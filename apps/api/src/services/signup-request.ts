import { createHash } from 'node:crypto';
import type { Logger } from '@booster-ai/logger';
import { and, desc, eq } from 'drizzle-orm';
import type { Auth } from 'firebase-admin/auth';
import type { Db } from '../db/client.js';
import { solicitudesRegistro, users } from '../db/schema.js';
import type { SignupRequestNotifier } from './notifications/signup-request-email.js';
import { createOnboardingToken } from './onboarding-token.js';

/**
 * T8 SEC-001 Sprint 2b — service para `POST /api/v1/signup-request`
 * (sec-001-cierre §3 H1.2 SC-1.2.1 + SC-1.2.5).
 *
 * Inserta una solicitud `estado=pendiente_aprobacion` en `solicitudes_registro`
 * SI el email NO está en `users`. Si ya existe, NO escribe nada — el response
 * del caller es idéntico en ambos casos (202) para que un atacante no pueda
 * enumerar emails registrados a través del comportamiento del endpoint.
 *
 * **Email enumeration defense (SC-1.2.5)**: response identical es contrato
 * de la capa route; este servicio devuelve `{ outcome: 'submitted' | 'shadowed' }`
 * solamente para que la route loguee structured con correlation_id (sin
 * exponer el outcome al cliente). El log structured permite a Booster medir
 * la rate de shadowed vs submitted en monitoring sin filtrar al exterior.
 *
 * **Lowercase normalization**: email normalizado a lowercase ANTES del
 * SELECT users + INSERT — previene duplicates `Foo@x.cl` vs `foo@x.cl`.
 *
 * **Idempotency NO-PK (intentional)**: si el mismo email envía 2 solicitudes
 * mientras una está pendiente, ambas se insertan (mismo email, distinto
 * id uuid). El admin UI (T10) muestra solo la última pendiente — el dedup
 * vive en presentación, no en BD. Resubmit tras reject es feature explícita.
 */

export interface SubmitSignupRequestInput {
  email: string;
  nombreCompleto: string;
}

export type SubmitSignupRequestOutcome = 'submitted' | 'shadowed';

export interface SubmitSignupRequestResult {
  outcome: SubmitSignupRequestOutcome;
  /** Solo presente si outcome=submitted. Útil para tests + tracing. */
  signupRequestId?: string;
}

export async function submitSignupRequest(
  db: Db,
  logger: Logger,
  input: SubmitSignupRequestInput,
  correlationId: string,
): Promise<SubmitSignupRequestResult> {
  const emailLower = input.email.toLowerCase().trim();
  const nombreTrimmed = input.nombreCompleto.trim();

  const existingUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, emailLower))
    .limit(1);

  if (existingUser.length > 0) {
    // Email enumeration defense: no INSERT, no error al caller. Solo
    // structured log para que Booster pueda medir la rate de shadowed
    // (señal de attack o de UX confusion donde users registrados intentan
    // resignup).
    logger.info(
      { correlationId, outcome: 'shadowed', emailHashed: hashEmail(emailLower) },
      'signup-request: shadowed (email already in users)',
    );
    return { outcome: 'shadowed' };
  }

  const inserted = await db
    .insert(solicitudesRegistro)
    .values({
      email: emailLower,
      nombreCompleto: nombreTrimmed,
    })
    .returning({ id: solicitudesRegistro.id });

  const id = inserted[0]?.id;
  if (!id) {
    // Defensa: el INSERT debería siempre retornar el row. Si no, falla
    // ruidoso para que el caller responda 500 (el caller decide; aquí
    // throw evita propagar success silencioso).
    throw new Error('signup-request: INSERT did not return id');
  }

  logger.info(
    { correlationId, outcome: 'submitted', signupRequestId: id },
    'signup-request: submitted',
  );
  return { outcome: 'submitted', signupRequestId: id };
}

/**
 * Hash determinístico parcial del email para logging structured. No revela
 * el email completo (PII per Ley 19.628) pero permite correlation entre
 * logs distintos del mismo email. SHA-256 truncado a 16 hex chars (64 bits)
 * — suficiente collision-resistance para log correlation, no authenticator.
 */
function hashEmail(emailLower: string): string {
  return createHash('sha256').update(emailLower).digest('hex').slice(0, 16);
}

// ============================================================================
// T10 — Admin approve / reject flow (sec-001-cierre §3 H1.2 SC-1.2.1 completion)
// ============================================================================

export interface SignupRequestSummary {
  id: string;
  email: string;
  nombreCompleto: string;
  estado: 'pendiente_aprobacion' | 'aprobado' | 'rechazado';
  solicitadoEn: Date;
  aprobadoPor: string | null;
  aprobadoEn: Date | null;
}

/**
 * Lista pending signup-requests para la admin UI. Ordenado por más reciente
 * primero. Limit 500 para safety; expected cardinality es 10-50/mes.
 */
export async function listPendingSignupRequests(db: Db): Promise<SignupRequestSummary[]> {
  const rows = await db
    .select()
    .from(solicitudesRegistro)
    .where(eq(solicitudesRegistro.estado, 'pendiente_aprobacion'))
    .orderBy(desc(solicitudesRegistro.solicitadoEn))
    .limit(500);
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    nombreCompleto: r.nombreCompleto,
    estado: r.estado,
    solicitadoEn: r.solicitadoEn,
    aprobadoPor: r.aprobadoPor,
    aprobadoEn: r.aprobadoEn,
  }));
}

export type ApproveSignupRequestResult =
  | {
      outcome: 'approved';
      firebaseUid: string;
      /** `null` en modo admin-provisioned (no se precrea users; lo crea el onboarding). */
      userId: string | null;
      /** Token one-shot emitido (solo modo admin-provisioned). NUNCA exponerlo al admin. */
      onboardingToken?: string;
    }
  | { outcome: 'not_found' }
  | { outcome: 'already_processed' }
  | { outcome: 'firebase_user_already_exists' };

/**
 * Aprueba una signup-request: crea el Firebase User vía Admin SDK + INSERT
 * users + UPDATE estado=aprobado + notify user. Transaccional sobre la BD;
 * el Firebase createUser ocurre fuera de la transacción (Firebase no
 * participa en pg transactions), pero el orden garantiza que si Firebase
 * falla, NO se actualiza el row.
 *
 * Idempotency: si otra approve concurrente ya completó, el UPDATE WHERE
 * estado=pendiente_aprobacion retorna 0 rows → outcome=already_processed.
 *
 * Error cases:
 *   - `not_found`: id no existe en `solicitudes_registro`.
 *   - `already_processed`: race condition con otro admin (estado != pending).
 *   - `firebase_user_already_exists`: Firebase rechaza createUser (email-already-exists);
 *     el row queda intacto pendiente para revisión manual.
 */
export async function approveSignupRequest(
  db: Db,
  logger: Logger,
  auth: Auth,
  notifier: SignupRequestNotifier,
  opts: {
    id: string;
    approverEmail: string;
    loginLinkUrl: string;
    correlationId: string;
    /**
     * Presente ⇔ `ADMIN_PROVISIONED_ONBOARDING_ENABLED` ON (T1.3/T1.4). Cuando
     * está, el approve emite el token one-shot, persiste `token_hash`/`expira_en`/
     * `firebase_uid` y NO precrea el row `users` (el dueño completa el onboarding
     * consumiendo el token, T1.5a). Ausente ⇒ comportamiento viejo (precrea).
     */
    adminProvisionedOnboarding?: { signingSecret: string; ttlMs: number };
  },
): Promise<ApproveSignupRequestResult> {
  const foundRows = await db
    .select()
    .from(solicitudesRegistro)
    .where(eq(solicitudesRegistro.id, opts.id))
    .limit(1);
  const request = foundRows[0];
  if (!request) {
    logger.warn(
      { correlationId: opts.correlationId, requestId: opts.id },
      'signup-request.approve: not_found',
    );
    return { outcome: 'not_found' };
  }
  if (request.estado !== 'pendiente_aprobacion') {
    logger.warn(
      { correlationId: opts.correlationId, requestId: opts.id, estado: request.estado },
      'signup-request.approve: already_processed',
    );
    return { outcome: 'already_processed' };
  }

  // Firebase Admin SDK createUser. Si Firebase rechaza por email-already-
  // exists, el row queda pendiente para que el admin investigue manual.
  let firebaseUid: string;
  try {
    const fbUser = await auth.createUser({
      email: request.email,
      displayName: request.nombreCompleto,
      emailVerified: false,
    });
    firebaseUid = fbUser.uid;
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === 'auth/email-already-exists') {
      logger.warn(
        {
          correlationId: opts.correlationId,
          requestId: opts.id,
          firebaseErrorCode: code,
        },
        'signup-request.approve: firebase_user_already_exists',
      );
      return { outcome: 'firebase_user_already_exists' };
    }
    logger.error(
      { err, correlationId: opts.correlationId, requestId: opts.id },
      'signup-request.approve: Firebase Admin SDK createUser threw',
    );
    throw err;
  }

  // Modo admin-provisioned (flag ON): emite token one-shot, persiste
  // token_hash/expira_en/firebase_uid y NO precrea users (destraba el 409
  // approve→onboarding). El dueño consume el token en T1.5a. Un solo UPDATE
  // atómico — el WHERE estado=pendiente_aprobacion conserva el race-guard.
  const adminProvisioned = opts.adminProvisionedOnboarding;
  if (adminProvisioned) {
    const { token, tokenHash, expiraEn } = createOnboardingToken({
      solicitudId: opts.id,
      ttlMs: adminProvisioned.ttlMs,
      secret: adminProvisioned.signingSecret,
    });

    let raced = false;
    try {
      const updated = await db
        .update(solicitudesRegistro)
        .set({
          estado: 'aprobado',
          aprobadoPor: opts.approverEmail,
          aprobadoEn: new Date(),
          tokenHash,
          expiraEn,
          firebaseUid,
        })
        .where(
          and(
            eq(solicitudesRegistro.id, opts.id),
            eq(solicitudesRegistro.estado, 'pendiente_aprobacion'),
          ),
        )
        .returning({ id: solicitudesRegistro.id });
      raced = updated.length === 0;
    } catch (err) {
      logger.error(
        { err, correlationId: opts.correlationId, requestId: opts.id, firebaseUid },
        'signup-request.approve: DB update failed post-Firebase-createUser (admin-provisioned)',
      );
      throw err;
    }
    if (raced) {
      // Otro admin aprobó entre el SELECT y el UPDATE. Firebase user huérfano
      // (cleanup vía T1.7 usando firebase_uid). NO se emite el token al usuario.
      logger.warn(
        { correlationId: opts.correlationId, requestId: opts.id, firebaseUid },
        'signup-request.approve: already_processed (race post-Firebase-createUser; orphan Firebase user)',
      );
      return { outcome: 'already_processed' };
    }

    await notifier.notifyUserOfApproval({
      requestId: opts.id,
      userEmail: request.email,
      loginLinkUrl: opts.loginLinkUrl,
      correlationId: opts.correlationId,
      onboardingToken: token,
    });

    logger.info(
      {
        correlationId: opts.correlationId,
        requestId: opts.id,
        firebaseUid,
        approverEmail: opts.approverEmail,
        mode: 'admin_provisioned',
      },
      'signup-request.approve: success (admin-provisioned; token issued, no user precreated)',
    );
    return { outcome: 'approved', firebaseUid, userId: null, onboardingToken: token };
  }

  // Modo viejo (flag OFF): INSERT users + UPDATE solicitudes_registro en transacción.
  let userId: string;
  try {
    const result = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(users)
        .values({
          firebaseUid,
          email: request.email,
          fullName: request.nombreCompleto,
          status: 'pendiente_verificacion',
        })
        .returning({ id: users.id });

      const updated = await tx
        .update(solicitudesRegistro)
        .set({
          estado: 'aprobado',
          aprobadoPor: opts.approverEmail,
          aprobadoEn: new Date(),
        })
        .where(
          and(
            eq(solicitudesRegistro.id, opts.id),
            eq(solicitudesRegistro.estado, 'pendiente_aprobacion'),
          ),
        )
        .returning({ id: solicitudesRegistro.id });

      if (updated.length === 0) {
        // Race condition: otro admin aprobó entre el SELECT inicial y el UPDATE.
        // Rollback la transacción throwing — el INSERT users queda revertido,
        // y el Firebase User queda huérfano (TODO operacional cleanup manual).
        throw new Error('already_processed_race');
      }
      const insertedId = inserted[0]?.id;
      if (!insertedId) {
        throw new Error('users insert did not return id');
      }
      return { userId: insertedId };
    });
    userId = result.userId;
  } catch (err) {
    if (err instanceof Error && err.message === 'already_processed_race') {
      logger.warn(
        { correlationId: opts.correlationId, requestId: opts.id, firebaseUid },
        'signup-request.approve: already_processed (race detected post-Firebase-createUser; orphan Firebase user)',
      );
      return { outcome: 'already_processed' };
    }
    logger.error(
      { err, correlationId: opts.correlationId, requestId: opts.id, firebaseUid },
      'signup-request.approve: DB transaction failed post-Firebase-createUser',
    );
    throw err;
  }

  await notifier.notifyUserOfApproval({
    requestId: opts.id,
    userEmail: request.email,
    loginLinkUrl: opts.loginLinkUrl,
    correlationId: opts.correlationId,
  });

  logger.info(
    {
      correlationId: opts.correlationId,
      requestId: opts.id,
      firebaseUid,
      userId,
      approverEmail: opts.approverEmail,
    },
    'signup-request.approve: success',
  );
  return { outcome: 'approved', firebaseUid, userId };
}

export type RejectSignupRequestResult =
  | { outcome: 'rejected' }
  | { outcome: 'not_found' }
  | { outcome: 'already_processed' };

/**
 * Rechaza una signup-request: UPDATE estado=rechazado + notify user (opcional
 * reason). No toca Firebase ni users. Idempotency via WHERE estado=pendiente.
 */
export async function rejectSignupRequest(
  db: Db,
  logger: Logger,
  notifier: SignupRequestNotifier,
  opts: { id: string; approverEmail: string; reason?: string; correlationId: string },
): Promise<RejectSignupRequestResult> {
  const updated = await db
    .update(solicitudesRegistro)
    .set({
      estado: 'rechazado',
      aprobadoPor: opts.approverEmail,
      aprobadoEn: new Date(),
    })
    .where(
      and(
        eq(solicitudesRegistro.id, opts.id),
        eq(solicitudesRegistro.estado, 'pendiente_aprobacion'),
      ),
    )
    .returning({ id: solicitudesRegistro.id, email: solicitudesRegistro.email });

  const updatedRow = updated[0];
  if (!updatedRow) {
    // Distinguir between not_found vs already_processed con un SELECT.
    const found = await db
      .select({ estado: solicitudesRegistro.estado })
      .from(solicitudesRegistro)
      .where(eq(solicitudesRegistro.id, opts.id))
      .limit(1);
    const foundRow = found[0];
    if (!foundRow) {
      logger.warn(
        { correlationId: opts.correlationId, requestId: opts.id },
        'signup-request.reject: not_found',
      );
      return { outcome: 'not_found' };
    }
    logger.warn(
      { correlationId: opts.correlationId, requestId: opts.id, estado: foundRow.estado },
      'signup-request.reject: already_processed',
    );
    return { outcome: 'already_processed' };
  }

  await notifier.notifyUserOfRejection({
    requestId: opts.id,
    userEmail: updatedRow.email,
    ...(opts.reason ? { reason: opts.reason } : {}),
    correlationId: opts.correlationId,
  });

  logger.info(
    {
      correlationId: opts.correlationId,
      requestId: opts.id,
      approverEmail: opts.approverEmail,
      ...(opts.reason ? { reason: opts.reason } : {}),
    },
    'signup-request.reject: success',
  );
  return { outcome: 'rejected' };
}
