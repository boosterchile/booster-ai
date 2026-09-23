import { formatPlateForDisplay, normalizePlate } from '@booster-ai/shared-schemas';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Navigation, Route as RouteIcon } from 'lucide-react';
import { z } from 'zod';
import { ApiError, api } from '../lib/api-client.js';
import { ageSeconds, formatAge } from '../lib/freshness.js';
import { TrazaMapPreview } from './map/TrazaMapPreview.js';
import { VehicleMap } from './map/VehicleMap.js';

const CONECTADO_HASTA_S = 30 * 60;
const VENTANA_MS = 30 * 24 * 60 * 60 * 1000;

const trayectoSchema = z.object({
  id: z.string(),
  vehiculo_id: z.string(),
  patente: z.string(),
  inicio: z.string(),
  fin: z.string(),
  distancia_km: z.number(),
  litros_consumidos: z.number().nullable().optional(),
  km_por_litro: z.number().nullable().optional(),
  posible_robo_combustible: z.boolean(),
  posible_robo_hormiga: z.boolean().optional(),
  event_lat: z.number().nullable(),
  event_lon: z.number().nullable(),
});

type TrayectoHub = z.infer<typeof trayectoSchema>;

const resumenSchema = z.object({
  ultimo_trayecto: trayectoSchema.nullable(),
  recientes: z.array(trayectoSchema),
  km_recientes: z.number(),
  litros_recientes: z.number().nullable(),
  km_por_litro: z.number().nullable(),
  cta_sensor: z.boolean(),
  alertas_total: z.number().int(),
  alerta_ultima: trayectoSchema.nullable(),
});

type ResumenHub = z.infer<typeof resumenSchema>;

const listadoSchema = z.object({
  resumen_vehiculo: resumenSchema.nullable(),
});

const ubicacionSchema = z.object({
  ubicacion: z.object({
    timestamp_device: z.string(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    speed_kmh: z.number().nullable(),
  }),
});

type UbicacionHub = z.infer<typeof ubicacionSchema>;

const trazaSchema = z.object({
  puntos: z.array(z.object({ lat: z.number(), lng: z.number() })),
});

export interface VehiculoHubProps {
  vehicleId: string;
  plate: string;
  typeLabel: string;
  brand: string | null;
  model: string | null;
  teltonikaImei: string | null;
  /** Dueño o admin de un transportista: puede ver el historial Teltonika. */
  puedeVerTrayectos: boolean;
  onAbrirConfig: () => void;
}

/**
 * Bloque operativo del detalle: patente, estado, métricas y últimos trayectos.
 * La configuración (IMEI y ficha) vive aparte, debajo.
 */
export function VehiculoHub({
  vehicleId,
  plate,
  typeLabel,
  brand,
  model,
  teltonikaImei,
  puedeVerTrayectos,
  onAbrirConfig,
}: VehiculoHubProps) {
  const alias = [brand, model]
    .map((parte) => parte?.trim() ?? '')
    .filter((parte) => parte.length > 0)
    .join(' ');
  const patente = formatPlateForDisplay(normalizePlate(plate));
  const conImei = teltonikaImei != null && teltonikaImei.length > 0;

  const ubicacionQ = useQuery({
    queryKey: ['vehiculos', vehicleId, 'ubicacion', 'hub'],
    enabled: conImei,
    queryFn: async (): Promise<UbicacionHub | null> => {
      try {
        const raw = await api.get<unknown>(`/vehiculos/${vehicleId}/ubicacion`);
        const parsed = ubicacionSchema.safeParse(raw);
        return parsed.success ? parsed.data : null;
      } catch (err) {
        if (err instanceof ApiError && (err.status === 404 || err.status === 400)) {
          return null;
        }
        throw err;
      }
    },
  });

  const resumenQ = useQuery({
    queryKey: ['vehiculos', vehicleId, 'resumen-hub'],
    enabled: conImei && puedeVerTrayectos,
    queryFn: async (): Promise<ResumenHub> => {
      const raw = await api.get<unknown>(urlResumen(vehicleId));
      const parsed = listadoSchema.safeParse(raw);
      if (!parsed.success || parsed.data.resumen_vehiculo == null) {
        throw new Error('listado de trayectos inválido');
      }
      return parsed.data.resumen_vehiculo;
    },
  });

  const estado = estadoTeltonika(conImei, ubicacionQ.data ?? null, ubicacionQ.isError);

  return (
    <section data-testid="hub-vehiculo" className="mb-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-semibold text-2xl text-neutral-900 tracking-tight sm:text-3xl">
              {patente}
            </h1>
            <EstadoPill estado={estado} />
          </div>
          <p className="mt-1 text-neutral-600 text-sm">
            {alias ? <span className="text-neutral-800">{alias}</span> : null}
            {alias ? <span aria-hidden> · </span> : null}
            <span>{typeLabel}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2" data-testid="hub-acciones">
          {conImei ? (
            <Link
              to="/app/vehiculos/$id/live"
              params={{ id: vehicleId }}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary-600 px-3 py-1.5 font-medium text-sm text-white hover:bg-primary-700"
            >
              <Navigation className="h-4 w-4" aria-hidden />
              Ver en vivo
            </Link>
          ) : null}
          {puedeVerTrayectos ? (
            <Link
              to="/app/trayectos"
              search={{ vehiculo: vehicleId }}
              className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5 font-medium text-neutral-800 text-sm hover:bg-neutral-50"
            >
              <RouteIcon className="h-4 w-4" aria-hidden />
              Ver trayectos
            </Link>
          ) : null}
        </div>
      </div>

      {puedeVerTrayectos ? (
        <Operacion
          vehicleId={vehicleId}
          plate={plate}
          conImei={conImei}
          resumen={resumenQ.data ?? null}
          cargando={conImei && resumenQ.isLoading}
          error={conImei && resumenQ.isError}
          ubicacion={ubicacionQ.data ?? null}
          onAbrirConfig={onAbrirConfig}
        />
      ) : (
        <p className="mt-4 text-neutral-700 text-sm">
          No tenés permiso para ver el historial de trayectos.
        </p>
      )}
    </section>
  );
}

function Operacion({
  vehicleId,
  plate,
  conImei,
  resumen,
  cargando,
  error,
  ubicacion,
  onAbrirConfig,
}: {
  vehicleId: string;
  plate: string;
  conImei: boolean;
  resumen: ResumenHub | null;
  cargando: boolean;
  error: boolean;
  ubicacion: UbicacionHub | null;
  onAbrirConfig: () => void;
}) {
  return (
    <>
      <div data-testid="hub-resumen" className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <TarjetaUltimo
          vehicleId={vehicleId}
          resumen={resumen}
          cargando={cargando}
          error={error}
          conImei={conImei}
          onAbrirConfig={onAbrirConfig}
        />
        <TarjetaConsumo
          resumen={resumen}
          cargando={cargando}
          error={error}
          conImei={conImei}
          vehicleId={vehicleId}
          onAbrirConfig={onAbrirConfig}
        />
        <TarjetaAlertas
          vehicleId={vehicleId}
          resumen={resumen}
          cargando={cargando}
          error={error}
          conImei={conImei}
          onAbrirConfig={onAbrirConfig}
        />
      </div>
      <div className="mt-4" data-testid="hub-mapa">
        <MapaPreview
          vehicleId={vehicleId}
          plate={plate}
          conImei={conImei}
          ultimo={resumen?.ultimo_trayecto ?? null}
          ubicacion={ubicacion}
          onAbrirConfig={onAbrirConfig}
        />
      </div>
      <ListaTrayectos
        vehicleId={vehicleId}
        resumen={resumen}
        cargando={cargando}
        error={error}
        conImei={conImei}
        onAbrirConfig={onAbrirConfig}
      />
    </>
  );
}

function TarjetaUltimo({
  vehicleId,
  resumen,
  cargando,
  error,
  conImei,
  onAbrirConfig,
}: {
  vehicleId: string;
  resumen: ResumenHub | null;
  cargando: boolean;
  error: boolean;
  conImei: boolean;
  onAbrirConfig: () => void;
}) {
  const ultimo = resumen?.ultimo_trayecto ?? null;
  return (
    <article className="rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="font-medium text-neutral-500 text-xs uppercase tracking-wide">
        Último trayecto
      </h2>
      {cuerpoTarjeta(cargando, error, conImei, onAbrirConfig, 'Sin IMEI no hay trayectos.')}
      {conImei && !cargando && !error && ultimo == null ? (
        <p className="mt-2 text-neutral-800 text-sm">Todavía no hay trayectos en 30 días.</p>
      ) : null}
      {ultimo ? (
        <div className="mt-2">
          <p className="text-neutral-900 text-sm">
            {fmtFecha(ultimo.inicio)} – {fmtFecha(ultimo.fin)}
          </p>
          <p className="mt-1 font-semibold text-neutral-900">
            {fmtKm(ultimo.distancia_km)}
            {ultimo.litros_consumidos != null ? ` · ${fmtLitros(ultimo.litros_consumidos)}` : ''}
          </p>
          <LinkDetalle vehicleId={vehicleId} trayectoId={ultimo.id} />
        </div>
      ) : null}
    </article>
  );
}

function TarjetaConsumo({
  resumen,
  cargando,
  error,
  conImei,
  vehicleId,
  onAbrirConfig,
}: {
  resumen: ResumenHub | null;
  cargando: boolean;
  error: boolean;
  conImei: boolean;
  vehicleId: string;
  onAbrirConfig: () => void;
}) {
  const hay = resumen != null && resumen.recientes.length > 0;
  return (
    <article className="rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="font-medium text-neutral-500 text-xs uppercase tracking-wide">Consumo</h2>
      {cuerpoTarjeta(
        cargando,
        error,
        conImei,
        onAbrirConfig,
        'Asociá un Teltonika para medir consumo.',
      )}
      {conImei && !cargando && !error && !hay ? (
        <p className="mt-2 text-neutral-800 text-sm">
          Sin trayectos para calcular consumo. El km/L aparece cuando el Teltonika lo informa.
        </p>
      ) : null}
      {hay && resumen ? (
        <div className="mt-2">
          <p className="font-semibold text-neutral-900">
            {resumen.km_por_litro != null ? `${fmtNum(resumen.km_por_litro, 2)} km/L` : '—'}
          </p>
          <p className="mt-1 text-neutral-700 text-sm">
            {fmtKm(resumen.km_recientes)} en los últimos trayectos
            {resumen.litros_recientes != null ? ` · ${fmtLitros(resumen.litros_recientes)}` : ''}
          </p>
          {resumen.cta_sensor ? (
            <Link
              to="/app/trayectos"
              search={{ vehiculo: vehicleId }}
              className="mt-2 inline-block text-primary-700 text-sm underline"
            >
              Conectá el sensor
            </Link>
          ) : null}
          {resumen.km_por_litro == null && !resumen.cta_sensor ? (
            <p className="mt-2 text-neutral-600 text-xs">
              Estos trayectos no traen un km/L confiable.
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function TarjetaAlertas({
  vehicleId,
  resumen,
  cargando,
  error,
  conImei,
  onAbrirConfig,
}: {
  vehicleId: string;
  resumen: ResumenHub | null;
  cargando: boolean;
  error: boolean;
  conImei: boolean;
  onAbrirConfig: () => void;
}) {
  const ultima = resumen?.alerta_ultima ?? null;
  const total = resumen?.alertas_total ?? 0;
  return (
    <article className="rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="font-medium text-neutral-500 text-xs uppercase tracking-wide">Alertas</h2>
      {cuerpoTarjeta(cargando, error, conImei, onAbrirConfig, 'Sin IMEI no hay alertas.')}
      {conImei && !cargando && !error && total === 0 ? (
        <p className="mt-2 text-neutral-800 text-sm">Sin alertas de combustible en 30 días.</p>
      ) : null}
      {conImei && !cargando && !error && total > 0 && ultima ? (
        <div className="mt-2">
          <p className="font-semibold text-neutral-900">
            {total} {total === 1 ? 'alerta' : 'alertas'} en 30 días
          </p>
          <div className="mt-2">
            <Badges trayecto={ultima} />
          </div>
          <LinkDetalle vehicleId={vehicleId} trayectoId={ultima.id} />
        </div>
      ) : null}
    </article>
  );
}

function cuerpoTarjeta(
  cargando: boolean,
  error: boolean,
  conImei: boolean,
  onAbrirConfig: () => void,
  sinImei: string,
) {
  if (!conImei) {
    return (
      <div className="mt-2">
        <p className="text-neutral-800 text-sm">{sinImei}</p>
        <button
          type="button"
          onClick={onAbrirConfig}
          className="mt-2 text-primary-700 text-sm underline"
        >
          Configurar dispositivo
        </button>
      </div>
    );
  }
  if (cargando) {
    return <p className="mt-2 text-neutral-600 text-sm">Cargando…</p>;
  }
  if (error) {
    return (
      <p className="mt-2 text-neutral-700 text-sm" role="alert">
        No pudimos cargar los trayectos. Probá de nuevo.
      </p>
    );
  }
  return null;
}

function MapaPreview({
  vehicleId,
  plate,
  conImei,
  ultimo,
  ubicacion,
  onAbrirConfig,
}: {
  vehicleId: string;
  plate: string;
  conImei: boolean;
  ultimo: TrayectoHub | null;
  ubicacion: UbicacionHub | null;
  onAbrirConfig: () => void;
}) {
  const trazaQ = useQuery({
    queryKey: ['vehiculos', vehicleId, 'traza', ultimo?.inicio ?? '', ultimo?.fin ?? ''],
    enabled: ultimo != null && Date.parse(ultimo.fin) > Date.parse(ultimo.inicio),
    queryFn: async () => {
      if (!ultimo) {
        return [];
      }
      const raw = await api.get<unknown>(
        `/vehiculos/${vehicleId}/traza?desde=${encodeURIComponent(ultimo.inicio)}&hasta=${encodeURIComponent(ultimo.fin)}`,
      );
      const parsed = trazaSchema.safeParse(raw);
      return parsed.success ? parsed.data.puntos : [];
    },
  });
  const puntos = trazaQ.data ?? [];
  const lat = ubicacion?.ubicacion.latitude ?? null;
  const lng = ubicacion?.ubicacion.longitude ?? null;
  const hayTraza = puntos.length >= 2;
  const hayPunto = lat != null && lng != null;

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-medium text-neutral-500 text-xs uppercase tracking-wide">
          {ultimo ? 'Último trayecto en el mapa' : 'Última posición'}
        </h2>
        {conImei ? (
          <Link
            to="/app/vehiculos/$id/historial"
            params={{ id: vehicleId }}
            className="text-neutral-600 text-sm underline"
          >
            Recorrido
          </Link>
        ) : null}
      </div>
      {hayTraza ? <TrazaMapPreview points={puntos} height={180} /> : null}
      {!hayTraza && ubicacion && lat != null && lng != null ? (
        <VehicleMap
          latitude={lat}
          longitude={lng}
          plate={plate}
          speedKmh={ubicacion.ubicacion.speed_kmh}
          timestampDevice={ubicacion.ubicacion.timestamp_device}
          height={180}
        />
      ) : null}
      {!hayTraza && !hayPunto ? (
        <div className="rounded-md border border-neutral-200 border-dashed bg-neutral-50 p-4">
          <p className="font-medium text-neutral-900 text-sm">Sin posición GPS todavía</p>
          <p className="mt-1 text-neutral-600 text-sm">
            {conImei
              ? 'Cuando el Teltonika reporte una coordenada, la ves acá.'
              : 'Asociá un dispositivo para ver la posición.'}
          </p>
          {conImei ? null : (
            <button
              type="button"
              onClick={onAbrirConfig}
              className="mt-2 text-primary-700 text-sm underline"
            >
              Configurar dispositivo
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ListaTrayectos({
  vehicleId,
  resumen,
  cargando,
  error,
  conImei,
  onAbrirConfig,
}: {
  vehicleId: string;
  resumen: ResumenHub | null;
  cargando: boolean;
  error: boolean;
  conImei: boolean;
  onAbrirConfig: () => void;
}) {
  const recientes = resumen?.recientes ?? [];
  return (
    <section className="mt-4" data-testid="hub-trayectos" aria-label="Últimos trayectos">
      <h2 className="font-semibold text-neutral-900">Últimos trayectos</h2>
      {conImei ? null : (
        <p className="mt-2 text-neutral-700 text-sm">
          Sin IMEI no hay historial.{' '}
          <button type="button" onClick={onAbrirConfig} className="text-primary-700 underline">
            Configurar dispositivo
          </button>
        </p>
      )}
      {conImei && cargando ? <p className="mt-2 text-neutral-600 text-sm">Cargando…</p> : null}
      {conImei && error ? (
        <p className="mt-2 text-neutral-700 text-sm" role="alert">
          No pudimos cargar los trayectos. Probá de nuevo.
        </p>
      ) : null}
      {conImei && !cargando && !error && recientes.length === 0 ? (
        <p className="mt-2 text-neutral-700 text-sm">
          Cuando este Teltonika cierre un trayecto, aparece acá.
        </p>
      ) : null}
      {recientes.length > 0 ? (
        <ul className="mt-2 divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
          {recientes.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3"
            >
              <div>
                <p className="text-neutral-900 text-sm">
                  {fmtFecha(t.inicio)} – {fmtFecha(t.fin)}
                </p>
                <p className="text-neutral-700 text-sm">
                  {fmtKm(t.distancia_km)}
                  {t.litros_consumidos != null ? ` · ${fmtLitros(t.litros_consumidos)}` : ''}
                </p>
                <Badges trayecto={t} />
              </div>
              <LinkDetalle vehicleId={vehicleId} trayectoId={t.id} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function LinkDetalle({ vehicleId, trayectoId }: { vehicleId: string; trayectoId: string }) {
  return (
    <Link
      to="/app/trayectos"
      search={{ detalle: trayectoId, vehiculo: vehicleId }}
      className="text-primary-700 text-sm underline"
    >
      Ver detalle
    </Link>
  );
}

function Badges({ trayecto }: { trayecto: TrayectoHub }) {
  if (!trayecto.posible_robo_combustible && trayecto.posible_robo_hormiga !== true) {
    return null;
  }
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {trayecto.posible_robo_combustible ? (
        <span className="inline-flex rounded bg-amber-100 px-1.5 py-0.5 text-amber-950 text-xs">
          posible robo combustible
        </span>
      ) : null}
      {trayecto.posible_robo_hormiga ? (
        <span className="inline-flex rounded bg-orange-100 px-1.5 py-0.5 text-orange-950 text-xs">
          posible robo hormiga
        </span>
      ) : null}
    </span>
  );
}

type Estado = { codigo: 'sin_imei' | 'conectado' | 'sin_senal'; detalle: string | null };

function estadoTeltonika(conImei: boolean, ubicacion: UbicacionHub | null, error: boolean): Estado {
  if (!conImei) {
    return { codigo: 'sin_imei', detalle: null };
  }
  const ts = ubicacion?.ubicacion.timestamp_device ?? null;
  const segundos = ageSeconds(ts);
  if (error || segundos == null) {
    return { codigo: 'sin_senal', detalle: 'sin reportes' };
  }
  const edad = formatAge(segundos);
  if (segundos < CONECTADO_HASTA_S) {
    return { codigo: 'conectado', detalle: edad };
  }
  return { codigo: 'sin_senal', detalle: edad };
}

function EstadoPill({ estado }: { estado: Estado }) {
  const clase =
    estado.codigo === 'conectado'
      ? 'bg-emerald-50 text-emerald-800'
      : estado.codigo === 'sin_senal'
        ? 'bg-amber-50 text-amber-950'
        : 'bg-neutral-100 text-neutral-700';
  const texto =
    estado.codigo === 'sin_imei'
      ? 'sin IMEI'
      : estado.codigo === 'conectado'
        ? 'conectado'
        : 'sin señal';
  return (
    <span
      data-testid="hub-estado"
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium text-xs ${clase}`}
    >
      {texto}
      {estado.detalle ? <span className="ml-1 font-normal">· {estado.detalle}</span> : null}
    </span>
  );
}

function urlResumen(vehicleId: string): string {
  const hasta = new Date();
  const desde = new Date(hasta.getTime() - VENTANA_MS);
  const params = new URLSearchParams({
    vehiculo_id: vehicleId,
    page: '1',
    page_size: '10',
    desde: desde.toISOString(),
    hasta: hasta.toISOString(),
  });
  return `/trayectos-teltonika?${params.toString()}`;
}

function fmtFecha(iso: string): string {
  return new Date(iso).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' });
}

function fmtNum(valor: number, decimales: number): string {
  return valor.toLocaleString('es-CL', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
}

function fmtKm(valor: number): string {
  return `${fmtNum(valor, 1)} km`;
}

function fmtLitros(valor: number): string {
  return `${fmtNum(valor, 1)} L`;
}
