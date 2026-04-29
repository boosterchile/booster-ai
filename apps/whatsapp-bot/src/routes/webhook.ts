import type { Logger } from '@booster-ai/logger';
import { type CargoType, chileanPhoneSchema } from '@booster-ai/shared-schemas';
import { type TwilioWhatsAppClient, verifyTwilioSignature } from '@booster-ai/whatsapp-client';
import { Hono } from 'hono';
import { PROMPTS } from '../conversation/prompts.js';
import type { ConversationStore } from '../conversation/store.js';
import type { ApiClient } from '../services/api-client.js';

/**
 * Routes del webhook Twilio:
 *   POST /webhooks/whatsapp — recepción de mensajes inbound firmados HMAC-SHA1
 *
 * Twilio NO usa un GET handshake como Meta — cada POST es directo y el bot
 * valida via X-Twilio-Signature.
 *
 * Body de Twilio es application/x-www-form-urlencoded con campos como:
 *   From=whatsapp:+56957790379
 *   To=whatsapp:+19383365293
 *   Body=hola
 *   MessageSid=SMxxx
 *   AccountSid=ACxxx
 *   ProfileName=John
 *   WaId=56957790379
 *   ...
 */
export function createWebhookRoutes(opts: {
  store: ConversationStore;
  whatsAppClient: TwilioWhatsAppClient;
  apiClient: ApiClient;
  authToken: string;
  webhookUrl: string;
  logger: Logger;
}) {
  const { store, whatsAppClient, apiClient, authToken, webhookUrl, logger } = opts;
  const app = new Hono();

  // Twilio no usa GET handshake. Si pinguean GET, devolvemos 200 vacío para health-check
  // de la consola Twilio (Twilio a veces pinguea GET para validar TLS).
  app.get('/webhooks/whatsapp', (c) => c.text('OK', 200));

  // --- Twilio webhook message handler ---
  app.post('/webhooks/whatsapp', async (c) => {
    const rawBody = await c.req.text();
    const signatureHeader = c.req.header('x-twilio-signature');

    // Body de Twilio viene form-encoded (no JSON).
    const params: Record<string, string> = {};
    const searchParams = new URLSearchParams(rawBody);
    for (const [key, value] of searchParams.entries()) {
      params[key] = value;
    }

    if (!verifyTwilioSignature(authToken, signatureHeader, webhookUrl, params)) {
      logger.warn(
        { signatureProvided: !!signatureHeader, signatureLen: signatureHeader?.length },
        'Twilio webhook signature invalid',
      );
      return c.text('Forbidden', 403);
    }

    const from = params.From; // "whatsapp:+56957790379"
    const body = params.Body ?? '';
    const messageSid = params.MessageSid ?? '';

    if (!from || !from.startsWith('whatsapp:')) {
      logger.warn({ from }, 'Webhook payload missing/invalid From');
      return c.text('Bad request', 400);
    }

    // Strip "whatsapp:" prefix → +E164
    const phoneE164 = from.slice('whatsapp:'.length);

    // Twilio puede mandar status callbacks (delivered, read) y otros eventos
    // que no son mensajes de texto del user. Detectamos por la presencia de Body.
    if (!body) {
      logger.debug({ messageSid, params }, 'ignoring non-text webhook event');
      return c.text('EVENT_RECEIVED', 200);
    }

    // Procesar de forma síncrona en el thin slice (Twilio retry policy es
    // razonable y el procesamiento total es <5s p99).
    try {
      await handleTextMessage({
        phoneE164,
        text: body,
        store,
        whatsAppClient,
        apiClient,
        logger,
      });
    } catch (err) {
      logger.error({ err, messageSid }, 'Error processing webhook — returning 200 anyway');
      // Responder 200 igual: si devolvemos 5xx, Twilio retry. Errores quedan en logs.
    }

    return c.text('EVENT_RECEIVED', 200);
  });

  return app;
}

/**
 * Procesa un mensaje de texto inbound:
 * 1. Carga/crea sesión del shipper (por número E.164).
 * 2. Envía evento USER_MESSAGE al state machine.
 * 3. Lee el estado resultante y manda el prompt correspondiente.
 * 4. Si llegamos al estado 'submitted' → llama al api y limpia la sesión.
 */
async function handleTextMessage(args: {
  phoneE164: string;
  text: string;
  store: ConversationStore;
  whatsAppClient: TwilioWhatsAppClient;
  apiClient: ApiClient;
  logger: Logger;
}): Promise<void> {
  const { phoneE164, text, store, whatsAppClient, apiClient, logger } = args;

  const phoneCheck = chileanPhoneSchema.safeParse(phoneE164);
  if (!phoneCheck.success) {
    logger.info({ phoneE164 }, 'non-Chilean phone, ignoring');
    return;
  }

  const session = store.getOrCreate(phoneE164);
  const stateBefore = session.actor.getSnapshot().value;
  session.actor.send({ type: 'USER_MESSAGE', text });
  const snapshot = session.actor.getSnapshot();
  const stateAfter = snapshot.value;

  logger.debug({ stateBefore, stateAfter }, 'conversation transition');

  const reply = resolvePrompt(stateAfter);
  if (reply) {
    await whatsAppClient.sendText({ to: phoneE164, body: reply });
  }

  if (snapshot.status === 'done') {
    if (stateAfter === 'submitted') {
      await submitIntake({
        session,
        phoneE164,
        apiClient,
        whatsAppClient,
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
  whatsAppClient: TwilioWhatsAppClient;
  logger: Logger;
}): Promise<void> {
  const { session, phoneE164, apiClient, whatsAppClient, logger } = args;
  const ctx = session.actor.getSnapshot().context;

  if (!ctx.originAddressRaw || !ctx.destinationAddressRaw || !ctx.cargoType || !ctx.pickupDateRaw) {
    logger.error({ ctx }, 'Incomplete context at submit time');
    await whatsAppClient.sendText({
      to: phoneE164,
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
      to: phoneE164,
      body: PROMPTS.confirmed(result.tracking_code),
    });
    logger.info({ trackingCode: result.tracking_code }, 'intake submitted');
  } catch (err) {
    logger.error({ err }, 'Failed to create trip request via api');
    await whatsAppClient.sendText({
      to: phoneE164,
      body: 'Ups, no pudimos registrar tu solicitud ahora. Intenta de nuevo en unos minutos escribiendo "hola".',
    });
  }
}

function resolvePrompt(state: unknown): string | null {
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
      return null;
    default:
      return null;
  }
}
