/**
 * Re-detección del tipo real de un archivo por sus magic bytes (file
 * signatures). El worker NO confía en el `file_mime` persistido en 4a: re-valida
 * el contenido del buffer descargado de GCS antes de elegir el pipeline
 * (rasterizar PDF vs preprocesar foto). Defensa en profundidad y robustez ante
 * un MIME mal registrado.
 *
 *   - PDF  → 25 50 44 46            ("%PDF")
 *   - JPEG → FF D8 FF
 *   - PNG  → 89 50 4E 47 0D 0A 1A 0A
 *
 * Función pura, sin dependencias.
 */

export type FileKind = 'pdf' | 'photo' | 'unknown';

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46] as const;
const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function startsWith(buffer: Uint8Array, signature: readonly number[]): boolean {
  if (buffer.length < signature.length) {
    return false;
  }
  for (let i = 0; i < signature.length; i++) {
    if (buffer[i] !== signature[i]) {
      return false;
    }
  }
  return true;
}

export function detectFileKind(buffer: Uint8Array): FileKind {
  if (startsWith(buffer, PDF_MAGIC)) {
    return 'pdf';
  }
  if (startsWith(buffer, JPEG_MAGIC) || startsWith(buffer, PNG_MAGIC)) {
    return 'photo';
  }
  return 'unknown';
}
