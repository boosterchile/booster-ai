import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from './cn.js';

export type PressableAreaProps = ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * Zona que se presiona y no es un botón: una fila de tabla, una tarjeta
 * elegible, una patente que abre su ficha. Aporta el `<button>` nativo
 * (`type="button"`), el foco visible y el texto alineado a la izquierda; el
 * consumidor pone solo el layout. **No pinta un botón**: un botón con
 * relleno, borde o color de acción es `Button`. La regla
 * `scripts/lint-botones.mjs` falla si un `PressableArea` lleva un relleno de
 * acción con texto blanco.
 */
export const PressableArea = forwardRef<HTMLButtonElement, PressableAreaProps>(
  function PressableArea({ type, className, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type ?? 'button'}
        className={cn(
          'text-left outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
        {...rest}
      />
    );
  },
);
