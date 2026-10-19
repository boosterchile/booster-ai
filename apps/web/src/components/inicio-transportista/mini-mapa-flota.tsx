import { Link } from '@tanstack/react-router';
import { FleetMap } from '../map/FleetMap.js';
import type { MapaNegocio } from './negocio.js';

/** El mismo mapa de `/app/flota`, en la columna derecha del escritorio. */
export function MiniMapaFlota({ mapa }: { mapa: MapaNegocio }) {
  return (
    <div data-testid="inicio-mapa-flota" className="hidden md:block">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="font-semibold text-neutral-900 text-sm">Flota ahora</h3>
        <Link to="/app/flota" className="font-semibold text-primary-700 text-sm">
          Abrir mapa
        </Link>
      </div>
      {mapa.vehiculos.length === 0 ? (
        <p className="mb-2 text-neutral-600 text-sm">Sin vehículos para mostrar en el mapa.</p>
      ) : null}
      <FleetMap vehicles={mapa.vehiculos} height={330} />
      <p className="mt-2 text-neutral-600 text-sm">
        <span className="font-semibold text-neutral-900 tabular-nums">{mapa.conectados}</span>
        <span>/{mapa.total} conectados</span>
        <span className="ml-3">
          {mapa.sinSenal} sin señal · {mapa.sinGps} sin GPS
        </span>
      </p>
    </div>
  );
}
