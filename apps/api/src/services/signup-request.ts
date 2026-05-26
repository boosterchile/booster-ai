import { createHash } from 'node:crypto';
import type { Logger } from '@booster-ai/logger';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { solicitudesRegistro, users } from '../db/schema.js';

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
