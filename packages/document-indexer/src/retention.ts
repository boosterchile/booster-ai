/**
 * Cálculo de `retentionUntil` y validación de retention pre-delete.
 *
 * SII Chile + Ley 18.290 → 6 años desde la emisión. Booster usa 7 años
 * como margen operacional (delete después de eso). Estos valores son
 * configurables a través de `RetentionConfig` por si la regulación cambia.
 */

import { DocumentRetentionViolationError } from './errors.js';

export interface RetentionConfig {
  /**
   * Años de retención mínima. Default 6 (Ley + SII).
   */
  retentionYears?: number;
  /**
   * Días extra como margen de seguridad antes de eliminar. Default 365
   * (1 año). Total = retentionYears + extraMarginDays.
   */
  extraMarginDays?: number;
}

const DEFAULT_RETENTION_YEARS = 6;
const DEFAULT_EXTRA_MARGIN_DAYS = 365;

export function computeRetentionUntil(emittedAt: Date, config: RetentionConfig = {}): Date {
  const years = config.retentionYears ?? DEFAULT_RETENTION_YEARS;
  const extraDays = config.extraMarginDays ?? DEFAULT_EXTRA_MARGIN_DAYS;
  const result = new Date(emittedAt);
  result.setUTCFullYear(result.getUTCFullYear() + years);
  result.setUTCDate(result.getUTCDate() + extraDays);
  return result;
}

/**
 * Throws si el documento aún está dentro del período legal de retención.
 * Patrón: invocar antes de `deleteDocument` para evitar borrar algo
 * que SII puede pedir.
 */
export function assertRetentionExpired(retentionUntil: Date, now: Date = new Date()): void {
  if (retentionUntil.getTime() > now.getTime()) {
    throw new DocumentRetentionViolationError(
      `Documento bajo retención legal hasta ${retentionUntil.toISOString()}`,
      retentionUntil,
    );
  }
}

/**
 * `true` si la retention venció.
 */
export function isRetentionExpired(retentionUntil: Date, now: Date = new Date()): boolean {
  return retentionUntil.getTime() <= now.getTime();
}
