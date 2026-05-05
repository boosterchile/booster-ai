import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

/**
 * Estado vacío reutilizable. Patrón visual unificado para listas sin
 * resultados: borde dashed, icono opcional centrado, título, descripción
 * y un slot libre para call-to-action.
 *
 * `action` es un `ReactNode` (no `{label, href}`) para que el caller
 * pueda usar el `<Link>` del router que prefiera (TanStack, Next, etc.)
 * o un `<button>` sin que este componente tenga que importar nada.
 * Para mantener consistencia visual, usar `emptyStateActionClass`.
 */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="rounded-lg border border-neutral-300 border-dashed bg-white p-10 text-center">
      {icon && <div className="mx-auto mb-3 flex justify-center text-neutral-400">{icon}</div>}
      <p className="font-medium text-neutral-900">{title}</p>
      {description && (
        <p className="mx-auto mt-1 max-w-md text-neutral-600 text-sm">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * Clases recomendadas para el CTA del EmptyState. Usarlo en el `<Link>`
 * o `<button>` que se pase como `action` para mantener consistencia
 * visual entre vistas.
 */
export const emptyStateActionClass =
  'inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700';
