/**
 * Endpoint interno: POST /internal/safety-events
 *
 * Recibe un Pub/Sub PUSH envelope desde la suscripción del topic safety-p0,
 * autentica al caller via OIDC (service account email claim), valida el
 * SafetyEvent y despacha la notificación de seguridad.
 *
 * Auth: OIDC token con `email` claim == SAFETY_PUSH_CALLER_SA.
 * Audience: config.API_AUDIENCE (idéntico al patrón admin-jobs).
 * Fail-closed: si SAFETY_PUSH_CALLER_SA no está configurado, rechaza todo (403).
 *
 * Códigos de estado:
 *   200  — éxito o ACK deliberado (vehicle desconocido, deduplicado).
 *   400  — envelope o evento malformado → Pub/Sub NO reintenta.
 *   401  — token Authorization ausente o JWT inválido.
 *   403  — JWT válido pero SA no autorizado, o SAFETY_PUSH_CALLER_SA no configurado.
 *   500  — error inesperado en routing o dispatch → Pub/Sub reintenta (→ DLQ).
 */

import type { Logger } from '@booster-ai/logger';
import { safetyEventSchema } from '@booster-ai/shared-schemas';
import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import { Hono } from 'hono';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import type { DispatchOutcome } from '../services/dispatch-safety-notification.js';
import { dispatchSafetyNotification } from '../services/dispatch-safety-notification.js';
import type { SafetyRouting } from '../services/route-safety-recipients.js';
import { routeSafetyRecipients } from '../services/route-safety-recipients.js';
import { sendPushToUser } from '../services/web-push.js';

/**
 * Schema del envelope de push de Pub/Sub.
 * Ref: https://cloud.google.com/pubsub/docs/push#receive_push
 */
const pubsubPushEnvelopeSchema = z.object({
  message: z.object({
    data: z.string(),
    attributes: z.record(z.string()).optional(),
    messageId: z.string(),
  }),
  subscription: z.string(),
});

export interface InternalSafetyEventsConfig {
  /** Email del SA autorizado a invocar este endpoint (SAFETY_PUSH_CALLER_SA). */
  safetyPushCallerSa: string | undefined;
  /** Audiences aceptadas para verifyIdToken (config.API_AUDIENCE). */
  apiAudience: readonly string[];
  /** Content SID del template Twilio safety_alert_v1 (CONTENT_SID_SAFETY_ALERT). */
  contentSidSafetyAlert: string | undefined;
}

export function createInternalSafetyEventsRoutes(opts: {
  db: Db;
  redis: Redis;
  logger: Logger;
  config: InternalSafetyEventsConfig;
  sendWhatsapp: (a: {
    to: string;
    contentSid: string;
    contentVariables: Record<string, string>;
  }) => Promise<unknown>;
  /**
   * OAuth2Client inyectable para tests (permite stubbear verifyIdToken sin
   * pegarle a la red). En producción se crea una instancia por default.
   */
  oauthClient?: OAuth2Client;
  /**
   * Función de routing inyectable para tests. Por default usa la implementación real.
   */
  routeRecipients?: (opts: {
    db: Db;
    imei: string;
    vehicleId?: string;
  }) => Promise<SafetyRouting | null>;
  /**
   * Función de dispatch inyectable para tests. Por default usa la implementación real.
   */
  dispatch?: (opts: {
    redis: Redis;
    db: Db;
    logger: Logger;
    event: z.infer<typeof safetyEventSchema>;
    routing: SafetyRouting;
    contentSidSafety?: string;
    sendPush: (a: {
      db: Db;
      logger: Logger;
      userId: string;
      payload: {
        title: string;
        body: string;
        tag: string;
        data: { assignment_id: string; message_id: string; url: string };
      };
    }) => Promise<unknown>;
    sendWhatsapp: (a: {
      to: string;
      contentSid: string;
      contentVariables: Record<string, string>;
    }) => Promise<unknown>;
  }) => Promise<DispatchOutcome>;
}) {
  const app = new Hono();

  const oauthClient = opts.oauthClient ?? new OAuth2Client();
  const apiAudienceMutable = [...opts.config.apiAudience];

  const routeRecipientsFn = opts.routeRecipients ?? routeSafetyRecipients;
  const dispatchFn = opts.dispatch ?? dispatchSafetyNotification;

  app.post('/', async (c) => {
    // ── 1. Auth: fail-closed si SA no configurado ─────────────────────────
    const { safetyPushCallerSa } = opts.config;
    if (!safetyPushCallerSa) {
      opts.logger.warn('internal-safety-events: SAFETY_PUSH_CALLER_SA no configurado, rechazando');
      return c.json({ error: 'Caller not allowed' }, 403);
    }

    // ── 2. Extraer Bearer token ───────────────────────────────────────────
    const authHeader = c.req.header('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      opts.logger.warn('internal-safety-events: Authorization header ausente');
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const token = authHeader.slice('Bearer '.length).trim();

    // ── 3. Verificar JWT (firma + aud + exp via google-auth-library) ──────
    let payload: TokenPayload | undefined;
    try {
      const ticket = await oauthClient.verifyIdToken({
        idToken: token,
        audience: apiAudienceMutable,
      });
      payload = ticket.getPayload();
    } catch (err: unknown) {
      opts.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'internal-safety-events: JWT verification failed',
      );
      return c.json({ error: 'Invalid token' }, 401);
    }

    if (!payload) {
      opts.logger.warn('internal-safety-events: JWT payload vacío tras verificación');
      return c.json({ error: 'Invalid token' }, 401);
    }

    // ── 4. Whitelist del email del SA caller ──────────────────────────────
    if (payload.email !== safetyPushCallerSa) {
      opts.logger.warn(
        { email: payload.email, expected: safetyPushCallerSa },
        'internal-safety-events: SA caller no permitido',
      );
      return c.json({ error: 'Caller not allowed' }, 403);
    }

    // ── 5. Parsear envelope Pub/Sub ───────────────────────────────────────
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      opts.logger.warn('internal-safety-events: body no es JSON válido');
      return c.json({ error: 'Invalid request body' }, 400);
    }

    const envelopeResult = pubsubPushEnvelopeSchema.safeParse(body);
    if (!envelopeResult.success) {
      opts.logger.warn(
        { issues: envelopeResult.error.issues },
        'internal-safety-events: envelope Pub/Sub inválido',
      );
      return c.json(
        { error: 'Invalid Pub/Sub envelope', details: envelopeResult.error.issues },
        400,
      );
    }

    const envelope = envelopeResult.data;

    // ── 6. Decodificar y validar el SafetyEvent ───────────────────────────
    let rawEvent: unknown;
    try {
      rawEvent = JSON.parse(Buffer.from(envelope.message.data, 'base64').toString('utf8'));
    } catch {
      opts.logger.warn(
        { messageId: envelope.message.messageId },
        'internal-safety-events: message.data no es JSON válido tras base64 decode',
      );
      return c.json({ error: 'Invalid event data' }, 400);
    }

    const eventResult = safetyEventSchema.safeParse(rawEvent);
    if (!eventResult.success) {
      opts.logger.warn(
        { issues: eventResult.error.issues, messageId: envelope.message.messageId },
        'internal-safety-events: SafetyEvent inválido',
      );
      return c.json({ error: 'Invalid SafetyEvent', details: eventResult.error.issues }, 400);
    }

    const event = eventResult.data;

    // ── 7. Routing ────────────────────────────────────────────────────────
    let routing: SafetyRouting | null;
    try {
      routing = await routeRecipientsFn({
        db: opts.db,
        imei: event.imei,
        ...(event.vehicleId !== undefined ? { vehicleId: event.vehicleId } : {}),
      });
    } catch (err: unknown) {
      opts.logger.error(
        { err, imei: event.imei, eventType: event.eventType },
        'internal-safety-events: error inesperado en routeSafetyRecipients',
      );
      return c.json({ error: 'internal_error' }, 500);
    }

    if (routing === null) {
      opts.logger.warn(
        { imei: event.imei, eventType: event.eventType },
        'internal-safety-events: vehículo desconocido, ACK sin notificación',
      );
      return c.json({ outcome: 'unknown_vehicle' }, 200);
    }

    // ── 8. Dispatch ───────────────────────────────────────────────────────
    let outcome: DispatchOutcome;
    try {
      outcome = await dispatchFn({
        redis: opts.redis,
        db: opts.db,
        logger: opts.logger,
        event,
        routing,
        ...(opts.config.contentSidSafetyAlert !== undefined
          ? { contentSidSafety: opts.config.contentSidSafetyAlert }
          : {}),
        sendPush: sendPushToUser,
        sendWhatsapp: opts.sendWhatsapp,
      });
    } catch (err: unknown) {
      opts.logger.error(
        { err, imei: event.imei, eventType: event.eventType },
        'internal-safety-events: error inesperado en dispatchSafetyNotification',
      );
      return c.json({ error: 'internal_error' }, 500);
    }

    // ── 9. Structured log final ───────────────────────────────────────────
    opts.logger.info(
      {
        imei: event.imei,
        eventType: event.eventType,
        outcome,
        messageId: envelope.message.messageId,
      },
      'internal-safety-events: procesado',
    );

    return c.json({ outcome }, 200);
  });

  return app;
}
