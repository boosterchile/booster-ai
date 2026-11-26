import { type ButtonHTMLAttributes, type CSSProperties, forwardRef } from 'react';
import { cn } from './cn.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';

/**
 * Tamaño. `md` (defecto) sigue el registro; `sm` es la acción secundaria en
 * una fila o tarjeta; `icon` es cuadrado (exige `aria-label`); `inline` va
 * dentro de un texto, sin alto mínimo ni relleno.
 */
export type ButtonSize = 'md' | 'sm' | 'icon' | 'inline';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Intención visual. `primary` usa el verde Booster (D-18, no tematiza); `danger` el semántico D1. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Estado de carga: muestra spinner, marca `aria-busy` y deshabilita la acción. */
  loading?: boolean;
}

/** Clases de color por variante — SOLO tokens D1 (verde de marca + neutrales + semántico danger). */
const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800',
  secondary:
    'border border-neutral-300 bg-neutral-0 text-neutral-900 hover:bg-neutral-100 active:bg-neutral-200',
  ghost: 'bg-transparent text-neutral-700 hover:bg-neutral-100 active:bg-neutral-200',
  danger: 'bg-danger-600 text-white hover:bg-danger-700 active:bg-danger-700',
  link: 'bg-transparent text-primary-700 underline-offset-2 hover:underline active:text-primary-800',
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  md: 'inline-flex rounded-md text-sm',
  sm: 'inline-flex rounded-md text-xs',
  icon: 'inline-flex shrink-0 rounded-md text-sm',
  inline: 'inline rounded-sm',
};

const SIZE_STYLE: Record<ButtonSize, CSSProperties | undefined> = {
  md: {
    minHeight: 'var(--touch-min)',
    paddingBlock: 'var(--pad-y)',
    paddingInline: 'var(--pad-x)',
  },
  sm: { minHeight: '2rem', paddingBlock: '0.25rem', paddingInline: '0.75rem' },
  icon: { minHeight: 'var(--touch-min)', minWidth: 'var(--touch-min)', padding: 0 },
  inline: undefined,
};

/**
 * Botón primitivo (grupo **dual**): el tamaño lo dictan las custom properties de
 * registro/densidad de Ola 0 (`--touch-min`, `--pad-y`, `--pad-x`) — no
 * reimplementa la lógica; bajo `[data-register=conductor]` el touch target
 * resuelve ≥44px (WCAG). Colores desde tokens D1: el verde Booster en `primary`
 * (DESIGN.md §8.1 / D-18: acción principal en toda la plataforma, no cambia
 * con el acento elegido) y el semántico en `danger`. **Sin personalidad**: el copy
 * lo pone quien lo usa. El foco visible lo aporta el `*:focus-visible` global de
 * la app (token `focusRing` de marca) sobre el `<button>` nativo focusable.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled,
    type,
    className,
    style,
    children,
    ...rest
  },
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
        'select-none items-center justify-center gap-2 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        SIZE_CLASS[size],
        VARIANT_CLASS[variant],
        className,
      )}
      style={{ ...SIZE_STYLE[size], ...style }}
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
