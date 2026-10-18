import { createHash } from 'node:crypto';

export interface TwilioContentFormParams {
  /** Sender en E.164; se antepone `whatsapp:` si falta. */
  fromNumber: string;
  /** Destinatario en E.164; se antepone `whatsapp:` si falta. */
  to: string;
  contentSid: string;
  contentVariables?: Record<string, string>;
}

const conPrefijo = (numero: string): string =>
  numero.startsWith('whatsapp:') ? numero : `whatsapp:${numero}`;

/**
 * Campos del POST a `Messages.json` para un Content Template. Única fuente
 * de la forma del request: la usan `TwilioWhatsAppClient.sendContent` y la
 * comparación en sombra del notification-service (T10-21).
 */
export function twilioContentForm(params: TwilioContentFormParams): Record<string, string> {
  const form: Record<string, string> = {
    From: conPrefijo(params.fromNumber),
    To: conPrefijo(params.to),
    ContentSid: params.contentSid,
  };
  if (params.contentVariables && Object.keys(params.contentVariables).length > 0) {
    form.ContentVariables = JSON.stringify(params.contentVariables);
  }
  return form;
}

/**
 * sha256 hex de la forma canónica del request: variables con claves
 * ordenadas, de modo que el orden de inserción no cambie el hash. Cada lado
 * de la sombra lo calcula con su propio `fromNumber`, así que una diferencia
 * de config del sender también diverge.
 */
export function hashTwilioContentForm(params: TwilioContentFormParams): string {
  const variables = params.contentVariables ?? {};
  const ordenadas: Record<string, string> = Object.fromEntries(
    Object.entries(variables).sort(([a], [b]) => a.localeCompare(b)),
  );
  const canonica = twilioContentForm({ ...params, contentVariables: ordenadas });
  return createHash('sha256')
    .update(
      JSON.stringify([
        canonica.From,
        canonica.To,
        canonica.ContentSid,
        canonica.ContentVariables ?? null,
      ]),
    )
    .digest('hex');
}
