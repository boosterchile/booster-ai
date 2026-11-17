import { panelBoosterFleetSchema } from '@booster-ai/shared-schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Fuel, ShieldAlert, Wrench } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import type { MeResponse } from '../hooks/use-me.js';
import { ApiError, api } from '../lib/api-client.js';
import { useEmpresaScope } from '../lib/empresa-activa.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;
type Panel = ReturnType<typeof panelBoosterFleetSchema.parse>;

const SENAL: Record<Panel['combustible']['vehiculos'][number]['senal'], string> = {
  posible_robo: 'Posible robo de combustible',
  sin_telemetria: 'Sin equipo Teltonika',
  sin_movimiento: 'Sin movimiento en 7 días',
  sin_sensor: 'Sin sensor de combustible',
  falta_capacidad: 'Falta la capacidad del estanque',
  dato_no_confiable: 'Dato de combustible no confiable',
  consumo_alto: 'Consume más que el resto de la flota',
  en_orden: 'En orden',
};

const DOC: Record<string, string> = {
  revision_tecnica: 'Revisión técnica',
  permiso_circulacion: 'Permiso de circulación',
  soap: 'SOAP',
  padron: 'Padrón',
  seguro_carga: 'Seguro de carga',
  poliza_responsabilidad: 'Póliza de responsabilidad civil',
  certificado_emisiones: 'Certificado de emisiones',
  licencia_conducir: 'Licencia de conducir',
  curso_b6: 'Curso B6',
  certificado_antecedentes: 'Certificado de antecedentes',
  examen_psicotecnico: 'Examen psicotécnico',
  hoja_vida_conductor: 'Hoja de vida',
  certificado_salud: 'Certificado de salud',
  otro: 'Otro',
};

const ESTADO_DOC: Record<Panel['documental']['vehiculos'][number]['estado'], string> = {
  vencido: 'Vencido',
  faltante: 'Falta el documento',
  sin_fecha: 'Sin fecha de vencimiento',
  sin_archivo: 'Falta el archivo',
  por_vencer: 'Por vencer',
  vigente: 'Vigente',
};

const ESTADO_MANT: Record<Panel['mantenciones']['items'][number]['estado'], string> = {
  vencida: 'Vencida',
  proxima: 'Próxima',
  programada: 'Programada',
  realizada: 'Realizada',
};

const TIPO_MANT: Record<Panel['mantenciones']['items'][number]['tipo'], string> = {
  preventiva: 'Preventiva',
  correctiva: 'Correctiva',
  inspeccion: 'Inspección',
};

function puedeVer(me: MeOnboarded): boolean {
  const membresia = me.active_membership;
  return (
    membresia?.empresa?.is_transportista === true &&
    (membresia.role === 'dueno' || membresia.role === 'admin')
  );
}

function mensajeDe(error: unknown): string {
  if (error instanceof ApiError && error.message.length > 0) {
    return error.message;
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return 'No se pudo completar la acción.';
}

function hoySantiago(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function BoosterFleetRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        return <BoosterFleetPage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function BoosterFleetPage({ me }: { me: MeOnboarded }) {
  if (!puedeVer(me)) {
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
      <Panel me={me} />
    </Layout>
  );
}

function Panel({ me }: { me: MeOnboarded }) {
  const scope = useEmpresaScope();
  const cliente = useQueryClient();
  const q = useQuery({
    queryKey: scope.key('booster-fleet'),
    retry: false,
    queryFn: async () => {
      const crudo = await api.get<unknown>('/booster-fleet', scope.init);
      const parsed = panelBoosterFleetSchema.safeParse(crudo);
      if (!parsed.success) {
        throw new Error('La respuesta de Booster Fleet no tiene la forma esperada.');
      }
      return parsed.data;
    },
  });
  const invalidar = () => cliente.invalidateQueries({ queryKey: scope.key('booster-fleet') });

  return (
    <div>
      <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">Booster Fleet</h1>
      <p className="mt-1 max-w-2xl text-neutral-600 text-sm">
        Control de la flota para el dueño: combustible de los últimos 7 días, documentos de cada
        camión y cada conductor, y mantenciones.
      </p>
      {q.isLoading && <p className="mt-6 text-neutral-500">Cargando Booster Fleet…</p>}
      {q.error && <p className="mt-6 text-danger-700">{mensajeDe(q.error)}</p>}
      {q.data && <Controles me={me} panel={q.data} onCambio={invalidar} />}
    </div>
  );
}

function Controles({
  panel,
  onCambio,
}: {
  me: MeOnboarded;
  panel: Panel;
  onCambio: () => Promise<void>;
}) {
  return (
    <div className="mt-8 space-y-10">
      <section aria-labelledby="combustible-titulo">
        <h2
          id="combustible-titulo"
          className="flex items-center gap-2 font-semibold text-neutral-900 text-xl"
        >
          <Fuel className="h-5 w-5" aria-hidden /> Combustible
        </h2>
        <p className="mt-1 text-neutral-600 text-sm">
          {panel.combustible.con_alerta} vehículos con algo que revisar
          {panel.combustible.litros_por_100_km != null &&
            ` · ${panel.combustible.litros_por_100_km} L/100 km de la flota`}
          .
        </p>
        {panel.combustible.truncado && (
          <p className="mt-2 text-amber-800 text-sm">
            La ventana de telemetría vino cortada. Las cifras pueden estar incompletas.
          </p>
        )}
        <TablaCombustible vehiculos={panel.combustible.vehiculos} />
      </section>

      <section aria-labelledby="documentos-titulo">
        <h2
          id="documentos-titulo"
          className="flex items-center gap-2 font-semibold text-neutral-900 text-xl"
        >
          <ShieldAlert className="h-5 w-5" aria-hidden /> Documentos
        </h2>
        <p className="mt-1 text-neutral-600 text-sm">
          {panel.documental.vehiculos_con_hallazgo} vehículos y{' '}
          {panel.documental.conductores_con_hallazgo} conductores con un documento pendiente.{' '}
          {panel.documental.vehiculos_al_dia} vehículos y {panel.documental.conductores_al_dia}{' '}
          conductores al día.
        </p>
        <ListaDocumentos
          titulo="Vehículos"
          filas={panel.documental.vehiculos.map((fila) => ({
            id: fila.vehiculo_id,
            nombre: fila.patente,
            to: '/app/vehiculos/$id' as const,
            alDia: fila.al_dia,
            estado: fila.estado,
            documentos: fila.documentos,
          }))}
        />
        <ListaDocumentos
          titulo="Conductores"
          filas={panel.documental.conductores.map((fila) => ({
            id: fila.conductor_id,
            nombre: `${fila.nombre} · ${fila.rut || 'Sin RUT'}`,
            to: '/app/conductores/$id' as const,
            alDia: fila.al_dia,
            estado: fila.estado,
            documentos: fila.documentos,
          }))}
        />
      </section>

      <section aria-labelledby="mantenciones-titulo">
        <h2
          id="mantenciones-titulo"
          className="flex items-center gap-2 font-semibold text-neutral-900 text-xl"
        >
          <Wrench className="h-5 w-5" aria-hidden /> Mantenciones
        </h2>
        <p className="mt-1 text-neutral-600 text-sm">
          {panel.mantenciones.vencidas} vencidas, {panel.mantenciones.proximas} próximas,{' '}
          {panel.mantenciones.programadas} programadas.
        </p>
        {panel.mantenciones.truncadas && (
          <p className="mt-2 text-amber-800 text-sm">
            Hay más mantenciones de las que entran en esta lista.
          </p>
        )}
        {panel.mantenciones.en_taller.length > 0 && (
          <p className="mt-2 text-neutral-800 text-sm">
            En taller: {panel.mantenciones.en_taller.map((v) => v.patente).join(', ')}.
          </p>
        )}
        <ListaMantenciones items={panel.mantenciones.items} onCambio={onCambio} />
        <FormularioMantencion vehiculos={panel.combustible.vehiculos} onCambio={onCambio} />
      </section>
    </div>
  );
}

function TablaCombustible({ vehiculos }: { vehiculos: Panel['combustible']['vehiculos'] }) {
  if (vehiculos.length === 0) {
    return <p className="mt-3 text-neutral-600 text-sm">Todavía no hay vehículos en la flota.</p>;
  }
  return (
    <table className="mt-3 w-full text-left text-sm">
      <thead className="text-neutral-500">
        <tr>
          <th className="py-1">Patente</th>
          <th>Señal</th>
          <th>Litros</th>
          <th>L/100 km</th>
        </tr>
      </thead>
      <tbody>
        {vehiculos.map((vehiculo) => (
          <tr key={vehiculo.vehiculo_id} className="border-neutral-100 border-t">
            <td className="py-2 font-medium">{vehiculo.patente}</td>
            <td>{SENAL[vehiculo.senal]}</td>
            <td>{vehiculo.litros ?? '—'}</td>
            <td>{vehiculo.litros_por_100_km ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ListaDocumentos({
  titulo,
  filas,
}: {
  titulo: string;
  filas: Array<{
    id: string;
    nombre: string;
    to: '/app/vehiculos/$id' | '/app/conductores/$id';
    alDia: boolean;
    estado: Panel['documental']['vehiculos'][number]['estado'];
    documentos: Panel['documental']['vehiculos'][number]['documentos'];
  }>;
}) {
  if (filas.length === 0) {
    return <p className="mt-3 text-neutral-600 text-sm">{titulo}: no hay registros.</p>;
  }
  return (
    <div className="mt-4">
      <h3 className="font-medium text-neutral-800">{titulo}</h3>
      <ul className="mt-2 divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
        {filas.map((fila) => (
          <li key={fila.id} className="px-4 py-3 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <Link to={fila.to} params={{ id: fila.id }} className="font-medium text-primary-700">
                {fila.nombre}
              </Link>
              <span>{fila.alDia ? 'Al día' : ESTADO_DOC[fila.estado]}</span>
            </div>
            {!fila.alDia && (
              <ul className="mt-1 text-neutral-600">
                {fila.documentos
                  .filter((doc) => doc.estado !== 'vigente')
                  .map((doc) => (
                    <li key={doc.tipo}>
                      {DOC[doc.tipo] ?? doc.tipo}: {ESTADO_DOC[doc.estado]}
                      {doc.fecha_vencimiento ? ` · ${doc.fecha_vencimiento}` : ''}
                    </li>
                  ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ListaMantenciones({
  items,
  onCambio,
}: {
  items: Panel['mantenciones']['items'];
  onCambio: () => Promise<void>;
}) {
  const scope = useEmpresaScope();
  const [error, setError] = useState<string | null>(null);
  const cerrar = useMutation({
    mutationFn: async (accion: { id: string; tipo: 'realizar' | 'cancelar' }) => {
      const path = `/booster-fleet/mantenciones/${accion.id}/${accion.tipo}`;
      if (accion.tipo === 'cancelar') {
        return await api.post(path, undefined, scope.init);
      }
      return await api.post(path, {}, scope.init);
    },
    onSuccess: async () => {
      setError(null);
      await onCambio();
    },
    onError: (err: unknown) => setError(mensajeDe(err)),
  });

  if (items.length === 0) {
    return (
      <p className="mt-3 text-neutral-600 text-sm">No hay mantenciones abiertas ni recientes.</p>
    );
  }
  return (
    <div className="mt-3">
      {error && <p className="mb-2 text-danger-700 text-sm">{error}</p>}
      <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
          >
            <div>
              <div className="font-medium text-neutral-900">
                {item.patente} · {item.titulo}
              </div>
              <div className="text-neutral-600">
                {TIPO_MANT[item.tipo]} · {item.programada_para} · {ESTADO_MANT[item.estado]}
                {item.notas ? ` · ${item.notas}` : ''}
              </div>
            </div>
            {item.estado !== 'realizada' && (
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-md border border-neutral-300 px-3 py-1"
                  disabled={cerrar.isPending}
                  onClick={() => cerrar.mutate({ id: item.id, tipo: 'realizar' })}
                >
                  Marcar realizada
                </button>
                <button
                  type="button"
                  className="rounded-md border border-neutral-300 px-3 py-1"
                  disabled={cerrar.isPending}
                  onClick={() => {
                    if (window.confirm(`¿Cancelar la mantención «${item.titulo}»?`)) {
                      cerrar.mutate({ id: item.id, tipo: 'cancelar' });
                    }
                  }}
                >
                  Cancelar
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FormularioMantencion({
  vehiculos,
  onCambio,
}: {
  vehiculos: Panel['combustible']['vehiculos'];
  onCambio: () => Promise<void>;
}) {
  const scope = useEmpresaScope();
  const [error, setError] = useState<string | null>(null);
  const [titulo, setTitulo] = useState('');
  const programar = useMutation({
    mutationFn: (body: {
      vehiculo_id: string;
      tipo: 'preventiva' | 'correctiva' | 'inspeccion';
      titulo: string;
      programada_para: string;
      kilometraje_objetivo?: number;
    }) => api.post('/booster-fleet/mantenciones', body, scope.init),
    onSuccess: async () => {
      setError(null);
      setTitulo('');
      await onCambio();
    },
    onError: (err: unknown) => setError(mensajeDe(err)),
  });

  function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const vehiculoId = String(data.get('vehiculo_id') ?? '');
    const tipo = String(data.get('tipo') ?? 'preventiva');
    const fecha = String(data.get('programada_para') ?? '');
    const km = String(data.get('kilometraje_objetivo') ?? '');
    if (tipo !== 'preventiva' && tipo !== 'correctiva' && tipo !== 'inspeccion') {
      setError('El tipo de mantención no es válido.');
      return;
    }
    programar.mutate({
      vehiculo_id: vehiculoId,
      tipo,
      titulo,
      programada_para: fecha,
      ...(km.length > 0 ? { kilometraje_objetivo: Number(km) } : {}),
    });
  }

  return (
    <form
      onSubmit={enviar}
      className="mt-4 grid gap-3 rounded-lg border border-neutral-200 bg-white p-4 sm:grid-cols-2"
    >
      <h3 className="font-medium text-neutral-900 sm:col-span-2">Programar mantención</h3>
      <label className="text-sm">
        Vehículo
        <select
          name="vehiculo_id"
          required
          className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2"
        >
          {vehiculos.map((vehiculo) => (
            <option key={vehiculo.vehiculo_id} value={vehiculo.vehiculo_id}>
              {vehiculo.patente}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Tipo
        <select
          name="tipo"
          className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2"
        >
          <option value="preventiva">Preventiva</option>
          <option value="correctiva">Correctiva</option>
          <option value="inspeccion">Inspección</option>
        </select>
      </label>
      <label className="text-sm">
        Qué hay que hacer
        <input
          name="titulo"
          value={titulo}
          onChange={(event) => setTitulo(event.target.value)}
          required
          minLength={3}
          className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>
      <label className="text-sm">
        Fecha
        <input
          type="date"
          name="programada_para"
          required
          defaultValue={hoySantiago()}
          className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>
      <label className="text-sm">
        Kilometraje objetivo (opcional)
        <input
          name="kilometraje_objetivo"
          inputMode="numeric"
          className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>
      <div className="flex items-end">
        <button
          type="submit"
          disabled={programar.isPending || vehiculos.length === 0}
          className="rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white disabled:opacity-50"
        >
          Programar mantención
        </button>
      </div>
      {error && <p className="text-danger-700 text-sm sm:col-span-2">{error}</p>}
    </form>
  );
}
