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
}
