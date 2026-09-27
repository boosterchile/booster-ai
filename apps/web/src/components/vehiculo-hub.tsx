import { formatPlateForDisplay, normalizePlate } from '@booster-ai/shared-schemas';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, Gauge, History, Navigation, Route as RouteIcon } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { z } from 'zod';
import { ApiError, api } from '../lib/api-client.js';
import {
  type EstadoDispositivo,
  estadoDispositivo,
  etiquetaDispositivo,
} from '../lib/estado-dispositivo.js';
import { ageSeconds, formatAge } from '../lib/freshness.js';
import { TrazaMapPreview } from './map/TrazaMapPreview.js';
import { VehicleMap } from './map/VehicleMap.js';

const VENTANA_MS = 30 * 24 * 60 * 60 * 1000;
const MAPA_ALTO_ESCRITORIO = 200;
const MAPA_ALTO_MOVIL = 160;

const BTN_LLENO =
  'inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary-600 px-3 py-1.5 font-medium text-sm text-white hover:bg-primary-700 sm:w-auto';
const BTN_CONTORNO =
  'inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 font-medium text-neutral-800 text-sm hover:bg-neutral-50 sm:w-auto';
const BTN_TEXTO =
  'inline-flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-1.5 font-medium text-primary-700 text-sm hover:bg-primary-50 sm:w-auto';
const CTA_TEXTO = 'mt-2 inline-flex text-primary-700 text-sm underline';

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
  cta_capacidad_estanque: z.boolean().optional(),
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

export type EstadoFlotaHub = 'activo' | 'mantenimiento' | 'retirado';

export interface VehiculoHubProps {
  vehicleId: string;
  plate: string;
  typeLabel: string;
  brand: string | null;
  model: string | null;
  status: EstadoFlotaHub;
  teltonikaImei: string | null;
  /** Dueño o admin de un transportista: puede ver el historial Teltonika. */
  puedeVerTrayectos: boolean;
  /** Dueño o admin: puede abrir la configuración y editar el IMEI. */
  puedeConfigurar: boolean;
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
  status,
  teltonikaImei,
  puedeVerTrayectos,
  puedeConfigurar,
  onAbrirConfig,
}: VehiculoHubProps) {
  const alias = [brand, model]
    .map((parte) => parte?.trim() ?? '')
    .filter((parte) => parte.length > 0)
    .join(' ');
  const patente = formatPlateForDisplay(normalizePlate(plate));
  const conImei = teltonikaImei != null && teltonikaImei.length > 0;
  const alturaMapa = useAlturaMapa();

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

  function reintentar() {
    void ubicacionQ.refetch();
    if (puedeVerTrayectos) {
      void resumenQ.refetch();
    }
  }

  const estado = estadoTeltonika(teltonikaImei, ubicacionQ.data ?? null, ubicacionQ.isError);

  return (
    <section data-testid="hub-vehiculo" className="mb-6 min-w-0">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-semibold text-2xl text-neutral-900 tracking-tight sm:text-3xl">
            {patente}
          </h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <EstadoPill
              testId="hub-estado"
              etiqueta="Dispositivo"
              valor={etiquetaDispositivo(estado.codigo)}
              detalle={estado.detalle}
              tono={tonoDispositivo(estado.codigo)}
              live
            />
            <EstadoPill
              testId="hub-flota"
              etiqueta="Flota"
              valor={etiquetaFlota(status)}
              detalle={null}
              tono={tonoFlota(status)}
            />
          </div>
          <p className="mt-1 text-neutral-600 text-sm">
            {alias ? <span className="text-neutral-800">{alias}</span> : null}
            {alias ? <span aria-hidden> · </span> : null}
            <span>{typeLabel}</span>
          </p>
        </div>
        <div
          className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end"
          data-testid="hub-acciones"
        >
          {conImei ? (
            <Link to="/app/vehiculos/$id/live" params={{ id: vehicleId }} className={BTN_LLENO}>
              <Navigation className="h-4 w-4" aria-hidden />
              Ver en vivo
            </Link>
          ) : null}
          {conImei ? (
            <Link
              to="/app/vehiculos/$id/historial"
              params={{ id: vehicleId }}
              className={BTN_CONTORNO}
            >
              <RouteIcon className="h-4 w-4" aria-hidden />
              Recorrido
            </Link>
          ) : null}
          {conImei && puedeVerTrayectos ? (
            <Link to="/app/trayectos" search={{ vehiculo: vehicleId }} className={BTN_TEXTO}>
              Ver trayectos
            </Link>
          ) : null}
          {!conImei && puedeConfigurar ? (
            <button type="button" onClick={onAbrirConfig} className={BTN_LLENO}>
              Configurar dispositivo
            </button>
          ) : null}
        </div>
      </div>

      {puedeVerTrayectos ? (
        <Operacion
          vehicleId={vehicleId}
          plate={plate}
          conImei={conImei}
          puedeConfigurar={puedeConfigurar}
          resumen={resumenQ.data ?? null}
          cargando={conImei && resumenQ.isLoading}
          error={conImei && resumenQ.isError}
          ubicacion={ubicacionQ.data ?? null}
          ubicacionError={conImei && ubicacionQ.isError}
          alturaMapa={alturaMapa}
          onAbrirConfig={onAbrirConfig}
          onReintentar={reintentar}
        />
      ) : (
        <HistorialLimitado conImei={conImei} />
      )}
    </section>
  );
}

function HistorialLimitado({ conImei }: { conImei: boolean }) {
  return (
    <div
      data-testid="hub-historial-limitado"
      className="mt-4 rounded-lg border border-neutral-200 border-dashed bg-neutral-50 px-4 py-4"
    >
      <p className="font-medium text-neutral-900 text-sm">
        El historial lo ve el admin de tu flota
      </p>
      <p className="mt-1 text-neutral-600 text-sm">
        {conImei
          ? 'El vivo y el recorrido siguen acá arriba.'
          : 'Cuando haya un dispositivo, vas a poder ver dónde está.'}
      </p>
    </div>
  );
}

function Operacion({
  vehicleId,
  plate,
  conImei,
  puedeConfigurar,
  resumen,
  cargando,
  error,
  ubicacion,
  ubicacionError,
  alturaMapa,
  onAbrirConfig,
  onReintentar,
}: {
  vehicleId: string;
  plate: string;
  conImei: boolean;
  puedeConfigurar: boolean;
  resumen: ResumenHub | null;
  cargando: boolean;
  error: boolean;
  ubicacion: UbicacionHub | null;
  ubicacionError: boolean;
  alturaMapa: number;
  onAbrirConfig: () => void;
  onReintentar: () => void;
}) {
  return (
    <div data-testid="hub-operacion" aria-busy={cargando}>
      <div data-testid="hub-resumen" className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <TarjetaUltimo
          vehicleId={vehicleId}
          resumen={resumen}
          cargando={cargando}
          error={error}
          conImei={conImei}
          puedeConfigurar={puedeConfigurar}
          onAbrirConfig={onAbrirConfig}
          onReintentar={onReintentar}
        />
        <TarjetaConsumo
          vehicleId={vehicleId}
          resumen={resumen}
          cargando={cargando}
          error={error}
          conImei={conImei}
          puedeConfigurar={puedeConfigurar}
          onAbrirConfig={onAbrirConfig}
          onReintentar={onReintentar}
        />
        <TarjetaAlertas
          vehicleId={vehicleId}
          resumen={resumen}
          cargando={cargando}
          error={error}
          conImei={conImei}
          puedeConfigurar={puedeConfigurar}
          onAbrirConfig={onAbrirConfig}
          onReintentar={onReintentar}
        />
      </div>
      <div className="mt-4" data-testid="hub-mapa">
        <MapaPreview
          vehicleId={vehicleId}
          plate={plate}
          conImei={conImei}
          puedeConfigurar={puedeConfigurar}
          ultimo={resumen?.ultimo_trayecto ?? null}
          ubicacion={ubicacion}
          ubicacionError={ubicacionError}
          altura={alturaMapa}
          onAbrirConfig={onAbrirConfig}
          onReintentar={onReintentar}
        />
      </div>
      <ListaTrayectos
        vehicleId={vehicleId}
        resumen={resumen}
        cargando={cargando}
        error={error}
        conImei={conImei}
        puedeConfigurar={puedeConfigurar}
        onAbrirConfig={onAbrirConfig}
        onReintentar={onReintentar}
      />
    </div>
  );
}

function TarjetaUltimo({
  vehicleId,
  resumen,
  cargando,
  error,
  conImei,
  puedeConfigurar,
  onAbrirConfig,
  onReintentar,
}: TarjetaProps) {
  const ultimo = resumen?.ultimo_trayecto ?? null;
  return (
    <article
      data-testid="hub-tarjeta-ultimo"
      className="rounded-lg border border-neutral-200 bg-white p-4"
    >
      <EncabezadoTarjeta icono={<History className="h-3.5 w-3.5" aria-hidden />} titulo="Último" />
      {cuerpoTarjeta(
        cargando,
        error,
        conImei,
        puedeConfigurar,
        onAbrirConfig,
        onReintentar,
        'Sin dispositivo no hay trayectos.',
      )}
      {conImei && !cargando && !error && ultimo == null ? (
        <div className="mt-2">
          <p className="text-neutral-800 text-sm">Todavía no hay trayectos en 30 días.</p>
          <LinkEnVivo vehicleId={vehicleId} />
        </div>
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
  vehicleId,
  resumen,
  cargando,
  error,
  conImei,
  puedeConfigurar,
  onAbrirConfig,
  onReintentar,
}: TarjetaProps) {
  const hay = resumen != null && resumen.recientes.length > 0;
  return (
    <article
      data-testid="hub-tarjeta-consumo"
      className="rounded-lg border border-neutral-200 bg-white p-4"
    >
      <EncabezadoTarjeta icono={<Gauge className="h-3.5 w-3.5" aria-hidden />} titulo="Consumo" />
      {cuerpoTarjeta(
        cargando,
        error,
        conImei,
        puedeConfigurar,
        onAbrirConfig,
        onReintentar,
        'Asociá un dispositivo para medir consumo.',
      )}
      {conImei && !cargando && !error && !hay ? (
        <div className="mt-2">
          <p className="text-neutral-800 text-sm">
            Sin trayectos para calcular consumo. El km/L aparece cuando el dispositivo lo informa.
          </p>
          <LinkEnVivo vehicleId={vehicleId} />
        </div>
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
            <button type="button" onClick={onAbrirConfig} className={CTA_TEXTO}>
              Conectá el sensor
            </button>
          ) : null}
          {resumen.cta_capacidad_estanque ? (
            <button
              type="button"
              onClick={onAbrirConfig}
              className="mt-2 block text-left text-primary-700 text-sm underline"
            >
              Completá la capacidad del estanque
            </button>
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
  puedeConfigurar,
  onAbrirConfig,
  onReintentar,
}: TarjetaProps) {
  const ultima = resumen?.alerta_ultima ?? null;
  const total = resumen?.alertas_total ?? 0;
  const hayAlertas = conImei && !cargando && !error && total > 0;
  return (
    <article
      data-testid="hub-tarjeta-alertas"
      className={`rounded-lg border bg-white p-4 ${hayAlertas ? 'border-amber-200' : 'border-neutral-200'}`}
    >
      <EncabezadoTarjeta
        icono={<AlertTriangle className="h-3.5 w-3.5" aria-hidden />}
        titulo="Alertas"
      />
      {cuerpoTarjeta(
        cargando,
        error,
        conImei,
        puedeConfigurar,
        onAbrirConfig,
        onReintentar,
        'Sin dispositivo no hay alertas.',
      )}
      {conImei && !cargando && !error && total === 0 ? (
        <p className="mt-2 text-neutral-800 text-sm">Sin alertas de combustible en 30 días.</p>
      ) : null}
      {hayAlertas && ultima ? (
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

interface TarjetaProps {
  vehicleId: string;
  resumen: ResumenHub | null;
  cargando: boolean;
  error: boolean;
  conImei: boolean;
  puedeConfigurar: boolean;
  onAbrirConfig: () => void;
  onReintentar: () => void;
}

function EncabezadoTarjeta({ icono, titulo }: { icono: ReactNode; titulo: string }) {
  return (
    <h2 className="flex items-center gap-1.5 font-medium text-neutral-500 text-xs uppercase tracking-wide">
      {icono}
      {titulo}
    </h2>
  );
}

function cuerpoTarjeta(
  cargando: boolean,
  error: boolean,
  conImei: boolean,
  puedeConfigurar: boolean,
  onAbrirConfig: () => void,
  onReintentar: () => void,
  sinImei: string,
) {
  if (!conImei) {
    return (
      <div className="mt-2">
        <p className="text-neutral-800 text-sm">{sinImei}</p>
        {puedeConfigurar ? (
          <button type="button" onClick={onAbrirConfig} className={CTA_TEXTO}>
            Configurar dispositivo
          </button>
        ) : null}
      </div>
    );
  }
  if (cargando) {
    return <p className="mt-2 text-neutral-600 text-sm">Cargando…</p>;
  }
  if (error) {
    return (
      <div className="mt-2">
        <p className="text-neutral-700 text-sm" role="alert">
          No pudimos cargar los trayectos.
        </p>
        <button type="button" onClick={onReintentar} className={CTA_TEXTO}>
          Reintentar
        </button>
      </div>
    );
  }
  return null;
}

function MapaPreview({
  vehicleId,
  plate,
  conImei,
  puedeConfigurar,
  ultimo,
  ubicacion,
  ubicacionError,
  altura,
  onAbrirConfig,
  onReintentar,
}: {
  vehicleId: string;
  plate: string;
  conImei: boolean;
  puedeConfigurar: boolean;
  ultimo: TrayectoHub | null;
  ubicacion: UbicacionHub | null;
  ubicacionError: boolean;
  altura: number;
  onAbrirConfig: () => void;
  onReintentar: () => void;
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
      <h2 className="mb-2 font-medium text-neutral-500 text-xs uppercase tracking-wide">
        {ultimo ? 'Último trayecto en el mapa' : 'Última posición'}
      </h2>
      <div data-testid="hub-mapa-alto" data-altura={altura}>
        {hayTraza ? <TrazaMapPreview points={puntos} height={altura} /> : null}
        {!hayTraza && ubicacion && lat != null && lng != null ? (
          <VehicleMap
            latitude={lat}
            longitude={lng}
            plate={plate}
            speedKmh={ubicacion.ubicacion.speed_kmh}
            timestampDevice={ubicacion.ubicacion.timestamp_device}
            height={altura}
          />
        ) : null}
        {!hayTraza && !hayPunto ? (
          <div
            className="rounded-md border border-neutral-200 border-dashed bg-neutral-50 p-4"
            style={{ minHeight: altura }}
          >
            <p className="font-medium text-neutral-900 text-sm">Sin posición GPS todavía</p>
            <p className="mt-1 text-neutral-600 text-sm">
              {conImei
                ? 'Cuando el dispositivo reporte una coordenada, la ves acá.'
                : 'Asociá un dispositivo para ver la posición.'}
            </p>
            {ubicacionError ? (
              <button type="button" onClick={onReintentar} className={CTA_TEXTO}>
                Reintentar
              </button>
            ) : null}
            {!conImei && puedeConfigurar ? (
              <button type="button" onClick={onAbrirConfig} className={CTA_TEXTO}>
                Configurar dispositivo
              </button>
            ) : null}
            {conImei && !ubicacionError ? <LinkEnVivo vehicleId={vehicleId} /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ListaTrayectos({
  vehicleId,
  resumen,
  cargando,
  error,
  conImei,
  puedeConfigurar,
  onAbrirConfig,
  onReintentar,
}: {
  vehicleId: string;
  resumen: ResumenHub | null;
  cargando: boolean;
  error: boolean;
  conImei: boolean;
  puedeConfigurar: boolean;
  onAbrirConfig: () => void;
  onReintentar: () => void;
}) {
  const recientes = resumen?.recientes ?? [];
  return (
    <section className="mt-4" data-testid="hub-trayectos" aria-label="Últimos trayectos">
      <h2 className="font-semibold text-neutral-900">Últimos trayectos</h2>
      {conImei ? null : (
        <p className="mt-2 text-neutral-700 text-sm">
          Sin dispositivo no hay historial.
          {puedeConfigurar ? (
            <>
              {' '}
              <button type="button" onClick={onAbrirConfig} className="text-primary-700 underline">
                Configurar dispositivo
              </button>
            </>
          ) : null}
        </p>
      )}
      {conImei && cargando ? <p className="mt-2 text-neutral-600 text-sm">Cargando…</p> : null}
      {conImei && error ? (
        <div className="mt-2">
          <p className="text-neutral-700 text-sm" role="alert">
            No pudimos cargar los trayectos.
          </p>
          <button type="button" onClick={onReintentar} className={CTA_TEXTO}>
            Reintentar
          </button>
        </div>
      ) : null}
      {conImei && !cargando && !error && recientes.length === 0 ? (
        <div className="mt-2">
          <p className="text-neutral-700 text-sm">
            Cuando este dispositivo cierre un trayecto, aparece acá.
          </p>
          <LinkEnVivo vehicleId={vehicleId} />
        </div>
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

function LinkEnVivo({ vehicleId }: { vehicleId: string }) {
  return (
    <Link to="/app/vehiculos/$id/live" params={{ id: vehicleId }} className={CTA_TEXTO}>
      Ver en vivo
    </Link>
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
        <span className="inline-flex rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-950 text-xs">
          Combustible
        </span>
      ) : null}
      {trayecto.posible_robo_hormiga ? (
        <span className="inline-flex rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-950 text-xs">
          Hormiga
        </span>
      ) : null}
    </span>
  );
}

type Estado = { codigo: EstadoDispositivo; detalle: string | null };

/**
 * El estado sale de `lib/estado-dispositivo`, la misma regla de la lista;
 * el hub solo le agrega la edad del último reporte.
 */
function estadoTeltonika(
  teltonikaImei: string | null,
  ubicacion: UbicacionHub | null,
  error: boolean,
): Estado {
  const timestampDevice = error ? null : (ubicacion?.ubicacion.timestamp_device ?? null);
  const codigo = estadoDispositivo({ teltonikaImei, timestampDevice });
  if (codigo === 'sin_dispositivo') {
    return { codigo, detalle: null };
  }
  return { codigo, detalle: formatAge(ageSeconds(timestampDevice)) ?? 'sin reportes' };
}

function tonoDispositivo(codigo: Estado['codigo']): string {
  if (codigo === 'conectado') {
    return 'bg-emerald-50 text-emerald-800';
  }
  if (codigo === 'sin_senal') {
    return 'bg-amber-50 text-amber-950';
  }
  return 'bg-neutral-100 text-neutral-700';
}

function etiquetaFlota(status: EstadoFlotaHub): string {
  if (status === 'mantenimiento') {
    return 'Mantención';
  }
  if (status === 'retirado') {
    return 'Retirado';
  }
  return 'Activo';
}

function tonoFlota(status: EstadoFlotaHub): string {
  if (status === 'activo') {
    return 'bg-success-50 text-success-700';
  }
  if (status === 'mantenimiento') {
    return 'bg-amber-50 text-amber-800';
  }
  return 'bg-neutral-100 text-neutral-600';
}

function EstadoPill({
  testId,
  etiqueta,
  valor,
  detalle,
  tono,
  live,
}: {
  testId: string;
  etiqueta: string;
  valor: string;
  detalle: string | null;
  tono: string;
  live?: boolean;
}) {
  return (
    <span
      data-testid={testId}
      aria-live={live ? 'polite' : undefined}
      className={`inline-flex max-w-full flex-wrap items-center gap-1 rounded-full px-2 py-0.5 text-xs ${tono}`}
    >
      <span className="font-medium uppercase tracking-wide">{etiqueta}</span>
      <span className="font-semibold">{valor}</span>
      {detalle ? <span className="font-normal">· {detalle}</span> : null}
    </span>
  );
}

function useAlturaMapa(): number {
  const [altura, setAltura] = useState(alturaMapaInicial);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return;
    }
    const mq = window.matchMedia('(min-width: 768px)');
    const aplicar = () => setAltura(mq.matches ? MAPA_ALTO_ESCRITORIO : MAPA_ALTO_MOVIL);
    aplicar();
    mq.addEventListener('change', aplicar);
    return () => mq.removeEventListener('change', aplicar);
  }, []);
  return altura;
}

function alturaMapaInicial(): number {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return MAPA_ALTO_ESCRITORIO;
  }
  return window.matchMedia('(min-width: 768px)').matches ? MAPA_ALTO_ESCRITORIO : MAPA_ALTO_MOVIL;
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
