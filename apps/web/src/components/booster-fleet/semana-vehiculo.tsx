import { cn } from '@booster-ai/ui-components';
import type { ReactNode } from 'react';
import { MarcaTono } from './etiqueta-severidad.js';
import { formatoFechaHora, formatoNumero } from './reglas.js';

export interface TrayectoSemana {
  id: string;
  inicio: string;
  fin: string;
  nivel_pct_inicial?: number | null | undefined;
  nivel_pct_final?: number | null | undefined;
  litros_iniciales: number | null;
  litros_finales: number | null;
  desviacion: boolean;
  evento_desde?: string | null | undefined;
  evento_hasta?: string | null | undefined;
  evento_litros?: number | null | undefined;
}

const MS_DIA = 86_400_000;

/** Posición de un instante dentro de la ventana, de 0 a 100. Null si no es una fecha. */
export function posicionEnVentana(iso: string, desdeMs: number, hastaMs: number): number | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t) || hastaMs <= desdeMs) {
    return null;
  }
  return Math.min(100, Math.max(0, ((t - desdeMs) / (hastaMs - desdeMs)) * 100));
}

export interface TramoNivel {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Los tramos de nivel que se pueden dibujar: uno por trayecto que trae
 * lectura al inicio y al final. Entre trayectos no hay lectura y no se une.
 * Usa el porcentaje del estanque si viene; si no, los litros contra el
 * máximo de la semana.
 */
export function tramosDeNivel(
  trayectos: readonly TrayectoSemana[],
  desdeMs: number,
  hastaMs: number,
): { unidad: '%' | 'L'; tope: number; tramos: TramoNivel[] } {
  const conPct = trayectos.some((t) => t.nivel_pct_inicial != null && t.nivel_pct_final != null);
  const lectura = (t: TrayectoSemana): [number, number] | null => {
    const inicio = conPct ? t.nivel_pct_inicial : t.litros_iniciales;
    const fin = conPct ? t.nivel_pct_final : t.litros_finales;
    return inicio != null && fin != null ? [inicio, fin] : null;
  };
  const valores = trayectos.flatMap((t) => lectura(t) ?? []);
  const tope = conPct ? 100 : Math.max(0, ...valores);
  const tramos: TramoNivel[] = [];
  for (const trayecto of trayectos) {
    const par = lectura(trayecto);
    const x1 = posicionEnVentana(trayecto.inicio, desdeMs, hastaMs);
    const x2 = posicionEnVentana(trayecto.fin, desdeMs, hastaMs);
    if (!par || x1 == null || x2 == null || tope <= 0) {
      continue;
    }
    tramos.push({
      id: trayecto.id,
      x1,
      y1: 100 - (par[0] / tope) * 100,
      x2,
      y2: 100 - (par[1] / tope) * 100,
    });
  }
  return { unidad: conPct ? '%' : 'L', tope, tramos };
}

function Carril({
  titulo,
  nota,
  children,
}: { titulo: string; nota?: string; children: ReactNode }) {
  return (
    <>
      <div className="border-neutral-200 border-t px-4 py-3 font-medium text-neutral-600 text-xs">
        {titulo}
        {nota ? <span className="mt-0.5 block font-normal text-neutral-500">{nota}</span> : null}
      </div>
      <div className="relative border-neutral-200 border-t border-l">{children}</div>
    </>
  );
}

/**
 * La semana del camión sobre un solo eje de tiempo: días, nivel de
 * estanque, trayectos y eventos comparten la escala horizontal, para leer
 * la desviación contra lo que el camión estaba haciendo.
 */
export function SemanaVehiculo({
  patente,
  desde,
  hasta,
  trayectos,
}: {
  patente: string;
  desde: string;
  hasta: string;
  trayectos: readonly TrayectoSemana[];
}) {
  const desdeMs = Date.parse(desde);
  const hastaMs = Date.parse(hasta);
  const dias = Math.max(1, Math.round((hastaMs - desdeMs) / MS_DIA));
  const nivel = tramosDeNivel(trayectos, desdeMs, hastaMs);
  const eventos = trayectos.filter((t) => t.desviacion);

  return (
    <section
      aria-labelledby="semana-titulo"
      className="overflow-hidden rounded-lg border border-neutral-200 bg-neutral-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <h2 id="semana-titulo" className="font-semibold text-neutral-900">
          La semana de {patente}
        </h2>
        <p className="text-neutral-600 text-xs">Todo sobre el mismo eje de tiempo</p>
      </div>
      <div className="grid grid-cols-[7.5rem_minmax(0,1fr)]">
        <Carril titulo="Días">
          <ol
            className="grid h-8 text-neutral-500 text-xs"
            style={{ gridTemplateColumns: `repeat(${dias}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: dias }, (_, i) => {
              const etiqueta = formatoFechaHora(new Date(desdeMs + i * MS_DIA).toISOString());
              return (
                <li
                  key={etiqueta ?? i}
                  className={cn('truncate px-2 py-2', i > 0 && 'border-neutral-200 border-l')}
                >
                  {etiqueta?.split(',')[0]}
                </li>
              );
            })}
          </ol>
        </Carril>

        <Carril
          titulo="Nivel de estanque"
          nota={nivel.unidad === '%' ? '% del estanque' : 'litros'}
        >
          {nivel.tramos.length === 0 ? (
            <p className="px-3 py-6 text-neutral-500 text-sm">Sin lectura de nivel en la semana.</p>
          ) : (
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              role="img"
              aria-label={`Nivel de estanque en ${nivel.tramos.length} trayectos con lectura. Entre trayectos no hay lectura.`}
              className="block h-36 w-full text-neutral-900"
            >
              {[0, 50, 100].map((y) => (
                <line
                  key={y}
                  x1="0"
                  x2="100"
                  y1={y}
                  y2={y}
                  className="stroke-neutral-200"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {nivel.tramos.map((tramo) => (
                <line
                  key={tramo.id}
                  x1={tramo.x1}
                  y1={4 + tramo.y1 * 0.92}
                  x2={tramo.x2}
                  y2={4 + tramo.y2 * 0.92}
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
          )}
        </Carril>

        <Carril titulo="Trayectos">
          <div className="relative h-11">
            {trayectos.map((trayecto) => {
              const x1 = posicionEnVentana(trayecto.inicio, desdeMs, hastaMs);
              const x2 = posicionEnVentana(trayecto.fin, desdeMs, hastaMs);
              if (x1 == null || x2 == null) {
                return null;
              }
              return (
                <span
                  key={trayecto.id}
                  title={`${formatoFechaHora(trayecto.inicio)} a ${formatoFechaHora(trayecto.fin)}`}
                  className={cn(
                    'absolute top-3 h-5 rounded border',
                    trayecto.desviacion
                      ? 'border-danger-600 bg-danger-50'
                      : 'border-neutral-300 bg-neutral-100',
                  )}
                  style={{ left: `${x1}%`, width: `${Math.max(0.6, x2 - x1)}%` }}
                />
              );
            })}
          </div>
        </Carril>

        <Carril titulo="Eventos">
          <div className="relative h-11">
            {eventos.length === 0 ? (
              <p className="px-3 py-3 text-neutral-500 text-sm">Sin desviaciones en la semana.</p>
            ) : (
              eventos.map((trayecto) => {
                const cuando = trayecto.evento_hasta ?? trayecto.evento_desde ?? trayecto.fin;
                const x = posicionEnVentana(cuando, desdeMs, hastaMs) ?? 0;
                const derecha = x > 60;
                return (
                  <span
                    key={trayecto.id}
                    className="absolute top-3 flex items-center gap-1.5 whitespace-nowrap font-semibold text-danger-700 text-xs"
                    style={derecha ? { right: `${100 - x}%` } : { left: `${x}%` }}
                  >
                    <MarcaTono tono="primero" />
                    {formatoFechaHora(cuando)?.split(', ')[1]}
                    {trayecto.evento_litros != null
                      ? ` · −${formatoNumero(trayecto.evento_litros)} L`
                      : ''}
                  </span>
                );
              })
            )}
          </div>
        </Carril>
      </div>
    </section>
  );
}
