import { Link } from '@tanstack/react-router';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  LogOut,
  PlayCircle,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { signOutUser } from '../hooks/use-auth.js';
import { ApiError, api } from '../lib/api-client.js';

/**
 * /app/platform-admin — surface dedicada para operaciones de admin de
 * plataforma de Booster (no admin de empresa). Reemplaza la fricción de
 * "abrir DevTools y pegar un snippet" con botones reales.
 *
 * Audiencia: emails en `BOOSTER_PLATFORM_ADMIN_EMAILS` del backend.
 * El allowlist se valida server-side; si el user no está, los endpoints
 * devuelven 403 y la UI muestra error claro.
 *
 * Auth: `meRequirement="skip"` — sólo requiere Firebase auth, no requiere
 * que el user tenga membership ni empresa onboarded. Esto permite que el
 * admin (que típicamente no tiene empresa propia) entre directo sin pasar
 * por el flujo de onboarding.
 */

interface SeedCredentials {
  shipper_owner: { email: string; password: string };
  carrier_owner: { email: string; password: string };
  stakeholder: { email: string; password: string };
  conductor: { rut: string; activation_pin: string | null };
  carrier_empresa_id: string;
  shipper_empresa_id: string;
  vehicle_with_mirror_id: string;
  vehicle_without_device_id: string;
}

interface SeedResponse {
  ok: true;
  credentials: SeedCredentials;
}

interface DeleteResponse {
  ok: true;
  empresas_eliminadas: number;
}

export function PlatformAdminRoute() {
  return <ProtectedRoute meRequirement="skip">{() => <PlatformAdminPage />}</ProtectedRoute>;
}

function PlatformAdminPage() {
  const [seedState, setSeedState] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'success'; data: SeedCredentials }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });
  const [cleanState, setCleanState] = useState<
    | { kind: 'idle' }
    | { kind: 'confirm' }
    | { kind: 'loading' }
    | { kind: 'success'; count: number }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  async function handleSeed() {
    setSeedState({ kind: 'loading' });
    try {
      const res = await api.post<SeedResponse>('/admin/seed/demo', {});
      setSeedState({ kind: 'success', data: res.credentials });
      // Si había estado de limpieza visible, limpiarlo.
      setCleanState({ kind: 'idle' });
    } catch (err) {
      const msg =
        err instanceof ApiError ? `${err.status}: ${err.message}` : (err as Error).message;
      setSeedState({ kind: 'error', message: msg });
    }
  }

  async function handleClean() {
    setCleanState({ kind: 'loading' });
    try {
      const res = await api.delete<DeleteResponse>('/admin/seed/demo');
      setCleanState({ kind: 'success', count: res.empresas_eliminadas });
      setSeedState({ kind: 'idle' });
    } catch (err) {
      const msg =
        err instanceof ApiError ? `${err.status}: ${err.message}` : (err as Error).message;
      setCleanState({ kind: 'error', message: msg });
    }
  }

  async function handleSignOut() {
    await signOutUser();
  }

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <header className="border-neutral-200 border-b bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-100 text-primary-700">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="font-semibold text-neutral-900">Booster · Platform Admin</div>
              <div className="text-neutral-500 text-xs">Operaciones internas de plataforma</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/login"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-neutral-700 text-sm transition hover:bg-neutral-100"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Volver al login normal
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

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">Demo end-to-end</h1>
            <p className="mt-2 max-w-2xl text-neutral-600 text-sm">
              Inicializa o limpia el set de demo en producción. El seed crea 4 usuarios sintéticos
              (shipper, carrier, stakeholder, conductor) + 2 vehículos del carrier (uno con IMEI
              espejo al Teltonika real de Van Oosterwyk, otro sin device para reporte GPS móvil). Es
              idempotente — re-ejecutar no duplica entidades.
            </p>
          </div>
          <Link
            to="/app/platform-admin/matching"
            className="inline-flex shrink-0 items-center gap-2 rounded-md border border-primary-300 bg-primary-50 px-3 py-2 font-medium text-primary-700 text-sm hover:bg-primary-100"
            data-testid="matching-backtest-link"
          >
            Matching v2 backtest →
          </Link>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
          <SeedCard onSeed={handleSeed} state={seedState} />
          <CleanCard onClean={handleClean} state={cleanState} setState={setCleanState} />
        </div>

        {seedState.kind === 'success' && <CredentialsPanel data={seedState.data} />}

        <details className="mt-8 rounded-lg border border-neutral-200 bg-white p-4 text-sm">
          <summary className="cursor-pointer font-medium text-neutral-900">
            ¿Qué crea exactamente el seed?
          </summary>
          <div className="mt-3 space-y-2 text-neutral-700">
            <div>
              <strong>Empresas sintéticas (is_demo=true)</strong>:
              <ul className="mt-1 ml-4 list-disc">
                <li>
                  Andina Demo S.A. (shipper) · RUT 76999111-1 · 2 sucursales (Maipú, Quilicura)
                </li>
                <li>
                  Transportes Demo Sur S.A. (carrier) · RUT 77888222-K · 2 vehículos (DEMO01,
                  DEMO02) · 1 conductor
                </li>
              </ul>
            </div>
            <div>
              <strong>Usuarios Firebase</strong>: dueños shipper/carrier y stakeholder con login
              email + password. El conductor usa RUT + PIN (D9). Todos los emails y RUTs vienen
              listados arriba tras la ejecución.
            </div>
            <div>
              <strong>Vehículo DEMO01</strong>: tiene{' '}
              <code className="rounded bg-neutral-100 px-1">
                teltonika_imei_espejo='863238075489155'
              </code>{' '}
              (el IMEI del Teltonika real de Van Oosterwyk). La data en vivo se refleja en este
              vehículo sin tocar a Van Oosterwyk. Reversa: la columna se setea NULL y el espejo
              desaparece.
            </div>
            <div>
              <strong>Limpieza</strong>: borra todas las empresas con is_demo=true + cascada por FK
              (vehículos, conductores, sucursales, memberships, users-conductores sin otras
              memberships). Van Oosterwyk queda intocado.
            </div>
          </div>
        </details>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card: inicializar seed
// ---------------------------------------------------------------------------

function SeedCard({
  onSeed,
  state,
}: {
  onSeed: () => void;
  state:
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'success'; data: SeedCredentials }
    | { kind: 'error'; message: string };
}) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-success-50 text-success-700">
          <PlayCircle className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h2 className="font-semibold text-neutral-900">Inicializar demo</h2>
          <p className="mt-1 text-neutral-600 text-sm">
            Crea las empresas, usuarios y vehículos del demo. Idempotente — corrida múltiples veces
            no duplica.
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={onSeed}
        disabled={state.kind === 'loading'}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-50"
        data-testid="seed-button"
      >
        {state.kind === 'loading' ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Creando entidades…
          </>
        ) : state.kind === 'success' ? (
          <>
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            Seed ejecutado · re-ejecutar
          </>
        ) : (
          <>
            <PlayCircle className="h-4 w-4" aria-hidden />
            Ejecutar seed
          </>
        )}
      </button>

      {state.kind === 'error' && (
        <div className="mt-3 rounded-md border border-danger-200 bg-danger-50 p-3 text-danger-700 text-sm">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div>
              <div className="font-medium">No se pudo ejecutar el seed</div>
              <div className="mt-1 font-mono text-xs">{state.message}</div>
              {state.message.includes('403') && (
                <div className="mt-2 text-xs">
                  Tu email no está en <code>BOOSTER_PLATFORM_ADMIN_EMAILS</code>. Avisa al equipo de
                  infra para agregarlo.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {state.kind === 'success' && (
        <div className="mt-3 rounded-md border border-success-200 bg-success-50 p-3 text-sm text-success-700">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Demo creada. Credenciales abajo.
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Card: limpiar demo
// ---------------------------------------------------------------------------

function CleanCard({
  onClean,
  state,
  setState,
}: {
  onClean: () => void;
  state:
    | { kind: 'idle' }
    | { kind: 'confirm' }
    | { kind: 'loading' }
    | { kind: 'success'; count: number }
    | { kind: 'error'; message: string };
  setState: (s: { kind: 'idle' } | { kind: 'confirm' }) => void;
}) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-danger-50 text-danger-700">
          <Trash2 className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h2 className="font-semibold text-neutral-900">Limpiar demo</h2>
          <p className="mt-1 text-neutral-600 text-sm">
            Borra todas las empresas con <code>is_demo=true</code> + cascada (vehículos,
            conductores, etc.). Van Oosterwyk queda intocado.
          </p>
        </div>
      </div>

      {state.kind === 'idle' && (
        <button
          type="button"
          onClick={() => setState({ kind: 'confirm' })}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md border border-danger-300 px-4 py-2 font-medium text-danger-700 text-sm hover:bg-danger-50"
          data-testid="clean-button"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          Borrar demo
        </button>
      )}

      {state.kind === 'confirm' && (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
          <div className="text-amber-900">
            ¿Confirmas borrar todas las entidades demo? Esta acción no se puede deshacer.
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={onClean}
              className="flex-1 rounded-md bg-danger-600 px-3 py-2 font-medium text-sm text-white hover:bg-danger-700"
              data-testid="clean-confirm"
            >
              Sí, borrar
            </button>
            <button
              type="button"
              onClick={() => setState({ kind: 'idle' })}
              className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-neutral-700 text-sm hover:bg-neutral-100"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {state.kind === 'loading' && (
        <div className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-neutral-100 px-4 py-2 text-neutral-700 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Borrando…
        </div>
      )}

      {state.kind === 'success' && (
        <div className="mt-3 rounded-md border border-success-200 bg-success-50 p-3 text-sm text-success-700">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Eliminadas <strong>{state.count}</strong> empresas demo + cascada.
          </div>
        </div>
      )}

      {state.kind === 'error' && (
        <div className="mt-3 rounded-md border border-danger-200 bg-danger-50 p-3 text-danger-700 text-sm">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div>
              <div className="font-medium">No se pudo borrar</div>
              <div className="mt-1 font-mono text-xs">{state.message}</div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Panel: credenciales
// ---------------------------------------------------------------------------

function CredentialsPanel({ data }: { data: SeedCredentials }) {
  return (
    <section className="mt-8 space-y-3">
      <h2 className="font-semibold text-neutral-900 text-xl">Credenciales del demo</h2>
      <p className="text-neutral-600 text-sm">
        Usa estas credenciales en pestañas distintas (idealmente ventanas privadas/incógnito) para
        ver cada rol. El PIN del conductor solo se muestra ahora — anótalo o cópialo.
      </p>

      <CredCard
        title="Shipper · Andina Demo S.A."
        subtitle="generador de carga · puede crear sucursales, publicar ofertas, ver certificados GLEC"
        loginUrl="/login"
        rows={[
          { label: 'Email', value: data.shipper_owner.email },
          { label: 'Password', value: data.shipper_owner.password, mono: true },
        ]}
      />

      <CredCard
        title="Carrier · Transportes Demo Sur S.A."
        subtitle="transportista · gestión de flota, conductores, asignaciones, cumplimiento"
        loginUrl="/login"
        rows={[
          { label: 'Email', value: data.carrier_owner.email },
          { label: 'Password', value: data.carrier_owner.password, mono: true },
        ]}
      />

      <CredCard
        title="Stakeholder · Mesa pública sostenibilidad"
        subtitle="acceso a dashboard de zonas de impacto (k-anonimizado)"
        loginUrl="/login"
        rows={[
          { label: 'Email', value: data.stakeholder.email },
          { label: 'Password', value: data.stakeholder.password, mono: true },
        ]}
      />

      <CredCard
        title="Conductor · Pedro González"
        subtitle="login dedicado por RUT + PIN · ver Modo Conductor, asignaciones, GPS móvil"
        loginUrl="/login/conductor"
        rows={[
          { label: 'RUT', value: data.conductor.rut, mono: true },
          {
            label: 'PIN de activación',
            value: data.conductor.activation_pin ?? '(ya activado · usar password)',
            mono: true,
            highlight: true,
          },
        ]}
        warning={
          data.conductor.activation_pin
            ? 'Anota o copia el PIN ahora — no se vuelve a mostrar. Si lo pierdes, re-ejecuta el seed.'
            : null
        }
      />

      <div className="mt-2 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-neutral-700 text-xs">
        <strong>IDs internos</strong> (para debug):
        <ul className="mt-1 space-y-0.5 font-mono">
          <li>shipper empresa: {data.shipper_empresa_id}</li>
          <li>carrier empresa: {data.carrier_empresa_id}</li>
          <li>vehicle DEMO01 (mirror IMEI): {data.vehicle_with_mirror_id}</li>
          <li>vehicle DEMO02 (sin device): {data.vehicle_without_device_id}</li>
        </ul>
      </div>
    </section>
  );
}

function CredCard({
  title,
  subtitle,
  loginUrl,
  rows,
  warning,
}: {
  title: string;
  subtitle: string;
  loginUrl: string;
  rows: { label: string; value: string; mono?: boolean; highlight?: boolean }[];
  warning?: string | null;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-neutral-900">{title}</h3>
          <p className="text-neutral-500 text-xs">{subtitle}</p>
        </div>
        <a
          href={loginUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 text-neutral-700 text-xs hover:bg-neutral-100"
        >
          Abrir login
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      </div>

      <dl className="mt-3 grid grid-cols-[100px_1fr_auto] gap-x-3 gap-y-1.5 text-sm">
        {rows.map((row) => (
          <CredRow key={row.label} {...row} />
        ))}
      </dl>

      {warning && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 text-xs">
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden />
          {warning}
        </div>
      )}
    </div>
  );
}

function CredRow({
  label,
  value,
  mono,
  highlight,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // no clipboard available — silent fail
    }
  }

  return (
    <>
      <dt className="text-neutral-500">{label}:</dt>
      <dd
        className={`${mono ? 'font-mono' : ''} ${
          highlight ? 'rounded bg-amber-100 px-2 font-bold text-amber-900' : 'text-neutral-900'
        } break-all`}
      >
        {value}
      </dd>
      <button
        type="button"
        onClick={handleCopy}
        className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-0.5 text-neutral-600 text-xs hover:bg-neutral-100"
        aria-label={`Copiar ${label}`}
      >
        <Copy className="h-3 w-3" aria-hidden />
        {copied ? '✓' : 'Copiar'}
      </button>
    </>
  );
}

// Stub para que TS no se queje del import si lo usamos defensivamente.
void ({} as ReactNode);
