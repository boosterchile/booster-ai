import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { MapPin, Navigation, Radio, Truck } from 'lucide-react';
import { useState } from 'react';
import { ChileanPlate } from '../components/ChileanPlate.js';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { RelativeTime } from '../components/RelativeTime.js';
import { FleetMap, type FleetMapVehicle } from '../components/map/FleetMap.js';
import type { MeResponse } from '../hooks/use-me.js';
import { api } from '../lib/api-client.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

interface FleetVehicleResponse {
  id: string;
  plate: string;
  type: string;
  teltonika_imei: string | null;
  status: 'activo' | 'mantenimiento' | 'retirado';
  position: {
    timestamp_device: string;
    latitude: number | null;
    longitude: number | null;
    speed_kmh: number | null;
    angle_deg: number | null;
  } | null;
}

/**
 * /app/flota — vista de seguimiento de flota en tiempo real.
 *
 * Reemplaza el patrón anterior donde la ubicación del vehículo se accedía
 * desde el formulario de edición (`/app/vehiculos/$id`). Esta vista es el
 * primer destino para "saber dónde está mi flota ahora mismo": mapa con
 * todos los vehículos + lista lateral. Click en un vehículo → drill-down
 * a `/app/vehiculos/$id/live` (modo Uber full-screen).
 *
 * Polling: 20 s. Es ~10× lo que cuesta /:id/live (15 s) pero captura
 * cambios sin sobrecargar cuando el usuario tiene la pestaña abierta.
 */
export function FlotaRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        return <FlotaPage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function FlotaPage({ me }: { me: MeOnboarded }) {
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const flotaQ = useQuery({
    queryKey: ['flota'],
    queryFn: async () => {
      const res = await api.get<{ fleet: FleetVehicleResponse[] }>('/vehiculos/flota');
      return res.fleet;
    },
    refetchInterval: 20_000,
  });

  const mapVehicles: FleetMapVehicle[] = (flotaQ.data ?? [])
    .filter((v) => v.position?.latitude != null && v.position?.longitude != null)
    .map((v) => ({
      id: v.id,
      plate: v.plate,
      latitude: v.position?.latitude ?? 0,
      longitude: v.position?.longitude ?? 0,
      speedKmh: v.position?.speed_kmh ?? null,
      hasTeltonika: Boolean(v.teltonika_imei),
    }));

  const totalCount = flotaQ.data?.length ?? 0;
  const reportingCount = mapVehicles.length;
  const noPosCount = totalCount - reportingCount;

  return (
    <Layout me={me} title="Seguimiento de flota">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">
            Seguimiento de flota
          </h1>
          <p className="mt-1 text-neutral-600 text-sm">
            Ubicación en tiempo real de todos los vehículos de tu empresa. Se actualiza cada 20
            segundos.
          </p>
        </div>
        <Link
          to="/app/vehiculos"
          className="hidden shrink-0 items-center gap-2 rounded-md border border-neutral-300 px-3 py-2 font-medium text-neutral-700 text-sm transition hover:bg-neutral-50 sm:flex"
        >
          <Truck className="h-4 w-4" aria-hidden />
          Gestionar flota
        </Link>
      </div>

      {flotaQ.isLoading && <p className="mt-6 text-neutral-500">Cargando…</p>}
      {flotaQ.error && (
        <p className="mt-6 text-danger-700">
          Error al cargar la flota. Reintenta en unos segundos.
        </p>
      )}

      {flotaQ.data && flotaQ.data.length === 0 && (
        <div className="mt-6 rounded-md border border-neutral-200 border-dashed bg-white p-10 text-center">
          <Truck className="mx-auto h-10 w-10 text-neutral-400" aria-hidden />
          <p className="mt-3 font-medium text-neutral-900">Aún no tienes vehículos</p>
          <p className="mt-1 text-neutral-600 text-sm">
            Agrega vehículos a tu flota para empezar a verlos en este mapa.
          </p>
          <Link
            to="/app/vehiculos/nuevo"
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700"
          >
            Agregar vehículo
          </Link>
        </div>
      )}

      {flotaQ.data && flotaQ.data.length > 0 && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-neutral-600 text-sm">
            <span className="inline-flex items-center gap-1 rounded-md bg-success-50 px-2 py-1 font-medium text-success-700 text-xs">
              <Radio className="h-3.5 w-3.5" aria-hidden />
              {reportingCount} reportando
            </span>
            {noPosCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 font-medium text-neutral-600 text-xs">
                <MapPin className="h-3.5 w-3.5" aria-hidden />
                {noPosCount} sin posición
              </span>
            )}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <FleetMap
                vehicles={mapVehicles}
                selectedId={selectedId}
                onSelectVehicle={(id) => setSelectedId(id)}
                height={520}
              />
            </div>

            <ul className="space-y-3 lg:max-h-[520px] lg:overflow-y-auto lg:pr-1">
              {flotaQ.data.map((v) => {
                const isSelected = selectedId === v.id;
                const hasPos = v.position?.latitude != null && v.position?.longitude != null;
                return (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(v.id)}
                      onDoubleClick={() =>
                        void navigate({
                          to: '/app/vehiculos/$id/live',
                          params: { id: v.id },
                        })
                      }
                      className={`w-full rounded-lg border bg-white p-3 text-left shadow-sm transition ${
                        isSelected
                          ? 'border-primary-500 ring-2 ring-primary-200'
                          : 'border-neutral-200 hover:border-primary-300'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <ChileanPlate plate={v.plate} size="sm" />
                        <span
                          className={`shrink-0 rounded-md px-2 py-0.5 font-medium text-xs ${
                            v.status === 'activo'
                              ? 'bg-success-50 text-success-700'
                              : v.status === 'mantenimiento'
                                ? 'bg-amber-50 text-amber-700'
                                : 'bg-neutral-100 text-neutral-600'
                          }`}
                        >
                          {v.status === 'activo'
                            ? 'Activo'
                            : v.status === 'mantenimiento'
                              ? 'Mantenimiento'
                              : 'Retirado'}
                        </span>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 text-neutral-700 text-xs">
                        <div>
                          <div className="text-neutral-500 uppercase tracking-wider">Velocidad</div>
                          <div className="font-mono text-sm">
                            {v.position?.speed_kmh != null ? `${v.position.speed_kmh} km/h` : '—'}
                          </div>
                        </div>
                        <div>
                          <div className="text-neutral-500 uppercase tracking-wider">Reportado</div>
                          <div className="text-sm">
                            {hasPos ? (
                              <RelativeTime
                                date={v.position?.timestamp_device ?? null}
                                fallback="sin GPS"
                              />
                            ) : (
                              <span className="text-neutral-400">sin GPS</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-between">
                        <span className="text-neutral-400 text-xs">
                          {v.teltonika_imei ? 'Teltonika' : 'Sin device'}
                        </span>
                        <Link
                          to="/app/vehiculos/$id/live"
                          params={{ id: v.id }}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-primary-600 text-xs hover:underline"
                        >
                          <Navigation className="h-3.5 w-3.5" aria-hidden />
                          Ver en vivo
                        </Link>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </Layout>
  );
}
