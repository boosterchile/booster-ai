/**
 * Validación de un archivo subido por multipart: tipo permitido, tamaño y
 * magic bytes. La comparten el repositorio documental de transporte y las
 * instrucciones de retiro, para que las dos superficies acepten exactamente
 * lo mismo.
 */

export const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export type AllowedMime = (typeof ALLOWED_MIME_TYPES)[number];
export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024; // 15 MB

export function extForMime(mime: AllowedMime): string {
  switch (mime) {
    case 'application/pdf':
      return 'pdf';
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
  }
}

/**
 * Magic bytes (file signatures) de cada MIME permitido. Defensa en profundidad
 * (review F4-4a finding 3): `file.type` lo controla el cliente y puede mentir
 * (ej. renombrar un `.exe` a `.pdf` y declarar `application/pdf`). Validamos el
 * CONTENIDO real del buffer antes de archivarlo en GCS.
 *
 *   - PDF  → 25 50 44 46            ("%PDF")
 *   - JPEG → FF D8 FF
 *   - PNG  → 89 50 4E 47 0D 0A 1A 0A
 */
const MAGIC_BYTES: Record<AllowedMime, readonly number[]> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};

/**
 * Detecta el MIME real de un buffer por sus magic bytes. Función pura: devuelve
 * el `AllowedMime` cuyo prefijo de firma coincide con el inicio del buffer, o
 * `null` si no coincide con ninguno permitido. No depende de la extensión ni
 * del `file.type` declarado.
 */
export function detectMagicByteMime(buffer: Uint8Array): AllowedMime | null {
  for (const mime of ALLOWED_MIME_TYPES) {
    const signature = MAGIC_BYTES[mime];
    if (buffer.length < signature.length) {
      continue;
    }
    let matches = true;
    for (let i = 0; i < signature.length; i++) {
      if (buffer[i] !== signature[i]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return mime;
    }
  }
  return null;
}

export type ArchivoValidado =
  | { ok: true; buffer: Buffer; mime: AllowedMime; size: number }
  | {
      ok: false;
      status: 400 | 413;
      body: { error: string; code: string; [k: string]: unknown };
      /** MIME detectado cuando no calza con el declarado (para el log). */
      detectedMime?: AllowedMime | null;
    };

/**
 * Valida un `File` de un multipart: tipo declarado permitido, tamaño máximo y
 * que el contenido real (magic bytes) coincida con el tipo declarado.
 */
export async function validarArchivoSubido(file: File): Promise<ArchivoValidado> {
  const mime = file.type;
  if (!ALLOWED_MIME_TYPES.includes(mime as AllowedMime)) {
    return {
      ok: false,
      status: 400,
      body: { error: 'mime_not_allowed', code: 'mime_not_allowed', allowed: ALLOWED_MIME_TYPES },
    };
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return {
      ok: false,
      status: 413,
      body: { error: 'file_too_large', code: 'file_too_large', max_bytes: MAX_DOCUMENT_BYTES },
    };
  }
  const allowedMime = mime as AllowedMime;
  const buffer = Buffer.from(await file.arrayBuffer());
  const detectedMime = detectMagicByteMime(buffer);
  if (detectedMime !== allowedMime) {
    return {
      ok: false,
      status: 400,
      body: { error: 'mime_mismatch', code: 'mime_mismatch', allowed: ALLOWED_MIME_TYPES },
      detectedMime,
    };
  }
  return { ok: true, buffer, mime: allowedMime, size: file.size };
}
