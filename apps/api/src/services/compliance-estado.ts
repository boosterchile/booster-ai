/**
 * D6 — Compliance: cálculo del estado de un documento según su vencimiento.
 *
 * Reglas:
 *   - Si no hay `fechaVencimiento` → 'vigente' (documentos sin fecha como
 *     padrón quedan siempre vigentes).
 *   - Si `fechaVencimiento` < hoy → 'vencido'.
 *   - Si `fechaVencimiento` <= hoy + DAYS_WARN → 'por_vencer'.
 *   - Caso contrario → 'vigente'.
 *
 * Threshold de "por vencer" en días configurable; default 30 días que es
 * el estándar de la industria (suficiente para renovar revisión técnica
 * o licencia sin urgencia).
 */

export const DAYS_WARN_DEFAULT = 30;

export type DocumentoEstado = 'vigente' | 'por_vencer' | 'vencido';

export function calcularEstadoDocumento(
  fechaVencimiento: Date | null,
  now: Date = new Date(),
  daysWarn: number = DAYS_WARN_DEFAULT,
): DocumentoEstado {
  if (!fechaVencimiento) {
    return 'vigente';
  }
  // Normalizamos a midnight UTC para que la comparación sea por día exacto
  // (sin sensibilidad a hora del día).
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const expiryMs = Date.UTC(
    fechaVencimiento.getUTCFullYear(),
    fechaVencimiento.getUTCMonth(),
    fechaVencimiento.getUTCDate(),
  );
  const diffDays = Math.floor((expiryMs - todayMs) / (24 * 60 * 60 * 1000));
  if (diffDays < 0) {
    return 'vencido';
  }
  if (diffDays <= daysWarn) {
    return 'por_vencer';
  }
  return 'vigente';
}
