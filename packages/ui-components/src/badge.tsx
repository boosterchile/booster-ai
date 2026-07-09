import type { HTMLAttributes } from 'react';
import { cn } from './cn.js';

export type BadgeVariant = 'success' | 'error' | 'warning' | 'info' | 'neutral';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

/** Pares tint/texto semánticos FIJOS de D1 (`statusXxxBg` = 50 / `statusXxxFg` = 700). */
const VARIANT_CLASS: Record<BadgeVariant, string> = {
  success: 'bg-success-50 text-success-700',
  error: 'bg-danger-50 text-danger-700',
  warning: 'bg-warning-50 text-warning-700',
  info: 'bg-info-50 text-info-700',
  neutral: 'bg-neutral-100 text-neutral-700',
};

/**
 * Badge primitivo (grupo **semántico-fijo**): NO depende del acento ni del
 * registro/densidad — es "el tablero del auto que no cambia con los LED"
 * (DESIGN.md §4.5). No lee `--accent-*` ni las custom properties de registro;
 * padding y tamaño son fijos (tokens de spacing D1). El estado se comunica por
 * **texto** (children), no solo por color.
 */
export function Badge({ variant = 'neutral', className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-xs',
        VARIANT_CLASS[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
