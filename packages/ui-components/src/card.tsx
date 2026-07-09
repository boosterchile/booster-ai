import type { HTMLAttributes } from 'react';
import { cn } from './cn.js';

/** Padding de sección: lo dicta el registro/densidad de Ola 0 (custom properties). */
const sectionPadding = { paddingBlock: 'var(--pad-y)', paddingInline: 'var(--pad-x)' } as const;

export type CardProps = HTMLAttributes<HTMLDivElement>;

/**
 * Card primitivo (grupo **dual**): la envoltura (borde/radio/sombra desde tokens
 * D1); el padding de sus secciones responde a `data-register`/`data-density` vía
 * las custom properties de Ola 0 (`--pad-y`/`--pad-x`) — no reimplementa tamaños.
 * Composable con `CardHeader`/`CardBody`/`CardFooter`. Sin lógica de negocio.
 */
export function Card({ className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border border-neutral-200 bg-neutral-0 shadow-sm',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Encabezado de la card (separador inferior). Padding por registro. */
export function CardHeader({ className, children, style, ...rest }: CardProps) {
  return (
    <div
      className={cn('border-neutral-200 border-b font-medium text-neutral-900', className)}
      style={{ ...sectionPadding, ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Cuerpo de la card. Padding por registro. */
export function CardBody({ className, children, style, ...rest }: CardProps) {
  return (
    <div
      className={cn('text-neutral-700 text-sm', className)}
      style={{ ...sectionPadding, ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Pie de la card (separador superior). Padding por registro. */
export function CardFooter({ className, children, style, ...rest }: CardProps) {
  return (
    <div
      className={cn('border-neutral-200 border-t', className)}
      style={{ ...sectionPadding, ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}
