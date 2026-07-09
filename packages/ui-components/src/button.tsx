import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from './cn.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Intención visual. `primary` usa el acento (tematiza por rol); `danger` el semántico D1. */
  variant?: ButtonVariant;
  /** Estado de carga: muestra spinner, marca `aria-busy` y deshabilita la acción. */
  loading?: boolean;
}

/** Clases de color por variante — SOLO tokens D1 (acento + neutrales + semántico danger). */
const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-accent-600 text-white hover:bg-accent-700 active:bg-accent-800',
  secondary:
    'border border-neutral-300 bg-neutral-0 text-neutral-900 hover:bg-neutral-100 active:bg-neutral-200',
  ghost: 'bg-transparent text-neutral-700 hover:bg-neutral-100 active:bg-neutral-200',
  danger: 'bg-danger-600 text-white hover:bg-danger-700 active:bg-danger-700',
};

/**
 * Botón primitivo (grupo **dual**): el tamaño lo dictan las custom properties de
 * registro/densidad de Ola 0 (`--touch-min`, `--pad-y`, `--pad-x`) — no
 * reimplementa la lógica; bajo `[data-register=conductor]` el touch target
 * resuelve ≥44px (WCAG). Colores desde tokens D1: el acento en `primary`
 * (tematiza por rol) y el semántico en `danger`. **Sin personalidad**: el copy
 * lo pone quien lo usa. El foco visible lo aporta el `*:focus-visible` global de
 * la app (token `focusRing` de marca) sobre el `<button>` nativo focusable.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', loading = false, disabled, type, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      // 'button' por defecto: evita submit accidental; el consumidor puede pasar 'submit'.
      type={type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex select-none items-center justify-center gap-2 rounded-md font-medium text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT_CLASS[variant],
        className,
      )}
      style={{
        minHeight: 'var(--touch-min)',
        paddingBlock: 'var(--pad-y)',
        paddingInline: 'var(--pad-x)',
      }}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
});

/** Spinner del estado loading. `currentColor` (hereda el texto de la variante); geometría SVG, sin tokens de color. */
function Spinner() {
  return (
    <svg aria-hidden="true" className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  );
}
