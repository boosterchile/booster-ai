import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifica la firma HMAC-SHA256 de un webhook de Meta WhatsApp Business.
 *
 * Meta firma cada request POST al webhook con el `app_secret` (Business Account
 * app secret). El header `X-Hub-Signature-256` viene con formato:
 *
 *   X-Hub-Signature-256: sha256=<hex-hmac-of-raw-body>
 *
 * Crítico: se firma el BODY RAW (bytes), no el parsed JSON. Por eso en el
 * webhook handler hay que leer el body como texto antes de parsear.
 *
 * Docs: https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests
 *
 * @param rawBody       body del request como string (como llegó por la red)
 * @param signatureHeader  valor completo del header X-Hub-Signature-256
 * @param appSecret     secret de la Meta Business App
 * @returns true si la firma es válida, false si no o si el header está malformado
 */
export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader) {
    return false;
  }

  const expectedPrefix = 'sha256=';
  if (!signatureHeader.startsWith(expectedPrefix)) {
    return false;
  }

  const receivedHex = signatureHeader.slice(expectedPrefix.length);
  // SHA-256 hex tiene 64 chars. Si no, rechazar sin llegar a HMAC.
  if (receivedHex.length !== 64 || !/^[0-9a-f]+$/i.test(receivedHex)) {
    return false;
  }

  const expectedHex = createHmac('sha256', appSecret).update(rawBody).digest('hex');

  try {
    // timingSafeEqual requiere buffers del mismo length — ya garantizado arriba.
    return timingSafeEqual(Buffer.from(receivedHex, 'hex'), Buffer.from(expectedHex, 'hex'));
  } catch {
    return false;
  }
}
