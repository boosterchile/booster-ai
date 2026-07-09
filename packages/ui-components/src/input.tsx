import { type InputHTMLAttributes, forwardRef } from 'react';
import { cn } from './cn.js';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Marca el campo como inválido: pinta el borde de error y expone `aria-invalid`. */
  invalid?: boolean;
}

/**
 * Input primitivo (grupo **dual**): `<input>` estilizado con tokens D1; el
 * tamaño (touch target + padding) responde a `data-register`/`data-density` vía
 * las custom properties de Ola 0. Estados default/focus/error/disabled. Cuando
 * `invalid`, expone `aria-invalid`; el `aria-describedby` al mensaje de error lo
 * pasa el consumidor (se reenvía). El foco visible lo aporta el
 * `*:focus-visible` global de la app.
 *
 * Es la **primitiva**; `apps/web/.../FormField.tsx` (hoy con `inputClass` de
 * interpolación condicional) es su consumidor natural y puede migrarse a
 * `Input` + `cn()` — pero esa migración va en su propio PR (fuera de este goal).
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid = false, className, style, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'block w-full rounded-md border bg-neutral-0 text-neutral-900 text-sm transition-colors placeholder:text-neutral-400 disabled:cursor-not-allowed disabled:opacity-50',
        invalid ? 'border-danger-500' : 'border-neutral-300',
        className,
      )}
      style={{
        minHeight: 'var(--touch-min)',
        paddingBlock: 'var(--pad-y)',
        paddingInline: 'var(--pad-x)',
        ...style,
      }}
      {...rest}
    />
  );
});
