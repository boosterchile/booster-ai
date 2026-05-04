/**
 * `generarCartaPorte` — entrypoint público del package.
 *
 * Flow:
 *   1. Validar input con Zod (`cartaPorteInputSchema`).
 *   2. Renderizar el componente React PDF a un Buffer.
 *   3. Computar SHA-256 del PDF.
 *   4. Retornar `{ pdfBuffer, sha256, sizeBytes }`.
 *
 * El PDF resultante NO está firmado digitalmente. La firma KMS es
 * responsabilidad del caller — típicamente `apps/document-service`
 * usando `firmar-pades` de `packages/certificate-generator`.
 *
 * Errores tipados:
 *   - `CartaPorteValidationError` si el input no pasa schema.
 *   - `CartaPorteRenderError` si @react-pdf/renderer falla en runtime.
 */

import { createHash } from 'node:crypto';
import { renderToBuffer } from '@react-pdf/renderer';
import type { ZodError } from 'zod';
import { CartaPorteRenderError, CartaPorteValidationError } from './errors.js';
import { CartaPorteDocument } from './pdf-document.js';
import { type CartaPorteInput, type CartaPorteResult, cartaPorteInputSchema } from './types.js';

export async function generarCartaPorte(input: CartaPorteInput): Promise<CartaPorteResult> {
  const parsed = cartaPorteInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CartaPorteValidationError(
      'Input inválido para Carta de Porte',
      flattenZodErrors(parsed.error),
    );
  }

  let pdfBuffer: Uint8Array;
  try {
    // renderToBuffer retorna un Node Buffer; lo normalizamos a Uint8Array
    // para que el caller (que puede correr en runtimes no-Node) lo maneje
    // sin asumir Buffer disponible.
    const buf = await renderToBuffer(CartaPorteDocument({ input: parsed.data }));
    pdfBuffer = new Uint8Array(buf);
  } catch (err) {
    throw new CartaPorteRenderError('Falló render de Carta de Porte (@react-pdf/renderer)', err);
  }

  const sha256 = createHash('sha256').update(pdfBuffer).digest('hex');

  return {
    pdfBuffer,
    sha256,
    sizeBytes: pdfBuffer.byteLength,
  };
}

function flattenZodErrors(error: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!out[key]) {
      out[key] = [];
    }
    out[key].push(issue.message);
  }
  return out;
}
