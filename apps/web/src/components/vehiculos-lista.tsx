import { formatPlateForDisplay, normalizePlate } from '@booster-ai/shared-schemas';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Map as MapIcon, MoreHorizontal, Navigation, Plus, Search, Truck } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { api } from '../lib/api-client.js';
import {
  type EstadoDispositivoLista,
  type EstadoVehiculoLista,
  type FiltroVehiculos,
  coincideBusqueda,
  coincideFiltro,
  contarFiltros,
  estadoDispositivo,
  etiquetaDispositivo,
} from '../lib/estado-dispositivo.js';
import { ChileanPlate } from './ChileanPlate.js';
import { EmptyState, emptyStateActionClass } from './EmptyState.js';

const TIPOS = [
  'camioneta',
  'furgon_pequeno',
  'furgon_mediano',
  'camion_pequeno',
  'camion_mediano',
  'camion_pesado',
  'semi_remolque',
  'refrigerado',
  'tanque',
] as const;

type TipoVehiculo = (typeof TIPOS)[number];

const TIPO_LABEL: Record<TipoVehiculo, string> = {
  camioneta: 'Camioneta',
  furgon_pequeno: 'Furgón pequeño',
  furgon_mediano: 'Furgón mediano',
  camion_pequeno: 'Camión pequeño',
  camion_mediano: 'Camión mediano',
  camion_pesado: 'Camión pesado',
  semi_remolque: 'Semi-remolque',
  refrigerado: 'Refrigerado',
  tanque: 'Tanque',
};

const ESTADO_LABEL: Record<EstadoVehiculoLista, string> = {
  activo: 'Activo',
  mantenimiento: 'Mantención',
  retirado: 'Retirado',
};

const ESTADO_COLOR: Record<EstadoVehiculoLista, string> = {
  activo: 'bg-success-50 text-success-700',
  mantenimiento: 'bg-amber-50 text-amber-700',
  retirado: 'bg-neutral-100 text-neutral-600',
};

const DISPOSITIVO_COLOR: Record<Exclude<EstadoDispositivoLista, 'pendiente'>, string> = {
  conectado: 'bg-emerald-50 text-emerald-800',
  sin_senal: 'bg-amber-50 text-amber-950',
  sin_dispositivo: 'bg-neutral-100 text-neutral-700',
};

const FILTROS: Array<{ id: FiltroVehiculos; label: string }> = [
  { id: 'todos', label: 'Todos' },
  { id: 'activos', label: 'Activos' },
  { id: 'mantencion', label: 'Mantención' },
  { id: 'retirados', label: 'Retirados' },
  { id: 'sin_dispositivo', label: 'Sin dispositivo' },
  { id: 'sin_senal', label: 'Sin señal' },
];

const vehiculoSchema = z.object({
  id: z.string(),
  plate: z.string(),
  type: z.string(),
  capacity_kg: z.number(),
  capacity_m3: z.number().nullish(),
  brand: z.string().nullish(),
  model: z.string().nullish(),
  teltonika_imei: z.string().nullish(),
  status: z.enum(['activo', 'mantenimiento', 'retirado']),
});

type VehiculoLista = z.infer<typeof vehiculoSchema>;

const vehiculosResponseSchema = z.object({
  vehicles: z.array(vehiculoSchema),
});

const flotaResponseSchema = z.object({
  fleet: z.array(
    z.object({
      id: z.string(),
      position: z
        .object({
          timestamp_device: z.string().nullish(),
        })
        .passthrough()
        .nullable()
        .optional(),
    }),
  ),
});

type FlotaSenal = z.infer<typeof flotaResponseSchema>['fleet'];

function esTipo(valor: string): valor is TipoVehiculo {
  for (const tipo of TIPOS) {
    if (tipo === valor) {
      return true;
    }
  }
  return false;
}

function etiquetaTipo(tipo: string): string {
  if (esTipo(tipo)) {
    return TIPO_LABEL[tipo];
  }
  return 'Vehículo';
}

function aliasMarca(
  brand: string | null | undefined,
  model: string | null | undefined,
): string | null {
  const partes = [brand, model]
    .map((parte) => parte?.trim() ?? '')
    .filter((parte) => parte.length > 0);
  return partes.length > 0 ? partes.join(' ') : null;
}

function etiquetaCapacidad(kg: number, m3: number | null | undefined): string {
  const kilos = `${kg.toLocaleString('es-CL')} kg`;
  if (m3 == null) {
    return kilos;
  }
  return `${kilos} · ${m3.toLocaleString('es-CL')} m³`;
}

function patenteVisible(plate: string): string {
  return formatPlateForDisplay(normalizePlate(plate));
}

function nombreCard(item: {
  patente: string;
  tipo: string;
  dispositivo: EstadoDispositivoLista;
  vehiculo: { status: EstadoVehiculoLista };
}): string {
  const senal =
    item.dispositivo === 'pendiente' ? 'señal cargando' : etiquetaDispositivo(item.dispositivo);
  return `Abrir ${item.patente}, ${item.tipo}, ${senal}, ${ESTADO_LABEL[item.vehiculo.status]}`;
}

function tieneImei(imei: string | null | undefined): boolean {
  return (imei?.trim() ?? '').length > 0;
}

/**
 * Lista operativa de `/app/vehiculos`.
 *
 * La frescura sale de `GET /vehiculos/flota` (la misma fuente del mapa),
 * con query key propia para no pisar el cache de `/app/flota`.
 */
export function VehiculosLista({ canWrite }: { canWrite: boolean }) {
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState<FiltroVehiculos>('todos');
  const [menuId, setMenuId] = useState<string | null>(null);
  const cerrarMenu = useCallback(() => setMenuId(null), []);

  const vehiclesQ = useQuery({
    queryKey: ['vehiculos'],
    queryFn: async () => {
      const raw = await api.get<unknown>('/vehiculos');
      const parsed = vehiculosResponseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error('respuesta de vehículos inválida');
      }
      return parsed.data.vehicles;
    },
  });

  const flotaQ = useQuery({
    queryKey: ['flota', 'senal-lista'],
    queryFn: async () => {
      const raw = await api.get<unknown>('/vehiculos/flota');
      const parsed = flotaResponseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error('respuesta de flota inválida');
      }
      return parsed.data.fleet;
    },
    refetchInterval: 20_000,
    enabled: vehiclesQ.isSuccess && (vehiclesQ.data?.length ?? 0) > 0,
  });

  function dispositivoDe(
    vehiculo: VehiculoLista,
    flota: FlotaSenal | undefined,
  ): EstadoDispositivoLista {
    if (!tieneImei(vehiculo.teltonika_imei)) {
      return 'sin_dispositivo';
    }
    if (flotaQ.isError || (flotaQ.isSuccess && flota == null)) {
      return estadoDispositivo({
        teltonikaImei: vehiculo.teltonika_imei ?? null,
        timestampDevice: null,
      });
    }
    if (!flotaQ.isSuccess || flota == null) {
      return 'pendiente';
    }
    const punto = flota.find((item) => item.id === vehiculo.id)?.position;
    const timestamp = punto?.timestamp_device;
    return estadoDispositivo({
      teltonikaImei: vehiculo.teltonika_imei ?? null,
      timestampDevice: typeof timestamp === 'string' ? timestamp : null,
    });
  }

  function limpiar() {
    setBusqueda('');
    setFiltro('todos');
    setMenuId(null);
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">Vehículos</h1>
          <p className="mt-1 text-neutral-600 text-sm">
            Quién reporta, quién está en mantención y a quién le falta el dispositivo.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/app/flota"
            className="inline-flex items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 py-2 font-medium text-neutral-800 text-sm transition hover:bg-neutral-50"
          >
            <MapIcon className="h-4 w-4" aria-hidden />
            Ver mapa
          </Link>
          {canWrite ? (
            <Link
              to="/app/vehiculos/nuevo"
              className="inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white shadow-xs transition hover:bg-primary-700"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Nuevo vehículo
            </Link>
          ) : null}
        </div>
      </div>

      {vehiclesQ.isPending ? <ListaCargando /> : null}
      {vehiclesQ.isError ? (
        <ListaError
          onRetry={() => {
            void vehiclesQ.refetch();
            void flotaQ.refetch();
          }}
        />
      ) : null}

      {vehiclesQ.isSuccess && vehiclesQ.data.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={<Truck className="h-10 w-10" aria-hidden />}
            title="Aún no tienes vehículos"
            description="Cuando sumes el primero, acá ves quién reporta y a quién le falta el dispositivo."
            action={
              canWrite ? (
                <Link to="/app/vehiculos/nuevo" className={emptyStateActionClass}>
                  <Plus className="h-4 w-4" aria-hidden />
                  Nuevo vehículo
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : null}

      {vehiclesQ.isSuccess && vehiclesQ.data.length > 0 ? (
        <ListaConDatos
          vehiculos={vehiclesQ.data}
          flota={flotaQ.data}
          dispositivoDe={dispositivoDe}
          busqueda={busqueda}
          onBusqueda={setBusqueda}
          filtro={filtro}
          onFiltro={setFiltro}
          onLimpiar={limpiar}
          canWrite={canWrite}
          menuId={menuId}
          onAbrirMenu={setMenuId}
          onCerrarMenu={cerrarMenu}
        />
      ) : null}
    </div>
  );
}

function ListaCargando() {
  return (
    <div
      data-testid="vehiculos-cargando"
      aria-busy="true"
      aria-live="polite"
      className="mt-6 space-y-2"
    >
      <p className="sr-only">Cargando vehículos</p>
      {['s1', 's2', 's3', 's4'].map((id) => (
        <div key={id} className="h-14 animate-pulse rounded-lg bg-neutral-200" />
      ))}
    </div>
  );
}

function ListaError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="mt-6 rounded-lg border border-danger-200 bg-danger-50 p-6">
      <p className="font-medium text-danger-800">No pudimos cargar los vehículos.</p>
      <p className="mt-1 text-danger-700 text-sm">Revisa la conexión e inténtalo otra vez.</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-md bg-danger-700 px-4 py-2 font-medium text-sm text-white hover:bg-danger-800"
      >
        Reintentar
      </button>
    </div>
  );
}

function ListaConDatos({
  vehiculos,
  flota,
  dispositivoDe,
  busqueda,
  onBusqueda,
  filtro,
  onFiltro,
  onLimpiar,
  canWrite,
  menuId,
  onAbrirMenu,
  onCerrarMenu,
}: {
  vehiculos: VehiculoLista[];
  flota: FlotaSenal | undefined;
  dispositivoDe: (vehiculo: VehiculoLista, flota: FlotaSenal | undefined) => EstadoDispositivoLista;
  busqueda: string;
  onBusqueda: (valor: string) => void;
  filtro: FiltroVehiculos;
  onFiltro: (filtro: FiltroVehiculos) => void;
  onLimpiar: () => void;
  canWrite: boolean;
  menuId: string | null;
  onAbrirMenu: (id: string) => void;
  onCerrarMenu: () => void;
}) {
  const enriquecidos = vehiculos.map((vehiculo) => {
    const dispositivo = dispositivoDe(vehiculo, flota);
    const marca = aliasMarca(vehiculo.brand, vehiculo.model);
    return {
      vehiculo,
      dispositivo,
      marca,
      tipo: etiquetaTipo(vehiculo.type),
      capacidad: etiquetaCapacidad(vehiculo.capacity_kg, vehiculo.capacity_m3),
      patente: patenteVisible(vehiculo.plate),
    };
  });
  const cuentas = contarFiltros(
    enriquecidos.map((item) => ({
      status: item.vehiculo.status,
      dispositivo: item.dispositivo,
    })),
  );
  const visibles = enriquecidos.filter(
    (item) =>
      coincideFiltro(filtro, {
        status: item.vehiculo.status,
        dispositivo: item.dispositivo,
      }) &&
      coincideBusqueda(busqueda, [item.vehiculo.plate, item.patente, item.marca ?? '', item.tipo]),
  );

  return (
    <div className="mt-6 min-w-0">
      <div className="flex flex-col gap-3">
        <div className="relative min-w-0 sm:max-w-xs">
          <Search
            className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 h-4 w-4 text-neutral-400"
            aria-hidden
          />
          <input
            type="search"
            value={busqueda}
            onChange={(event) => onBusqueda(event.target.value)}
            placeholder="Patente, marca o modelo"
            aria-label="Buscar vehículos"
            autoComplete="off"
            className="w-full rounded-md border border-neutral-300 bg-white py-2 pr-8 pl-9 text-neutral-900 text-sm shadow-xs placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none"
          />
        </div>
        <fieldset className="flex flex-wrap gap-2 border-0 p-0">
          <legend className="sr-only">Filtrar vehículos</legend>
          {FILTROS.map((item) => {
            const activo = filtro === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={activo}
                data-testid={`filtro-${item.id}`}
                onClick={() => onFiltro(item.id)}
                className={
                  activo
                    ? 'inline-flex items-center gap-1.5 rounded-full bg-neutral-900 px-3 py-1 font-medium text-sm text-white'
                    : 'inline-flex items-center gap-1.5 rounded-full border border-neutral-300 bg-white px-3 py-1 font-medium text-neutral-800 text-sm hover:bg-neutral-50'
                }
              >
                <span>{item.label}</span>
                <span className="tabular-nums">{cuentas[item.id]}</span>
              </button>
            );
          })}
        </fieldset>
      </div>

      {visibles.length === 0 ? (
        <div className="mt-4 rounded-lg border border-neutral-300 border-dashed bg-white p-8 text-center">
          <p className="font-medium text-neutral-900">Ningún vehículo coincide</p>
          <p className="mx-auto mt-1 max-w-md text-neutral-600 text-sm">
            Prueba con otra patente o limpia el filtro.
          </p>
          <button
            type="button"
            onClick={onLimpiar}
            className="mt-4 rounded-md border border-neutral-300 bg-white px-4 py-2 font-medium text-neutral-800 text-sm hover:bg-neutral-50"
          >
            Limpiar
          </button>
        </div>
      ) : (
        <>
          <div
            data-testid="vehiculos-tabla"
            className="mt-4 hidden w-full max-w-full overflow-x-clip rounded-lg border border-neutral-200 bg-white shadow-sm lg:block"
          >
            <table className="w-full table-fixed">
              <caption className="sr-only">Vehículos de la flota</caption>
              <colgroup>
                <col className="w-[18%]" />
                <col className="w-[24%]" />
                <col className="w-[16%]" />
                <col className="w-[16%]" />
                <col className="w-[12%]" />
                <col className="w-[14%]" />
              </colgroup>
              <thead className="bg-neutral-50">
                <tr>
                  <Th>Patente</Th>
                  <Th>Tipo</Th>
                  <Th>Capacidad</Th>
                  <Th>Dispositivo</Th>
                  <Th>Estado</Th>
                  <Th>
                    <span className="sr-only">Acciones</span>
                  </Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {visibles.map((item) => (
                  <tr key={item.vehiculo.id} className="hover:bg-neutral-50">
                    <Td>
                      <ChileanPlate plate={item.vehiculo.plate} size="sm" />
                    </Td>
                    <Td>
                      <div className="truncate font-medium text-neutral-900">{item.tipo}</div>
                      <div className="truncate text-neutral-500 text-xs">{item.marca ?? '—'}</div>
                    </Td>
                    <Td>
                      <span className="text-neutral-800">{item.capacidad}</span>
                    </Td>
                    <Td>
                      <DispositivoPill estado={item.dispositivo} />
                    </Td>
                    <Td>
                      <EstadoBadge status={item.vehiculo.status} />
                    </Td>
                    <Td clip={false}>
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          to="/app/vehiculos/$id"
                          params={{ id: item.vehiculo.id }}
                          className="rounded-md bg-primary-50 px-2 py-1 font-medium text-primary-700 text-sm hover:bg-primary-100"
                        >
                          Abrir
                        </Link>
                        <MenuAcciones
                          id={item.vehiculo.id}
                          plate={item.patente}
                          abierto={menuId === item.vehiculo.id}
                          onAbrir={() => onAbrirMenu(item.vehiculo.id)}
                          onCerrar={onCerrarMenu}
                          puedeEditar={canWrite}
                          puedeVivo={tieneImei(item.vehiculo.teltonika_imei)}
                        />
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul data-testid="vehiculos-cards" className="mt-4 space-y-3 lg:hidden">
            {visibles.map((item) => (
              <li
                key={item.vehiculo.id}
                className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm"
              >
                <Link
                  to="/app/vehiculos/$id"
                  params={{ id: item.vehiculo.id }}
                  aria-label={nombreCard(item)}
                  className="block p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <ChileanPlate plate={item.vehiculo.plate} size="sm" />
                    <EstadoBadge status={item.vehiculo.status} />
                  </div>
                  <p className="mt-2 text-neutral-800 text-sm">
                    {item.tipo}
                    {item.marca ? ` · ${item.marca}` : ''}
                  </p>
                  <p className="mt-1 text-neutral-500 text-xs">{item.capacidad}</p>
                  <div className="mt-3">
                    <DispositivoPill estado={item.dispositivo} />
                  </div>
                </Link>
                {tieneImei(item.vehiculo.teltonika_imei) ? (
                  <div className="flex justify-end border-neutral-100 border-t px-4 py-2">
                    <Link
                      to="/app/vehiculos/$id/live"
                      params={{ id: item.vehiculo.id }}
                      className="inline-flex items-center gap-1 font-medium text-primary-700 text-sm hover:underline"
                    >
                      <Navigation className="h-3.5 w-3.5" aria-hidden />
                      Ver en vivo
                    </Link>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Th({ children }: { children: ReactNode }) {
  return (
    <th className="px-2 py-2 text-left font-semibold text-neutral-600 text-xs uppercase tracking-wider">
      {children}
    </th>
  );
}

function Td({ children, clip = true }: { children: ReactNode; clip?: boolean }) {
  return (
    <td
      className={`px-2 py-2 align-middle text-neutral-800 text-sm ${clip ? 'overflow-hidden' : ''}`}
    >
      {children}
    </td>
  );
}

function EstadoBadge({ status }: { status: EstadoVehiculoLista }) {
  return (
    <span
      className={`inline-flex rounded-md px-2 py-0.5 font-medium text-xs ${ESTADO_COLOR[status]}`}
    >
      {ESTADO_LABEL[status]}
    </span>
  );
}

function DispositivoPill({ estado }: { estado: EstadoDispositivoLista }) {
  if (estado === 'pendiente') {
    return (
      <span
        aria-busy="true"
        className="inline-flex rounded-full bg-neutral-100 px-2 py-0.5 font-medium text-neutral-500 text-xs"
      >
        …
      </span>
    );
  }
  return (
    <span
      className={`inline-flex max-w-full rounded-full px-2 py-0.5 font-medium text-xs ${DISPOSITIVO_COLOR[estado]}`}
    >
      {etiquetaDispositivo(estado)}
    </span>
  );
}

function MenuAcciones({
  id,
  plate,
  abierto,
  onAbrir,
  onCerrar,
  puedeEditar,
  puedeVivo,
}: {
  id: string;
  plate: string;
  abierto: boolean;
  onAbrir: () => void;
  onCerrar: () => void;
  puedeEditar: boolean;
  puedeVivo: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) {
      return;
    }
    function onPointer(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (ref.current?.contains(target)) {
        return;
      }
      onCerrar();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCerrar();
      }
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [abierto, onCerrar]);

  if (!puedeEditar && !puedeVivo) {
    return null;
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-label={`Más acciones de ${plate}`}
        onClick={() => {
          if (abierto) {
            onCerrar();
          } else {
            onAbrir();
          }
        }}
        className="rounded-md p-1.5 text-neutral-600 hover:bg-neutral-100"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </button>
      {abierto ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-40 rounded-md border border-neutral-200 bg-white py-1 shadow-lg"
        >
          {puedeVivo ? (
            <Link
              role="menuitem"
              to="/app/vehiculos/$id/live"
              params={{ id }}
              onClick={onCerrar}
              className="block px-3 py-2 text-neutral-800 text-sm hover:bg-neutral-50"
            >
              Ver en vivo
            </Link>
          ) : null}
          {puedeEditar ? (
            <Link
              role="menuitem"
              to="/app/vehiculos/$id"
              params={{ id }}
              onClick={onCerrar}
              className="block px-3 py-2 text-neutral-800 text-sm hover:bg-neutral-50"
            >
              Editar
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
