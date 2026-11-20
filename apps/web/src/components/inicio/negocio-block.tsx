import { Card } from '@booster-ai/ui-components';
import { Link } from '@tanstack/react-router';
import { RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';

export function NegocioBlock({
  titulo,
  testId,
  enlace,
  children,
}: {
  titulo: string;
  testId: string;
  enlace?: { to: string; label: string };
  children: ReactNode;
}) {
  return (
    <Card data-testid={testId}>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <h3 className="font-semibold text-neutral-900 text-sm uppercase tracking-wide">{titulo}</h3>
        {enlace ? (
          <Link to={enlace.to} className="font-semibold text-primary-700 text-sm">
            {enlace.label}
          </Link>
        ) : null}
      </div>
      <div className="px-4 pb-4">{children}</div>
    </Card>
  );
}

export function EsqueletoBloque({ testId }: { testId: string }) {
  return <div data-testid={testId} className="h-16 animate-pulse rounded-md bg-neutral-100" />;
}

export function ErrorBloque({
  nombre,
  fuente,
  onReintentar,
}: {
  nombre: string;
  fuente: string;
  onReintentar: (fuente: string) => void;
}) {
  return (
    <div>
      <p className="font-medium text-neutral-900 text-sm">No cargó {nombre}</p>
      <p className="mt-0.5 text-neutral-600 text-sm">El resto del Inicio sigue funcionando</p>
      <button
        type="button"
        data-testid={`reintentar-${fuente}`}
        onClick={() => onReintentar(fuente)}
        className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-neutral-300 px-2.5 py-1 font-medium text-neutral-800 text-xs hover:bg-neutral-50"
      >
        <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
        Reintentar
      </button>
    </div>
  );
}

export function CtaVerde({ to, children }: { to: string; children: string }) {
  return (
    <Link
      to={to}
      className="mt-3 inline-flex w-full items-center justify-center rounded-md bg-primary-600 px-3 py-2.5 font-semibold text-sm text-white hover:bg-primary-700"
    >
      {children}
    </Link>
  );
}
