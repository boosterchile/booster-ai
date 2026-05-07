import crypto from 'node:crypto';

/**
 * Verificación de firma Twilio para webhook (Wave 2 Track B4).
 *
 * Twilio firma cada webhook con HMAC-SHA1 sobre la concatenación
 * de la URL completa + los params del body ordenados alfabéticamente.
 * El header `X-Twilio-Signature` contiene el HMAC en base64.
 *
 * Spec: https://www.twilio.com/docs/usage/webhooks/webhooks-security
 *
 * **Crítico para producción**: sin esta validación cualquiera puede
 * inyectar SMS falsos al gateway → falsos crashes/unplugs/jamming
 * que disparan alertas P0 al NOC. La validación es la única barrera
 * de entrada.
 */

export interface ValidateOpts {
  /** Token Twilio del Account SID — se obtiene de Secret Manager. */
  authToken: string;
  /** Header X-Twilio-Signature recibido. */
  signature: string;
  /** URL del webhook tal como Twilio la conoce — debe ser la misma
   *  que tiene configurada en su Console (incluyendo https + path
   *  exacto). */
  url: string;
  /** Params del body POST como objeto plano (Twilio manda
   *  application/x-www-form-urlencoded). Caller los parsea de
   *  request.formData() o similar. */
  params: Record<string, string>;
}

/**
 * Retorna `true` si la firma es válida. Pure function, no I/O.
 *
 * Implementación basada en la spec oficial Twilio:
 *   1. Concatenar URL + cada `key+value` ordenado alfabéticamente.
 *   2. HMAC-SHA1 con authToken como secret.
 *   3. Comparar base64 del HMAC con el header `X-Twilio-Signature` en
 *      tiempo constante (timingSafeEqual).
 */
export function validateTwilioSignature(opts: ValidateOpts): boolean {
  const { authToken, signature, url, params } = opts;

  // Sort keys alphabetically y concatenar key+value sin separador.
  const sortedKeys = Object.keys(params).sort();
  const concatenated = sortedKeys.reduce((acc, k) => acc + k + params[k], url);

  const hmac = crypto.createHmac('sha1', authToken);
  hmac.update(concatenated, 'utf8');
  const expectedB64 = hmac.digest('base64');

  // timingSafeEqual previene timing attacks que extraen byte por byte.
  const expectedBuf = Buffer.from(expectedB64, 'base64');
  const receivedBuf = Buffer.from(signature, 'base64');
  if (expectedBuf.length !== receivedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}
