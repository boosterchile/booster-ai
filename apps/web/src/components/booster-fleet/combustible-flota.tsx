import type { PanelBoosterFleet } from '@booster-ai/shared-schemas';
import { cn } from '@booster-ai/ui-components';
import { Link } from '@tanstack/react-router';
import { Fuel } from 'lucide-react';
import { EtiquetaSeveridad, Patente } from './etiqueta-severidad.js';
import {
  type Destino,
  ETIQUETA_SENAL,
  TITULO_TONO,
  TONO_DE_SENAL,
  type VehiculoFlota,
  accionDe,
  agruparPorTono,
  contar,
  descripcionDe,
  formatoNumero,
  medianaLectura,
} from './reglas.js';

function EnlaceAccion({
  destino,
  className,
  children,
}: {
  destino: Destino;
  className: string;
  children: string;
}) {
  if (destino.to === '/app/trayectos') {
    return (
      <Link to="/app/trayectos" search={destino.search} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <Link to="/app/vehiculos/$id" params={destino.params} className={className}>
      {children}
    </Link>
  );
}

/** L/100 km con una barra que marca la mediana de la flota. */
function Consumo({ vehiculo, mediana }: { vehiculo: VehiculoFlota; mediana: number | null }) {
  const valor = vehiculo.litros_por_100_km;
  if (valor == null) {
    return <span className="text-neutral-500 text-xs">sin lectura</span>;
  }
  const escala = Math.max(valor, mediana ?? 0) * 1.15;
  const tono = TONO_DE_SENAL[vehiculo.senal];
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="tabular-nums">{formatoNumero(valor)}</span>
      <span aria-hidden="true" className="relative h-1.5 w-14 rounded-full bg-neutral-100">
        <span
          className={cn(
            'absolute inset-y-0 left-0 rounded-full',
            tono === 'primero' && 'bg-danger-600',
            tono === 'atencion' && 'bg-urgency-600',
            tono !== 'primero' && tono !== 'atencion' && 'bg-neutral-500',
          )}
          style={{ width: `${(valor / escala) * 100}%` }}
        />
        {mediana != null ? (
          <span
            className="-inset-y-1 absolute w-px bg-neutral-900"
            style={{ left: `${(mediana / escala) * 100}%` }}
          />
        ) : null}
      </span>
    </span>
  );
}

/** Un camión: patente, señal, litros, consumo contra la mediana y la acción. */
export function FilaFlota({
  vehiculo,
  mediana,
}: {
  vehiculo: VehiculoFlota;
  mediana: number | null;
}) {
  const tono = TONO_DE_SENAL[vehiculo.senal];
  const accion = accionDe(vehiculo);
  return (
    <tr className={cn('border-neutral-200 border-t', tono === 'primero' && 'bg-danger-50')}>
      <th scope="row" className="px-4 py-2.5 text-left align-top font-normal">
        <Link
          to="/app/booster-fleet/vehiculos/$id"
          params={{ id: vehiculo.vehiculo_id }}
          aria-label={`Ver el detalle de ${vehiculo.patente}`}
        >
          <Patente>{vehiculo.patente}</Patente>
        </Link>
      </th>
      <td className="px-3 py-2.5 align-top">
        <EtiquetaSeveridad tono={tono}>{ETIQUETA_SENAL[vehiculo.senal]}</EtiquetaSeveridad>
        <span className="mt-1 block text-neutral-600 text-xs">{descripcionDe(vehiculo)}</span>
      </td>
      <td className="px-3 py-2.5 text-right align-top tabular-nums">
        {vehiculo.litros != null ? (
          `${formatoNumero(vehiculo.litros)} L`
        ) : (
          <span className="text-neutral-500">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right align-top">
        <Consumo vehiculo={vehiculo} mediana={mediana} />
      </td>
      <td className="px-4 py-2.5 text-right align-top">
        {accion ? (
          <EnlaceAccion
            destino={accion.destino}
            className={
              tono === 'primero'
                ? 'inline-flex rounded-md bg-danger-600 px-2.5 py-1 font-medium text-white text-xs hover:bg-danger-700'
                : 'whitespace-nowrap font-medium text-primary-700 text-sm hover:underline'
            }
          >
            {accion.etiqueta}
          </EnlaceAccion>
        ) : null}
      </td>
    </tr>
  );
}

/**
 * Combustible de la flota, agrupado por tono en orden de gravedad. Los
 * camiones en orden se colapsan en una línea: el color queda para lo que
 * hay que resolver.
 */
export function CombustibleFlota({
  combustible,
}: {
  combustible: PanelBoosterFleet['combustible'];
}) {
  const mediana = medianaLectura(combustible.vehiculos);
  const grupos = agruparPorTono(combustible.vehiculos);

  return (
    <section
      aria-labelledby="combustible-titulo"
      className="overflow-hidden rounded-lg border border-neutral-200 bg-neutral-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <h2
          id="combustible-titulo"
          className="flex items-center gap-2 font-semibold text-neutral-900"
        >
          <Fuel className="h-4 w-4" aria-hidden /> Combustible
        </h2>
        <p className="text-neutral-600 text-xs">
          {contar(combustible.vehiculos.length, 'camión', 'camiones')} · últimos 7 días
          {mediana != null ? ` · mediana ${formatoNumero(mediana)} L/100 km` : ''}
        </p>
      </div>
      {combustible.vehiculos.length === 0 ? (
        <p className="border-neutral-200 border-t px-4 py-4 text-neutral-600 text-sm">
          Todavía no hay vehículos en la flota.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-neutral-500 text-xs">
            <tr className="border-neutral-200 border-t">
              <th scope="col" className="px-4 py-2 text-left font-medium">
                Camión
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Señal
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Litros
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                L/100 km
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Qué hacer
              </th>
            </tr>
          </thead>
          {grupos.map((grupo) => (
            <tbody key={grupo.tono}>
              <tr className="border-neutral-200 border-t bg-neutral-50">
                <th
                  scope="colgroup"
                  colSpan={5}
                  className="px-4 py-1.5 text-left font-semibold text-neutral-500 text-xs uppercase tracking-wider"
                >
                  {TITULO_TONO[grupo.tono]} · {grupo.vehiculos.length}
                </th>
              </tr>
              {grupo.tono === 'en_orden' ? (
                <tr className="border-neutral-200 border-t">
                  <td colSpan={5} className="px-4 py-2.5">
                    <ul className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      {grupo.vehiculos.map((vehiculo) => (
                        <li key={vehiculo.vehiculo_id} className="flex items-center gap-2">
                          <Patente>{vehiculo.patente}</Patente>
                          {vehiculo.litros_por_100_km != null ? (
                            <span className="text-neutral-600 tabular-nums">
                              {formatoNumero(vehiculo.litros_por_100_km)}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ) : (
                grupo.vehiculos.map((vehiculo) => (
                  <FilaFlota key={vehiculo.vehiculo_id} vehiculo={vehiculo} mediana={mediana} />
                ))
              )}
            </tbody>
          ))}
        </table>
      )}
    </section>
  );
}
