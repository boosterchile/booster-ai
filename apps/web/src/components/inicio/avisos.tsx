import { Link } from '@tanstack/react-router';
import { ChevronRight, Leaf } from 'lucide-react';

export interface AvisoItem {
  id: string;
  titulo: string;
  detalle: string | null;
  href: string;
  tono: 'alerta' | 'calmo';
}

export function AvisoChips({ avisos }: { avisos: AvisoItem[] }) {
  if (avisos.length === 0) {
    return null;
  }
  return (
    <div data-testid="avisos-chips" className="flex flex-wrap gap-2 md:hidden">
      {avisos.map((aviso) => (
        <Link
          key={aviso.id}
          to={aviso.href}
          className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-neutral-0 px-3 py-1.5 text-neutral-800 text-sm"
        >
          <span
            className={
              aviso.tono === 'alerta'
                ? 'h-2 w-2 rounded-full bg-warning-500'
                : 'h-2 w-2 rounded-full bg-primary-500'
            }
            aria-hidden="true"
          />
          {aviso.titulo}
        </Link>
      ))}
    </div>
  );
}

export function AvisosCard({ avisos }: { avisos: AvisoItem[] }) {
  if (avisos.length === 0) {
    return <p className="text-neutral-600 text-sm">Sin avisos para mostrar.</p>;
  }
  return (
    <ul data-testid="avisos-card" className="divide-y divide-neutral-100">
      {avisos.map((aviso) => (
        <li key={aviso.id}>
          <Link to={aviso.href} className="flex items-center gap-3 py-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-700">
              <Leaf className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-neutral-900 text-sm">{aviso.titulo}</span>
              {aviso.detalle ? (
                <span className="block text-neutral-500 text-xs">{aviso.detalle}</span>
              ) : null}
            </span>
            <ChevronRight className="h-4 w-4 text-neutral-400" aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
