import { z } from 'zod';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `true` si `s` es un ISO date AAAA-MM-DD que además es un día de calendario
 * REAL. El regex por sí solo acepta imposibles (`2026-02-31`, `2026-13-01`,
 * `2026-02-29` en año no bisiesto) que harían `THROW` al castear `::date` en
 * Postgres ("date/time field value out of range"). Validamos el día real con
 * round-trip de `Date.UTC` (solo aritmética UTC, sin dependencia de timezone).
 */
export function isRealCalendarDate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) {
    return false;
  }
  const [y, m, d] = s.split('-').map((p) => Number.parseInt(p, 10)) as [number, number, number];
  if (m < 1 || m > 12 || d < 1 || d > 31) {
    return false;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * ISO date `AAAA-MM-DD` que es un día de calendario REAL. A diferencia de un
 * simple `.regex(/^\d{4}-\d{2}-\d{2}$/)`, rechaza días imposibles que de otro
 * modo llegarían a un `::date` en SQL y provocarían un error 500 (o, en un
 * worker, un poison pill → DLQ). Reutilizable en cualquier boundary que reciba
 * fechas ISO de terceros.
 */
export const isoCalendarDateSchema = z
  .string()
  .regex(ISO_DATE_RE, 'debe ser ISO date YYYY-MM-DD')
  .refine(isRealCalendarDate, { message: 'debe ser un día de calendario válido' });
