import type { Logger } from '@booster-ai/logger';

/**
 * Cliente HTTP mínimo para Meta Graph API v20.0 — WhatsApp Business Cloud API.
 *
 * Scope del thin slice (Fase 6): sólo enviar mensajes de texto (sendText).
 * Features pospuestas a slices siguientes:
 *   - Templates (requeridos para mensajes fuera de la ventana de 24h)
 *   - Interactive messages (botones, listas) para UX mejorada
 *   - Media (imágenes, documentos) para compartir guías de despacho
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
 */

const GRAPH_API_VERSION = 'v20.0';
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export interface WhatsAppClientOptions {
  /** Phone Number ID asignado por Meta (distinto del número E.164) */
  phoneNumberId: string;
  /** Access token de larga duración (Business System User Token) */
  accessToken: string;
  /** Logger para trazar calls (con redaction de token) */
  logger: Logger;
  /** Timeout por request en ms (default 10s) */
  timeoutMs?: number;
}

export interface SendTextParams {
  /** Destinatario en formato E.164 sin el "+" (como Meta lo espera) */
  to: string;
  /** Cuerpo del mensaje (max 4096 chars por Meta) */
  body: string;
  /**
   * Si se provee, marca este mensaje como respuesta a uno existente (UI nicer).
   * Es el `message.id` que Meta asignó al mensaje original del user.
   */
  replyTo?: string;
}

export interface SendTextResponse {
  messaging_product: 'whatsapp';
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string; message_status?: string }>;
}

export class WhatsAppApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody: unknown,
  ) {
    super(message);
    this.name = 'WhatsAppApiError';
  }
}

export class WhatsAppClient {
  constructor(private readonly options: WhatsAppClientOptions) {}

  async sendText(params: SendTextParams): Promise<SendTextResponse> {
    const { phoneNumberId, accessToken, logger, timeoutMs = 10_000 } = this.options;

    const url = `${GRAPH_API_BASE}/${phoneNumberId}/messages`;

    // Shape per https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages#text-object
    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: params.to,
      type: 'text',
      text: { body: params.body, preview_url: false },
    };
    if (params.replyTo) {
      payload.context = { message_id: params.replyTo };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const responseBody = (await response.json().catch(() => ({}))) as unknown;

      if (!response.ok) {
        logger.error(
          { status: response.status, response: responseBody, to: params.to },
          'WhatsApp API sendText failed',
        );
        throw new WhatsAppApiError(
          `WhatsApp API error: ${response.status}`,
          response.status,
          responseBody,
        );
      }

      logger.debug({ to: params.to, response: responseBody }, 'WhatsApp sendText ok');
      return responseBody as SendTextResponse;
    } finally {
      clearTimeout(timeout);
    }
  }
}
