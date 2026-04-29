import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifica la firma HMAC-SHA1 de un webhook de Twilio.
 *
 * Twilio firma cada request POST al webhook con el `auth_token` de la cuenta.
 * El header `X-Twilio-Signature` contiene un HMAC-SHA1 base64 de la
 * concatenación: URL completa del webhook + cada par (key, value) del body
 * form-encoded ordenado alfabéticamente por key.
 *
 * Algoritmo (https://www.twilio.com/docs/usage/webhooks/webhooks-security):
 *   1. data = full request URL (including https://, host, path, query string)
 *   2. Para cada parameter del body POST en orden alfabético: data += key + value
 *   3. signature = base64( HMAC-SHA1(authToken, data) )
 *   4. Comparar con header X-Twilio-Signature usando timingSafeEqual
 *
 * Crítico: la URL debe ser EXACTAMENTE la misma que Twilio usó para hacer el
 * POST — incluyendo scheme, host, port (si non-default), path y query string.
 * Si Cloud Run / LB rewrite el host (p.ej. http→https), va a fallar la firma.
 *
 * @param authToken     Twilio Account Auth Token
 * @param signatureHeader  valor del header X-Twilio-Signature (base64)
 * @param url           URL completa del webhook (la que Twilio usa)
 * @param params        body POST parseado como Record<string, string>
 * @returns true si la firma es válida
 */
export function verifyTwilioSignature(
  authToken: string,
  signatureHeader: string | undefined,
  url: string,
  params: Record<string, string>,
): boolean {
  if (!signatureHeader) {
    return false;
  }

  // Concatenar URL + sorted (key, value) pairs.
  let data = url;
  const sortedKeys = Object.keys(params).sort();
  for (const key of sortedKeys) {
    data += key + params[key];
  }

  // HMAC-SHA1 de data con authToken, base64.
  const expectedB64 = createHmac('sha1', authToken).update(data).digest('base64');

  try {
    const a = Buffer.from(signatureHeader, 'base64');
    const b = Buffer.from(expectedB64, 'base64');
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
