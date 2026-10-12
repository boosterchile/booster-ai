import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { PlatformAdminFrame } from '../components/admin/PlatformAdminFrame.js';
import { ApiError, api } from '../lib/api-client.js';

/**
 * ADR-080 — conciliación del mandato de cobro (platform-admin).
 *
 * Muestra el float de terceros contra su tope, los conteos por estado y los
 * viajes en mandato con sus vencimientos. Registra cobros, liberaciones,
 * anticipos del operador y resoluciones de disputa, siempre con evidencia
 * (referencia del abono, de la transferencia, id del adelanto o de la
 * resolución). Registra; no mueve dinero. Con el flag apagado el backend
 * responde 404 y la página lo dice.
 */
export function PlatformAdminMandatoCobroRoute() {
  return (
    <ProtectedRoute meRequirement="skip">
      {() => (
        <PlatformAdminFrame volver={{ to: '/app/platform-admin', label: 'Volver' }}>
          <Pagina />
        </PlatformAdminFrame>
      )}
    </ProtectedRoute>
  );
}

const lineaSchema = z.object({
  estado: z.string(),
  en: z.string().nullable(),
  monto_clp: z.number().nullable(),
  vence_en: z.string().nullable(),
});
const viajeSchema = z.object({
  asignacion_id: z.string(),
  tracking_code: z.string(),
  generador: z.string(),
  transportista: z.string(),
  recepcion_conforme_en: z.string().nullable(),
  cobro: lineaSchema,
  liberacion: lineaSchema,
  montos_esperados: z.object({ cobro_clp: z.number(), liberacion_clp: z.number() }),
});
const resumenSchema = z.object({
  float_clp: z.number(),
  tope_float_clp: z.number(),
  conteos: z.object({
    cobro: z.record(z.number()),
    liberacion: z.record(z.number()),
  }),
  viajes: z.array(viajeSchema),
});
type Resumen = z.infer<typeof resumenSchema>;
type Viaje = z.infer<typeof viajeSchema>;

const TIPOS = [
  { valor: 'cobro_registrado', etiqueta: 'Cobro al generador (abono)', conMonto: true },
  {
    valor: 'liberacion_booster',
    etiqueta: 'Liberación por Booster (transferencia)',
    conMonto: true,
  },
  {
    valor: 'anticipo_operador',
    etiqueta: 'Anticipo del operador (id del adelanto)',
    conMonto: true,
  },
  { valor: 'disputa_resuelta', etiqueta: 'Resolver disputa (liberar)', conMonto: false },
] as const;
const tipoSchema = z.enum([
  'cobro_registrado',
  'liberacion_booster',
  'anticipo_operador',
  'disputa_resuelta',
]);
type Tipo = z.infer<typeof tipoSchema>;

const ERRORES: Record<string, string> = {
  tope_float_excedido: 'Supera el tope del float: Booster no puede adelantar más caja propia.',
  monto_invalido: 'El monto no coincide con el esperado para este viaje.',
  sin_recepcion_conforme: 'El viaje no tiene recepción conforme todavía.',
  cobro_no_pendiente: 'El cobro ya está registrado.',
  liberacion_no_pendiente: 'El transportista ya recibió su pago.',
  liberacion_en_disputa: 'La liberación está congelada por una disputa abierta.',
  sin_disputa_abierta: 'No hay disputa abierta en este viaje.',
  adelanto_invalido: 'El adelanto no existe, es de otro viaje o no está desembolsado.',
  fecha_anterior_a_recepcion: 'La fecha es anterior a la recepción conforme.',
  validation_error: 'Revisa los campos: evidencia y fecha son obligatorias.',
};

const clp = (n: number) =>
  n.toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es-CL') : '—');

function Pagina() {
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [estado, setEstado] = useState<'cargando' | 'ok' | 'desactivado' | 'error'>('cargando');
  const [seleccionado, setSeleccionado] = useState<Viaje | null>(null);

  const cargar = useCallback(async () => {
    try {
      setResumen(resumenSchema.parse(await api.get<unknown>('/admin/mandato-cobro')));
      setEstado('ok');
    } catch (err) {
      setEstado(err instanceof ApiError && err.status === 404 ? 'desactivado' : 'error');
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (estado === 'cargando') {
    return <p className="text-neutral-600">Cargando…</p>;
  }
  if (estado === 'desactivado') {
    return (
      <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4 text-neutral-700 text-sm">
        El mandato de cobro está desactivado (modo conector). Se activa con las seis precondiciones
        de ADR-080 §6 cumplidas; ver <code>.specs/mandato-de-cobro/activacion.md</code>.
      </div>
    );
  }
  if (estado === 'error' || !resumen) {
    return <p className="text-danger-700">No se pudo cargar la conciliación.</p>;
  }

  const disponible = Math.max(0, resumen.tope_float_clp - resumen.float_clp);
  return (
    <div className="space-y-6">
      <h1 className="font-bold text-2xl text-neutral-900">Mandato de cobro</h1>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Dato titulo="Float de terceros" valor={clp(resumen.float_clp)} />
        <Dato titulo="Tope" valor={clp(resumen.tope_float_clp)} />
        <Dato titulo="Disponible" valor={clp(disponible)} />
      </dl>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-neutral-200 border-b text-left text-neutral-600">
              <th className="py-2 pr-3">Viaje</th>
              <th className="py-2 pr-3">Generador</th>
              <th className="py-2 pr-3">Transportista</th>
              <th className="py-2 pr-3">Recepción</th>
              <th className="py-2 pr-3">Cobro</th>
              <th className="py-2 pr-3">Liberación</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {resumen.viajes.map((v) => (
              <tr key={v.asignacion_id} className="border-neutral-100 border-b">
                <td className="py-2 pr-3 font-mono">{v.tracking_code}</td>
                <td className="py-2 pr-3">{v.generador}</td>
                <td className="py-2 pr-3">{v.transportista}</td>
                <td className="py-2 pr-3">{fecha(v.recepcion_conforme_en)}</td>
                <td className="py-2 pr-3">
                  {v.cobro.estado} · vence {fecha(v.cobro.vence_en)}
                </td>
                <td className="py-2 pr-3">
                  {v.liberacion.estado} · vence {fecha(v.liberacion.vence_en)}
                </td>
                <td className="py-2">
                  <button
                    type="button"
                    onClick={() => setSeleccionado(v)}
                    className="rounded-md border border-neutral-300 px-2 py-1 text-neutral-700 text-xs hover:bg-neutral-100"
                  >
                    Registrar
                  </button>
                </td>
              </tr>
            ))}
            {resumen.viajes.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 text-center text-neutral-600">
                  No hay viajes en mandato de cobro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {seleccionado && (
        <FormularioEvento
          viaje={seleccionado}
          onListo={() => {
            setSeleccionado(null);
            void cargar();
          }}
          onCerrar={() => setSeleccionado(null)}
        />
      )}
    </div>
  );
}

function Dato({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-3">
      <dt className="text-neutral-600 text-xs">{titulo}</dt>
      <dd className="font-semibold text-lg text-neutral-900">{valor}</dd>
    </div>
  );
}

function FormularioEvento({
  viaje,
  onListo,
  onCerrar,
}: {
  viaje: Viaje;
  onListo: () => void;
  onCerrar: () => void;
}) {
  const [tipo, setTipo] = useState<Tipo>('cobro_registrado');
  const [monto, setMonto] = useState(String(viaje.montos_esperados.cobro_clp));
  const [evidencia, setEvidencia] = useState('');
  const [ocurrido, setOcurrido] = useState(() => new Date().toISOString().slice(0, 16));
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const conMonto = TIPOS.find((t) => t.valor === tipo)?.conMonto ?? false;

  function cambiarTipo(nuevo: Tipo) {
    setTipo(nuevo);
    setMonto(
      nuevo === 'cobro_registrado'
        ? String(viaje.montos_esperados.cobro_clp)
        : nuevo === 'liberacion_booster'
          ? String(viaje.montos_esperados.liberacion_clp)
          : '',
    );
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await api.post(`/admin/mandato-cobro/${viaje.asignacion_id}/eventos`, {
        tipo,
        ...(conMonto ? { monto_clp: Number(monto) } : {}),
        evidencia_ref: evidencia.trim(),
        ocurrido_en: new Date(ocurrido).toISOString(),
      });
      onListo();
    } catch (err) {
      const code = err instanceof ApiError ? (err.code ?? err.message) : '';
      setError(ERRORES[code] ?? 'No se pudo registrar el evento.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form
      onSubmit={enviar}
      className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4"
      aria-label={`Registrar evento del viaje ${viaje.tracking_code}`}
    >
      <h2 className="font-semibold text-neutral-900">Viaje {viaje.tracking_code}</h2>
      <label className="block text-sm">
        <span className="text-neutral-700">Evento</span>
        <select
          value={tipo}
          onChange={(e) => cambiarTipo(tipoSchema.parse(e.target.value))}
          className="mt-1 block w-full rounded-md border border-neutral-300 p-2"
        >
          {TIPOS.map((t) => (
            <option key={t.valor} value={t.valor}>
              {t.etiqueta}
            </option>
          ))}
        </select>
      </label>
      {conMonto && (
        <label className="block text-sm">
          <span className="text-neutral-700">Monto (CLP)</span>
          <input
            type="number"
            min={1}
            step={1}
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            className="mt-1 block w-full rounded-md border border-neutral-300 p-2"
          />
        </label>
      )}
      <label className="block text-sm">
        <span className="text-neutral-700">
          Evidencia (referencia del abono, transferencia o id)
        </span>
        <input
          type="text"
          value={evidencia}
          onChange={(e) => setEvidencia(e.target.value)}
          maxLength={200}
          required
          className="mt-1 block w-full rounded-md border border-neutral-300 p-2"
        />
      </label>
      <label className="block text-sm">
        <span className="text-neutral-700">Fecha del movimiento</span>
        <input
          type="datetime-local"
          value={ocurrido}
          onChange={(e) => setOcurrido(e.target.value)}
          required
          className="mt-1 block w-full rounded-md border border-neutral-300 p-2"
        />
      </label>
      {error && (
        <p className="text-danger-700 text-sm" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCerrar}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-neutral-700 text-sm hover:bg-neutral-100"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={enviando || evidencia.trim() === ''}
          className="rounded-md bg-primary-600 px-3 py-1.5 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {enviando ? 'Registrando…' : 'Registrar'}
        </button>
      </div>
    </form>
  );
}
