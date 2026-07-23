import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { Activity, Fuel, Gauge, Thermometer } from 'lucide-react';
import type { ReactNode } from 'react';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { LiveTrackingScreen } from '../components/map/LiveTrackingScreen.js';
import { api } from '../lib/api-client.js';
import { ageSeconds, formatAge } from '../lib/freshness.js';

/**
 * /app/vehiculos/:id/live — pantalla full-screen estilo Uber.
 *
 * Solo accesible si el user es de la empresa dueña del vehículo (el
 * endpoint /vehiculos/:id/ubicacion ya tiene ownership check).
 *
 * Polling: 15s (más agresivo que /vehiculos/:id detail porque el contexto
 * de uso es ver-en-tiempo-real, no editar).
 */
interface UbicacionResponse {
  vehicle_id: string;
  plate: string;
  teltonika_imei: string | null;
  ubicacion: {
    timestamp_device: string;
    latitude: number | null;
    longitude: number | null;
    altitude_m: number | null;
    angle_deg: number | null;
    satellites: number | null;
    speed_kmh: number | null;
    priority: number;
    /**
     * W3 — 2º sensor por envío (IO 72 Dallas, FMC150). `null` explícito si
     * el punto no trae IO 72, el valor es inválido, o la fuente es el
     * fallback browser_gps (sin sensores). Ver apps/api/src/routes/vehiculos.ts.
     */
    temperatura_c: number | null;
    temperatura_registrada_en: string | null;
    /**
     * Sanity de varianza (migración 0051): `true` si el vehículo tiene
     * `tiene_sensor_temperatura` pero IO 72 es 0 constante (instalación fallida /
     * sonda desconectada). NO es alerta — hint de ops. Espejo MANUAL del DTO en
     * apps/api/src/routes/vehiculos.ts (resolverTemperaturaCarga).
     */
    temperatura_sensor_sospechoso: boolean;
    /**
     * W4 — CAN LVCAN en vivo (81 vehicle speed km/h, 85 engine RPM, 89 fuel
     * level %). `null` si el ping no trae CAN (motor apagado / sin adaptador
     * CAN / fuente browser_gps). Espejo MANUAL del DTO en
     * apps/api/src/routes/vehiculos.ts (extractCan).
     */
    can_speed_kmh: number | null;
    rpm: number | null;
    fuel_pct: number | null;
  };
}

/**
 * Stat "Temperatura" del bottomExtra de LiveTrackingScreen. `null` se
 * muestra como "Sin dato" explícito — nunca se oculta el stat completo,
 * porque la ausencia de sensor de temperatura es información relevante
 * para el transportista (ej. sensor Dallas desconectado en tránsito).
 */
function TemperaturaStat({
  temperaturaC,
  temperaturaRegistradaEn,
  sospechoso,
}: {
  temperaturaC: number | null;
  temperaturaRegistradaEn: string | null;
  sospechoso: boolean;
}) {
  const ageLabel = formatAge(ageSeconds(temperaturaRegistradaEn));
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-1 text-neutral-500 text-xs uppercase tracking-wide">
        <Thermometer className="h-4 w-4" aria-hidden />
        Temperatura
      </div>
      <div className="mt-0.5 font-semibold text-lg text-neutral-700">
        {temperaturaC != null ? (
          <>
            {temperaturaC.toFixed(1)} °C{' '}
            <span className="font-normal text-neutral-500 text-xs">{ageLabel ?? '—'}</span>
            {sospechoso ? (
              <span
                className="font-normal text-danger-600 text-xs"
                data-testid="temp-sensor-sospechoso"
              >
                {' '}
                ⚠ revisar sensor
              </span>
            ) : null}
          </>
        ) : (
          'Sin dato'
        )}
      </div>
    </div>
  );
}

/**
 * W4 — Stat CAN LVCAN del `bottomExtra` (fuel %, RPM, velocidad CAN). Mismo
 * molde visual que `TemperaturaStat`. `null` (motor apagado / sin CAN) se
 * muestra como "Sin dato" explícito, nunca se oculta — la ausencia de CAN es
 * información relevante (vehículo apagado o adaptador CAN desconectado).
 */
function CanStat({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string | null;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-1 text-neutral-500 text-xs uppercase tracking-wide">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 font-semibold text-lg text-neutral-700">{value ?? 'Sin dato'}</div>
    </div>
  );
}

export function VehiculoLiveRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        return <VehiculoLivePage />;
      }}
    </ProtectedRoute>
  );
}

function VehiculoLivePage() {
  const { id } = useParams({ strict: false }) as { id: string };

  const ubicacionQ = useQuery({
    queryKey: ['vehiculos', id, 'ubicacion'],
    queryFn: async () => {
      try {
        return await api.get<UbicacionResponse>(`/vehiculos/${id}/ubicacion`);
      } catch {
        return null;
      }
    },
    refetchInterval: 15_000,
  });

  return (
    <LiveTrackingScreen
      title={ubicacionQ.data?.plate ? `${ubicacionQ.data.plate} · En vivo` : 'Vehículo en vivo'}
      subtitle={
        ubicacionQ.data?.teltonika_imei
          ? `IMEI ${ubicacionQ.data.teltonika_imei}`
          : 'Sin Teltonika asociado'
      }
      backTo={`/app/vehiculos/${id}`}
      latitude={ubicacionQ.data?.ubicacion.latitude ?? null}
      longitude={ubicacionQ.data?.ubicacion.longitude ?? null}
      speedKmh={ubicacionQ.data?.ubicacion.speed_kmh ?? null}
      angleDeg={ubicacionQ.data?.ubicacion.angle_deg ?? null}
      timestampDevice={ubicacionQ.data?.ubicacion.timestamp_device ?? null}
      isLoading={ubicacionQ.isLoading}
      isFetching={ubicacionQ.isFetching}
      onRefresh={() => void ubicacionQ.refetch()}
      bottomExtra={
        ubicacionQ.data ? (
          <div className="flex items-center justify-between gap-4">
            <TemperaturaStat
              temperaturaC={ubicacionQ.data.ubicacion.temperatura_c}
              temperaturaRegistradaEn={ubicacionQ.data.ubicacion.temperatura_registrada_en}
              sospechoso={ubicacionQ.data.ubicacion.temperatura_sensor_sospechoso}
            />
            <CanStat
              icon={<Fuel className="h-4 w-4" aria-hidden />}
              label="Combustible"
              value={
                ubicacionQ.data.ubicacion.fuel_pct != null
                  ? `${ubicacionQ.data.ubicacion.fuel_pct} %`
                  : null
              }
            />
            <CanStat
              icon={<Gauge className="h-4 w-4" aria-hidden />}
              label="RPM"
              value={
                ubicacionQ.data.ubicacion.rpm != null ? `${ubicacionQ.data.ubicacion.rpm}` : null
              }
            />
            <CanStat
              icon={<Activity className="h-4 w-4" aria-hidden />}
              label="Vel. CAN"
              value={
                ubicacionQ.data.ubicacion.can_speed_kmh != null
                  ? `${ubicacionQ.data.ubicacion.can_speed_kmh} km/h`
                  : null
              }
            />
          </div>
        ) : undefined
      }
    />
  );
}
