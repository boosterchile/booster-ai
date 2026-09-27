import { createHash } from 'node:crypto';
import type { Logger } from '@booster-ai/logger';
import { eq } from 'drizzle-orm';
import type { Auth } from 'firebase-admin/auth';
import type { Db } from '../db/client.js';
import { solicitudesRegistro, users } from '../db/schema.js';
import { decidirAltaExencion } from './decidir-alta-exencion.js';
import type { SignupRequestNotifier } from './notifications/signup-request-email.js';
import { approveSignupRequest } from './signup-request.js';

/**
 * Alta por exención del platform-admin (`.specs/alta-membresia` fase 1).
 *
 * Inserta una `solicitudes_registro` y la aprueba en modo admin-provisioned:
 * el dueño todavía no existe. El token one-shot lo entrega la ruta, solo en
 * la respuesta al admin. Este módulo exige el secreto de firma: sin él el
 * caller responde 503 y no llega acá, para no caer al approve que precrea
 * `usuarios`.
 */

export interface EmitirAltaExencionInput {
  email: string;
  nombreCompleto: string;
  approverEmail: string;
  correlationId: string;
  loginLinkUrl: string;
  adminProvisionedOnboarding: { signingSecret: string; ttlMs: number };
}

export type EmitirAltaExencionResult =
  | {
      outcome: 'issued';
      solicitudId: string;
      firebaseUid: string;
      onboardingToken: string;
      onboardingTokenExpiresAt: Date;
    }
  | {
      outcome:
        | 'email_already_registered'
        | 'alta_ya_emitida'
        | 'solicitud_pendiente'
        | 'firebase_user_already_exists';
    };

function hashEmail(emailLower: string): string {
  return createHash('sha256').update(emailLower).digest('hex').slice(0, 16);
}

export async function emitirAltaExencion(
  db: Db,
  logger: Logger,
  auth: Auth,
  notifier: SignupRequestNotifier,
  input: EmitirAltaExencionInput,
): Promise<EmitirAltaExencionResult> {
  const emailLower = input.email.toLowerCase().trim();
  const nombreTrimmed = input.nombreCompleto.trim();

  const existingUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, emailLower))
    .limit(1);

  const solicitudes = await db
    .select({ id: solicitudesRegistro.id, estado: solicitudesRegistro.estado })
    .from(solicitudesRegistro)
    .where(eq(solicitudesRegistro.email, emailLower))
    .limit(20);

  const decision = decidirAltaExencion({
    usuarioExiste: existingUser.length > 0,
    solicitudes,
  });

  if (decision.accion === 'rechazar') {
    logger.info(
      {
        correlationId: input.correlationId,
        outcome: decision.codigo,
        emailHashed: hashEmail(emailLower),
      },
      'alta.exencion: rechazada antes de aprobar',
    );
    return { outcome: decision.codigo };
  }

  const inserted = await db
    .insert(solicitudesRegistro)
    .values({
      email: emailLower,
      nombreCompleto: nombreTrimmed,
    })
    .returning({ id: solicitudesRegistro.id });
  const solicitudId = inserted[0]?.id;
  if (!solicitudId) {
    throw new Error('alta.exencion: INSERT solicitudes_registro no devolvió id');
  }

  const approved = await approveSignupRequest(db, logger, auth, notifier, {
    id: solicitudId,
    approverEmail: input.approverEmail,
    loginLinkUrl: input.loginLinkUrl,
    correlationId: input.correlationId,
    adminProvisionedOnboarding: input.adminProvisionedOnboarding,
  });

  if (approved.outcome === 'firebase_user_already_exists') {
    return { outcome: 'firebase_user_already_exists' };
  }
  if (approved.outcome === 'already_processed') {
    return { outcome: 'alta_ya_emitida' };
  }
  if (
    approved.outcome !== 'approved' ||
    !approved.onboardingToken ||
    !approved.onboardingTokenExpiresAt
  ) {
    logger.error(
      { correlationId: input.correlationId, solicitudId, outcome: approved.outcome },
      'alta.exencion: approve no emitió token',
    );
    throw new Error('alta.exencion: approve no emitió token');
  }

  logger.info(
    {
      correlationId: input.correlationId,
      solicitudId,
      firebaseUid: approved.firebaseUid,
      approverEmail: input.approverEmail,
      mode: 'exencion_admin',
    },
    'alta.exencion: enlace emitido',
  );

  return {
    outcome: 'issued',
    solicitudId,
    firebaseUid: approved.firebaseUid,
    onboardingToken: approved.onboardingToken,
    onboardingTokenExpiresAt: approved.onboardingTokenExpiresAt,
  };
}
