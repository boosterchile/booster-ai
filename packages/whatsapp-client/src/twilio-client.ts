import type { Logger } from '@booster-ai/logger';

/**
 * Cliente HTTP mínimo para Twilio Programmable Messaging API — WhatsApp.
 *
 * Twilio usa el formato `whatsapp:+E164` para los números From/To, y la API
 * acepta application/x-www-form-urlencoded con Basic auth (AccountSid:AuthToken).
 *
 * Docs: https://www.twilio.com/docs/whatsapp/api
 */

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';

export interface TwilioClientOptions {
  /** Twilio Account SID (empieza con AC...) */
  accountSid: string;
  /** Twilio Auth Token de la cuenta */
  authToken: string;
  /** Número WhatsApp Twilio en formato E.164 con `+` (ej: +19383365293).
   *  El cliente le antepone `whatsapp:` automáticamente. */
  fromNumber: string;
  /** Logger para trazar calls (con redaction de auth) */
  logger: Logger;
  /** Timeout por request en ms (default 10s) */
  timeoutMs?: number;
}

export interface SendTextParams {
  /** Destinatario en E.164 con `+` (ej: +56957790379).
   *  El cliente le antepone `whatsapp:` automáticamente. */
  to: string;
  /** Cuerpo del mensaje (max 1600 chars en WhatsApp via Twilio) */
  body: string;
}

export interface SendTextResponse {
  sid: string;
  status: string;
  to: string;
  from: string;
  body: string;
  date_created: string;
}

/**
 * Parámetros para enviar un Content Template aprobado.
 *
 * Necesario para mensajes fuera de la ventana de 24h (cuando el carrier
 * no envió un mensaje al bot recientemente). Meta exige template
 * pre-aprobado con categoría Utility o Marketing — Twilio gestiona la
 * aprobación cuando el template se crea desde Content Editor.
 *
 * Docs: https://www.twilio.com/docs/content/api/content-api-resources
 */
export interface SendContentParams {
  /** Destinatario en E.164 con `+`. El cliente antepone `whatsapp:`. */
  to: string;
  /** Content SID aprobado (formato `HX...`, 32 hex chars). */
  contentSid: string;
  /**
   * Variables del template indexadas por posición (1-based).
   * Ej. `{ "1": "BOO-1234", "2": "Santiago → Concepción" }` rellena
   * `{{1}}` y `{{2}}` del body. Si el template no tiene variables,
   * pasar `{}` o omitir.
   */
  contentVariables?: Record<string, string>;
}

export interface SendContentResponse extends SendTextResponse {
  // Twilio retorna la misma shape que sendText cuando se usa Content API.
  // El campo `body` viene resuelto con las variables ya sustituidas.
}

export class TwilioApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody: unknown,
  ) {
    super(message);
    this.name = 'TwilioApiError';
  }
}

export class TwilioWhatsAppClient {
  constructor(private readonly options: TwilioClientOptions) {}

  async sendText(params: SendTextParams): Promise<SendTextResponse> {
    const { accountSid, authToken, fromNumber, logger, timeoutMs = 10_000 } = this.options;

    const url = `${TWILIO_API_BASE}/Accounts/${accountSid}/Messages.json`;

    // Twilio expects whatsapp:+E164 prefix.
    const from = fromNumber.startsWith('whatsapp:') ? fromNumber : `whatsapp:${fromNumber}`;
    const to = params.to.startsWith('whatsapp:') ? params.to : `whatsapp:${params.to}`;

    const formBody = new URLSearchParams({
      From: from,
      To: to,
      Body: params.body,
    });

    // Basic auth: base64(AccountSid:AuthToken).
    const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: `Basic ${basicAuth}`,
        },
        body: formBody.toString(),
        signal: controller.signal,
      });

      const responseBody = (await response.json().catch(() => ({}))) as unknown;

      if (!response.ok) {
        logger.error(
          { status: response.status, response: responseBody, to: params.to },
          'Twilio API sendText failed',
        );
        throw new TwilioApiError(
          `Twilio API error: ${response.status}`,
          response.status,
          responseBody,
        );
      }

      logger.debug({ to: params.to, response: responseBody }, 'Twilio sendText ok');
      return responseBody as SendTextResponse;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Envía un mensaje basado en un Content Template aprobado por Meta.
   *
   * A diferencia de `sendText` (que solo funciona dentro de la ventana de
   * 24h), un template puede enviarse en cualquier momento al usuario.
   * Twilio aplica las variables al template del lado del servicio antes
   * de entregarlo a Meta.
   */
  async sendContent(params: SendContentParams): Promise<SendContentResponse> {
    const { accountSid, authToken, fromNumber, logger, timeoutMs = 10_000 } = this.options;

    const url = `${TWILIO_API_BASE}/Accounts/${accountSid}/Messages.json`;

    const from = fromNumber.startsWith('whatsapp:') ? fromNumber : `whatsapp:${fromNumber}`;
    const to = params.to.startsWith('whatsapp:') ? params.to : `whatsapp:${params.to}`;

    const formBody = new URLSearchParams({
      From: from,
      To: to,
      ContentSid: params.contentSid,
    });
    if (params.contentVariables && Object.keys(params.contentVariables).length > 0) {
      formBody.set('ContentVariables', JSON.stringify(params.contentVariables));
    }

    const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: `Basic ${basicAuth}`,
        },
        body: formBody.toString(),
        signal: controller.signal,
      });

      const responseBody = (await response.json().catch(() => ({}))) as unknown;

      if (!response.ok) {
        logger.error(
          {
            status: response.status,
            response: responseBody,
            to: params.to,
            contentSid: params.contentSid,
          },
          'Twilio API sendContent failed',
        );
        throw new TwilioApiError(
          `Twilio API error: ${response.status}`,
          response.status,
          responseBody,
        );
      }

      logger.debug(
        { to: params.to, contentSid: params.contentSid, response: responseBody },
        'Twilio sendContent ok',
      );
      return responseBody as SendContentResponse;
    } finally {
      clearTimeout(timeout);
    }
  }
}
