import { type ReactNode, useId } from 'react';

interface FormFieldProps {
  label: string;
  required?: boolean | undefined;
  error?: string | undefined;
  hint?: string | undefined;
  /**
   * El render prop recibe `id` (para `<label htmlFor>` + el input)
   * y `describedBy` (para `aria-describedby` del input — apunta al
   * hint o al error según corresponda).
   */
  render: (props: { id: string; describedBy: string | undefined }) => ReactNode;
}

/**
 * Wrapper estandar para campos de formulario.
 *
 * Maneja label + hint + error inline + atributos ARIA. El input se
 * inyecta vía render-prop para que el caller mantenga control total
 * sobre el elemento (input, select, textarea, custom controls de
 * libs como react-hook-form). Esto evita el problema de cloneElement
 * con tipos genéricos.
 *
 * El componente se diseñó para integrar con react-hook-form pero
 * funciona también con state manual (`useState` + safeParse).
 *
 * Diseñado para reemplazar el `Field` local que existía duplicado en
 * `OnboardingForm.tsx`, `ProfileForm.tsx` y otros forms del repo.
 */
export function FormField({ label, required, error, hint, render }: FormFieldProps) {
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;
  const hintId = hint && !error ? `${id}-hint` : undefined;
  const describedBy = errorId ?? hintId;

  return (
    <div>
      <label htmlFor={id} className="block font-medium text-neutral-700 text-sm">
        {label}
        {required && (
          <span aria-label="requerido" className="ml-0.5 text-danger-600">
            *
          </span>
        )}
      </label>
      <div className="mt-1">{render({ id, describedBy })}</div>
      {hintId && (
        <p id={hintId} className="mt-1 text-neutral-500 text-xs">
          {hint}
        </p>
      )}
      {errorId && (
        <p id={errorId} className="mt-1 text-danger-700 text-xs" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Clases Tailwind canónicas para inputs/select/textarea dentro de un
 * FormField. Marca el borde en rojo cuando hay error.
 *
 * Patrón "función helper" en lugar de variant component para que
 * cada caller pueda agregar clases extra al lado (ej. `disabled:`,
 * `font-mono`, etc.) sin pelear con merge de clases.
 */
export function inputClass(hasError: boolean): string {
  return `block w-full rounded-md border px-3 py-2 text-neutral-900 text-sm shadow-xs focus:outline-none ${
    hasError
      ? 'border-danger-500 focus:border-danger-500'
      : 'border-neutral-300 focus:border-primary-500'
  }`;
}
