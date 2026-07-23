import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ArrowLeft, Fuel, Gauge, MapPin, Route as RouteIcon, Timer } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { TrazaMapPreview } from '../components/map/TrazaMapPreview.js';
import { api } from '../lib/api-client.js';
import type { LatLng } from '../lib/polyline.js';

/**
 * /app/vehiculos/:id/historial — recorrido real del vehículo en una ventana.
 *
 * Capa 2 (reframe a vehículo, ver `.specs/vehiculo-traza-historial/`): dibuja
 * la traza real (downsampleada por el backend) sobre el mapa + un resumen
 * (distancia, duración, y si hay CAN, litros consumidos y km del odómetro).
 *
 * Espejo MANUAL del DTO de `GET /vehiculos/:id/traza` en
 * apps/api/src/routes/vehiculos.ts — ambos lados se editan juntos.
 */
interface TrazaResponse {
  vehicle_id: string;
  plate: string;
  desde: string;
  hasta: string;
  puntos: Array<{ t: string; lat: number; lng: number }>;
  puntos_total: number;
  puntos_devueltos: number;
  resumen: {
    distancia_km: number;
    /** Tiempo REAL de movimiento (excluye paradas y apagones), no el span. */
    duracion_min: number;
    litros_consumidos: number | null;
    km_can: number | null;
  };
}

/**
 * `YYYY-MM-DDTHH:mm` en hora LOCAL del navegador, para los
 * `<input type="datetime-local">`. El operador (en Chile) ve/edita su hora
 * local; la conversión a UTC la hace `localInputToIso`.
 */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Interpreta el valor del `datetime-local` (hora local del navegador → zona
 * del SO, DST incluido) y lo convierte a ISO UTC para la query. Devuelve `null`
 * si el valor es inválido (input vacío), para no romper el render.
 */
function localInputToIso(local: string): string | null {
  const ms = new Date(local).getTime();
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function formatDuracion(min: number): string {
  if (min < 1) {
    return '< 1 min';
  }
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export function VehiculoHistorialRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        return <VehiculoHistorialPage />;
      }}
    </ProtectedRoute>
  );
}

function VehiculoHistorialPage() {
  const { id } = useParams({ strict: false }) as { id: string };

  // Rango por defecto: últimos 7 días, con hora.
  const hoy = new Date();
  const hace7 = new Date(hoy.getTime() - 7 * 24 * 60 * 60 * 1000);
  const [desde, setDesde] = useState(toLocalInput(hace7));
  const [hasta, setHasta] = useState(toLocalInput(hoy));

  const desdeIso = localInputToIso(desde);
  const hastaIso = localInputToIso(hasta);
  // `desde <= hasta` sobre `YYYY-MM-DDTHH:mm` es comparación cronológica
  // (formato fijo, zero-padded).
  const rangoValido = desdeIso !== null && hastaIso !== null && desde <= hasta;

  const trazaQ = useQuery({
    queryKey: ['vehiculos', id, 'traza', desdeIso, hastaIso],
    queryFn: () => {
      if (desdeIso === null || hastaIso === null) {
        // Inalcanzable: `enabled` ya exige rango válido. Guard defensivo.
        throw new Error('rango inválido');
      }
      return api.get<TrazaResponse>(
        `/vehiculos/${id}/traza?desde=${encodeURIComponent(desdeIso)}&hasta=${encodeURIComponent(hastaIso)}`,
      );
    },
    enabled: rangoValido,
  });

  const points = useMemo<LatLng[]>(
    () => (trazaQ.data?.puntos ?? []).map((p) => ({ lat: p.lat, lng: p.lng })),
    [trazaQ.data],
  );

  const resumen = trazaQ.data?.resumen;

  return (
    <div className="mx-auto max-w-4xl p-4">
      <div className="mb-4 flex items-center gap-3">
        <Link
          to="/app/vehiculos/$id"
          params={{ id }}
          className="flex items-center gap-1 text-neutral-500 text-sm hover:text-neutral-700"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Volver
        </Link>
        <h1 className="font-semibold text-lg text-neutral-800">
          {trazaQ.data?.plate ? `${trazaQ.data.plate} · Recorrido` : 'Recorrido del vehículo'}
        </h1>
      </div>

      {/* Selector de rango */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-neutral-600 text-xs">
          Desde
          <input
            type="datetime-local"
            value={desde}
            max={hasta}
            onChange={(e) => setDesde(e.target.value)}
            className="mt-0.5 rounded-md border border-neutral-300 px-2 py-1 text-neutral-800 text-sm"
          />
        </label>
        <label className="flex flex-col text-neutral-600 text-xs">
          Hasta
          <input
            type="datetime-local"
            value={hasta}
            min={desde}
            onChange={(e) => setHasta(e.target.value)}
            className="mt-0.5 rounded-md border border-neutral-300 px-2 py-1 text-neutral-800 text-sm"
          />
        </label>
      </div>

      {trazaQ.isError ? (
        <div
          className="rounded-md border border-danger-200 bg-danger-50 p-4 text-danger-700 text-sm"
          data-testid="traza-error"
        >
          No se pudo cargar el recorrido. Intentá con otro rango.
        </div>
      ) : (
        <>
          <TrazaMapPreview points={points} />

          {/* Resumen */}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="traza-resumen">
            <ResumenStat
              icon={<RouteIcon className="h-4 w-4" aria-hidden />}
              label="Distancia"
              value={resumen ? `${resumen.distancia_km.toFixed(1)} km` : '—'}
            />
            <ResumenStat
              icon={<Timer className="h-4 w-4" aria-hidden />}
              label="En movimiento"
              value={resumen ? formatDuracion(resumen.duracion_min) : '—'}
            />
            <ResumenStat
              icon={<Fuel className="h-4 w-4" aria-hidden />}
              label="Combustible"
              value={
                resumen?.litros_consumidos != null
                  ? `${resumen.litros_consumidos.toFixed(1)} L`
                  : 'Sin dato'
              }
            />
            <ResumenStat
              icon={<Gauge className="h-4 w-4" aria-hidden />}
              label="Km (CAN)"
              value={resumen?.km_can != null ? `${resumen.km_can.toFixed(1)} km` : 'Sin dato'}
            />
          </div>

          {trazaQ.data ? (
            <p className="mt-2 flex items-center gap-1 text-neutral-500 text-xs">
              <MapPin className="h-3 w-3" aria-hidden />
              {trazaQ.data.puntos_devueltos} de {trazaQ.data.puntos_total} puntos
              {trazaQ.data.puntos_devueltos < trazaQ.data.puntos_total
                ? ' (traza simplificada)'
                : ''}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function ResumenStat({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col rounded-md border border-neutral-200 bg-white p-3">
      <div className="flex items-center gap-1 text-neutral-500 text-xs uppercase tracking-wide">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 font-semibold text-lg text-neutral-800">{value}</div>
    </div>
  );
}
