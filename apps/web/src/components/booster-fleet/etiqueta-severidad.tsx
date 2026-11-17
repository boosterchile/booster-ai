import { Badge, cn } from '@booster-ai/ui-components';
import type { ReactNode } from 'react';
import type { Tono } from './reglas.js';

const CLASE: Record<Tono, string> = {
  primero: 'bg-danger-600 text-white',
  sin_lectura: 'border border-urgency-600 border-dashed bg-neutral-0 text-warning-700',
  atencion: 'bg-urgency-100 text-urgency-800',
  en_orden: 'bg-success-50 text-success-700',
  neutro: 'bg-neutral-100 text-neutral-700',
};

/** La forma dice el tono sin depender del color. */
const GLIFO: Record<Tono, ReactNode> = {
  primero: <path d="M4 .4 7.8 7.4H.2z" fill="currentColor" />,
  sin_lectura: (
    <path d="M4 .9 7.1 4 4 7.1.9 4z" fill="none" stroke="currentColor" strokeWidth="1.3" />
  ),
  atencion: <path d="M4 .3 7.7 4 4 7.7.3 4z" fill="currentColor" />,
  en_orden: (
    <path
      d="M1 4.3 3.2 6.4 7 1.8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  neutro: <circle cx="4" cy="4" r="2.4" fill="currentColor" />,
};

/**
 * Etiqueta de severidad de Booster Fleet: compone el `Badge` del sistema y
 * le agrega una forma por tono. El texto nombra la causa, no el nivel.
 */
export function EtiquetaSeveridad({ tono, children }: { tono: Tono; children: ReactNode }) {
  return (
    <Badge className={cn('gap-1.5 whitespace-nowrap rounded font-semibold', CLASE[tono])}>
      <svg viewBox="0 0 8 8" className="h-2 w-2 flex-none" aria-hidden="true">
        {GLIFO[tono]}
      </svg>
      {children}
    </Badge>
  );
}

/** Marca chica del tono, para listas donde la etiqueta completa no cabe. */
export function MarcaTono({ tono }: { tono: Tono }) {
  return (
    <svg
      viewBox="0 0 8 8"
      aria-hidden="true"
      className={cn(
        'h-2.5 w-2.5 flex-none',
        tono === 'primero' && 'text-danger-600',
        tono === 'sin_lectura' && 'text-urgency-600',
        tono === 'atencion' && 'text-urgency-600',
        tono === 'en_orden' && 'text-success-500',
        tono === 'neutro' && 'text-neutral-500',
      )}
    >
      {GLIFO[tono]}
    </svg>
  );
}

/** Patente en mono, compacta para filas densas. */
export function Patente({ children }: { children: string }) {
  return (
    <span className="inline-block rounded border border-neutral-300 bg-neutral-0 px-1.5 font-mono font-semibold text-neutral-900 text-sm tracking-wide">
      {children}
    </span>
  );
}
