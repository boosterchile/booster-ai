import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
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
  nota_combustible: string | null;
  posible_robo_combustible: boolean;
  sensor_combustible: 'ausente' | 'presente' | 'degradado';
  cta_sensor: boolean;
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
  const [page, setPage] = useState(1);
  const permitido = puedeVer(me);
  const q = useQuery({
    queryKey: ['trayectos-teltonika', page],
    enabled: permitido,
    queryFn: () => api.get<Listado>(`/trayectos-teltonika?page=${page}&page_size=${PAGE_SIZE}`),
  });

  return (
    <Layout me={me} title="Trayectos">
      <header>
        <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">
          Historial de trayectos
        </h1>
        <p className="mt-1 max-w-2xl text-neutral-600 text-sm">
          Mirá los trayectos de tus Teltonika: distancia, litros y un aviso si el combustible bajó
          de golpe con el vehículo detenido.
        </p>
      </header>

      {permitido ? null : <SinPermiso />}
      {permitido && q.isLoading ? (
        <p className="mt-8 text-neutral-600">Cargando trayectos…</p>
      ) : null}
      {permitido && q.isError ? <ErrorCarga error={q.error} /> : null}
      {permitido && q.data ? (
        <ListadoTrayectos data={q.data} page={page} onPage={(siguiente) => setPage(siguiente)} />
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

function ListadoTrayectos({
  data,
  page,
  onPage,
}: {
  data: Listado;
  page: number;
  onPage: (page: number) => void;
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

  return (
    <div className="mt-8">
      {data.cta_sensor ? (
        <p className="mb-4 max-w-2xl rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950 text-sm">
          Tus Teltonika no reportan sensor de combustible. Conectá el sensor para ver litros, km/L y
          el aviso de posible robo.
        </p>
      ) : null}
      {data.truncado ? (
        <p className="mb-4 text-neutral-600 text-sm">
          Estamos mostrando los puntos más recientes de la ventana. Acotá las fechas si te falta un
          trayecto viejo.
        </p>
      ) : null}
      {data.trayectos.length === 0 ? (
        <p className="text-neutral-700">No hay trayectos en este período.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
            <caption className="sr-only">
              Trayectos Teltonika de la flota, del más reciente al más viejo
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
                  L ini
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  L fin
                </th>
                <th scope="col" className="py-2 font-medium">
                  km/L
                </th>
              </tr>
            </thead>
            <tbody>
              {data.trayectos.map((t) => (
                <tr key={t.id} className="border-neutral-100 border-b align-top">
                  <td className="py-3 pr-3">{fmtFecha(t.inicio)}</td>
                  <td className="py-3 pr-3">{fmtFecha(t.fin)}</td>
                  <td className="py-3 pr-3">
                    <div className="font-medium text-neutral-900">{t.patente}</div>
                    {t.posible_robo_combustible ? (
                      <span className="mt-1 inline-flex rounded bg-amber-100 px-1.5 py-0.5 text-amber-950 text-xs">
                        posible robo combustible
                      </span>
                    ) : null}
                    {t.cta_sensor && !data.cta_sensor ? (
                      <p className="mt-1 text-neutral-600 text-xs">
                        Conectá el sensor de combustible.
                      </p>
                    ) : null}
                  </td>
                  <td className="py-3 pr-3">{fmtNum(t.distancia_km, 1)} km</td>
                  <td className="py-3 pr-3">{fmtLitros(t.litros_iniciales)}</td>
                  <td className="py-3 pr-3">{fmtLitros(t.litros_finales)}</td>
                  <td className="py-3">
                    {t.km_por_litro == null ? (
                      <span>
                        —
                        {t.nota_combustible ? (
                          <span className="mt-1 block text-neutral-600 text-xs">
                            {t.nota_combustible}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      fmtNum(t.km_por_litro, 2)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
