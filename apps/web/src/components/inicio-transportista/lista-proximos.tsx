import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import type { RetiroNegocio } from './negocio.js';

const MOVIL = 3;

function FilaMovil({ retiro }: { retiro: RetiroNegocio }) {
  return (
    <li data-testid={`retiro-movil-${retiro.clave}`} className="flex items-center gap-3 py-2">
      <div className="w-14 shrink-0">
        <p className="font-semibold text-neutral-900 text-sm tabular-nums">{retiro.hora}</p>
        <p className="text-neutral-500 text-xs">{retiro.dia}</p>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-neutral-900 text-sm">{retiro.ruta}</p>
        <p className="truncate text-neutral-600 text-xs">
          {retiro.patente ? <span className="mr-1 font-medium">{retiro.patente}</span> : null}
          {retiro.sinConductor ? (
            <span className="font-semibold text-danger-700">Sin conductor</span>
          ) : (
            retiro.conductor
          )}
        </p>
      </div>
      {retiro.asignarId ? (
        <Link
          to="/app/asignaciones/$id"
          params={{ id: retiro.asignarId }}
          className="shrink-0 rounded-md bg-primary-600 px-2.5 py-1 font-semibold text-white text-xs"
        >
          Asignar
        </Link>
      ) : (
        <ChevronRight className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden="true" />
      )}
    </li>
  );
}

function FilaDesktop({ retiro }: { retiro: RetiroNegocio }) {
  return (
    <tr data-testid={`retiro-desktop-${retiro.clave}`} className="border-neutral-100 border-b">
      <td className="py-2 pr-3 font-semibold text-sm">
        {retiro.dia} {retiro.hora}
      </td>
      <td className="py-2 pr-3 text-sm">{retiro.ruta}</td>
      <td className="py-2 pr-3 text-sm">{retiro.patente ?? '—'}</td>
      <td className="py-2 text-sm">
        {retiro.sinConductor ? (
          <span className="font-semibold text-danger-700">Sin conductor</span>
        ) : (
          retiro.conductor
        )}
        {retiro.asignarId ? (
          <Link
            to="/app/asignaciones/$id"
            params={{ id: retiro.asignarId }}
            className="ml-2 rounded-md bg-primary-600 px-2.5 py-1 font-semibold text-white text-xs"
          >
            Asignar
          </Link>
        ) : null}
      </td>
    </tr>
  );
}

/** 3 filas en móvil y tabla de hasta 5 en desktop. Una sola acción Asignar. */
export function ListaProximos({ retiros }: { retiros: RetiroNegocio[] }) {
  const movil = retiros.slice(0, MOVIL);
  return (
    <>
      <ul data-testid="retiros-movil" className="md:hidden">
        {movil.map((retiro) => (
          <FilaMovil key={retiro.clave} retiro={retiro} />
        ))}
      </ul>
      <div data-testid="retiros-desktop" className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="text-neutral-500 text-xs">
              <th className="pr-3 pb-2 font-semibold">Retiro</th>
              <th className="pr-3 pb-2 font-semibold">Ruta</th>
              <th className="pr-3 pb-2 font-semibold">Vehículo</th>
              <th className="pb-2 font-semibold">Conductor</th>
            </tr>
          </thead>
          <tbody>
            {retiros.map((retiro) => (
              <FilaDesktop key={retiro.clave} retiro={retiro} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
