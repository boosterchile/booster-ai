/**
 * @booster-ai/whatsapp-client
 *
 * Clientes para los dos BSPs que soportamos:
 *  - Meta WhatsApp Cloud API (verifyMetaSignature + WhatsAppClient)
 *  - Twilio Programmable Messaging WhatsApp (verifyTwilioSignature + TwilioWhatsAppClient)
 *
 * El bot apps/whatsapp-bot decide en runtime cuál usar según env vars
 * (presencia de TWILIO_ACCOUNT_SID lo selecciona como Twilio).
 */

// Meta Cloud API path
export { verifyMetaSignature } from './signature.js';
export {
  WhatsAppClient,
  WhatsAppApiError,
  type WhatsAppClientOptions,
  type SendTextParams as MetaSendTextParams,
  type SendTextResponse as MetaSendTextResponse,
} from './client.js';

// Twilio path
export { verifyTwilioSignature } from './twilio-signature.js';
export {
  TwilioWhatsAppClient,
  TwilioApiError,
  type TwilioClientOptions,
  type SendTextParams as TwilioSendTextParams,
  type SendTextResponse as TwilioSendTextResponse,
} from './twilio-client.js';
