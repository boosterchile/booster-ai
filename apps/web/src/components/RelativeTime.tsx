import { useEffect, useState } from 'react';
import {
  type FreshnessThresholds,
  ageSeconds,
  formatAge,
  freshnessClass,
  freshnessLevel,
} from '../lib/freshness.js';

interface RelativeTimeProps {
  /** ISO string o Date. Null/undefined → muestra placeholder. */
  date: string | Date | null | undefined;
  /** Texto que se muestra si `date` es null. Default '—'. */
  fallback?: string;
  /** Override de thresholds para el coloreado (ver freshnessLevel). */
  thresholds?: FreshnessThresholds;
  /** Clases extra (se concatenan al freshnessClass). */
  className?: string;
  /**
   * Cada cuántos ms re-render forzado para refrescar el "hace X". Default
   * 30 s — alineado con el polling típico de GPS. Subir si performance
   * importa más que precisión (ej. 60 s para chat). Setear 0 deshabilita
   * el auto-refresh (mostrará el valor del primer render).
   */
  refreshIntervalMs?: number;
}

/**
 * Renderiza un `<time>` con tiempo relativo ("hace 5 min") y color según
 * frescura (fresh / stale / old). Tooltip nativo con la fecha completa.
 *
 * Se auto-refresca cada `refreshIntervalMs` (default 30 s) para que el
 * label cambie sin requerir un re-render del padre.
 *
 * Uso típico:
 *
 *   <p>
 *     Reportado por el dispositivo: <RelativeTime date={timestamp_device} />
 *   </p>
 */
export function RelativeTime({
  date,
  fallback = '—',
  thresholds,
  className,
  refreshIntervalMs = 30_000,
}: RelativeTimeProps) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (refreshIntervalMs <= 0) {
      return;
    }
    const id = setInterval(() => setTick((t) => t + 1), refreshIntervalMs);
    return () => clearInterval(id);
  }, [refreshIntervalMs]);

  if (date == null) {
    return <span className={`text-neutral-400 ${className ?? ''}`}>{fallback}</span>;
  }

  const seconds = ageSeconds(date);
  const label = formatAge(seconds);
  const level = freshnessLevel(seconds, thresholds);
  const colorClass = freshnessClass(level);

  const ts = typeof date === 'string' ? new Date(date) : date;
  const isoAttr = Number.isNaN(ts.getTime()) ? undefined : ts.toISOString();
  const titleAttr = Number.isNaN(ts.getTime())
    ? undefined
    : ts.toLocaleString('es-CL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'America/Santiago',
      });

  return (
    <time dateTime={isoAttr} title={titleAttr} className={`${colorClass} ${className ?? ''}`}>
      {label ?? fallback}
    </time>
  );
}
