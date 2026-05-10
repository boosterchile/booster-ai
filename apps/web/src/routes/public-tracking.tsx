/**
 * /tracking/$token — página pública del estado de un trip (Phase 5 PR-L4).
 *
 * Surface SIN auth — el shipper o consignee llega acá con un link
 * compartido (Phase 5 PR-L3 envía el link via WhatsApp). NO requiere
 * cuenta ni login.
 *
 * Layout mobile-first deliberado: el consignee típicamente abre el link
 * desde su teléfono. La info crítica (status + vehículo + posición)
 * cabe arriba del fold sin scroll.
 *
 * **Datos mostrados** (todos vienen del endpoint público):
 *   - Tracking code + status del trip
 *   - Origen / destino (texto)
 *   - Vehículo: tipo + plate parcial enmascarada
 *   - Posición: lat/lng + velocidad + age (cuándo fue la última lectura)
 *   - Progress (cuando #121 merge): avg_speed + age en formato humano
 *
 * **NO mostrados** (privacy + decisión backend):
 *   - Plate completa
 *   - Driver name
 *   - Precio acordado
 */

import { useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Gauge,
  MapPin,
  Package,
  RefreshCw,
  Truck,
} from 'lucide-react';
import {
  type PublicTrackingFoundResponse,
  usePublicTracking,
} from '../hooks/use-public-tracking.js';

export function PublicTrackingRoute() {
  const { token } = useParams({ strict: false }) as { token: string };
  const queryClient = useQueryClient();
  const query = usePublicTracking(token);

  const handleRefresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['public-tracking', token] });
  };

  return (
    <div className="min-h-screen bg-neutral-100">
      <Header />

      <main className="mx-auto max-w-2xl px-4 py-6">
        {query.isLoading && <LoadingState />}
        {query.isError && <ErrorState error={query.error} />}
        {query.data && (
          <TrackingContent
            data={query.data}
            isFetching={query.isFetching}
            onRefresh={handleRefresh}
          />
        )}
      </main>
    </div>
  );
}

function Header() {
  return (
    <header className="border-neutral-200 border-b bg-white">
      <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-4">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-700 text-white"
          aria-hidden
        >
          <Truck className="h-5 w-5" />
        </div>
        <div>
          <h1 className="font-semibold text-neutral-900 text-sm">Booster AI</h1>
          <p className="text-neutral-500 text-xs">Seguimiento de carga</p>
        </div>
      </div>
    </header>
  );
}

function LoadingState() {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <RefreshCw className="h-5 w-5 animate-spin text-neutral-400" aria-hidden />
        <p className="text-neutral-500 text-sm">Cargando seguimiento…</p>
      </div>
    </div>
  );
}

function ErrorState({ error }: { error: unknown }) {
  const isNotFound = error instanceof Error && error.message.includes('404');
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 text-amber-700" aria-hidden />
        <div>
          <p className="font-semibold text-amber-900 text-sm">
            {isNotFound ? 'Link de seguimiento no válido' : 'No se pudo cargar el seguimiento'}
          </p>
          <p className="mt-1 text-amber-800 text-xs">
            {isNotFound
              ? 'Verifica que el link sea correcto. Si el problema persiste, contacta a quien te lo compartió.'
              : 'Intenta refrescar la página en unos segundos.'}
          </p>
        </div>
      </div>
    </div>
  );
}

function TrackingContent({
  data,
  isFetching,
  onRefresh,
}: {
  data: PublicTrackingFoundResponse;
  isFetching: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="space-y-4">
      <StatusCard data={data} isFetching={isFetching} onRefresh={onRefresh} />
      <RouteCard data={data} />
      <VehicleCard data={data} />
      <PositionCard data={data} />
      {data.progress && <ProgressCard progress={data.progress} />}
      <Footer />
    </div>
  );
}

const STATUS_LABELS: Record<string, { label: string; bg: string; text: string }> = {
  asignado: { label: 'Asignado', bg: 'bg-primary-50', text: 'text-primary-800' },
  en_proceso: { label: 'En camino', bg: 'bg-success-50', text: 'text-success-800' },
  entregado: { label: 'Entregado', bg: 'bg-success-100', text: 'text-success-900' },
  cancelado: { label: 'Cancelado', bg: 'bg-neutral-100', text: 'text-neutral-700' },
  esperando_match: { label: 'Buscando transportista', bg: 'bg-amber-50', text: 'text-amber-800' },
};

function StatusCard({
  data,
  isFetching,
  onRefresh,
}: {
  data: PublicTrackingFoundResponse;
  isFetching: boolean;
  onRefresh: () => void;
}) {
  const meta = STATUS_LABELS[data.trip.status] ?? {
    label: data.trip.status,
    bg: 'bg-neutral-100',
    text: 'text-neutral-700',
  };
  const isDelivered = data.trip.status === 'entregado';

  return (
    <section
      className={`rounded-lg p-5 shadow-sm ${meta.bg}`}
      aria-label="Estado del envío"
      data-testid="status-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={`font-semibold text-xs uppercase tracking-wide ${meta.text}`}>Estado</p>
          <p className={`mt-1 font-bold text-2xl ${meta.text}`}>{meta.label}</p>
          <p className={`mt-1 text-xs ${meta.text} opacity-80`}>Carga {data.trip.tracking_code}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {isDelivered ? (
            <CheckCircle2 className={`h-8 w-8 ${meta.text}`} aria-hidden />
          ) : (
            <Truck className={`h-8 w-8 ${meta.text}`} aria-hidden />
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={isFetching}
            aria-label="Refrescar"
            className={`rounded p-1 transition ${meta.text} hover:bg-white/50 disabled:opacity-50`}
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} aria-hidden />
          </button>
        </div>
      </div>
    </section>
  );
}

function RouteCard({ data }: { data: PublicTrackingFoundResponse }) {
  return (
    <section
      className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm"
      aria-label="Ruta"
    >
      <div className="flex items-start gap-3">
        <Package className="mt-0.5 h-5 w-5 shrink-0 text-neutral-500" aria-hidden />
        <div className="flex-1 space-y-3">
          <div>
            <p className="font-semibold text-neutral-500 text-xs uppercase tracking-wide">Origen</p>
            <p className="text-neutral-900 text-sm">{data.trip.origin_address}</p>
          </div>
          <div className="border-neutral-100 border-t pt-3">
            <p className="font-semibold text-neutral-500 text-xs uppercase tracking-wide">
              Destino
            </p>
            <p className="text-neutral-900 text-sm">{data.trip.destination_address}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

const VEHICLE_TYPE_LABELS: Record<string, string> = {
  camioneta: 'Camioneta',
  furgon_pequeno: 'Furgón pequeño',
  furgon_mediano: 'Furgón mediano',
  camion_pequeno: 'Camión pequeño',
  camion_mediano: 'Camión mediano',
  camion_pesado: 'Camión pesado',
  semi_remolque: 'Semi-remolque',
  camion_3_4: 'Camión 3/4',
};

function VehicleCard({ data }: { data: PublicTrackingFoundResponse }) {
  const label = VEHICLE_TYPE_LABELS[data.vehicle.type] ?? data.vehicle.type;
  return (
    <section
      className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm"
      aria-label="Vehículo"
    >
      <div className="flex items-center gap-3">
        <Truck className="h-5 w-5 text-neutral-500" aria-hidden />
        <div>
          <p className="font-semibold text-neutral-500 text-xs uppercase tracking-wide">Vehículo</p>
          <p className="text-neutral-900 text-sm">
            {label} · Placa {data.vehicle.plate_partial}
          </p>
        </div>
      </div>
    </section>
  );
}

function PositionCard({ data }: { data: PublicTrackingFoundResponse }) {
  if (!data.position) {
    return (
      <section
        className="rounded-lg border border-neutral-200 bg-neutral-50 p-5 shadow-sm"
        aria-label="Sin posición disponible"
      >
        <div className="flex items-start gap-3">
          <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-neutral-400" aria-hidden />
          <div>
            <p className="font-semibold text-neutral-700 text-sm">Sin posición reciente</p>
            <p className="mt-0.5 text-neutral-600 text-xs">
              El vehículo no ha reportado su ubicación en los últimos 30 minutos. Esto puede pasar
              si entró a una zona sin cobertura GPS.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const mapsUrl = `https://www.google.com/maps?q=${data.position.latitude},${data.position.longitude}&z=14`;
  const speedText =
    data.position.speed_kmh !== null && data.position.speed_kmh > 0
      ? `${data.position.speed_kmh} km/h`
      : 'detenido';

  return (
    <section
      className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm"
      aria-label="Posición actual"
    >
      <div className="flex items-start gap-3">
        <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-primary-700" aria-hidden />
        <div className="flex-1">
          <p className="font-semibold text-neutral-500 text-xs uppercase tracking-wide">
            Posición actual · {speedText}
          </p>
          <p className="mt-1 font-mono text-neutral-900 text-xs">
            {data.position.latitude.toFixed(5)}, {data.position.longitude.toFixed(5)}
          </p>
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-primary-700 text-xs underline"
          >
            Ver en Google Maps
          </a>
        </div>
      </div>
    </section>
  );
}

function ProgressCard({
  progress,
}: {
  progress: NonNullable<PublicTrackingFoundResponse['progress']>;
}) {
  return (
    <section
      className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm"
      aria-label="Indicadores de progreso"
      data-testid="progress-card"
    >
      <div className="flex items-start gap-3">
        <Gauge className="mt-0.5 h-5 w-5 shrink-0 text-neutral-500" aria-hidden />
        <div className="flex-1 space-y-2">
          <p className="font-semibold text-neutral-500 text-xs uppercase tracking-wide">Progreso</p>
          {progress.avg_speed_kmh_last_15min !== null && (
            <p className="text-neutral-700 text-sm">
              Velocidad promedio (últimos 15 min):{' '}
              <span className="font-semibold text-neutral-900">
                {progress.avg_speed_kmh_last_15min.toFixed(0)} km/h
              </span>
            </p>
          )}
          {progress.last_position_age_seconds !== null && (
            <p className="flex items-center gap-1 text-neutral-700 text-xs">
              <Clock className="h-3.5 w-3.5" aria-hidden />
              Actualizado hace {formatAge(progress.last_position_age_seconds)}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Formato humano de "hace X tiempo".
 *
 * - <60s → "Xs"
 * - <60min → "Xmin"
 * - >=60min → "Xh Ymin"
 */
export function formatAge(seconds: number): string {
  if (seconds < 60) {
    return `${Math.floor(seconds)}s`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)} min`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
}

function Footer() {
  return (
    <footer className="pt-2 pb-4 text-center">
      <p className="text-neutral-500 text-xs">
        Powered by{' '}
        <a
          href="https://app.boosterchile.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary-700 underline"
        >
          Booster AI
        </a>
        {' · '}
        Logística sostenible certificada
      </p>
    </footer>
  );
}
