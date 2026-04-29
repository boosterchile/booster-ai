import type { Logger } from '@booster-ai/logger';
import { type CargoType, chileanPhoneSchema } from '@booster-ai/shared-schemas';
import { type TwilioWhatsAppClient, verifyTwilioSignature } from '@booster-ai/whatsapp-client';
import { Hono } from 'hono';
import type Redis from 'ioredis';
import { PROMPTS } from '../conversation/prompts.js';
import type { ConversationStore } from '../conversation/store.js';
import type { ApiClient } from '../services/api-client.js';

/** TTL del dedup key — match con la ventana razonable de retries de Twilio. */
const DEDUP_TTL_SECONDS = 60 * 60; // 1h

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
  redis: Redis;
  authToken: string;
  webhookUrl: string;
  logger: Logger;
}) {
  const { store, whatsAppClient, apiClient, redis, authToken, webhookUrl, logger } = opts;
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

    // Idempotencia: Twilio retry-ea webhooks que devuelven 5xx (y a veces
    // por timeout en su side aunque hayamos respondido OK). SET NX en Redis
    // garantiza que cada MessageSid se procesa exactamente una vez dentro
    // de la ventana TTL. Si Redis está caído, fail-open: procesamos igual
    // (mejor reprocessar 1 mensaje que dejarlo sin atender).
    if (messageSid) {
      try {
        const dedupKey = `bot:dedup:${messageSid}`;
        const result = await redis.set(dedupKey, '1', 'EX', DEDUP_TTL_SECONDS, 'NX');
        if (result !== 'OK') {
          logger.info({ messageSid }, 'duplicate webhook (already processed) — ack-200 noop');
          return c.text('EVENT_RECEIVED', 200);
        }
      } catch (err) {
        logger.warn({ err, messageSid }, 'redis dedup failed, processing anyway');
      }
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

  // --- Twilio status callback handler ---
  // Twilio postea acá cuando un mensaje cambia de status (queued, sent,
  // delivered, read, failed, undelivered). Lo configuramos en Twilio
  // sandbox/sender settings → "Status callback URL".
  //
  // Body típico (form-encoded):
  //   MessageSid=SMxxx
  //   MessageStatus=delivered
  //   To=whatsapp:+56957790379
  //   From=whatsapp:+14155238886
  //   ChannelInstallSid=...
  //   ApiVersion=2010-04-01
  //   ErrorCode=63016 (solo si failed)
  //   ErrorMessage=... (solo si failed)
  //
  // Por ahora persistimos via structured logs en Cloud Logging — desde ahí
  // pueden sinkearse a BigQuery para analytics. Iteración futura: tabla
  // dedicated `whatsapp_message_log` para queries low-latency.
  app.post('/webhooks/twilio-status', async (c) => {
    const rawBody = await c.req.text();
    const signatureHeader = c.req.header('x-twilio-signature');

    const params: Record<string, string> = {};
    for (const [key, value] of new URLSearchParams(rawBody).entries()) {
      params[key] = value;
    }

    // Twilio firma con la URL configurada en Twilio console — necesita ser la
    // URL del status callback, no la del inbound webhook. Aceptamos ambas
    // para flexibilidad (si admin configura status callback en una URL
    // distinta, debe setear STATUS_WEBHOOK_URL env var; default = webhookUrl
    // con path /twilio-status).
    const statusWebhookUrl = `${webhookUrl.replace(/\/webhooks\/whatsapp$/, '')}/webhooks/twilio-status`;

    if (!verifyTwilioSignature(authToken, signatureHeader, statusWebhookUrl, params)) {
      logger.warn(
        { signatureProvided: !!signatureHeader },
        'Twilio status callback signature invalid',
      );
      return c.text('Forbidden', 403);
    }

    const status = params.MessageStatus;
    const isFailed = status === 'failed' || status === 'undelivered';

    // Loggeamos con severity proporcional. Cloud Logging permite filtrar por
    // severity para alerts en delivery failures.
    const logFn = isFailed ? logger.error : logger.info;
    logFn.call(
      logger,
      {
        messageSid: params.MessageSid,
        messageStatus: status,
        to: params.To,
        from: params.From,
        errorCode: params.ErrorCode,
        errorMessage: params.ErrorMessage,
      },
      `twilio status: ${status}`,
    );

    return c.text('OK', 200);
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

  const session = await store.load(phoneE164);
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
    await store.remove(phoneE164);
  } else {
    // Persistir el snapshot actualizado para que el próximo mensaje del mismo
    // shipper retome desde acá (incluso si lo procesa otra instancia del bot).
    await store.save(session);
  }
}

async function submitIntake(args: {
  session: Awaited<ReturnType<ConversationStore['load']>>;
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
