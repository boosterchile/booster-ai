import { Link } from '@tanstack/react-router';
import { ChevronRight, ShieldAlert, WifiOff } from 'lucide-react';
import type { AvisoNegocio } from './negocio.js';

function Chip({ aviso }: { aviso: AvisoNegocio }) {
  return (
    <Link
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
  );
}

export function AvisosChips({ avisos }: { avisos: AvisoNegocio[] }) {
  if (avisos.length === 0) {
    return null;
  }
  return (
    <div data-testid="avisos-chips" className="flex flex-wrap gap-2 md:hidden">
      {avisos.map((aviso) => (
        <Chip key={aviso.id} aviso={aviso} />
      ))}
    </div>
  );
}

export function AvisosCard({ avisos }: { avisos: AvisoNegocio[] }) {
  return (
    <ul data-testid="avisos-card" className="hidden divide-y divide-neutral-100 md:block">
      {avisos.map((aviso) => {
        const Icono = aviso.id === 'documentos' ? ShieldAlert : WifiOff;
        return (
          <li key={aviso.id}>
            <Link to={aviso.href} className="flex items-center gap-3 py-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-warning-50 text-warning-700">
                <Icono className="h-4 w-4" aria-hidden="true" />
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
        );
      })}
    </ul>
  );
}
