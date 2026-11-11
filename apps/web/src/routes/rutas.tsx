import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Inbox, Plus, Truck, UserRound, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { EmptyState } from '../components/EmptyState.js';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { useFeatureFlags } from '../hooks/use-feature-flags.js';
import type { MeResponse } from '../hooks/use-me.js';
import { ApiError, api } from '../lib/api-client.js';
import { flagsDe } from '../lib/capacidades.js';
import { useEmpresaScope } from '../lib/empresa-activa.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

interface ResumenRuta {
  id: string;
  estado: 'planificada' | 'en_curso' | 'cerrada' | 'cancelada';
  vehiculo: { id: string; patente: string } | null;
  conductor: { id: string; nombre: string } | null;
  servicios: number;
  paradas_pendientes: number;
}

interface ParadaRuta {
  id: string;
  orden: number;
  tipo: 'recogida' | 'entrega';
  resuelta_en: string | null;
  servicio: {
    asignacion_id: string;
    viaje_id: string;
    codigo_seguimiento: string;
    cancelado: boolean;
    direccion: string;
    peso_kg: number | null;
  };
}

interface DetalleRuta {
  id: string;
  estado: ResumenRuta['estado'];
  capacidad: { kg: number; m3: number | null } | null;
  paradas: ParadaRuta[];
  tramos: { desde: number; hasta: number; masa_kg: number }[];
}

interface Violacion {
  motivo: string;
  tramo?: number;
  masa_kg?: number;
  capacidad_kg?: number;
}

const kg = (n: number) => `${n.toLocaleString('es-CL')} kg`;
const cargas = (n: number) => (n === 1 ? '1 carga' : `${n} cargas`);

const MENSAJES: Record<string, string> = {
  servicio_ya_recogido: 'Esa carga ya se recogió: no se puede sacar ni mover a otra ruta.',
  servicio_cancelado: 'Esa carga está cancelada.',
  servicio_unico_de_la_ruta: 'Es la única carga de la ruta: ya viaja sola.',
  servicio_ya_en_la_ruta: 'Esa carga ya está en esta ruta.',
  entrega_antes_de_recogida: 'La entrega de una carga no puede ir antes de su recogida.',
  parada_resuelta_movida: 'Una parada ya hecha no se puede mover.',
  recogida_antes_de_parada_resuelta:
    'La recogida de una carga nueva tiene que ir después de las paradas ya hechas.',
  servicio_sin_peso_en_ruta_consolidada:
    'Una carga sin peso declarado no puede compartir ruta: no sabemos si cabe.',
  carroceria_incompatible: 'La carrocería del camión de esta ruta no sirve para esa carga.',
  ruta_no_editable: 'Esta ruta ya terminó: no se puede cambiar.',
  rutas_de_distinta_empresa: 'Las dos rutas tienen que ser de tu empresa.',
};

/** Traduce el rechazo del API a algo que la oficina pueda resolver. */
function mensajeDeRechazo(err: unknown): string {
  if (!(err instanceof ApiError) || err.code !== 'ruta_invalida') {
    return 'No pudimos guardar el cambio. Intenta de nuevo en unos segundos.';
  }
  const detalles = err.details as { violaciones?: Violacion[] } | null;
  const [primera] = detalles?.violaciones ?? [];
  if (
    primera?.motivo === 'capacidad_peso_excedida' &&
    primera.tramo !== undefined &&
    primera.masa_kg !== undefined &&
    primera.capacidad_kg !== undefined
  ) {
    return `No cabe: entre las paradas ${primera.tramo + 1} y ${primera.tramo + 2} irían ${kg(
      primera.masa_kg,
    )} y el camión lleva ${kg(primera.capacidad_kg)}.`;
  }
  return (primera && MENSAJES[primera.motivo]) ?? 'No se pudo hacer el cambio en esta ruta.';
}

/**
 * `/app/rutas` — la oficina arma la ruta de un camión (ADR-088, spec
 * ruta-parada-servicio §4.2 y §4.5): junta cargas ya aceptadas, las quita y
 * ordena las paradas. Las reglas (peso por tramo, paradas hechas, carrocería)
 * las decide el API; esta pantalla muestra el resultado o explica el rechazo.
 */
export function RutasRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        return <RutasPage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function RutasPage({ me }: { me: MeOnboarded }) {
  return (
    <Layout me={me} title="Rutas">
      <RutasContenido me={me} />
    </Layout>
  );
}

function RutasContenido({ me }: { me: MeOnboarded }) {
  const empresa = me.active_membership?.empresa;
  const esTransportista = empresa?.is_transportista ?? false;
  const puedeArmar = flagsDe(me).asignar;
  const { flags, isLoading: cargandoFlags } = useFeatureFlags();
  const activa = esTransportista && flags.rutas_api_activada;

  const scope = useEmpresaScope();
  const listaQ = useQuery({
    queryKey: scope.key('rutas', 'lista'),
    enabled: activa,
    refetchInterval: 30_000,
    queryFn: async () => (await api.get<{ rutas: ResumenRuta[] }>('/rutas', scope.init)).rutas,
  });
  const [seleccionada, setSeleccionada] = useState<string | null>(null);
  const rutas = listaQ.data ?? [];

  return (
    <>
      <h1 className="font-bold text-2xl text-neutral-900 tracking-tight sm:text-3xl">Rutas</h1>
      <p className="mt-1 text-neutral-600 text-sm">
        Junta en un mismo camión las cargas que ya aceptaste y ordena sus paradas.
      </p>

      {!esTransportista && (
        <output className="mt-6 block rounded-md border border-warning-500/30 bg-warning-50 p-4 text-sm text-warning-700">
          Tu empresa <strong>{empresa?.legal_name}</strong> no opera como transportista, así que no
          arma rutas.
        </output>
      )}

      {esTransportista && !cargandoFlags && !flags.rutas_api_activada && (
        <output className="mt-6 block rounded-md border border-neutral-200 bg-white p-4 text-neutral-700 text-sm">
          Armar rutas con varias cargas todavía no está disponible.
        </output>
      )}

      {activa && listaQ.isLoading && (
        <div className="mt-10 text-center text-neutral-500 text-sm">Cargando rutas…</div>
      )}

      {activa && listaQ.isError && (
        <div
          role="alert"
          className="mt-6 rounded-md border border-danger-500/30 bg-danger-50 p-4 text-danger-700 text-sm"
        >
          No pudimos cargar tus rutas. Intenta de nuevo en unos segundos.
        </div>
      )}

      {activa && listaQ.isSuccess && rutas.length === 0 && (
        <div className="mt-10">
          <EmptyState
            icon={<Inbox className="h-10 w-10" aria-hidden />}
            title="No tienes rutas activas"
            description="Cuando aceptes una oferta, la carga aparece aquí con su propia ruta."
          />
        </div>
      )}

      {activa && rutas.length > 0 && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <ul className="space-y-2">
            {rutas.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  aria-label={`${r.vehiculo?.patente ?? 'Sin camión'} · ${cargas(r.servicios)}`}
                  aria-pressed={seleccionada === r.id}
                  onClick={() => setSeleccionada(r.id)}
                  className={`w-full rounded-lg border p-3 text-left transition ${
                    seleccionada === r.id
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-neutral-200 bg-white hover:bg-neutral-50'
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 font-medium text-neutral-900 text-sm">
                      <Truck className="h-4 w-4 text-neutral-500" aria-hidden />
                      {r.vehiculo?.patente ?? 'Sin camión'} · {cargas(r.servicios)}
                    </span>
                    {r.estado === 'en_curso' && (
                      <span className="rounded-full bg-primary-600 px-2 py-0.5 font-medium text-white text-xs">
                        En curso
                      </span>
                    )}
                  </span>
                  <span className="mt-1 flex items-center gap-2 text-neutral-600 text-xs">
                    <UserRound className="h-3.5 w-3.5" aria-hidden />
                    {r.conductor?.nombre ?? 'Sin conductor'}
                    <span aria-hidden>·</span>
                    {r.paradas_pendientes === 1
                      ? '1 parada pendiente'
                      : `${r.paradas_pendientes} paradas pendientes`}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {seleccionada ? (
            <DetalleDeRuta
              key={seleccionada}
              rutaId={seleccionada}
              // Se puede sumar una carga que hoy viaja sola y todavía no sale.
              candidatas={rutas.filter(
                (r) => r.id !== seleccionada && r.servicios === 1 && r.estado === 'planificada',
              )}
              puedeArmar={puedeArmar}
            />
          ) : (
            <p className="rounded-lg border border-neutral-200 border-dashed p-6 text-center text-neutral-500 text-sm">
              Elige una ruta para ver sus paradas.
            </p>
          )}
        </div>
      )}
    </>
  );
}

function DetalleDeRuta({
  rutaId,
  candidatas,
  puedeArmar,
}: { rutaId: string; candidatas: ResumenRuta[]; puedeArmar: boolean }) {
  const scope = useEmpresaScope();
  const queryClient = useQueryClient();
  const clave = scope.key('rutas', 'detalle', rutaId);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const detalleQ = useQuery({
    queryKey: clave,
    queryFn: async () =>
      (await api.get<{ ruta: DetalleRuta }>(`/rutas/${rutaId}`, scope.init)).ruta,
  });
  // Cada candidata viaja sola: de su detalle salen el código y la asignación.
  const candidatasQ = useQueries({
    queries: (puedeArmar ? candidatas.slice(0, 20) : []).map((c) => ({
      queryKey: scope.key('rutas', 'detalle', c.id),
      queryFn: async () =>
        (await api.get<{ ruta: DetalleRuta }>(`/rutas/${c.id}`, scope.init)).ruta,
    })),
  });

  const cambio = useMutation({
    mutationFn: async (pedir: () => Promise<{ ruta: DetalleRuta }>) => pedir(),
    onMutate: () => {
      setError(null);
      setAviso(null);
    },
    onSuccess: ({ ruta }) => {
      // La respuesta ya trae la ruta como quedó; la lista se vuelve a pedir.
      queryClient.setQueryData(clave, ruta);
      void queryClient.invalidateQueries({ queryKey: scope.key('rutas', 'lista') });
    },
    onError: (err) => setError(mensajeDeRechazo(err)),
  });

  if (detalleQ.isLoading) {
    return <div className="text-center text-neutral-500 text-sm">Cargando la ruta…</div>;
  }
  const ruta = detalleQ.data;
  if (!ruta) {
    return (
      <div
        role="alert"
        className="rounded-md border border-danger-500/30 bg-danger-50 p-4 text-danger-700 text-sm"
      >
        No pudimos cargar esta ruta. Intenta de nuevo en unos segundos.
      </div>
    );
  }

  const { paradas } = ruta;
  const vigentes = new Set(
    paradas.filter((p) => !p.servicio.cancelado).map((p) => p.servicio.asignacion_id),
  );
  const recogidas = new Set(
    paradas
      .filter((p) => p.tipo === 'recogida' && p.resuelta_en)
      .map((p) => p.servicio.asignacion_id),
  );
  const seMueve = (p: ParadaRuta | undefined) => p !== undefined && !p.resuelta_en;

  const mover = (desde: number, hacia: number) => {
    const ids = paradas.map((p) => p.id);
    const [id] = ids.splice(desde, 1);
    if (id === undefined) {
      return;
    }
    ids.splice(hacia, 0, id);
    cambio.mutate(() =>
      api.put<{ ruta: DetalleRuta }>(`/rutas/${rutaId}/paradas`, { paradas: ids }, scope.init),
    );
  };
  const quitar = (p: ParadaRuta) =>
    cambio.mutate(async () => {
      const r = await api.delete<{ ruta: DetalleRuta }>(
        `/rutas/${rutaId}/servicios/${p.servicio.asignacion_id}`,
        scope.init,
      );
      setAviso(`${p.servicio.codigo_seguimiento} volvió a una ruta propia.`);
      return r;
    });
  const agregar = (asignacionId: string) =>
    cambio.mutate(() =>
      api.post<{ ruta: DetalleRuta }>(
        `/rutas/${rutaId}/servicios`,
        {
          asignacion_id: asignacionId,
          // Al final de la ruta; después se ordena con las flechas.
          posicion: { recogida: paradas.length, entrega: paradas.length + 1 },
        },
        scope.init,
      ),
    );

  const paraAgregar = candidatasQ.flatMap((q) => {
    const [parada] = q.data?.paradas ?? [];
    return parada && !parada.servicio.cancelado ? [parada.servicio] : [];
  });

  return (
    <div className="space-y-4">
      {error && (
        <div
          role="alert"
          className="rounded-md border border-danger-500/30 bg-danger-50 p-3 text-danger-700 text-sm"
        >
          {error}
        </div>
      )}
      {aviso && (
        <output className="block rounded-md border border-success-500/30 bg-success-50 p-3 text-sm text-success-700">
          {aviso}
        </output>
      )}

      <section
        aria-label="Paradas de la ruta"
        className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-semibold text-base text-neutral-900">Paradas</h2>
          {ruta.capacidad && (
            <p className="text-neutral-600 text-sm">Capacidad: {kg(ruta.capacidad.kg)}</p>
          )}
        </div>
        <ol className="mt-3 space-y-2">
          {paradas.map((p, i) => {
            const etiqueta = `${p.tipo === 'recogida' ? 'recoger' : 'entregar'} ${p.servicio.codigo_seguimiento}`;
            const cancelada = p.servicio.cancelado;
            const tramo = ruta.tramos.find((t) => t.desde === i);
            const sePuedeQuitar =
              p.tipo === 'recogida' &&
              !cancelada &&
              !recogidas.has(p.servicio.asignacion_id) &&
              vigentes.size > 1;
            return (
              <li key={p.id} className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-200 font-semibold text-neutral-700 text-xs">
                    {i + 1}
                  </span>
                  <div
                    className={`min-w-0 flex-1 text-sm ${
                      cancelada ? 'text-neutral-400 line-through' : 'text-neutral-800'
                    }`}
                  >
                    <p className="font-medium">
                      {p.tipo === 'recogida' ? 'Recoger' : 'Entregar'}{' '}
                      <span className="font-mono text-neutral-600 text-xs">
                        {p.servicio.codigo_seguimiento}
                      </span>
                    </p>
                    <p className="break-words">{p.servicio.direccion}</p>
                  </div>
                  {cancelada && <Estado texto="Cancelada" />}
                  {!cancelada && p.resuelta_en && <Estado texto="Hecha" />}
                  {puedeArmar && !cancelada && !p.resuelta_en && (
                    <div className="flex shrink-0 items-center gap-1">
                      <BotonIcono
                        etiqueta={`Subir la parada ${i + 1}: ${etiqueta}`}
                        disabled={cambio.isPending || !seMueve(paradas[i - 1])}
                        onClick={() => mover(i, i - 1)}
                      >
                        <ArrowUp className="h-4 w-4" aria-hidden />
                      </BotonIcono>
                      <BotonIcono
                        etiqueta={`Bajar la parada ${i + 1}: ${etiqueta}`}
                        disabled={cambio.isPending || !seMueve(paradas[i + 1])}
                        onClick={() => mover(i, i + 1)}
                      >
                        <ArrowDown className="h-4 w-4" aria-hidden />
                      </BotonIcono>
                      {sePuedeQuitar && (
                        <BotonIcono
                          etiqueta={`Quitar ${p.servicio.codigo_seguimiento} de la ruta`}
                          disabled={cambio.isPending}
                          onClick={() => quitar(p)}
                        >
                          <X className="h-4 w-4" aria-hidden />
                        </BotonIcono>
                      )}
                    </div>
                  )}
                </div>
                {tramo && (
                  <p className="mt-2 border-neutral-200 border-t pt-2 pl-9 text-neutral-500 text-xs">
                    {tramo.masa_kg === 0 ? 'Camión vacío' : `${kg(tramo.masa_kg)} a bordo`}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {puedeArmar && paraAgregar.length > 0 && (
        <section
          aria-label="Cargas para agregar"
          className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm"
        >
          <h2 className="font-semibold text-base text-neutral-900">Agregar una carga</h2>
          <p className="mt-1 text-neutral-600 text-sm">
            Cargas aceptadas que hoy viajan solas y todavía no salen.
          </p>
          <ul className="mt-3 space-y-2">
            {paraAgregar.map((s) => (
              <li
                key={s.asignacion_id}
                className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 p-3"
              >
                <div className="min-w-0 text-sm">
                  <p className="font-mono text-neutral-700 text-xs">{s.codigo_seguimiento}</p>
                  <p className="break-words text-neutral-800">{s.direccion}</p>
                  {s.peso_kg !== null && (
                    <p className="text-neutral-500 text-xs">{kg(s.peso_kg)}</p>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={`Agregar ${s.codigo_seguimiento} a la ruta`}
                  disabled={cambio.isPending}
                  onClick={() => agregar(s.asignacion_id)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary-600 px-3 py-2 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  Agregar
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Estado({ texto }: { texto: 'Hecha' | 'Cancelada' }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 font-medium text-xs ${
        texto === 'Hecha' ? 'bg-success-50 text-success-700' : 'bg-neutral-200 text-neutral-600'
      }`}
    >
      {texto}
    </span>
  );
}

function BotonIcono({
  etiqueta,
  disabled,
  onClick,
  children,
}: { etiqueta: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={etiqueta}
      title={etiqueta}
      disabled={disabled}
      onClick={onClick}
      className="rounded-md border border-neutral-300 bg-white p-2 text-neutral-700 hover:bg-neutral-100 disabled:opacity-40"
    >
      {children}
    </button>
  );
}
