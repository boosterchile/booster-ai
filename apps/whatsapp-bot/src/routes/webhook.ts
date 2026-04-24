import type { Logger } from '@booster-ai/logger';
import {
  type CargoType,
  WhatsAppWebhookPayload,
  chileanPhoneSchema,
  isTextMessage,
} from '@booster-ai/shared-schemas';
import { type WhatsAppClient, verifyMetaSignature } from '@booster-ai/whatsapp-client';
import { Hono } from 'hono';
import { PROMPTS } from '../conversation/prompts.js';
import type { ConversationStore } from '../conversation/store.js';
import type { ApiClient } from '../services/api-client.js';

/**
 * Routes del webhook Meta:
 *   GET  /webhook — verificación inicial (hub.challenge)
 *   POST /webhook — recepción de mensajes inbound firmados HMAC
 */
export function createWebhookRoutes(opts: {
  store: ConversationStore;
  whatsAppClient: WhatsAppClient;
  apiClient: ApiClient;
  appSecret: string;
  verifyToken: string;
  logger: Logger;
}) {
  const { store, whatsAppClient, apiClient, appSecret, verifyToken, logger } = opts;
  const app = new Hono();

  // --- Meta webhook verification handshake ---
  app.get('/webhooks/whatsapp', (c) => {
    const mode = c.req.query('hub.mode');
    const token = c.req.query('hub.verify_token');
    const challenge = c.req.query('hub.challenge');

    if (mode === 'subscribe' && token === verifyToken && challenge) {
      logger.info('Webhook verification succeeded');
      return c.text(challenge, 200);
    }

    logger.warn({ mode }, 'Webhook verification failed');
    return c.text('Forbidden', 403);
  });

  // --- Meta webhook message handler ---
  app.post('/webhooks/whatsapp', async (c) => {
    // Crítico: leer body raw ANTES de parse para verificación HMAC.
    const rawBody = await c.req.text();
    const signatureHeader = c.req.header('x-hub-signature-256');

    if (!verifyMetaSignature(rawBody, signatureHeader, appSecret)) {
      logger.warn('Webhook signature invalid');
      return c.text('Forbidden', 403);
    }

    // Parse + validar con Zod.
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return c.text('Bad request', 400);
    }

    const parsed = WhatsAppWebhookPayload.safeParse(payload);
    if (!parsed.success) {
      logger.warn({ issues: parsed.error.issues }, 'Webhook payload shape invalid');
      return c.text('Bad request', 400);
    }

    // Meta manda at-least-once → responder 200 rápido y procesar asíncronamente.
    // En el thin slice lo hacemos sincrónicamente por simplicidad (<5s p99).
    try {
      for (const entry of parsed.data.entry) {
        for (const change of entry.changes) {
          const messages = change.value.messages ?? [];
          for (const message of messages) {
            if (!isTextMessage(message)) {
              logger.debug({ type: message.type }, 'ignoring non-text message');
              continue;
            }
            await handleTextMessage({
              waId: message.from,
              messageId: message.id,
              text: message.text.body,
              store,
              whatsAppClient,
              apiClient,
              logger,
            });
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error processing webhook — returning 200 anyway');
      // Responder 200 igual: si devolvemos 5xx, Meta va a retry indefinidamente.
      // Los errores quedan en Cloud Logging + eventual DLQ.
    }

    return c.text('EVENT_RECEIVED', 200);
  });

  return app;
}

/**
 * Procesa un mensaje de texto inbound:
 * 1. Carga/crea sesión del shipper (por wa_id).
 * 2. Envía evento USER_MESSAGE al state machine.
 * 3. Lee el estado resultante y manda el prompt correspondiente.
 * 4. Si llegamos al estado 'submitted' → llama al api y limpia la sesión.
 */
async function handleTextMessage(args: {
  waId: string;
  messageId: string;
  text: string;
  store: ConversationStore;
  whatsAppClient: WhatsAppClient;
  apiClient: ApiClient;
  logger: Logger;
}): Promise<void> {
  const { waId, text, store, whatsAppClient, apiClient, logger } = args;

  // Meta manda wa_id sin "+". Normalizamos a E.164 chileno +56...
  const phoneE164 = `+${waId}`;
  const phoneCheck = chileanPhoneSchema.safeParse(phoneE164);
  if (!phoneCheck.success) {
    // Número fuera de Chile o formato no soportado — responder cortésmente.
    logger.info({ waId }, 'non-Chilean phone, ignoring');
    return;
  }

  const session = store.getOrCreate(phoneE164);
  const stateBefore = session.actor.getSnapshot().value;
  session.actor.send({ type: 'USER_MESSAGE', text });
  const snapshot = session.actor.getSnapshot();
  const stateAfter = snapshot.value;

  logger.debug({ stateBefore, stateAfter }, 'conversation transition');

  // Mapear estado → prompt a enviar.
  const reply = resolvePrompt(stateAfter);
  if (reply) {
    await whatsAppClient.sendText({ to: waId, body: reply });
  }

  // Estado final: submit o cancel.
  if (snapshot.status === 'done') {
    if (stateAfter === 'submitted') {
      await submitIntake({
        session,
        phoneE164,
        apiClient,
        whatsAppClient,
        waId,
        logger,
      });
    }
    store.remove(phoneE164);
  }
}

async function submitIntake(args: {
  session: ReturnType<ConversationStore['getOrCreate']>;
  phoneE164: string;
  apiClient: ApiClient;
  whatsAppClient: WhatsAppClient;
  waId: string;
  logger: Logger;
}): Promise<void> {
  const { session, phoneE164, apiClient, whatsAppClient, waId, logger } = args;
  const ctx = session.actor.getSnapshot().context;

  if (!ctx.originAddressRaw || !ctx.destinationAddressRaw || !ctx.cargoType || !ctx.pickupDateRaw) {
    // No debería pasar si el state machine está bien definido, pero defendemos.
    logger.error({ ctx }, 'Incomplete context at submit time');
    await whatsAppClient.sendText({
      to: waId,
      body: 'Ups, algo salió mal con tu solicitud. Escribe "hola" para empezar de nuevo.',
    });
    return;
  }

  try {
    const result = await apiClient.createTripRequest({
      shipper_whatsapp: phoneE164,
      origin_address_raw: ctx.originAddressRaw,
      destination_address_raw: ctx.destinationAddressRaw,
      cargo_type: ctx.cargoType as CargoType,
      pickup_date_raw: ctx.pickupDateRaw,
    });

    await whatsAppClient.sendText({
      to: waId,
      body: PROMPTS.confirmed(result.tracking_code),
    });
    logger.info({ trackingCode: result.tracking_code }, 'intake submitted');
  } catch (err) {
    logger.error({ err }, 'Failed to create trip request via api');
    await whatsAppClient.sendText({
      to: waId,
      body: 'Ups, no pudimos registrar tu solicitud ahora. Intenta de nuevo en unos minutos escribiendo "hola".',
    });
  }
}

function resolvePrompt(state: unknown): string | null {
  // state puede ser string simple ("greeting") o objeto nested — en esta
  // máquina todos los estados son simples strings de primer nivel.
  if (typeof state !== 'string') {
    return null;
  }

  switch (state) {
    case 'greeting':
      return PROMPTS.greeting;
    case 'greetingInvalid':
      return PROMPTS.invalidMenuOption;
    case 'menuLookupNotImplemented':
      return PROMPTS.menuLookupNotImplemented;
    case 'askOrigin':
      return PROMPTS.askOrigin;
    case 'askDestination':
      return PROMPTS.askDestination;
    case 'askCargoType':
      return PROMPTS.askCargoType;
    case 'askCargoTypeInvalid':
      return PROMPTS.invalidCargoOption;
    case 'askPickupDate':
      return PROMPTS.askPickupDate;
    case 'cancelled':
      return PROMPTS.cancelled;
    case 'submitted':
      // El mensaje de confirmación lo manda submitIntake() con el tracking code.
      return null;
    default:
      return null;
  }
}
