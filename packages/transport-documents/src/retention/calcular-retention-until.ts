/**
 * Cálculo de `retention_until` (frente F4, ADR-070, dominio crítico).
 *
 * Política de custodia del archivador (spec O-3 / O-8): Booster conserva el
 * documento tributario 6 años desde la `fecha_emision` (fallback
 * `created_at + 6a` cuando no hay fecha, marcando el documento para revisión).
 * Fundamento: Código Tributario DL 830 Art. 17/200. PROHIBIDO borrado
 * automático dentro del período (no se implementa purga en F4, solo el cálculo).
 *
 * Función PURA: sin DB, sin red. Devuelve la fecha como ISO date (YYYY-MM-DD,
 * tipo `date` en Postgres, sin componente de hora).
 *
 * Canónica del package `@booster-ai/transport-documents` (C-4: la lógica de
 * dominio vive en packages, no inline en apps). `apps/api` re-exporta desde acá.
 */

const RETENTION_YEARS = 6;

/** Días del mes (1-12) en el año dado, considerando bisiesto. */
function lastDayOfMonth(year: number, monthIndex0: number): number {
  // Date.UTC con día 0 del mes siguiente = último día del mes actual.
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

/** Suma N años a un ISO date YYYY-MM-DD, clampeando el día al mes destino. */
function addYearsIsoDate(isoDate: string, years: number): string {
  const [y, m, d] = isoDate.split('-').map((p) => Number.parseInt(p, 10));
  const targetYear = (y as number) + years;
  const monthIndex0 = (m as number) - 1;
  const maxDay = lastDayOfMonth(targetYear, monthIndex0);
  const day = Math.min(d as number, maxDay);
  const mm = String(monthIndex0 + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${targetYear}-${mm}-${dd}`;
}

/** Extrae el ISO date (YYYY-MM-DD) en UTC de un Date. */
function toIsoDateUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface RetentionResult {
  /** ISO date YYYY-MM-DD hasta el cual se conserva el documento. */
  retentionUntil: string;
  /**
   * `true` cuando se usó el fallback `created_at + 6a` (no había
   * `fecha_emision`): el plazo es conservador y debe revisarse al decodificar
   * o corregir la fecha real.
   */
  needsReview: boolean;
}

export function calcularRetentionUntil(input: {
  /** `<DD><FE>` decodificado o ingresado manualmente. Null/"" => fallback. */
  fechaEmision: string | null;
  /** `creado_en` de la fila del documento. */
  createdAt: Date;
}): RetentionResult {
  const fecha = input.fechaEmision?.trim();
  if (fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return {
      retentionUntil: addYearsIsoDate(fecha, RETENTION_YEARS),
      needsReview: false,
    };
  }
  return {
    retentionUntil: addYearsIsoDate(toIsoDateUtc(input.createdAt), RETENTION_YEARS),
    needsReview: true,
  };
}
