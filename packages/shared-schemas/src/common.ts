import { z } from 'zod';

/**
 * Tracking code público de un intake/cargo request. Formato: BOO-XXXXXX.
 * 6 caracteres alfanuméricos uppercase (base36), espacio ~2.18B combinaciones.
 *
 * Se exporta al shipper como identificador humano-amigable (imprimible en guías,
 * dictable por teléfono, searcheable). No se usa para lookups internos del backend
 * (para eso se usan UUIDs de primitives/ids.ts).
 *
 * Colisión probable a ~47K requests por paradoja del cumpleaños. A ese volumen
 * hay que migrar a 8 chars o insertar retry loop contra UNIQUE constraint.
 */
export const trackingCodeSchema = z
  .string()
  .regex(/^BOO-[A-Z0-9]{6}$/, 'Formato inválido: BOO-XXXXXX');
export type TrackingCode = z.infer<typeof trackingCodeSchema>;

const TRACKING_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function generateTrackingCode(): TrackingCode {
  let code = 'BOO-';
  for (let i = 0; i < 6; i += 1) {
    const idx = Math.floor(Math.random() * TRACKING_CODE_ALPHABET.length);
    code += TRACKING_CODE_ALPHABET[idx];
  }
  // Cast seguro: el loop genera exactamente 6 chars del alphabet permitido.
  return code as TrackingCode;
}
