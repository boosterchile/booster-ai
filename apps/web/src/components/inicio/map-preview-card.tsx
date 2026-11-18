import { Link } from '@tanstack/react-router';
import { MapPin } from 'lucide-react';

export interface PinMapa {
  id: string;
  titulo: string;
  detalle: string;
  href: string;
}

/**
 * Columna derecha del escritorio. El mapa en vivo de una carga es
 * `/app/cargas/$id/track` (LiveTrackingScreen). Acá no se piden N detalles:
 * el listado ya dijo cuáles van en camino, y el seguimiento abre esa pantalla.
 */
export function MapPreviewCard({
  titulo,
  pins,
  resumen,
}: {
  titulo: string;
  pins: PinMapa[];
  resumen: string | null;
}) {
  const primero = pins[0];
  return (
    <div data-testid="inicio-mapa-cargas" className="rounded-lg border border-neutral-200 bg-white">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <h3 className="font-semibold text-neutral-900 text-sm">{titulo}</h3>
        {primero ? (
          <Link to={primero.href} className="font-semibold text-primary-700 text-sm">
            Seguimiento en vivo
          </Link>
        ) : null}
      </div>
      <div className="mx-4 flex h-[280px] flex-col items-center justify-center rounded-lg border border-neutral-300 border-dashed bg-neutral-50 px-4 text-center">
        <MapPin className="h-8 w-8 text-neutral-400" aria-hidden="true" />
        {pins.length === 0 ? (
          <p className="mt-2 font-medium text-neutral-700 text-sm">Sin cargas en camino</p>
        ) : (
          <ul className="mt-3 space-y-1 text-neutral-800 text-sm">
            {pins.slice(0, 4).map((pin) => (
              <li key={pin.id}>
                <Link to={pin.href} className="font-medium text-primary-800">
                  {pin.titulo}
                </Link>
                <span className="text-neutral-600"> · {pin.detalle}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {resumen ? <p className="px-4 py-3 text-neutral-600 text-sm">{resumen}</p> : null}
    </div>
  );
}
