import { useQuery } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { EventoCombustibleMap } from '../components/map/EventoCombustibleMap.js';
import type { MeResponse } from '../hooks/use-me.js';
import { ApiError, api } from '../lib/api-client.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

interface Trayecto {
  id: string;
  vehiculo_id: string;
  empresa_id: string;
  patente: string;
  inicio: string;
  fin: string;
  distancia_km: number;
  litros_iniciales: number | null;
  litros_finales: number | null;
  km_por_litro: number | null;
  fuente_combustible?: FuenteCombustible | null;
  litros_consumidos?: number | null;
  nivel_pct_inicial?: number | null;
  nivel_pct_final?: number | null;
  nota_combustible: string | null;
  posible_robo_combustible: boolean;
  posible_robo_hormiga?: boolean;
  event_lat: number | null;
  event_lon: number | null;
  sensor_combustible: 'ausente' | 'presente' | 'degradado';
  cta_sensor: boolean;
  cta_capacidad_estanque?: boolean;
}

type FuenteCombustible = 'nivel_litros' | 'consumo_can' | 'nivel_porcentaje';
type CombustibleVehiculo = FuenteCombustible | 'sin_sensor';
type FiltroCombustible = 'con_dato' | 'sin_dato';

interface VehiculoCombustible {
  vehiculo_id: string;
  patente: string;
  combustible: CombustibleVehiculo;
}

interface Listado {
  empresa_id: string;
  vehiculos_teltonika: number;
  truncado: boolean;
  cta: 'vincular_teltonika' | null;
  cta_sensor: boolean;
  page: number;
  page_size: number;
  total: number;
  /** Ausentes en una API anterior a las pestañas: la página se muestra sin ellas. */
  total_con_combustible?: number;
  total_sin_combustible?: number;
  vehiculos?: VehiculoCombustible[];
  trayectos: Trayecto[];
}

const PAGE_SIZE = 20;

/**
 * /app/trayectos — historial de trayectos Teltonika para el dueño o admin
 * del transportista. No está atado a una carga de Booster.
 */
export function TrayectosTeltonikaRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        return <TrayectosTeltonikaPage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function puedeVer(me: MeOnboarded): boolean {
  const role = me.active_membership?.role;
  const empresa = me.active_membership?.empresa;
  return Boolean(empresa?.is_transportista && (role === 'dueno' || role === 'admin'));
}

export function TrayectosTeltonikaPage({ me }: { me: MeOnboarded }) {
  const search = (useSearch({ strict: false }) ?? {}) as {
    detalle?: string;
    page?: number;
    vehiculo?: string;
  };
  const [page, setPage] = useState(() =>
    search.page != null && search.page >= 1 ? search.page : 1,
  );
  const [combustible, setCombustible] = useState<FiltroCombustible>('con_dato');
  const permitido = puedeVer(me);
  const vehiculo = search.vehiculo;
  const q = useQuery({
    queryKey: ['trayectos-teltonika', combustible, page, vehiculo ?? '', search.detalle ?? ''],
    enabled: permitido,
    queryFn: () => api.get<Listado>(urlListado(page, combustible, vehiculo, search.detalle)),
  });

  return (
    <Layout me={me} title="Trayectos">
      <header>
        <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">
          Historial de trayectos
        </h1>
        <p className="mt-1 max-w-2xl text-neutral-600 text-sm">
          Mirá los trayectos de tus Teltonika: litros, km/L y L/100 km. Con eso armás el costo de
          operación por tu cuenta. El aviso de golpe y el de hormiga son distintos.
        </p>
      </header>

      {permitido ? null : <SinPermiso />}
      {permitido && q.isLoading ? (
        <p className="mt-8 text-neutral-600">Cargando trayectos…</p>
      ) : null}
      {permitido && q.isError ? <ErrorCarga error={q.error} /> : null}
      {permitido && vehiculo ? <FiltroVehiculo /> : null}
      {permitido && q.data ? (
        search.detalle ? (
          <DetalleTrayecto
            trayecto={q.data.trayectos.find((t) => t.id === search.detalle) ?? null}
            page={page}
            vehiculo={vehiculo}
          />
        ) : (
          <ListadoTrayectos
            data={q.data}
            page={page}
            combustible={combustible}
            vehiculo={vehiculo}
            onPage={(siguiente) => setPage(siguiente)}
            onCombustible={(filtro) => {
              setCombustible(filtro);
              setPage(1);
            }}
          />
        )
      ) : null}
    </Layout>
  );
}

function SinPermiso() {
  return (
    <p className="mt-8 text-neutral-700">No tenés permiso para ver el historial de trayectos.</p>
  );
}

function ErrorCarga({ error }: { error: unknown }) {
  if (error instanceof ApiError && error.status === 403) {
    return <SinPermiso />;
  }
  return (
    <p className="mt-8 text-neutral-700" role="alert">
      No pudimos cargar los trayectos. Probá de nuevo.
    </p>
  );
}

function urlListado(
  page: number,
  combustible: FiltroCombustible,
  vehiculo?: string,
  detalle?: string,
): string {
  const base = `/trayectos-teltonika?page=${page}&page_size=${PAGE_SIZE}`;
  const combustibleQs = combustible === 'sin_dato' ? '&combustible=sin_dato' : '';
  if (!vehiculo) {
    return `${base}${combustibleQs}`;
  }
  const hasta = new Date();
  const desde = new Date(hasta.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ventana =
    `&vehiculo_id=${encodeURIComponent(vehiculo)}` +
    `&desde=${encodeURIComponent(desde.toISOString())}` +
    `&hasta=${encodeURIComponent(hasta.toISOString())}`;
  const detalleQs = detalle ? `&detalle=${encodeURIComponent(detalle)}` : '';
  return `${base}${combustibleQs}${ventana}${detalleQs}`;
}

function FiltroVehiculo() {
  return (
    <p className="mt-4 text-neutral-700 text-sm">
      Estás viendo los trayectos de este vehículo, últimos 30 días.{' '}
      <Link to="/app/trayectos" className="underline">
        Ver toda la flota
      </Link>
    </p>
  );
}

function ListadoTrayectos({
  data,
  page,
  combustible,
  vehiculo,
  onPage,
  onCombustible,
}: {
  data: Listado;
  page: number;
  combustible: FiltroCombustible;
  vehiculo?: string | undefined;
  onPage: (page: number) => void;
  onCombustible: (filtro: FiltroCombustible) => void;
}) {
  if (data.cta === 'vincular_teltonika') {
    return (
      <div className="mt-8 max-w-xl rounded-lg border border-neutral-200 bg-neutral-50 p-6">
        <p className="text-neutral-800">
          Todavía no tenés un Teltonika vinculado a la flota. Vinculá un dispositivo para auditar
          los trayectos.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            to="/app/admin/dispositivos"
            className="inline-flex rounded-md bg-neutral-900 px-3 py-2 text-sm text-white"
          >
            Vincular Teltonika
          </Link>
          <Link
            to="/app/vehiculos"
            className="inline-flex rounded-md border border-neutral-300 px-3 py-2 text-neutral-800 text-sm"
          >
            Ver vehículos
          </Link>
        </div>
      </div>
    );
  }

  const paginas = Math.max(1, Math.ceil(data.total / data.page_size));
  const conPestanas = data.total_con_combustible != null && data.total_sin_combustible != null;
  const sinDato = conPestanas && combustible === 'sin_dato';
  const vehiculos = data.vehiculos ?? [];

  return (
    <div className="mt-8">
      {data.cta_sensor ? (
        <p className="mb-4 max-w-2xl rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950 text-sm">
          Tus Teltonika no reportan sensor de combustible. Conectá el sensor para ver litros, km/L y
          L/100 km —con eso armás el costo de operación por tu cuenta— y el aviso de posible robo.
        </p>
      ) : null}
      {data.truncado ? (
        <p className="mb-4 text-neutral-600 text-sm">
          Estamos mostrando los puntos más recientes de la ventana. Acotá las fechas si te falta un
          trayecto viejo.
        </p>
      ) : null}
      {conPestanas ? (
        <PestanasCombustible
          activa={combustible}
          totalCon={data.total_con_combustible ?? 0}
          totalSin={data.total_sin_combustible ?? 0}
          onCambiar={onCombustible}
        />
      ) : null}
      {sinDato ? (
        <AvisoSinDato vehiculos={vehiculos} trayectos={data.trayectos} />
      ) : (
        <LeyendaFuentes vehiculos={vehiculos} />
      )}
      {data.trayectos.length === 0 ? (
        <p className="text-neutral-700">
          {vehiculo
            ? 'Este vehículo no tiene trayectos en este período.'
            : conPestanas && !sinDato
              ? 'No hay trayectos con dato de combustible en este período.'
              : 'No hay trayectos en este período.'}
        </p>
      ) : sinDato ? (
        <TablaSinDato trayectos={data.trayectos} />
      ) : (
        <>
          <TablaConDato trayectos={data.trayectos} page={page} vehiculo={vehiculo} />
          {data.trayectos.some(esTramoCorto) ? (
            <p className="mt-3 text-neutral-600 text-xs">
              Sin litros ni km/L en trayectos de menos de 10 km o 5 L: con tan poca muestra el
              número no es confiable.
            </p>
          ) : null}
        </>
      )}
      {data.total > data.page_size ? (
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-40"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            Anterior
          </button>
          <p className="text-neutral-600 text-sm">
            Página {page} de {paginas}
          </p>
          <button
            type="button"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-40"
            disabled={page >= paginas}
            onClick={() => onPage(page + 1)}
          >
            Siguiente
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PestanasCombustible({
  activa,
  totalCon,
  totalSin,
  onCambiar,
}: {
  activa: FiltroCombustible;
  totalCon: number;
  totalSin: number;
  onCambiar: (filtro: FiltroCombustible) => void;
}) {
  const clase = (filtro: FiltroCombustible) =>
    activa === filtro
      ? 'rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white'
      : 'rounded-md border border-neutral-300 px-3 py-1.5 text-neutral-800 text-sm';
  return (
    <fieldset className="mb-4 flex flex-wrap gap-2">
      <legend className="sr-only">Filtrar por combustible</legend>
      <button
        type="button"
        aria-pressed={activa === 'con_dato'}
        className={clase('con_dato')}
        onClick={() => onCambiar('con_dato')}
      >
        Con combustible ({totalCon})
      </button>
      <button
        type="button"
        aria-pressed={activa === 'sin_dato'}
        className={clase('sin_dato')}
        onClick={() => onCambiar('sin_dato')}
      >
        Sin dato de combustible ({totalSin})
      </button>
    </fieldset>
  );
}

/**
 * Una línea por fuente, con las patentes. Solo aparece si algún camión
 * informa algo distinto del nivel en litros: si no, no hay nada que aclarar.
 */
function LeyendaFuentes({ vehiculos }: { vehiculos: VehiculoCombustible[] }) {
  const nivel = patentesCon(vehiculos, 'nivel_litros');
  const consumo = patentesCon(vehiculos, 'consumo_can');
  const porcentaje = patentesCon(vehiculos, 'nivel_porcentaje');
  if (consumo.length === 0 && porcentaje.length === 0) {
    return null;
  }
  return (
    <section
      aria-label="Qué informa cada camión"
      className="mb-4 max-w-2xl space-y-1 text-neutral-600 text-sm"
    >
      {nivel.length > 0 ? (
        <p>
          {listaPatentes(nivel)} {verbo(nivel, 'informa', 'informan')} el nivel del estanque en
          litros: ves litros, km/L y el aviso de posible robo.
        </p>
      ) : null}
      {consumo.length > 0 ? (
        <p>
          {listaPatentes(consumo)} {verbo(consumo, 'informa', 'informan')} los litros consumidos:
          ves litros y km/L. El aviso de posible robo necesita el nivel en litros.
        </p>
      ) : null}
      {porcentaje.length > 0 ? (
        <p>
          {listaPatentes(porcentaje)} {verbo(porcentaje, 'informa', 'informan')} el nivel en %, no
          en litros: sin la capacidad del estanque no calculamos litros ni km/L.
        </p>
      ) : null}
    </section>
  );
}

/** Un mensaje por causa: sin sensor en la flota, o sin lectura en estos trayectos. */
function AvisoSinDato({
  vehiculos,
  trayectos,
}: {
  vehiculos: VehiculoCombustible[];
  trayectos: Trayecto[];
}) {
  const sinSensor = patentesCon(vehiculos, 'sin_sensor');
  const conSensor = new Set(
    vehiculos.filter((v) => v.combustible !== 'sin_sensor').map((v) => v.vehiculo_id),
  );
  const sinLectura = [
    ...new Set(trayectos.filter((t) => conSensor.has(t.vehiculo_id)).map((t) => t.patente)),
  ].sort(compararPatentes);
  if (sinSensor.length === 0 && sinLectura.length === 0) {
    return null;
  }
  return (
    <section
      aria-label="Por qué no hay dato de combustible"
      className="mb-4 max-w-2xl space-y-1 text-neutral-600 text-sm"
    >
      {sinSensor.length > 0 ? (
        <p>
          {listaPatentes(sinSensor)} no {verbo(sinSensor, 'tiene', 'tienen')} sensor de combustible
          conectado. Acá ves sus trayectos y kilómetros.
        </p>
      ) : null}
      {sinLectura.length > 0 ? (
        <p>En estos trayectos de {listaPatentes(sinLectura)} no llegó lectura de combustible.</p>
      ) : null}
    </section>
  );
}

function TablaConDato({
  trayectos,
  page,
  vehiculo,
}: {
  trayectos: Trayecto[];
  page: number;
  vehiculo?: string | undefined;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[48rem] border-collapse text-left text-sm">
        <caption className="sr-only">
          Trayectos Teltonika con dato de combustible, del más reciente al más viejo
        </caption>
        <thead>
          <tr className="border-neutral-200 border-b text-neutral-500">
            <th scope="col" className="py-2 pr-3 font-medium">
              Inicio
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Fin
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Vehículo
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Distancia
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Nivel ini
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Nivel fin
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Litros
            </th>
            <th scope="col" className="py-2 font-medium">
              Consumo
            </th>
          </tr>
        </thead>
        <tbody>
          {trayectos.map((t) => (
            <tr key={t.id} className="border-neutral-100 border-b align-top">
              <td className="py-3 pr-3">{fmtFecha(t.inicio)}</td>
              <td className="py-3 pr-3">{fmtFecha(t.fin)}</td>
              <td className="py-3 pr-3">
                <div className="font-medium text-neutral-900">{t.patente}</div>
                {tieneAviso(t) ? (
                  <div className="mt-1 flex flex-col items-start gap-1">
                    <Avisos trayecto={t} />
                    <Link
                      to="/app/trayectos"
                      search={searchDetalle(t.id, page, vehiculo)}
                      className="text-amber-950 text-xs underline"
                    >
                      {tieneGeo(t) ? 'Ver en el mapa' : 'Ver detalle'}
                    </Link>
                  </div>
                ) : null}
              </td>
              <td className="py-3 pr-3">{fmtNum(t.distancia_km, 1)} km</td>
              <td className="py-3 pr-3">{fmtNivel(t.litros_iniciales, t.nivel_pct_inicial)}</td>
              <td className="py-3 pr-3">{fmtNivel(t.litros_finales, t.nivel_pct_final)}</td>
              <td className="py-3 pr-3">{fmtLitros(t.litros_consumidos ?? null)}</td>
              <td className="py-3">
                <ConsumoCelda trayecto={t} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * En «Sin dato» la nota genérica de lectura se explica una vez en el aviso.
 * Las notas del provisioning (IO inutilizable o falta de capacidad) sí van
 * en la fila.
 */
function notaProvisionEnSinDato(nota: string | null) {
  if (
    nota == null ||
    nota === 'No hay una lectura válida de litros en este trayecto. No calculamos km/L.'
  ) {
    return null;
  }
  return <span className="mt-1 block text-neutral-600 text-xs">{nota}</span>;
}

function TablaSinDato({ trayectos }: { trayectos: Trayecto[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
        <caption className="sr-only">
          Trayectos Teltonika sin dato de combustible, del más reciente al más viejo
        </caption>
        <thead>
          <tr className="border-neutral-200 border-b text-neutral-500">
            <th scope="col" className="py-2 pr-3 font-medium">
              Inicio
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Fin
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Vehículo
            </th>
            <th scope="col" className="py-2 font-medium">
              Distancia
            </th>
          </tr>
        </thead>
        <tbody>
          {trayectos.map((t) => (
            <tr key={t.id} className="border-neutral-100 border-b align-top">
              <td className="py-3 pr-3">{fmtFecha(t.inicio)}</td>
              <td className="py-3 pr-3">{fmtFecha(t.fin)}</td>
              <td className="py-3 pr-3 font-medium text-neutral-900">{t.patente}</td>
              <td className="py-3">
                {fmtNum(t.distancia_km, 1)} km
                {notaProvisionEnSinDato(t.nota_combustible)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Trae litros (nivel en L o contador CAN) pero la API no calculó km/L ni dejó
 * nota: el tramo quedó bajo el mínimo de 5 L o 10 km.
 */
function esTramoCorto(trayecto: Trayecto): boolean {
  const fuente = trayecto.fuente_combustible;
  return (
    (fuente === 'nivel_litros' || fuente === 'consumo_can') &&
    trayecto.km_por_litro == null &&
    trayecto.nota_combustible == null
  );
}

function patentesCon(vehiculos: VehiculoCombustible[], combustible: CombustibleVehiculo): string[] {
  return vehiculos
    .filter((v) => v.combustible === combustible)
    .map((v) => v.patente)
    .sort(compararPatentes);
}

function compararPatentes(a: string, b: string): number {
  return a.localeCompare(b, 'es');
}

/** «A», «A y B», «A, B y C». */
function listaPatentes(patentes: string[]): string {
  if (patentes.length <= 1) {
    return patentes[0] ?? '';
  }
  return `${patentes.slice(0, -1).join(', ')} y ${patentes[patentes.length - 1]}`;
}

function verbo(patentes: string[], singular: string, plural: string): string {
  return patentes.length === 1 ? singular : plural;
}

function DetalleTrayecto({
  trayecto,
  page,
  vehiculo,
}: {
  trayecto: Trayecto | null;
  page: number;
  vehiculo?: string | undefined;
}) {
  return (
    <section className="mt-8 max-w-3xl" aria-label="Detalle del trayecto">
      <Link
        to="/app/trayectos"
        search={searchLista(page, vehiculo)}
        className="text-neutral-700 text-sm underline"
      >
        Volver al historial
      </Link>
      {trayecto == null ? (
        <p className="mt-4 text-neutral-700">
          No encontramos ese trayecto en esta página del historial.
        </p>
      ) : (
        <DetalleEncontrado trayecto={trayecto} />
      )}
    </section>
  );
}

function DetalleEncontrado({ trayecto }: { trayecto: Trayecto }) {
  const lat = trayecto.event_lat;
  const lon = trayecto.event_lon;
  const geo = lat != null && lon != null;
  return (
    <div className="mt-4">
      <h2 className="font-semibold text-neutral-900 text-xl">{trayecto.patente}</h2>
      <p className="mt-1 text-neutral-600 text-sm">
        {fmtFecha(trayecto.inicio)} – {fmtFecha(trayecto.fin)}
      </p>
      {tieneAviso(trayecto) ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Avisos trayecto={trayecto} />
        </div>
      ) : (
        <p className="mt-3 text-neutral-700">
          Este trayecto no tiene un aviso de posible robo de combustible.
        </p>
      )}
      {tieneAviso(trayecto) && lat != null && lon != null ? (
        <div className="mt-4">
          <EventoCombustibleMap latitude={lat} longitude={lon} />
        </div>
      ) : null}
      {tieneAviso(trayecto) && !geo ? (
        <div className="mt-4 max-w-xl rounded-lg border border-neutral-200 bg-neutral-50 p-4">
          <p className="font-medium text-neutral-900">sin ubicación</p>
          <p className="mt-1 text-neutral-600 text-sm">
            En la ventana de la caída no hay un punto del Teltonika con coordenadas, así que no
            marcamos un pin.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function tieneAviso(trayecto: Trayecto): boolean {
  return trayecto.posible_robo_combustible || trayecto.posible_robo_hormiga === true;
}

function Avisos({ trayecto }: { trayecto: Trayecto }) {
  return (
    <>
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
    </>
  );
}

function tieneGeo(trayecto: Trayecto): boolean {
  return trayecto.event_lat != null && trayecto.event_lon != null;
}

function searchDetalle(
  id: string,
  page: number,
  vehiculo?: string,
): { detalle: string; page?: number; vehiculo?: string } {
  const out: { detalle: string; page?: number; vehiculo?: string } = { detalle: id };
  if (page > 1) {
    out.page = page;
  }
  if (vehiculo) {
    out.vehiculo = vehiculo;
  }
  return out;
}

function searchLista(page: number, vehiculo?: string): { page?: number; vehiculo?: string } {
  const out: { page?: number; vehiculo?: string } = {};
  if (page > 1) {
    out.page = page;
  }
  if (vehiculo) {
    out.vehiculo = vehiculo;
  }
  return out;
}

function ConsumoCelda({ trayecto }: { trayecto: Trayecto }) {
  if (trayecto.km_por_litro == null) {
    return (
      <span>
        —
        {trayecto.nota_combustible ? (
          <span className="mt-1 block text-neutral-600 text-xs">{trayecto.nota_combustible}</span>
        ) : null}
        {trayecto.cta_capacidad_estanque ? (
          <Link
            to="/app/vehiculos/$id"
            params={{ id: trayecto.vehiculo_id }}
            hash="configuracion"
            className="mt-1 block text-primary-700 text-xs underline"
          >
            Completar en la configuración
          </Link>
        ) : null}
      </span>
    );
  }
  const porCien = litrosPorCienKm(trayecto);
  return (
    <span>
      {fmtNum(trayecto.km_por_litro, 2)} km/L
      {porCien == null ? null : (
        <span className="mt-1 block text-neutral-600 text-xs">{fmtNum(porCien, 1)} L/100 km</span>
      )}
    </span>
  );
}

/** L/100 km = 100 / km/L: sale del mismo tramo leído que el km/L. */
function litrosPorCienKm(trayecto: Trayecto): number | null {
  const kmPorLitro = trayecto.km_por_litro;
  if (kmPorLitro == null || !(kmPorLitro > 0)) {
    return null;
  }
  return 100 / kmPorLitro;
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

function fmtLitros(valor: number | null): string {
  if (valor == null) {
    return '—';
  }
  return `${fmtNum(valor, 1)} L`;
}

/** Nivel en litros si el camión lo informa; si no, en %. */
function fmtNivel(litros: number | null, porcentaje: number | null | undefined): string {
  if (litros != null) {
    return fmtLitros(litros);
  }
  if (porcentaje != null) {
    return `${fmtNum(porcentaje, 0)} %`;
  }
  return '—';
}
