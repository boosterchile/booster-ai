/**
 * @booster-ai/whatsapp-client
 *
 * Cliente mínimo para Meta WhatsApp Business Cloud API v20.0.
 *
 * Thin slice scope (Fase 6):
 *  - verifyMetaSignature: HMAC-SHA256 del body raw con X-Hub-Signature-256
 *  - WhatsAppClient.sendText: enviar mensajes de texto outbound
 *
 * Expansión prevista en slices siguientes:
 *  - Mensajes interactivos (botones, listas) para reemplazar menús numerados
 *  - Templates para mensajes fuera de ventana 24h (notificaciones push-like)
 *  - Media (imágenes, documentos) para compartir guías de despacho PDF
 *  - Webhooks de status (delivered, read) para tracking de notificaciones
 */

export { verifyMetaSignature } from './signature.js';
export {
  WhatsAppClient,
  WhatsAppApiError,
  type WhatsAppClientOptions,
  type SendTextParams,
  type SendTextResponse,
} from './client.js';
