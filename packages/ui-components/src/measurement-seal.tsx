import type { HTMLAttributes } from 'react';
import { cn } from './cn.js';

export type MeasurementSealKind = 'measured' | 'estimated';

export interface MeasurementSealProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** `measured` → «Medido»; `estimated` → «Estimado». La palabra es fija. */
  kind: MeasurementSealKind;
}

/** Palabra fija por tipo: el sello dice lo mismo en toda la plataforma. */
const WORD: Record<MeasurementSealKind, string> = {
  measured: 'Medido',
  estimated: 'Estimado',
};

/** Forma por tipo: borde continuo (medido) vs punteado (estimado). Tokens D1. */
const KIND_CLASS: Record<MeasurementSealKind, string> = {
  measured: 'border-primary-600 bg-primary-50 text-primary-800',
  estimated: 'border-dashed border-neutral-500 bg-neutral-0 text-neutral-700',
};

/**
 * Sello del dato ambiental (grupo **semántico-fijo**, DESIGN.md §8.1 / D-18).
 * Lo ambiental se distingue por **forma y palabra**, no por color: «Medido»
 * lleva borde continuo e ícono de visto; «Estimado», borde punteado e ícono de
 * aproximación (≈). No lee el acento ni el registro/densidad. El ícono es
 * decorativo: el nombre accesible es la palabra.
 */
export function MeasurementSeal({ kind, className, ...rest }: MeasurementSealProps) {
  return (
    <span
      data-kind={kind}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-semibold text-xs',
        KIND_CLASS[kind],
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
        {kind === 'measured' ? (
          <>
            <circle cx="8" cy="8" r="6.25" />
            <path d="M5 8.25 7.1 10.4 11 6" />
          </>
        ) : (
          <>
            <path d="M3 6.4c1.7-1.9 3.3-1.9 5 0s3.3 1.9 5 0" />
            <path d="M3 10.4c1.7-1.9 3.3-1.9 5 0s3.3 1.9 5 0" />
          </>
        )}
      </svg>
      {WORD[kind]}
    </span>
  );
}
