import { Link } from '@tanstack/react-router';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  LogOut,
  PlayCircle,
  Settings2,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { signOutUser } from '../hooks/use-auth.js';
import { ApiError, api } from '../lib/api-client.js';

/**
 * /app/platform-admin/matching — Comparar algoritmo de asignación (ADR-033).
 * Reservada a platform admins (allowlist en backend).
 *
 * Surface:
 *
 *   - Lanzar simulación: rango de fechas opcional, cantidad máxima de
 *     viajes a analizar, y opcionalmente ajustar los pesos de cada
 *     criterio (capacidad ajustada, viaje de retorno, reputación, tier).
 *   - Lista de simulaciones recientes con preview de métricas clave en
 *     lenguaje natural ("75% coincide con el algoritmo actual").
 *   - Detalle de una simulación: tarjetas de métricas, panel de
 *     transportistas favorecidos / perjudicados, distribución de
 *     calidad de match, y tabla expandible viaje por viaje.
 *
 * El backend gateéa con BOOSTER_PLATFORM_ADMIN_EMAILS — la UI muestra un
 * mensaje humanizado (vía humanizeError) si el usuario no está en la
 * lista, sin exponer el nombre de la env var ni códigos técnicos.
 */

// ---------------------------------------------------------------------------
// Tipos del API (alinean con apps/api/src/services/matching-backtest.ts)
// ---------------------------------------------------------------------------

interface Pesos {
  capacidad: number;
  backhaul: number;
  reputacion: number;
  tier: number;
}

const DEFAULT_PESOS: Pesos = {
  capacidad: 0.4,
  backhaul: 0.35,
  reputacion: 0.15,
  tier: 0.1,
};

interface MetricasResumen {
  tripsProcesados: number;
  tripsConCandidatosV1: number;
  tripsConCandidatosV2: number;
  topNOverlapPct: number;
  scoreDeltaAvg: number;
  backhaulHitRatePct: number;
  empresasFavorecidas: Array<{ empresaId: string; delta: number }>;
  empresasPerjudicadas: Array<{ empresaId: string; delta: number }>;
  distribucionScoresV2: Record<string, number>;
}

interface ResultadoTrip {
  tripId: string;
  originRegionCode: string;
  cargoWeightKg: number;
  candidatosTotal: number;
  ofertasV1: Array<{ empresaId: string; vehicleId: string; scoreInt: number }>;
  ofertasV2: Array<{ empresaId: string; vehicleId: string; scoreInt: number }>;
  overlapEmpresas: number;
  deltaScorePromedio: number;
  backhaulHit: boolean;
}

interface RunListItem {
  id: string;
  createdAt: string;
  createdByEmail: string;
  estado: 'pendiente' | 'ejecutando' | 'completada' | 'fallida';
  tripsProcesados: number;
  resumenPreview: { topNOverlapPct: number; scoreDeltaAvg: number } | null;
}

interface RunDetail {
  id: string;
  createdAt: string;
  completedAt: string | null;
  createdByEmail: string;
  estado: string;
  tripsProcesados: number;
  tripsConCandidatosV1: number;
  tripsConCandidatosV2: number;
  pesosUsados: Pesos | null;
  metricasResumen: MetricasResumen | null;
  resultados: ResultadoTrip[] | null;
  errorMessage: string | null;
}

// ---------------------------------------------------------------------------
// Route + page
// ---------------------------------------------------------------------------

export function PlatformAdminMatchingRoute() {
  return (
    <ProtectedRoute meRequirement="skip">{() => <PlatformAdminMatchingPage />}</ProtectedRoute>
  );
}

function PlatformAdminMatchingPage() {
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<RunDetail | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [errorList, setErrorList] = useState<string | null>(null);

  async function refreshList() {
    setLoadingList(true);
    setErrorList(null);
    try {
      const res = await api.get<{ ok: true; runs: RunListItem[] }>('/admin/matching/backtest');
      setRuns(res.runs);
    } catch (err) {
      const msg =
        err instanceof ApiError ? `${err.status}: ${err.message}` : (err as Error).message;
      setErrorList(msg);
    } finally {
      setLoadingList(false);
    }
  }

  async function loadDetail(id: string) {
    setSelectedRunId(id);
    setSelectedRun(null);
    setLoadingDetail(true);
    try {
      const res = await api.get<{ ok: true; run: RunDetail }>(`/admin/matching/backtest/${id}`);
      setSelectedRun(res.run);
    } catch (err) {
      const msg =
        err instanceof ApiError ? `${err.status}: ${err.message}` : (err as Error).message;
      setSelectedRun({
        id,
        createdAt: '',
        completedAt: null,
        createdByEmail: '',
        estado: 'fallida',
        tripsProcesados: 0,
        tripsConCandidatosV1: 0,
        tripsConCandidatosV2: 0,
        pesosUsados: null,
        metricasResumen: null,
        resultados: null,
        errorMessage: msg,
      });
    } finally {
      setLoadingDetail(false);
    }
  }

  useEffect(() => {
    void refreshList();
    // refreshList se re-define en cada render; queremos cargar la lista
    // una sola vez al montar — el setter funcional + closures basta.
  }, []);

  async function handleSignOut() {
    await signOutUser();
  }

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <header className="border-neutral-200 border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-100 text-primary-700">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="font-semibold text-neutral-900">Comparar algoritmo de asignación</div>
              <div className="text-neutral-500 text-xs">
                Probá un nuevo algoritmo de asignación sobre viajes reales antes de activarlo
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/app/platform-admin"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-neutral-700 text-sm transition hover:bg-neutral-100"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Volver a Platform Admin
            </Link>
            <button
              type="button"
              onClick={handleSignOut}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-neutral-600 text-sm transition hover:bg-neutral-100"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              Salir
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">
          ¿Qué transportistas habría elegido el nuevo algoritmo?
        </h1>
        <p className="mt-2 max-w-3xl text-neutral-600 text-sm">
          Esta página simula cómo el <strong>nuevo algoritmo de asignación</strong> (que prioriza
          transportistas con viaje de retorno disponible, buena reputación y vehículo bien
          dimensionado) habría elegido transportistas en viajes pasados, y compara el resultado
          contra el <strong>algoritmo actual</strong> (que sólo considera capacidad del vehículo).
          Sirve para evaluar el cambio antes de activarlo en producción.
        </p>
        <details className="mt-3 max-w-3xl text-neutral-600 text-sm">
          <summary className="cursor-pointer font-medium text-neutral-700">
            ¿Cómo funciona exactamente?
          </summary>
          <div className="mt-2 space-y-2 text-neutral-600 text-xs">
            <p>
              Para cada viaje pasado en la ventana elegida, la simulación recalcula qué
              transportistas habrían recibido oferta bajo cada algoritmo y compara los dos
              resultados. No crea ofertas reales ni modifica nada — solo computa "qué habría pasado
              si".
            </p>
            <p>
              Las señales del nuevo algoritmo (viajes activos del transportista, historial de
              últimos 7 días, ofertas de últimos 90 días, tier de membresía) usan el estado actual
              de la base de datos. Esto significa que la simulación responde a la pregunta "¿cómo se
              vería hoy el matching bajo estos pesos?" — útil para evaluar pesos, no es análisis
              estadístico estricto sobre el pasado.
            </p>
          </div>
        </details>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[420px_1fr]">
          <RunForm onSubmitted={refreshList} />
          <RunsList
            runs={runs}
            loading={loadingList}
            error={errorList}
            selectedRunId={selectedRunId}
            onSelect={loadDetail}
            onRefresh={refreshList}
          />
        </div>

        {selectedRunId && (
          <div className="mt-8">
            <RunDetailView run={selectedRun} loading={loadingDetail} />
          </div>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form: disparar corrida
// ---------------------------------------------------------------------------

function RunForm({ onSubmitted }: { onSubmitted: () => void | Promise<void> }) {
  const [tripsLimit, setTripsLimit] = useState(500);
  const [tripsDesde, setTripsDesde] = useState('');
  const [tripsHasta, setTripsHasta] = useState('');
  const [useCustomPesos, setUseCustomPesos] = useState(false);
  const [pesos, setPesos] = useState<Pesos>(DEFAULT_PESOS);
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'success'; id: string; resumen: MetricasResumen }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  const pesosSum = pesos.capacidad + pesos.backhaul + pesos.reputacion + pesos.tier;
  const pesosValid = Math.abs(pesosSum - 1) < 0.01;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (useCustomPesos && !pesosValid) {
      setState({
        kind: 'error',
        message: `La suma de los pesos tiene que ser 1.00 (actualmente suma ${pesosSum.toFixed(2)})`,
      });
      return;
    }

    setState({ kind: 'loading' });
    try {
      const body: Record<string, unknown> = { tripsLimit };
      if (tripsDesde) {
        body.tripsDesde = new Date(tripsDesde).toISOString();
      }
      if (tripsHasta) {
        body.tripsHasta = new Date(tripsHasta).toISOString();
      }
      if (useCustomPesos) {
        body.pesos = pesos;
      }

      const res = await api.post<{
        ok: true;
        id: string;
        resumen: MetricasResumen;
      }>('/admin/matching/backtest', body);
      setState({ kind: 'success', id: res.id, resumen: res.resumen });
      await onSubmitted();
    } catch (err) {
      const msg =
        err instanceof ApiError ? `${err.status}: ${err.message}` : (err as Error).message;
      setState({ kind: 'error', message: msg });
    }
  }

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-700">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h2 className="font-semibold text-neutral-900">Lanzar una simulación</h2>
          <p className="mt-1 text-neutral-600 text-sm">
            Sobre cuántos viajes pasados querés simular el algoritmo nuevo. Tarda menos de 30
            segundos para 500 viajes.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mt-4 space-y-3">
        <fieldset className="space-y-3">
          <legend className="font-medium text-neutral-700 text-xs uppercase tracking-wide">
            Qué viajes incluir
          </legend>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-neutral-700">Desde (opcional)</span>
              <input
                type="date"
                value={tripsDesde}
                onChange={(e) => setTripsDesde(e.target.value)}
                className="mt-1 block w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </label>
            <label className="block text-sm">
              <span className="text-neutral-700">Hasta (opcional)</span>
              <input
                type="date"
                value={tripsHasta}
                onChange={(e) => setTripsHasta(e.target.value)}
                className="mt-1 block w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </label>
          </div>
          <p className="text-neutral-500 text-xs">
            Sin fechas, toma los viajes más recientes hasta el límite indicado abajo.
          </p>

          <label className="block text-sm">
            <span className="text-neutral-700">Cantidad máxima de viajes a simular</span>
            <input
              type="number"
              min={1}
              max={5000}
              value={tripsLimit}
              onChange={(e) => setTripsLimit(Number(e.target.value) || 500)}
              className="mt-1 block w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
            <span className="text-neutral-500 text-xs">Mínimo 1 — máximo 5000.</span>
          </label>
        </fieldset>

        <fieldset className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
          <legend className="-mt-1 px-1 font-medium text-neutral-700 text-xs uppercase tracking-wide">
            Qué tan importante es cada criterio
          </legend>
          <label className="mt-1 flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={useCustomPesos}
              onChange={(e) => setUseCustomPesos(e.target.checked)}
              className="rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
            />
            <Settings2 className="h-4 w-4 text-neutral-600" aria-hidden />
            <span className="font-medium text-neutral-700">
              Ajustar manualmente (sino, usa los valores recomendados)
            </span>
          </label>
          <p className="mt-1 text-neutral-500 text-xs">
            Los valores recomendados priorizan capacidad ajustada (40%) y viaje de retorno (35%),
            con menos peso en reputación (15%) y tier de membresía (10%).
          </p>

          {useCustomPesos && (
            <div className="mt-3 space-y-2">
              <PesoInput
                label="Capacidad ajustada"
                hint="vehículo no sobredimensionado para la carga"
                value={pesos.capacidad}
                onChange={(v) => setPesos({ ...pesos, capacidad: v })}
              />
              <PesoInput
                label="Viaje de retorno"
                hint="el transportista ya iba a esa zona"
                value={pesos.backhaul}
                onChange={(v) => setPesos({ ...pesos, backhaul: v })}
              />
              <PesoInput
                label="Reputación"
                hint="historial de ofertas aceptadas (90 días)"
                value={pesos.reputacion}
                onChange={(v) => setPesos({ ...pesos, reputacion: v })}
              />
              <PesoInput
                label="Tier de membresía"
                hint="bonus para suscripciones de pago"
                value={pesos.tier}
                onChange={(v) => setPesos({ ...pesos, tier: v })}
              />
              <div className={`text-xs ${pesosValid ? 'text-success-700' : 'text-danger-700'}`}>
                Suma actual: {pesosSum.toFixed(2)}{' '}
                {pesosValid ? '✓ válida' : '— ajusta para que sume 1.00'}
              </div>
            </div>
          )}
        </fieldset>

        <button
          type="submit"
          disabled={state.kind === 'loading'}
          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-50"
          data-testid="run-backtest-button"
        >
          {state.kind === 'loading' ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Simulando…
            </>
          ) : (
            <>
              <PlayCircle className="h-4 w-4" aria-hidden />
              Lanzar simulación
            </>
          )}
        </button>

        {state.kind === 'error' && (
          <div className="rounded-md border border-danger-200 bg-danger-50 p-3 text-danger-700 text-sm">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <div>
                <div className="font-medium">No se pudo lanzar la simulación</div>
                <div className="mt-1 text-xs">{humanizeError(state.message)}</div>
              </div>
            </div>
          </div>
        )}

        {state.kind === 'success' && (
          <div className="rounded-md border border-success-200 bg-success-50 p-3 text-sm text-success-700">
            <div className="font-medium">Simulación completada</div>
            <div className="mt-1 text-xs">
              {state.resumen.tripsProcesados} viajes analizados · {state.resumen.topNOverlapPct}% de
              coincidencia con el algoritmo actual
            </div>
            <div className="mt-1 text-neutral-700 text-xs">
              Mirá el detalle abajo seleccionando la simulación en la lista.
            </div>
          </div>
        )}
      </form>
    </section>
  );
}

/**
 * Traduce mensajes de error técnicos a algo entendible para el operador.
 * El backend devuelve códigos como "forbidden_platform_admin" — útil en
 * logs pero opaco en la UI.
 */
function humanizeError(raw: string): string {
  if (raw.includes('403') || raw.includes('forbidden_platform_admin')) {
    return 'Tu email no tiene permiso para acceder a esta sección. Si crees que es un error, pedile al equipo de infra que agregue tu email a la lista de administradores de plataforma.';
  }
  if (raw.includes('401')) {
    return 'Tu sesión expiró. Recargá la página para volver a iniciar sesión.';
  }
  if (raw.includes('400') || raw.toLowerCase().includes('validation')) {
    return 'Algún valor del formulario no es válido. Revisá las fechas y el límite de viajes.';
  }
  if (raw.includes('500') || raw.toLowerCase().includes('backtest_failed')) {
    return `La simulación falló del lado del servidor. Detalle: ${raw}`;
  }
  return raw;
}

function PesoInput({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-start gap-2 text-xs">
      <div className="w-36 shrink-0 pt-1">
        <div className="text-neutral-700">{label}</div>
        {hint && <div className="text-neutral-500 text-[10px] leading-tight">{hint}</div>}
      </div>
      <input
        type="number"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-20 rounded-md border border-neutral-300 px-2 py-1 text-sm focus:border-primary-500 focus:outline-none"
      />
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 flex-1"
        aria-label={`Peso de ${label}`}
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Lista de corridas
// ---------------------------------------------------------------------------

function RunsList({
  runs,
  loading,
  error,
  selectedRunId,
  onSelect,
  onRefresh,
}: {
  runs: RunListItem[];
  loading: boolean;
  error: string | null;
  selectedRunId: string | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
}) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-neutral-900">Simulaciones recientes</h2>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="text-primary-700 text-xs hover:underline disabled:opacity-50"
        >
          {loading ? 'Cargando…' : 'Actualizar'}
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-danger-200 bg-danger-50 p-3 text-danger-700 text-sm">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{humanizeError(error)}</span>
          </div>
        </div>
      )}

      {runs.length === 0 && !loading && !error && (
        <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-4 text-center text-neutral-600 text-sm">
          Todavía no se hizo ninguna simulación. Lanza la primera desde el formulario de la
          izquierda.
        </div>
      )}

      {runs.length > 0 && (
        <ul className="mt-3 divide-y divide-neutral-200">
          {runs.map((run) => (
            <li key={run.id}>
              <button
                type="button"
                onClick={() => onSelect(run.id)}
                className={`flex w-full items-center justify-between gap-3 px-2 py-3 text-left hover:bg-neutral-50 ${
                  selectedRunId === run.id ? 'bg-primary-50' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <EstadoBadge estado={run.estado} />
                    <span className="text-neutral-500 text-xs">
                      <Clock className="mr-1 inline h-3 w-3" aria-hidden />
                      {formatTimestamp(run.createdAt)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-neutral-700 text-sm">
                    {run.tripsProcesados > 0
                      ? `${run.tripsProcesados.toLocaleString('es-CL')} viajes analizados`
                      : 'Aún en proceso…'}
                  </div>
                  {run.resumenPreview && (
                    <div className="mt-1 text-neutral-500 text-xs">
                      <strong>{run.resumenPreview.topNOverlapPct}%</strong> coincide con el
                      algoritmo actual
                      {run.resumenPreview.scoreDeltaAvg !== 0 && (
                        <>
                          {' '}
                          · cambio promedio de puntaje{' '}
                          {formatDelta(run.resumenPreview.scoreDeltaAvg)}
                        </>
                      )}
                    </div>
                  )}
                  <div className="mt-0.5 text-neutral-400 text-xs">por {run.createdByEmail}</div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-CL', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatDelta(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(3)}`;
}

function EstadoBadge({ estado }: { estado: string }) {
  const styles: Record<string, string> = {
    pendiente: 'bg-neutral-100 text-neutral-700',
    ejecutando: 'bg-primary-100 text-primary-700',
    completada: 'bg-success-100 text-success-700',
    fallida: 'bg-danger-100 text-danger-700',
  };
  const labels: Record<string, string> = {
    pendiente: 'En cola',
    ejecutando: 'Procesando',
    completada: 'Lista',
    fallida: 'Falló',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium text-xs ${styles[estado] ?? 'bg-neutral-100 text-neutral-700'}`}
    >
      {labels[estado] ?? estado}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Detalle de corrida
// ---------------------------------------------------------------------------

function RunDetailView({
  run,
  loading,
}: {
  run: RunDetail | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <section className="rounded-lg border border-neutral-200 bg-white p-8 text-center shadow-sm">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-neutral-400" aria-hidden />
        <p className="mt-2 text-neutral-600 text-sm">Cargando detalle…</p>
      </section>
    );
  }
  if (!run) {
    return null;
  }

  if (run.errorMessage) {
    return (
      <section className="rounded-lg border border-danger-200 bg-danger-50 p-5">
        <h2 className="font-semibold text-danger-900">No pudimos cargar esta simulación</h2>
        <p className="mt-2 text-danger-700 text-sm">{humanizeError(run.errorMessage)}</p>
      </section>
    );
  }

  const resumen = run.metricasResumen;

  return (
    <section className="space-y-5">
      <header className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-neutral-900">Detalle de la simulación</h2>
            <div className="mt-1 text-neutral-600 text-xs">
              Lanzada por <strong>{run.createdByEmail}</strong> el {formatTimestamp(run.createdAt)}
            </div>
          </div>
          <EstadoBadge estado={run.estado} />
        </div>
        {run.pesosUsados && (
          <div className="mt-3">
            <div className="mb-2 text-neutral-600 text-xs">Pesos usados en esta simulación:</div>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <PesoChip label="Capacidad ajustada" value={run.pesosUsados.capacidad} />
              <PesoChip label="Viaje de retorno" value={run.pesosUsados.backhaul} />
              <PesoChip label="Reputación" value={run.pesosUsados.reputacion} />
              <PesoChip label="Tier de membresía" value={run.pesosUsados.tier} />
            </div>
          </div>
        )}
      </header>

      {resumen && (
        <>
          <ResumenCards resumen={resumen} />
          <MoversPanel
            favorecidas={resumen.empresasFavorecidas}
            perjudicadas={resumen.empresasPerjudicadas}
          />
          <DistribucionScores distribucion={resumen.distribucionScoresV2} />
        </>
      )}

      {run.resultados && run.resultados.length > 0 && (
        <ResultadosTable resultados={run.resultados} />
      )}
    </section>
  );
}

function PesoChip({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="rounded-md bg-neutral-100 px-2 py-1.5">
      <div className="text-neutral-500 text-[10px] leading-tight">{label}</div>
      <div className="font-semibold text-neutral-900 text-sm">{pct}%</div>
    </div>
  );
}

function ResumenCards({ resumen }: { resumen: MetricasResumen }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <MetricCard
        label="Viajes analizados"
        value={resumen.tripsProcesados.toLocaleString('es-CL')}
        hint={
          resumen.tripsConCandidatosV2 === resumen.tripsProcesados
            ? 'todos con transportistas elegibles'
            : `${resumen.tripsConCandidatosV2.toLocaleString('es-CL')} con transportistas elegibles`
        }
      />
      <MetricCard
        label="Coincidencia con algoritmo actual"
        value={`${Math.round(resumen.topNOverlapPct)}%`}
        hint={
          resumen.topNOverlapPct >= 70
            ? 'muy similar — bajo riesgo de cambio brusco'
            : resumen.topNOverlapPct >= 40
              ? 'moderada — el nuevo algoritmo elige distinto en varios casos'
              : 'baja — cambia mucho la selección de transportistas'
        }
        tone={resumen.topNOverlapPct >= 40 ? 'positive' : 'negative'}
      />
      <MetricCard
        label="Cambio promedio de puntaje"
        value={formatDelta(resumen.scoreDeltaAvg)}
        hint={
          resumen.scoreDeltaAvg > 0.02
            ? 'el algoritmo nuevo asigna a transportistas mejor calificados'
            : resumen.scoreDeltaAvg < -0.02
              ? 'el algoritmo nuevo asigna a transportistas peor calificados'
              : 'casi sin diferencia'
        }
        tone={resumen.scoreDeltaAvg >= 0 ? 'positive' : 'negative'}
      />
      <MetricCard
        label="Viajes con retorno aprovechado"
        value={`${Math.round(resumen.backhaulHitRatePct)}%`}
        hint={
          resumen.backhaulHitRatePct >= 20
            ? 'el algoritmo nuevo aprovecha viajes de retorno'
            : 'pocos transportistas tienen viaje de retorno disponible'
        }
        tone={resumen.backhaulHitRatePct >= 20 ? 'positive' : undefined}
      />
    </div>
  );
}

function MetricCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
  tone?: 'positive' | 'negative' | undefined;
}) {
  const tones: Record<string, string> = {
    positive: 'border-success-200 bg-success-50',
    negative: 'border-amber-200 bg-amber-50',
  };
  return (
    <div
      className={`rounded-lg border p-4 shadow-sm ${tone ? tones[tone] : 'border-neutral-200 bg-white'}`}
    >
      <div className="text-neutral-600 text-xs">{label}</div>
      <div className="mt-1 font-bold font-mono text-2xl text-neutral-900">{value}</div>
      {hint && <div className="mt-1 text-neutral-500 text-xs">{hint}</div>}
    </div>
  );
}

function MoversPanel({
  favorecidas,
  perjudicadas,
}: {
  favorecidas: MetricasResumen['empresasFavorecidas'];
  perjudicadas: MetricasResumen['empresasPerjudicadas'];
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <div className="rounded-lg border border-success-200 bg-white p-4 shadow-sm">
        <h3 className="flex items-center gap-2 font-semibold text-neutral-900 text-sm">
          <TrendingUp className="h-4 w-4 text-success-700" aria-hidden />
          Transportistas que reciben más ofertas
        </h3>
        <p className="mt-1 text-neutral-500 text-xs">
          Con el algoritmo nuevo, estos transportistas recibirían más ofertas que hoy.
        </p>
        {favorecidas.length === 0 ? (
          <p className="mt-3 text-neutral-500 text-xs">
            Ningún transportista gana ofertas adicionales en esta simulación.
          </p>
        ) : (
          <ul className="mt-3 space-y-1.5 text-sm">
            {favorecidas.map((e) => (
              <li key={e.empresaId} className="flex items-center justify-between">
                <span className="font-mono text-neutral-700 text-xs">
                  {e.empresaId.slice(0, 12)}…
                </span>
                <span className="font-semibold text-success-700">
                  +{e.delta} {e.delta === 1 ? 'oferta' : 'ofertas'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="rounded-lg border border-amber-200 bg-white p-4 shadow-sm">
        <h3 className="flex items-center gap-2 font-semibold text-neutral-900 text-sm">
          <TrendingDown className="h-4 w-4 text-amber-700" aria-hidden />
          Transportistas que reciben menos ofertas
        </h3>
        <p className="mt-1 text-neutral-500 text-xs">
          Con el algoritmo nuevo, estos transportistas recibirían menos ofertas que hoy.
        </p>
        {perjudicadas.length === 0 ? (
          <p className="mt-3 text-neutral-500 text-xs">
            Ningún transportista pierde ofertas en esta simulación.
          </p>
        ) : (
          <ul className="mt-3 space-y-1.5 text-sm">
            {perjudicadas.map((e) => (
              <li key={e.empresaId} className="flex items-center justify-between">
                <span className="font-mono text-neutral-700 text-xs">
                  {e.empresaId.slice(0, 12)}…
                </span>
                <span className="font-semibold text-amber-700">
                  {e.delta} {e.delta === -1 ? 'oferta' : 'ofertas'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function DistribucionScores({ distribucion }: { distribucion: Record<string, number> }) {
  // Buckets internos del backend: '0-200' → '800-1000' (score × 1000).
  // Renombramos para el operador en términos de "nivel de match".
  const niveles: Array<{ key: string; label: string }> = [
    { key: '0-200', label: 'Bajo' },
    { key: '200-400', label: 'Medio-bajo' },
    { key: '400-600', label: 'Medio' },
    { key: '600-800', label: 'Bueno' },
    { key: '800-1000', label: 'Excelente' },
  ];
  const total = Object.values(distribucion).reduce((a, b) => a + b, 0);

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <h3 className="font-semibold text-neutral-900 text-sm">
        Qué tan buenos son los matches que produce el algoritmo nuevo
      </h3>
      <p className="mt-1 text-neutral-500 text-xs">
        Cuántas ofertas caen en cada nivel de calidad de match (más a la derecha = mejor match entre
        carga y transportista).
      </p>
      <div className="mt-3 space-y-2">
        {niveles.map(({ key, label }) => {
          const count = distribucion[key] ?? 0;
          const pct = total > 0 ? (count / total) * 100 : 0;
          return (
            <div key={key}>
              <div className="flex items-center justify-between text-xs">
                <span className="text-neutral-700">{label}</span>
                <span className="text-neutral-500">
                  {count.toLocaleString('es-CL')} ofertas ({pct.toFixed(1)}%)
                </span>
              </div>
              <div className="mt-0.5 h-2 overflow-hidden rounded-full bg-neutral-100">
                <div className="h-full bg-primary-500" style={{ width: `${Math.max(pct, 1)}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ResultadosTable({ resultados }: { resultados: ResultadoTrip[] }) {
  const [expanded, setExpanded] = useState(false);
  const visibles = expanded ? resultados : resultados.slice(0, 10);

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-neutral-900 text-sm">
          Detalle viaje por viaje ({resultados.length.toLocaleString('es-CL')})
        </h3>
        {resultados.length > 10 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 text-primary-700 text-xs hover:underline"
          >
            {expanded ? 'Mostrar primeros 10' : `Ver todos (${resultados.length})`}
            <ChevronDown
              className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
              aria-hidden
            />
          </button>
        )}
      </div>
      <p className="mt-1 text-neutral-500 text-xs">
        Cada fila es un viaje pasado y muestra cómo coinciden los algoritmos. "Coincidencia" es
        cuántos de los transportistas que elegiría el algoritmo nuevo también los elegiría el
        actual.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-neutral-200 border-b text-neutral-500 text-xs">
              <th className="py-2 text-left">Viaje</th>
              <th className="py-2 text-left">Región origen</th>
              <th className="py-2 text-right">Peso de carga</th>
              <th className="py-2 text-right">Transportistas elegibles</th>
              <th className="py-2 text-right">Coincidencia</th>
              <th className="py-2 text-right">Cambio de puntaje</th>
              <th className="py-2 text-center">¿Aprovecha retorno?</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((r) => (
              <tr key={r.tripId} className="border-neutral-100 border-b">
                <td className="py-2 font-mono text-neutral-700 text-xs">{r.tripId.slice(0, 8)}…</td>
                <td className="py-2 text-neutral-700">{r.originRegionCode}</td>
                <td className="py-2 text-right text-neutral-700">
                  {r.cargoWeightKg.toLocaleString('es-CL')} kg
                </td>
                <td className="py-2 text-right text-neutral-700">{r.candidatosTotal}</td>
                <td className="py-2 text-right text-neutral-700">
                  {r.ofertasV2.length === 0 ? '—' : `${r.overlapEmpresas} de ${r.ofertasV2.length}`}
                </td>
                <td
                  className={`py-2 text-right ${
                    r.deltaScorePromedio > 0
                      ? 'text-success-700'
                      : r.deltaScorePromedio < 0
                        ? 'text-amber-700'
                        : 'text-neutral-500'
                  }`}
                >
                  {formatDelta(r.deltaScorePromedio)}
                </td>
                <td className="py-2 text-center">
                  {r.backhaulHit ? (
                    <span className="text-success-700" aria-label="sí">
                      Sí
                    </span>
                  ) : (
                    <span className="text-neutral-400" aria-label="no">
                      No
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
