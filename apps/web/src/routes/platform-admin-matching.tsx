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
 * /app/platform-admin/matching — UI para gestionar el matching engine v2
 * (ADR-033). Reservada a platform admins (allowlist en backend).
 *
 * Surface:
 *
 *   - Disparar corrida de backtest: fechas desde/hasta, tripsLimit,
 *     pesos custom opcionales (capacidad/backhaul/reputacion/tier).
 *   - Lista de corridas recientes con preview de métricas clave.
 *   - Detalle de una corrida: resumen + tabla expandible de resultados
 *     por trip (overlap, score deltas, backhaul hits).
 *
 * El backend ya gateéa con BOOSTER_PLATFORM_ADMIN_EMAILS — la UI muestra
 * error claro si el usuario no está en la lista.
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
              <div className="font-semibold text-neutral-900">Booster · Matching Engine v2</div>
              <div className="text-neutral-500 text-xs">Backtest v1 vs v2 (ADR-033)</div>
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
          Matching engine v2 · Backtest
        </h1>
        <p className="mt-2 max-w-3xl text-neutral-600 text-sm">
          Replay del scoring sobre trips históricos para comparar la distribución de ofertas del
          algoritmo v1 (capacity-only) con v2 (multi-factor con backhaul awareness). Las señales v2
          usan el estado actual de la BD — útil para evaluar pesos antes de activar el flag, no para
          análisis estadístico riguroso.
        </p>

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
        message: `Pesos deben sumar 1.0 (suma actual: ${pesosSum.toFixed(2)})`,
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
          <h2 className="font-semibold text-neutral-900">Disparar corrida</h2>
          <p className="mt-1 text-neutral-600 text-sm">
            Sets de 500 trips corren en &lt; 30 segundos. Hard-cap 5000.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mt-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="text-neutral-700">Trips desde</span>
            <input
              type="date"
              value={tripsDesde}
              onChange={(e) => setTripsDesde(e.target.value)}
              className="mt-1 block w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </label>
          <label className="block text-sm">
            <span className="text-neutral-700">Trips hasta</span>
            <input
              type="date"
              value={tripsHasta}
              onChange={(e) => setTripsHasta(e.target.value)}
              className="mt-1 block w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </label>
        </div>

        <label className="block text-sm">
          <span className="text-neutral-700">Límite de trips (1-5000)</span>
          <input
            type="number"
            min={1}
            max={5000}
            value={tripsLimit}
            onChange={(e) => setTripsLimit(Number(e.target.value) || 500)}
            className="mt-1 block w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </label>

        <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={useCustomPesos}
              onChange={(e) => setUseCustomPesos(e.target.checked)}
              className="rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
            />
            <Settings2 className="h-4 w-4 text-neutral-600" aria-hidden />
            <span className="font-medium text-neutral-700">Pesos custom (A/B test)</span>
          </label>

          {useCustomPesos && (
            <div className="mt-3 space-y-2">
              <PesoInput
                label="Capacidad"
                value={pesos.capacidad}
                onChange={(v) => setPesos({ ...pesos, capacidad: v })}
              />
              <PesoInput
                label="Backhaul"
                value={pesos.backhaul}
                onChange={(v) => setPesos({ ...pesos, backhaul: v })}
              />
              <PesoInput
                label="Reputación"
                value={pesos.reputacion}
                onChange={(v) => setPesos({ ...pesos, reputacion: v })}
              />
              <PesoInput
                label="Tier"
                value={pesos.tier}
                onChange={(v) => setPesos({ ...pesos, tier: v })}
              />
              <div className={`text-xs ${pesosValid ? 'text-success-700' : 'text-danger-700'}`}>
                Suma: {pesosSum.toFixed(3)} {pesosValid ? '✓' : '(debe ser 1.000)'}
              </div>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={state.kind === 'loading'}
          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-50"
          data-testid="run-backtest-button"
        >
          {state.kind === 'loading' ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Ejecutando backtest…
            </>
          ) : (
            <>
              <PlayCircle className="h-4 w-4" aria-hidden />
              Ejecutar backtest
            </>
          )}
        </button>

        {state.kind === 'error' && (
          <div className="rounded-md border border-danger-200 bg-danger-50 p-3 text-danger-700 text-sm">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <div>
                <div className="font-medium">No se pudo ejecutar</div>
                <div className="mt-1 font-mono text-xs">{state.message}</div>
                {state.message.includes('403') && (
                  <div className="mt-2 text-xs">
                    Tu email no está en <code>BOOSTER_PLATFORM_ADMIN_EMAILS</code>.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {state.kind === 'success' && (
          <div className="rounded-md border border-success-200 bg-success-50 p-3 text-sm text-success-700">
            <div className="font-medium">Corrida {state.id.slice(0, 8)}… completada</div>
            <div className="mt-1 text-xs">
              {state.resumen.tripsProcesados} trips · Overlap {state.resumen.topNOverlapPct}% ·
              Δscore avg {state.resumen.scoreDeltaAvg.toFixed(3)}
            </div>
          </div>
        )}
      </form>
    </section>
  );
}

function PesoInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-20 shrink-0 text-neutral-600">{label}</span>
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
        className="flex-1"
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
        <h2 className="font-semibold text-neutral-900">Corridas recientes</h2>
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
          <AlertTriangle className="mr-1 inline h-4 w-4" aria-hidden />
          {error}
        </div>
      )}

      {runs.length === 0 && !loading && !error && (
        <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-4 text-center text-neutral-600 text-sm">
          Sin corridas todavía. Lanza la primera desde el formulario.
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
                    <span className="font-mono text-neutral-700 text-xs">
                      {run.id.slice(0, 8)}…
                    </span>
                    <EstadoBadge estado={run.estado} />
                  </div>
                  <div className="mt-0.5 text-neutral-500 text-xs">
                    <Clock className="mr-1 inline h-3 w-3" aria-hidden />
                    {new Date(run.createdAt).toLocaleString('es-CL')} · {run.createdByEmail}
                  </div>
                  {run.resumenPreview && (
                    <div className="mt-1 text-neutral-700 text-xs">
                      <strong>{run.tripsProcesados}</strong> trips · overlap{' '}
                      {run.resumenPreview.topNOverlapPct}% · Δavg{' '}
                      {run.resumenPreview.scoreDeltaAvg.toFixed(3)}
                    </div>
                  )}
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

function EstadoBadge({ estado }: { estado: string }) {
  const styles: Record<string, string> = {
    pendiente: 'bg-neutral-100 text-neutral-700',
    ejecutando: 'bg-primary-100 text-primary-700',
    completada: 'bg-success-100 text-success-700',
    fallida: 'bg-danger-100 text-danger-700',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium text-xs ${styles[estado] ?? 'bg-neutral-100 text-neutral-700'}`}
    >
      {estado}
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
        <h2 className="font-semibold text-danger-900">Error en corrida {run.id.slice(0, 8)}…</h2>
        <p className="mt-2 font-mono text-danger-700 text-xs">{run.errorMessage}</p>
      </section>
    );
  }

  const resumen = run.metricasResumen;

  return (
    <section className="space-y-5">
      <header className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-neutral-900">Detalle · {run.id.slice(0, 8)}…</h2>
            <div className="mt-1 text-neutral-600 text-xs">
              Disparado por <strong>{run.createdByEmail}</strong> el{' '}
              {new Date(run.createdAt).toLocaleString('es-CL')}
            </div>
          </div>
          <EstadoBadge estado={run.estado} />
        </div>
        {run.pesosUsados && (
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <PesoChip label="Capacidad" value={run.pesosUsados.capacidad} />
            <PesoChip label="Backhaul" value={run.pesosUsados.backhaul} />
            <PesoChip label="Reputación" value={run.pesosUsados.reputacion} />
            <PesoChip label="Tier" value={run.pesosUsados.tier} />
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
  return (
    <div className="rounded-md bg-neutral-100 px-2 py-1">
      <div className="text-neutral-500 text-xs">{label}</div>
      <div className="font-mono font-semibold text-neutral-900 text-sm">{value.toFixed(2)}</div>
    </div>
  );
}

function ResumenCards({ resumen }: { resumen: MetricasResumen }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <MetricCard
        label="Trips procesados"
        value={resumen.tripsProcesados.toString()}
        hint={`${resumen.tripsConCandidatosV2} con candidatos v2`}
      />
      <MetricCard
        label="Overlap top-N"
        value={`${resumen.topNOverlapPct.toFixed(1)}%`}
        hint="empresas comunes v1 vs v2"
      />
      <MetricCard
        label="Δ score promedio"
        value={resumen.scoreDeltaAvg.toFixed(3)}
        hint={resumen.scoreDeltaAvg >= 0 ? 'v2 puntúa más alto' : 'v2 puntúa más bajo'}
        tone={resumen.scoreDeltaAvg >= 0 ? 'positive' : 'negative'}
      />
      <MetricCard
        label="Backhaul hits"
        value={`${resumen.backhaulHitRatePct.toFixed(1)}%`}
        hint="trips con carrier de retorno"
        tone="positive"
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
  hint?: string;
  tone?: 'positive' | 'negative';
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
          Empresas favorecidas
        </h3>
        {favorecidas.length === 0 ? (
          <p className="mt-2 text-neutral-500 text-xs">Ninguna empresa ganó slots adicionales.</p>
        ) : (
          <ul className="mt-2 space-y-1.5 text-sm">
            {favorecidas.map((e) => (
              <li key={e.empresaId} className="flex items-center justify-between">
                <span className="font-mono text-neutral-700 text-xs">
                  {e.empresaId.slice(0, 12)}…
                </span>
                <span className="font-semibold text-success-700">+{e.delta}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="rounded-lg border border-amber-200 bg-white p-4 shadow-sm">
        <h3 className="flex items-center gap-2 font-semibold text-neutral-900 text-sm">
          <TrendingDown className="h-4 w-4 text-amber-700" aria-hidden />
          Empresas perjudicadas
        </h3>
        {perjudicadas.length === 0 ? (
          <p className="mt-2 text-neutral-500 text-xs">Ninguna empresa perdió slots.</p>
        ) : (
          <ul className="mt-2 space-y-1.5 text-sm">
            {perjudicadas.map((e) => (
              <li key={e.empresaId} className="flex items-center justify-between">
                <span className="font-mono text-neutral-700 text-xs">
                  {e.empresaId.slice(0, 12)}…
                </span>
                <span className="font-semibold text-amber-700">{e.delta}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function DistribucionScores({ distribucion }: { distribucion: Record<string, number> }) {
  const buckets = ['0-200', '200-400', '400-600', '600-800', '800-1000'];
  const total = Object.values(distribucion).reduce((a, b) => a + b, 0);

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <h3 className="font-semibold text-neutral-900 text-sm">Distribución de scores v2</h3>
      <p className="mt-1 text-neutral-500 text-xs">
        Cuenta de ofertas v2 por bucket de score (×1000).
      </p>
      <div className="mt-3 space-y-2">
        {buckets.map((bucket) => {
          const count = distribucion[bucket] ?? 0;
          const pct = total > 0 ? (count / total) * 100 : 0;
          return (
            <div key={bucket}>
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-neutral-700">{bucket}</span>
                <span className="text-neutral-500">
                  {count} ({pct.toFixed(1)}%)
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
          Detalle por trip ({resultados.length})
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
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-neutral-200 border-b text-neutral-500 text-xs">
              <th className="py-2 text-left">Trip</th>
              <th className="py-2 text-left">Origen</th>
              <th className="py-2 text-right">Carga (kg)</th>
              <th className="py-2 text-right">Candidatos</th>
              <th className="py-2 text-right">Overlap</th>
              <th className="py-2 text-right">Δ score</th>
              <th className="py-2 text-center">Backhaul</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((r) => (
              <tr key={r.tripId} className="border-neutral-100 border-b">
                <td className="py-2 font-mono text-neutral-700 text-xs">{r.tripId.slice(0, 8)}…</td>
                <td className="py-2 text-neutral-700">{r.originRegionCode}</td>
                <td className="py-2 text-right font-mono text-neutral-700">
                  {r.cargoWeightKg.toLocaleString('es-CL')}
                </td>
                <td className="py-2 text-right font-mono text-neutral-700">{r.candidatosTotal}</td>
                <td className="py-2 text-right">
                  <span className="font-mono text-neutral-700">
                    {r.overlapEmpresas}/{r.ofertasV2.length}
                  </span>
                </td>
                <td
                  className={`py-2 text-right font-mono ${
                    r.deltaScorePromedio >= 0 ? 'text-success-700' : 'text-amber-700'
                  }`}
                >
                  {r.deltaScorePromedio >= 0 ? '+' : ''}
                  {r.deltaScorePromedio.toFixed(3)}
                </td>
                <td className="py-2 text-center">
                  {r.backhaulHit ? (
                    <span className="text-success-700">✓</span>
                  ) : (
                    <span className="text-neutral-300">—</span>
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
