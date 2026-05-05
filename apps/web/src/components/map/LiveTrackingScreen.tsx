import { Link } from '@tanstack/react-router';
// biome-ignore lint/suspicious/noShadowRestrictedNames: `Map` es el componente exportado por la lib de Google Maps; renombrarlo localmente confunde más que ayuda.
import { APIProvider, AdvancedMarker, Map, Pin } from '@vis.gl/react-google-maps';
import { ArrowLeft, Gauge, MapPin, Navigation, RefreshCw, Truck } from 'lucide-react';
import type { ReactNode } from 'react';
import { env } from '../../lib/env.js';
import { ageSeconds, formatAge } from '../../lib/freshness.js';

/**
 * Pantalla de tracking en vivo estilo Uber.
 *
 * Layout:
 *   - Mapa fullscreen (100vh - header height)
 *   - Header flotante arriba: back button + título (placa o trip ID) + status
 *   - Bottom card flotante: speed actual + última actualización + dirección
 *     opcional + acciones contextuales (ej. botón "Ver detalle del vehículo")
 *
 * Reusable para:
 *   - /app/vehiculos/:id/live (transportista ve SU vehículo)
 *   - /app/cargas/:id/track (shipper ve dónde va SU carga)
 *
 * Polling: el caller maneja useQuery con refetchInterval. Pasa props nuevos
 * y el marker + bottom card se actualizan reactivamente.
 *
 * Estados:
 *   - latitude=null → empty state "Sin posición GPS aún"
 *   - sin VITE_GOOGLE_MAPS_API_KEY → fallback "Mapa no disponible"
 *   - latitude+longitude OK → mapa centrado en el vehículo con marker
 */
export function LiveTrackingScreen({
  title,
  subtitle,
  backTo,
  latitude,
  longitude,
  speedKmh,
  angleDeg,
  timestampDevice,
  isLoading,
  isFetching,
  onRefresh,
  bottomExtra,
}: {
  title: string;
  subtitle?: string | undefined;
  backTo: string;
  latitude: number | null;
  longitude: number | null;
  speedKmh?: number | null;
  angleDeg?: number | null;
  timestampDevice?: Date | string | null;
  isLoading?: boolean;
  isFetching?: boolean;
  onRefresh?: () => void;
  bottomExtra?: ReactNode;
}) {
  const hasMaps = Boolean(env.VITE_GOOGLE_MAPS_API_KEY);
  const hasPos = latitude != null && longitude != null;

  // Cuánto hace del último update. Helpers compartidos en lib/freshness.
  // El threshold de 2 min para `isStale` se mantiene porque /track es la
  // vista realtime (más estricta que el detalle, donde hay 5 min).
  const ageSec = ageSeconds(timestampDevice ?? null);
  const ageLabel = formatAge(ageSec);
  const isStale = ageSec != null && ageSec > 120;

  return (
    <div className="relative h-screen w-full overflow-hidden bg-neutral-100">
      {/* Mapa fullscreen */}
      {hasMaps && hasPos && (
        // biome-ignore lint/style/noNonNullAssertion: hasMaps garantiza que la key está definida.
        <APIProvider apiKey={env.VITE_GOOGLE_MAPS_API_KEY!}>
          <Map
            style={{ height: '100%', width: '100%' }}
            center={{ lat: latitude, lng: longitude }}
            zoom={15}
            gestureHandling="greedy"
            disableDefaultUI={false}
            mapTypeControl={false}
            fullscreenControl={false}
            streetViewControl={false}
            mapId="booster-live-map"
          >
            <AdvancedMarker position={{ lat: latitude, lng: longitude }} title={title}>
              <Pin
                background={isStale ? '#9CA3AF' : '#1FA058'}
                borderColor={isStale ? '#6B7280' : '#0D6E3F'}
                glyphColor="#FFFFFF"
              />
            </AdvancedMarker>
          </Map>
        </APIProvider>
      )}

      {/* Empty states cubriendo el área del mapa */}
      {!hasMaps && (
        <FallbackOverlay
          icon={<MapPin className="h-12 w-12 text-neutral-400" aria-hidden />}
          title="Mapa no disponible"
          description="La key de Google Maps no está configurada en este entorno."
        />
      )}
      {hasMaps && !hasPos && (
        <FallbackOverlay
          icon={<Truck className="h-12 w-12 text-neutral-400" aria-hidden />}
          title={isLoading ? 'Cargando…' : 'Sin posición GPS aún'}
          description={
            isLoading
              ? 'Obteniendo última ubicación…'
              : 'El dispositivo no ha reportado coordenadas. Si recién se asoció, los primeros puntos pueden tardar unos segundos.'
          }
        />
      )}

      {/* Header flotante — top */}
      <div className="absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/30 to-transparent p-4 pb-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <Link
            to={backTo}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-lg transition hover:bg-neutral-50"
            aria-label="Volver"
          >
            <ArrowLeft className="h-5 w-5 text-neutral-700" aria-hidden />
          </Link>
          <div className="flex-1 rounded-lg bg-white px-4 py-2 shadow-lg">
            <div className="font-semibold text-neutral-900 text-sm leading-tight">{title}</div>
            {subtitle && <div className="text-neutral-600 text-xs leading-tight">{subtitle}</div>}
          </div>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={isFetching}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-lg transition hover:bg-neutral-50 disabled:opacity-60"
              aria-label="Refrescar"
            >
              <RefreshCw
                className={`h-4 w-4 text-neutral-700 ${isFetching ? 'animate-spin' : ''}`}
                aria-hidden
              />
            </button>
          )}
        </div>
      </div>

      {/* Bottom card flotante — sticky abajo */}
      <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/20 to-transparent p-4 pt-12">
        <div className="mx-auto max-w-6xl rounded-xl bg-white p-4 shadow-2xl">
          <div className="flex items-center justify-between gap-4">
            <Stat
              icon={<Gauge className="h-4 w-4" aria-hidden />}
              label="Velocidad"
              value={speedKmh != null ? `${speedKmh} km/h` : '—'}
              tone={speedKmh != null && speedKmh > 0 ? 'green' : 'neutral'}
            />
            <Stat
              icon={<Navigation className="h-4 w-4" aria-hidden />}
              label="Rumbo"
              value={angleDeg != null ? `${angleDeg}°` : '—'}
              tone="neutral"
            />
            <Stat
              icon={<RefreshCw className="h-4 w-4" aria-hidden />}
              label="Actualizado"
              value={ageLabel ?? '—'}
              tone={isStale ? 'amber' : 'neutral'}
            />
          </div>
          {bottomExtra && (
            <div className="mt-3 border-neutral-100 border-t pt-3">{bottomExtra}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function FallbackOverlay({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-8">
      <div className="max-w-md rounded-xl border border-neutral-200 bg-white p-6 text-center shadow-xl">
        <div className="flex justify-center">{icon}</div>
        <h2 className="mt-3 font-semibold text-lg text-neutral-900">{title}</h2>
        <p className="mt-1 text-neutral-600 text-sm">{description}</p>
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: 'green' | 'amber' | 'neutral';
}) {
  const colorByTone =
    tone === 'green'
      ? 'text-success-700'
      : tone === 'amber'
        ? 'text-amber-700'
        : 'text-neutral-700';
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-1 text-neutral-500 text-xs uppercase tracking-wide">
        {icon}
        {label}
      </div>
      <div className={`mt-0.5 font-semibold text-lg ${colorByTone}`}>{value}</div>
    </div>
  );
}
