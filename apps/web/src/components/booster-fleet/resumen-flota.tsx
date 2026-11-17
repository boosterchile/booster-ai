import type { PanelBoosterFleet } from '@booster-ai/shared-schemas';
import { cn } from '@booster-ai/ui-components';
import {
  TITULO_TONO,
  TONO_DE_SENAL,
  type Tono,
  agruparPorTono,
  contar,
  formatoNumero,
  fraseEstado,
} from './reglas.js';

const SEGMENTO: Record<Tono, string> = {
  primero: 'bg-danger-600',
  sin_lectura: 'border border-urgency-600 border-dashed bg-urgency-50',
  atencion: 'bg-urgency-500',
  en_orden: 'bg-success-500',
  neutro: 'bg-neutral-300',
};

const LEYENDA: Record<Tono, [string, string]> = {
  primero: ['desviación', 'desviaciones'],
  sin_lectura: ['sin lectura', 'sin lectura'],
  atencion: ['con consumo alto', 'con consumo alto'],
  en_orden: ['en orden', 'en orden'],
  neutro: ['', ''],
};

/** Una cifra de la franja: etiqueta, valor, unidad y una nota que dice de qué está hecha. */
export function CifraFlota({
  etiqueta,
  valor,
  unidad,
  nota,
  critica = false,
}: {
  etiqueta: string;
  valor: string;
  unidad?: string;
  nota?: string;
  critica?: boolean;
}) {
  return (
    <div className="min-w-0 px-4 py-3.5">
      <dt className="font-medium text-neutral-600 text-xs">{etiqueta}</dt>
      <dd className="mt-1">
        <span
          className={cn(
            'font-semibold text-2xl tabular-nums tracking-tight',
            critica ? 'text-danger-700' : 'text-neutral-900',
          )}
        >
          {valor}
        </span>
        {unidad ? <span className="ml-1.5 text-neutral-600 text-sm">{unidad}</span> : null}
        {nota ? <span className="mt-1 block text-neutral-500 text-xs">{nota}</span> : null}
      </dd>
    </div>
  );
}

/**
 * Cabecera del panel: la frase que dice por dónde partir, la barra con un
 * segmento por camión y las cuatro cifras. Combustible manda.
 */
export function ResumenFlota({
  panel,
  documentosPendientes,
}: {
  panel: PanelBoosterFleet;
  documentosPendientes: number;
}) {
  const { combustible, documental, mantenciones } = panel;
  const frase = fraseEstado(combustible);
  const grupos = agruparPorTono(combustible.vehiculos);
  const leyenda = grupos
    .map((grupo) => {
      const [uno, varios] = LEYENDA[grupo.tono];
      return `${grupo.vehiculos.length} ${grupo.vehiculos.length === 1 ? uno : varios}`;
    })
    .join(', ');
  const hayPrimero = grupos.some((grupo) => grupo.tono === 'primero');

  return (
    <div>
      <div className="mt-5 grid items-end gap-6 lg:grid-cols-[1fr_24rem]">
        <p className="max-w-2xl font-semibold text-3xl text-neutral-900 leading-tight tracking-tight">
          {frase.inicio}
          {frase.foco ? (
            <>
              {' '}
              <span className={hayPrimero ? 'text-danger-700' : undefined}>{frase.foco}</span>
            </>
          ) : null}
        </p>
        {combustible.vehiculos.length > 0 ? (
          <div>
            <div
              role="img"
              aria-label={`${contar(combustible.vehiculos.length, 'camión', 'camiones')}: ${leyenda}`}
              className="flex h-7 gap-0.5"
            >
              {combustible.vehiculos.map((vehiculo) => (
                <span
                  key={vehiculo.vehiculo_id}
                  className={cn('flex-1 rounded-sm', SEGMENTO[TONO_DE_SENAL[vehiculo.senal]])}
                />
              ))}
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-neutral-600 text-xs">
              {grupos.map((grupo) => (
                <li key={grupo.tono}>
                  <span className="font-semibold text-neutral-900">{grupo.vehiculos.length}</span>{' '}
                  {LEYENDA[grupo.tono][grupo.vehiculos.length === 1 ? 0 : 1] ||
                    TITULO_TONO[grupo.tono]}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <dl className="mt-6 grid divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-neutral-0 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
        <CifraFlota
          etiqueta="Consumo de la flota"
          valor={
            combustible.litros_por_100_km != null
              ? formatoNumero(combustible.litros_por_100_km)
              : '—'
          }
          unidad="L/100 km"
          nota={
            combustible.litros_por_100_km != null
              ? 'Solo con lectura confiable'
              : 'Sin lectura confiable todavía'
          }
        />
        <CifraFlota
          etiqueta="Combustible"
          valor={String(combustible.con_alerta)}
          unidad={`de ${combustible.vehiculos.length} con alerta`}
          critica={hayPrimero}
        />
        <CifraFlota
          etiqueta="Documentos"
          valor={String(documentosPendientes)}
          unidad={documentosPendientes === 1 ? 'pendiente' : 'pendientes'}
          nota={`${contar(documental.vehiculos_con_hallazgo, 'vehículo', 'vehículos')} · ${contar(documental.conductores_con_hallazgo, 'conductor', 'conductores')}`}
        />
        <CifraFlota
          etiqueta="Mantenciones"
          valor={String(mantenciones.vencidas)}
          unidad={mantenciones.vencidas === 1 ? 'vencida' : 'vencidas'}
          nota={`${contar(mantenciones.proximas, 'próxima', 'próximas')} · ${contar(mantenciones.programadas, 'programada', 'programadas')}`}
          critica={mantenciones.vencidas > 0}
        />
      </dl>
    </div>
  );
}
