import { z } from 'zod';
import { ApiError, api } from './api-client.js';

/**
 * Cliente de las instrucciones de retiro (spec `instrucciones-retiro`): el QR o
 * comprobante que el lugar de retiro le entrega al generador, con el lugar y
 * una nota. El API valida tipo, tamaño y magic bytes; acá se valida la
 * respuesta antes de usarla.
 */

export const INSTRUCCIONES_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export const MAX_INSTRUCCIONES_BYTES = 15 * 1024 * 1024;

const instruccionesSchema = z.object({
  lugar: z.string().nullable(),
  nota: z.string().nullable(),
  archivo: z.object({ mime: z.enum(INSTRUCCIONES_MIME_TYPES), url: z.string().url() }).nullable(),
  actualizado_en: z.string(),
});

const respuestaSchema = z.object({ instrucciones: instruccionesSchema });

export type InstruccionesRetiro = z.infer<typeof instruccionesSchema>;

const ruta = (tripId: string) => `/viajes/${tripId}/instrucciones-retiro`;

/** `null` si el viaje todavía no tiene instrucciones (404 `sin_instrucciones`). */
export async function getInstruccionesRetiro(tripId: string): Promise<InstruccionesRetiro | null> {
  try {
    const raw = await api.get<unknown>(ruta(tripId));
    return respuestaSchema.parse(raw).instrucciones;
  } catch (err) {
    if (err instanceof ApiError && err.code === 'sin_instrucciones') {
      return null;
    }
    throw err;
  }
}

export async function guardarInstruccionesRetiro(
  tripId: string,
  campos: { file: File | null; lugar: string; nota: string },
): Promise<InstruccionesRetiro> {
  const form = new FormData();
  if (campos.file) {
    form.append('file', campos.file);
  }
  form.append('lugar', campos.lugar);
  form.append('nota', campos.nota);
  const raw = await api.putForm<unknown>(ruta(tripId), form);
  return respuestaSchema.parse(raw).instrucciones;
}

export function esArchivoPermitido(file: File): { ok: true } | { ok: false; mensaje: string } {
  if (!(INSTRUCCIONES_MIME_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, mensaje: 'Ese archivo no sirve. Sube una imagen PNG o JPEG, o un PDF.' };
  }
  if (file.size > MAX_INSTRUCCIONES_BYTES) {
    return { ok: false, mensaje: 'El archivo pesa de más (máximo 15 MB).' };
  }
  return { ok: true };
}

export function mensajeErrorInstrucciones(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'instrucciones_vacias':
        return 'Agrega el QR o comprobante, o una nota para el conductor.';
      case 'mime_not_allowed':
      case 'mime_mismatch':
        return 'Ese archivo no sirve. Sube una imagen PNG o JPEG, o un PDF.';
      case 'file_too_large':
      case 'payload_too_large':
        return 'El archivo pesa de más (máximo 15 MB).';
      case 'storage_unavailable':
      case 'upload_failed':
        return 'El archivo no se pudo guardar. Inténtalo más tarde.';
      case 'read_only':
      case 'capability_denied':
      case 'forbidden':
        return 'Tu rol no puede cargar instrucciones de retiro.';
      case 'invalid_body':
        return 'El lugar y la nota pueden tener hasta 500 caracteres.';
    }
  }
  return 'No pudimos guardar las instrucciones. Inténtalo de nuevo.';
}
