import type { PanelBoosterFleet } from '@booster-ai/shared-schemas';
import { Button, Modal } from '@booster-ai/ui-components';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { FileText, Fuel, Plus } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { EtiquetaSeveridad, MarcaTono } from '../components/booster-fleet/etiqueta-severidad.js';
import {
  FormularioMantencion,
  mensajeDe,
} from '../components/booster-fleet/formulario-mantencion.js';
import { MantencionesFlota } from '../components/booster-fleet/mantenciones-flota.js';
import {
  ETIQUETA_SENAL,
  TONO_DE_SENAL,
  TONO_DOCUMENTO,
  type VehiculoFlota,
  formatoCoordenadas,
  formatoFechaHora,
  formatoNumero,
  hallazgosDocumentales,
  medianaLectura,
} from '../components/booster-fleet/reglas.js';
import { SemanaVehiculo } from '../components/booster-fleet/semana-vehiculo.js';
import {
  type MeOnboarded,
  puedeVerBoosterFleet,
  usePanelBoosterFleet,
} from '../components/booster-fleet/use-panel.js';
import { EventoCombustibleMap } from '../components/map/EventoCombustibleMap.js';
import { api } from '../lib/api-client.js';
import { useEmpresaScope } from '../lib/empresa-activa.js';

const trayectoSchema = z.object({
  id: z.string(),
  inicio: z.string(),
  fin: z.string(),
  distancia_km: z.number(),
  litros_iniciales: z.number().nullable(),
  litros_finales: z.number().nullable(),
  litros_consumidos: z.number().nullable().optional(),
  litros_por_100_km: z.number().nullable().optional(),
  nivel_pct_inicial: z.number().nullable().optional(),
  nivel_pct_final: z.number().nullable().optional(),
  posible_robo_combustible: z.boolean(),
  posible_robo_hormiga: z.boolean().optional(),
  evento_desde: z.string().nullable().optional(),
  evento_hasta: z.string().nullable().optional(),
  evento_litros: z.number().nullable().optional(),
});
const listadoSchema = z.object({ trayectos: z.array(trayectoSchema) });
type Trayecto = z.infer<typeof trayectoSchema>;

const PANEL = 'overflow-hidden rounded-lg border border-neutral-200 bg-neutral-0';
const ENLACE = 'whitespace-nowrap font-medium text-primary-700 text-sm hover:underline';

export function BoosterFleetVehiculoRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        return <Pagina me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function Pagina({ me }: { me: MeOnboarded }) {
  if (!puedeVerBoosterFleet(me)) {
    return (
      <Layout me={me} title="Booster Fleet">
        <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">Booster Fleet</h1>
        <p className="mt-3 max-w-xl text-neutral-700">
          Booster Fleet es el control de flota del dueño de la empresa de transportes.
        </p>
      </Layout>
    );
  }
  return (
    <Layout me={me} title="Booster Fleet">
      <Detalle />
    </Layout>
  );
}

/**
 * Detalle de un vehículo de Booster Fleet (`.specs/booster-fleet-rediseno`):
 * la desviación con su fecha, hora, litros y lugar, y la semana del camión
 * sobre un solo eje de tiempo.
 */
function Detalle() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { consulta, invalidar } = usePanelBoosterFleet();
  const panel = consulta.data;
  const vehiculo = panel?.combustible.vehiculos.find((v) => v.vehiculo_id === id);

  return (
    <div>
      <nav aria-label="Ruta" className="text-neutral-600 text-sm">
        <Link to="/app/booster-fleet" className={ENLACE}>
          Booster Fleet
        </Link>
        <span className="mx-2">/</span>
        <span>Combustible</span>
      </nav>
      {consulta.isLoading && <p className="mt-6 text-neutral-500">Cargando el vehículo…</p>}
      {consulta.error && (
        <p role="alert" className="mt-6 text-danger-700">
          {mensajeDe(consulta.error)}
        </p>
      )}
      {panel && !vehiculo ? (
        <p className="mt-6 text-neutral-700">Este vehículo no está en la flota.</p>
      ) : null}
      {panel && vehiculo ? (
        <Contenido panel={panel} vehiculo={vehiculo} onCambio={invalidar} />
      ) : null}
    </div>
  );
}

function Contenido({
  panel,
  vehiculo,
  onCambio,
}: {
  panel: PanelBoosterFleet;
  vehiculo: VehiculoFlota;
  onCambio: () => Promise<void>;
}) {
  const scope = useEmpresaScope();
  const [programando, setProgramando] = useState(false);
  const { desde, hasta } = panel.combustible;
  const q = useQuery({
    queryKey: scope.key('booster-fleet', 'trayectos', vehiculo.vehiculo_id, desde, hasta),
    retry: false,
    queryFn: async () => {
      const url =
        `/trayectos-teltonika?page=1&page_size=50&vehiculo_id=${encodeURIComponent(vehiculo.vehiculo_id)}` +
        `&desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`;
      const parsed = listadoSchema.safeParse(await api.get<unknown>(url, scope.init));
      if (!parsed.success) {
        throw new Error('La respuesta de trayectos no tiene la forma esperada.');
      }
      return [...parsed.data.trayectos].sort((a, b) => a.inicio.localeCompare(b.inicio));
    },
  });
  const trayectos = q.data ?? [];
  const tono = TONO_DE_SENAL[vehiculo.senal];
  const mediana = medianaLectura(panel.combustible.vehiculos);
  const documentos = hallazgosDocumentales({
    ...panel.documental,
    vehiculos: panel.documental.vehiculos.filter((v) => v.vehiculo_id === vehiculo.vehiculo_id),
    conductores: [],
  });
  const items = panel.mantenciones.items.filter((m) => m.vehiculo_id === vehiculo.vehiculo_id);
  const mantenciones: PanelBoosterFleet['mantenciones'] = {
    vencidas: items.filter((m) => m.estado === 'vencida').length,
    proximas: items.filter((m) => m.estado === 'proxima').length,
    programadas: items.filter((m) => m.estado === 'programada').length,
    truncadas: false,
    en_taller: panel.mantenciones.en_taller.filter((v) => v.vehiculo_id === vehiculo.vehiculo_id),
    items,
  };

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono font-semibold text-2xl text-neutral-900 tracking-wide">
            {vehiculo.patente}
          </h1>
          <EtiquetaSeveridad tono={tono}>
            {vehiculo.senal === 'posible_robo'
              ? 'Desviación por analizar'
              : ETIQUETA_SENAL[vehiculo.senal]}
          </EtiquetaSeveridad>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link to="/app/vehiculos/$id" params={{ id: vehiculo.vehiculo_id }} className={ENLACE}>
            Ir al vehículo
          </Link>
          <Button onClick={() => setProgramando(true)}>
            <Plus className="h-4 w-4" aria-hidden /> Programar inspección
          </Button>
        </div>
      </div>

      {vehiculo.desviacion ? <BloqueDesviacion vehiculo={vehiculo} /> : null}

      <div className="mt-6">
        {q.error ? (
          <p role="alert" className="text-danger-700 text-sm">
            {mensajeDe(q.error)}
          </p>
        ) : (
          <SemanaVehiculo
            patente={vehiculo.patente}
            desde={desde}
            hasta={hasta}
            trayectos={trayectos.map((t) => ({
              ...t,
              desviacion: t.posible_robo_combustible || t.posible_robo_hormiga === true,
            }))}
          />
        )}
      </div>

      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="space-y-6">
          <TablaTrayectos trayectos={trayectos} cargando={q.isLoading} />
          <section aria-labelledby="semana-combustible" className={PANEL}>
            <h2
              id="semana-combustible"
              className="flex items-center gap-2 px-4 py-3 font-semibold text-neutral-900"
            >
              <Fuel className="h-4 w-4" aria-hidden /> Combustible de la semana
            </h2>
            <dl>
              <Dato
                nombre="Litros"
                valor={vehiculo.litros != null ? `${formatoNumero(vehiculo.litros)} L` : '—'}
              />
              <Dato
                nombre="Kilómetros con lectura"
                valor={vehiculo.km != null ? `${formatoNumero(vehiculo.km)} km` : '—'}
              />
              <Dato
                nombre="Consumo"
                valor={
                  vehiculo.litros_por_100_km != null
                    ? `${formatoNumero(vehiculo.litros_por_100_km)} L/100 km`
                    : 'Sin lectura confiable'
                }
              />
              <Dato
                nombre="Mediana de la flota"
                valor={mediana != null ? `${formatoNumero(mediana)} L/100 km` : 'Sin comparación'}
              />
            </dl>
            <p className="border-neutral-200 border-t px-4 py-3 text-neutral-600 text-xs leading-relaxed">
              Booster muestra qué pasó, cuándo y dónde; no a quién apuntar. Una desviación puede ser
              una falla del sensor, y un consumo alto puede venir de la vía: congestión, desvíos,
              pendiente o espera con el motor encendido.
            </p>
          </section>
        </div>
        <div className="space-y-6">
          <section aria-labelledby="documentos-vehiculo" className={PANEL}>
            <h2
              id="documentos-vehiculo"
              className="flex items-center gap-2 px-4 py-3 font-semibold text-neutral-900"
            >
              <FileText className="h-4 w-4" aria-hidden /> Documentos
            </h2>
            {documentos.length === 0 ? (
              <p className="border-neutral-200 border-t px-4 py-3 text-neutral-600 text-sm">
                Sin documentos pendientes.
              </p>
            ) : (
              <ul>
                {documentos.map((doc) => (
                  <li
                    key={doc.clave}
                    className="flex items-center gap-2 border-neutral-200 border-t px-4 py-2.5 text-sm"
                  >
                    <MarcaTono tono={TONO_DOCUMENTO[doc.estado]} />
                    <span className="font-medium text-neutral-900">{doc.documento}</span>
                    <span className="text-neutral-600">· {doc.texto}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-neutral-200 border-t px-4 py-2.5">
              <Link
                to="/app/vehiculos/$id"
                params={{ id: vehiculo.vehiculo_id }}
                className={ENLACE}
              >
                Abrir ficha del vehículo
              </Link>
            </div>
          </section>
          <MantencionesFlota
            mantenciones={mantenciones}
            vehiculos={[vehiculo]}
            onCambio={onCambio}
          />
        </div>
      </div>

      <Modal isOpen={programando} onOpenChange={setProgramando} title="Programar inspección">
        {({ close }) => (
          <FormularioMantencion
            vehiculos={[vehiculo]}
            onProgramada={async () => {
              close();
              await onCambio();
            }}
          />
        )}
      </Modal>
    </>
  );
}

function Dato({ nombre, valor }: { nombre: string; valor: string }) {
  return (
    <div className="flex justify-between gap-3 border-neutral-200 border-t px-4 py-2.5 text-sm">
      <dt className="text-neutral-600">{nombre}</dt>
      <dd className="font-medium text-neutral-900 tabular-nums">{valor}</dd>
    </div>
  );
}

/** La desviación con sus cuatro datos, siempre en el mismo orden. Lo que falta se dice. */
function BloqueDesviacion({ vehiculo }: { vehiculo: VehiculoFlota }) {
  const desviacion = vehiculo.desviacion;
  if (!desviacion) {
    return null;
  }
  const [fecha, horaDesde] = (formatoFechaHora(desviacion.desde) ?? '').split(', ');
  const [fechaHasta, horaHasta] = (formatoFechaHora(desviacion.hasta) ?? '').split(', ');
  const coordenadas = formatoCoordenadas(desviacion.lat, desviacion.lon);
  const hora =
    horaDesde && horaHasta ? `${horaDesde} a ${horaHasta}` : horaDesde || horaHasta || null;

  return (
    <section
      aria-labelledby="desviacion-titulo"
      className="mt-5 rounded-lg border border-danger-600 bg-danger-50 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id="desviacion-titulo" className="font-semibold text-danger-700 text-lg">
          {desviacion.tipo === 'hormiga'
            ? 'Desviación gradual de combustible por analizar'
            : 'Desviación de combustible por analizar'}
        </h2>
        <Link
          to="/app/trayectos"
          search={{ vehiculo: vehiculo.vehiculo_id, detalle: desviacion.trayecto_id }}
          className="inline-flex rounded-md bg-danger-600 px-3 py-1.5 font-medium text-sm text-white hover:bg-danger-700"
        >
          Analizar trayecto
        </Link>
      </div>
      <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
        <Hecho nombre="Fecha" valor={fecha || fechaHasta || 'Fecha sin dato'} />
        <Hecho nombre="Hora" valor={hora ?? 'Hora sin dato'} />
        <Hecho nombre="Lugar" valor={coordenadas ?? 'Lugar sin dato'} />
        <Hecho
          nombre="Variación"
          valor={
            desviacion.litros != null ? `−${formatoNumero(desviacion.litros)} L` : 'Litros sin dato'
          }
        />
      </dl>
      <p className="mt-3 text-neutral-700 text-sm">
        Puede ser una falla del sensor: analiza el trayecto antes de sacar conclusiones.
        {desviacion.total > 1 ? ` Hubo ${desviacion.total} desviaciones en la semana.` : ''}
      </p>
      {desviacion.lat != null && desviacion.lon != null ? (
        <div className="mt-4">
          <EventoCombustibleMap latitude={desviacion.lat} longitude={desviacion.lon} />
        </div>
      ) : null}
    </section>
  );
}

function Hecho({ nombre, valor }: { nombre: string; valor: string }) {
  return (
    <div>
      <dt className="font-semibold text-danger-700 text-xs uppercase tracking-wider">{nombre}</dt>
      <dd className="font-semibold text-neutral-900 text-sm">{valor}</dd>
    </div>
  );
}

function TablaTrayectos({
  trayectos,
  cargando,
}: {
  trayectos: readonly Trayecto[];
  cargando: boolean;
}) {
  return (
    <section aria-labelledby="trayectos-titulo" className={PANEL}>
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <h2 id="trayectos-titulo" className="font-semibold text-neutral-900">
          Trayectos de la semana
        </h2>
        <p className="text-neutral-600 text-xs">
          {trayectos.length} {trayectos.length === 1 ? 'trayecto' : 'trayectos'}
        </p>
      </div>
      {trayectos.length === 0 ? (
        <p className="border-neutral-200 border-t px-4 py-4 text-neutral-600 text-sm">
          {cargando ? 'Cargando trayectos…' : 'Sin trayectos en la semana.'}
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-neutral-500 text-xs">
            <tr className="border-neutral-200 border-t">
              <th scope="col" className="px-4 py-2 text-left font-medium">
                Inicio
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Fin
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Km
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Litros
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                L/100 km
              </th>
              <th scope="col" className="px-4 py-2 text-left font-medium">
                Nota
              </th>
            </tr>
          </thead>
          <tbody>
            {trayectos.map((t) => {
              const desviacion = t.posible_robo_combustible || t.posible_robo_hormiga === true;
              return (
                <tr
                  key={t.id}
                  className={
                    desviacion
                      ? 'border-neutral-200 border-t bg-danger-50'
                      : 'border-neutral-200 border-t'
                  }
                >
                  <th scope="row" className="px-4 py-2 text-left font-normal text-neutral-700">
                    {formatoFechaHora(t.inicio)}
                  </th>
                  <td className="px-3 py-2 text-neutral-700">{formatoFechaHora(t.fin)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatoNumero(t.distancia_km)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {t.litros_consumidos != null ? formatoNumero(t.litros_consumidos) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {t.litros_por_100_km != null ? formatoNumero(t.litros_por_100_km) : '—'}
                  </td>
                  <td className="px-4 py-2 font-medium text-danger-700 text-xs">
                    {desviacion
                      ? `${t.posible_robo_combustible ? 'Desviación' : 'Desviación gradual'}${
                          t.evento_litros != null ? ` · −${formatoNumero(t.evento_litros)} L` : ''
                        }`
                      : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
