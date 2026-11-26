import type { HTMLAttributes } from 'react';
import { cn } from './cn.js';
import { MeasurementSeal } from './measurement-seal.js';

/** Presentación de la huella según ADR-091 (la misma que calcula el certificado). */
export type FootprintPresentation = 'primario' | 'medido_teltonika' | 'estimado';

export interface FootprintSealProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  presentacion: FootprintPresentation;
}

/** Texto fijo de la presentación intermedia de ADR-091. */
const TEXTO_INTERMEDIA = 'Distancia medida con Teltonika · consumo modelado';

/**
 * Sello de la huella de carbono (decisión 2 del PO del 2026-11-25). Son tres
 * presentaciones, igual que en el certificado:
 *
 * - `primario`: la huella misma fue medida → «Medido».
 * - `medido_teltonika`: conserva su texto y no lleva «Medido», porque lo
 *   medido es la distancia y el consumo es modelado.
 * - `estimado`: «Estimado».
 */
export function FootprintSeal({ presentacion, className, ...rest }: FootprintSealProps) {
  if (presentacion === 'primario') {
    return (
      <MeasurementSeal
        kind="measured"
        data-presentacion={presentacion}
        className={className}
        {...rest}
      />
    );
  }
  if (presentacion === 'estimado') {
    return (
      <MeasurementSeal
        kind="estimated"
        data-presentacion={presentacion}
        className={className}
        {...rest}
      />
    );
  }
  return (
    <span
      data-presentacion={presentacion}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-neutral-500 bg-neutral-0 px-2 py-0.5 font-semibold text-neutral-700 text-xs',
        className,
      )}
      {...rest}
    >
      <svg
        aria-hidden="true"
        className="h-3.5 w-3.5 shrink-0"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M2.5 11.5h11" />
        <path d="M2.5 9.5v4M13.5 9.5v4M8 10.5v2" />
        <path d="M4 6.5c1.3-1.4 2.7-1.4 4 0s2.7 1.4 4 0" />
      </svg>
      {TEXTO_INTERMEDIA}
    </span>
  );
}
