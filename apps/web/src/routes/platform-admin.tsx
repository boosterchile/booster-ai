import {
  type OrganizacionStakeholder,
  STAKEHOLDER_ORG_TYPE_LABEL,
  type StakeholderOrgType,
} from '@booster-ai/shared-schemas';
import { Link } from '@tanstack/react-router';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  LogOut,
  PlayCircle,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
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
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link
              to="/app/platform-admin/matching"
              className="inline-flex items-center gap-2 rounded-md border border-primary-300 bg-primary-50 px-3 py-2 font-medium text-primary-700 text-sm hover:bg-primary-100"
              data-testid="matching-backtest-link"
            >
              Comparar algoritmo de asignación →
            </Link>
            <Link
              to="/app/platform-admin/observability"
              className="inline-flex items-center gap-2 rounded-md border border-primary-300 bg-primary-50 px-3 py-2 font-medium text-primary-700 text-sm hover:bg-primary-100"
              data-testid="observability-dashboard-link"
            >
              Observabilidad de plataforma →
            </Link>
          </div>
        </div>

        <div className="mt-4 flex items-start justify-between gap-4 rounded-lg border border-neutral-200 bg-white p-4">
          <div>
            <h3 className="font-semibold text-neutral-900">Configuración del sitio (ADR-039)</h3>
            <p className="mt-1 text-neutral-600 text-sm">
              Editor de marca y copy del demo landing (logo, hero, certificaciones, cards de
              personas). Cambios aplican en runtime con cache 5 min — sin redeploy.
            </p>
          </div>
          <Link
            to="/app/platform-admin/site-settings"
            className="inline-flex shrink-0 items-center gap-2 rounded-md border border-primary-300 bg-primary-50 px-3 py-2 font-medium text-primary-700 text-sm hover:bg-primary-100"
            data-testid="site-settings-link"
          >
            Editar sitio →
          </Link>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
          <SeedCard onSeed={handleSeed} state={seedState} />
          <CleanCard onClean={handleClean} state={cleanState} setState={setCleanState} />
        </div>

        {seedState.kind === 'success' && <CredentialsPanel data={seedState.data} />}

        <StakeholderOrgsSection />

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

// ---------------------------------------------------------------------------
// Sección: Organizaciones stakeholder (ADR-034)
// ---------------------------------------------------------------------------

interface StakeholderOrgsListResponse {
  organizations: OrganizacionStakeholder[];
}

function StakeholderOrgsSection() {
  const [orgs, setOrgs] = useState<OrganizacionStakeholder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<StakeholderOrgsListResponse>('/admin/stakeholder-orgs')
      .then((res) => {
        if (cancelled) {
          return;
        }
        setOrgs(res.organizations);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        const msg =
          err instanceof ApiError ? `${err.status}: ${err.message}` : (err as Error).message;
        setError(msg);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  function handleCreated() {
    setShowCreate(false);
    setRefreshTick((t) => t + 1);
  }

  return (
    <section className="mt-8 rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-primary-700" aria-hidden />
          <div>
            <h2 className="font-semibold text-neutral-900">Organizaciones stakeholder</h2>
            <p className="mt-1 max-w-2xl text-neutral-600 text-sm">
              Reguladores, gremios, observatorios académicos, ONGs y departamentos ESG corporativos
              que reciben datos agregados del marketplace (k-anonimidad ≥ 5). Alta solo desde aquí
              (ADR-034).
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-3 py-1.5 font-medium text-sm text-white hover:bg-primary-700"
          data-testid="stakeholder-org-create-toggle"
        >
          <Plus className="h-4 w-4" aria-hidden />
          {showCreate ? 'Cancelar' : 'Crear organización'}
        </button>
      </div>

      {showCreate && <CreateStakeholderOrgForm onCreated={handleCreated} />}

      <div className="mt-4">
        {loading && (
          <div className="inline-flex items-center gap-2 text-neutral-500 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Cargando organizaciones…
          </div>
        )}
        {error && (
          <div className="rounded-md border border-danger-200 bg-danger-50 p-3 text-danger-700 text-sm">
            {error}
          </div>
        )}
        {!loading && !error && orgs.length === 0 && (
          <p className="text-neutral-500 text-sm">
            No hay organizaciones stakeholder todavía. Crea la primera con el botón de arriba.
          </p>
        )}
        {!loading && !error && orgs.length > 0 && (
          <ul className="divide-y divide-neutral-100">
            {orgs.map((org) => (
              <StakeholderOrgRow key={org.id} org={org} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * Fila expandible de una organización stakeholder. Muestra resumen
 * compacto + on-click expande a panel con lista de miembros + form de
 * invitación. Cada panel se monta lazy (no carga miembros hasta que el
 * admin expande).
 */
interface StakeholderOrgMember {
  membership_id: string;
  user_id: string;
  rut: string | null;
  email: string;
  full_name: string;
  status: 'pendiente_invitacion' | 'activa' | 'suspendida' | 'removida';
  is_pending: boolean;
  invitado_en: string;
  unido_en: string | null;
}

interface StakeholderOrgDetailResponse extends OrganizacionStakeholder {
  miembros: StakeholderOrgMember[];
}

function StakeholderOrgRow({ org }: { org: OrganizacionStakeholder }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="py-3" data-testid={`stakeholder-org-row-${org.id}`}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start justify-between gap-3 text-left transition hover:bg-neutral-50"
        aria-expanded={expanded}
        aria-controls={`stakeholder-org-detail-${org.id}`}
        data-testid={`stakeholder-org-toggle-${org.id}`}
      >
        <div>
          <div className="font-medium text-neutral-900">{org.nombre_legal}</div>
          <div className="mt-0.5 text-neutral-500 text-xs">
            {STAKEHOLDER_ORG_TYPE_LABEL[org.tipo]}
            {org.region_ambito && ` · ${org.region_ambito}`}
            {org.sector_ambito && ` · ${org.sector_ambito}`}
            {org.eliminado_en && ' · ELIMINADA'}
          </div>
        </div>
        <div className="flex items-center gap-2 text-neutral-400 text-xs">
          {new Date(org.creado_en).toLocaleDateString('es-CL')}
          <span aria-hidden>{expanded ? '▾' : '▸'}</span>
        </div>
      </button>

      {expanded && !org.eliminado_en && (
        <div
          id={`stakeholder-org-detail-${org.id}`}
          className="mt-3 ml-1 border-neutral-100 border-l-2 pl-4"
        >
          <StakeholderOrgMembersPanel orgId={org.id} />
        </div>
      )}
    </li>
  );
}

function StakeholderOrgMembersPanel({ orgId }: { orgId: string }) {
  const [detail, setDetail] = useState<StakeholderOrgDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<StakeholderOrgDetailResponse>(`/admin/stakeholder-orgs/${orgId}`)
      .then((res) => {
        if (cancelled) {
          return;
        }
        setDetail(res);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        const msg =
          err instanceof ApiError ? `${err.status}: ${err.message}` : (err as Error).message;
        setError(msg);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, refreshTick]);

  function handleInvited() {
    setShowInvite(false);
    setRefreshTick((t) => t + 1);
  }

  if (loading) {
    return (
      <div className="inline-flex items-center gap-2 text-neutral-500 text-xs">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        Cargando miembros…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-danger-200 bg-danger-50 p-2 text-danger-700 text-xs">
        {error}
      </div>
    );
  }

  if (!detail) {
    return null;
  }

  return (
    <div data-testid={`stakeholder-org-members-${orgId}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-medium text-neutral-700 text-xs">
          Miembros ({detail.miembros.length})
        </span>
        <button
          type="button"
          onClick={() => setShowInvite((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md bg-primary-50 px-2 py-1 font-medium text-primary-700 text-xs hover:bg-primary-100"
          data-testid={`stakeholder-org-invite-toggle-${orgId}`}
        >
          <Plus className="h-3 w-3" aria-hidden />
          {showInvite ? 'Cancelar' : 'Invitar miembro'}
        </button>
      </div>

      {showInvite && <InviteStakeholderMemberForm orgId={orgId} onInvited={handleInvited} />}

      {detail.miembros.length === 0 ? (
        <p className="text-neutral-500 text-xs">
          Esta organización todavía no tiene miembros. Invita al primero con el botón de arriba.
        </p>
      ) : (
        <ul className="space-y-1">
          {detail.miembros.map((m) => (
            <li
              key={m.membership_id}
              className="flex items-center justify-between gap-2 rounded-md bg-neutral-50 px-2 py-1.5 text-xs"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-neutral-900">{m.full_name}</div>
                <div className="text-neutral-500">
                  {m.rut && <span className="font-mono">{m.rut}</span>}
                  {m.email && <span className="ml-2">{m.email}</span>}
                </div>
              </div>
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 font-medium text-[10px] uppercase tracking-wide ${
                  m.status === 'activa'
                    ? 'bg-success-50 text-success-700'
                    : m.status === 'pendiente_invitacion'
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-neutral-100 text-neutral-600'
                }`}
              >
                {m.status === 'pendiente_invitacion' ? 'pendiente' : m.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface InviteFormState {
  rut: string;
  email: string;
  full_name: string;
}

function InviteStakeholderMemberForm({
  orgId,
  onInvited,
}: {
  orgId: string;
  onInvited: () => void;
}) {
  const [form, setForm] = useState<InviteFormState>({ rut: '', email: '', full_name: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post(`/admin/stakeholder-orgs/${orgId}/invitar`, {
        rut: form.rut,
        email: form.email,
        full_name: form.full_name,
      });
      onInvited();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'already_member') {
        setError('Este RUT ya es miembro de la organización.');
      } else {
        const msg =
          err instanceof ApiError ? `${err.status}: ${err.message}` : (err as Error).message;
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="mb-3 grid grid-cols-1 gap-2 rounded-md border border-neutral-200 bg-white p-3 sm:grid-cols-3"
      data-testid={`stakeholder-org-invite-form-${orgId}`}
    >
      <label className="flex flex-col gap-1">
        <span className="font-medium text-neutral-700 text-xs">RUT</span>
        <input
          type="text"
          value={form.rut}
          onChange={(e) => setForm({ ...form, rut: e.target.value })}
          className="rounded-md border border-neutral-300 px-2 py-1 text-xs focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
          placeholder="12.345.678-9"
          data-testid={`stakeholder-org-invite-rut-${orgId}`}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium text-neutral-700 text-xs">Email</span>
        <input
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          className="rounded-md border border-neutral-300 px-2 py-1 text-xs focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
          placeholder="usuario@dominio.cl"
          data-testid={`stakeholder-org-invite-email-${orgId}`}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium text-neutral-700 text-xs">Nombre completo</span>
        <input
          type="text"
          value={form.full_name}
          onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          className="rounded-md border border-neutral-300 px-2 py-1 text-xs focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
          placeholder="Nombre completo"
          data-testid={`stakeholder-org-invite-name-${orgId}`}
        />
      </label>
      {error && (
        <div className="rounded-md border border-danger-200 bg-danger-50 p-2 text-danger-700 text-xs sm:col-span-3">
          {error}
        </div>
      )}
      <div className="sm:col-span-3">
        <button
          type="submit"
          disabled={submitting || !form.rut || !form.email || !form.full_name}
          className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-3 py-1.5 font-medium text-white text-xs hover:bg-primary-700 disabled:opacity-50"
          data-testid={`stakeholder-org-invite-submit-${orgId}`}
        >
          {submitting ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              Invitando…
            </>
          ) : (
            'Enviar invitación'
          )}
        </button>
      </div>
    </form>
  );
}

interface CreateStakeholderOrgFormState {
  nombre_legal: string;
  tipo: StakeholderOrgType;
  region_ambito: string;
  sector_ambito: string;
}

function CreateStakeholderOrgForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState<CreateStakeholderOrgFormState>({
    nombre_legal: '',
    tipo: 'observatorio_academico',
    region_ambito: '',
    sector_ambito: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post('/admin/stakeholder-orgs', {
        nombre_legal: form.nombre_legal,
        tipo: form.tipo,
        region_ambito: form.region_ambito.trim() === '' ? null : form.region_ambito.trim(),
        sector_ambito: form.sector_ambito.trim() === '' ? null : form.sector_ambito.trim(),
      });
      onCreated();
    } catch (err) {
      const msg =
        err instanceof ApiError ? `${err.status}: ${err.message}` : (err as Error).message;
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const tipos: StakeholderOrgType[] = [
    'regulador',
    'gremio',
    'observatorio_academico',
    'ong',
    'corporativo_esg',
  ];

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-4 grid grid-cols-1 gap-3 rounded-md border border-neutral-200 bg-neutral-50 p-4 sm:grid-cols-2"
      data-testid="stakeholder-org-create-form"
    >
      <label className="flex flex-col gap-1 sm:col-span-2">
        <span className="font-medium text-neutral-700 text-sm">Nombre legal</span>
        <input
          type="text"
          required
          minLength={3}
          maxLength={200}
          value={form.nombre_legal}
          onChange={(e) => setForm({ ...form, nombre_legal: e.target.value })}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
          placeholder="Ej: Observatorio Logístico UC"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium text-neutral-700 text-sm">Tipo</span>
        <select
          value={form.tipo}
          onChange={(e) => setForm({ ...form, tipo: e.target.value as StakeholderOrgType })}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
        >
          {tipos.map((t) => (
            <option key={t} value={t}>
              {STAKEHOLDER_ORG_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium text-neutral-700 text-sm">
          Región ámbito <span className="text-neutral-400 text-xs">(opcional, ISO 3166-2:CL)</span>
        </span>
        <input
          type="text"
          value={form.region_ambito}
          onChange={(e) => setForm({ ...form, region_ambito: e.target.value.toUpperCase() })}
          maxLength={50}
          pattern="^CL-[A-Z]{2,3}$"
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
          placeholder="Ej: CL-RM"
        />
      </label>
      <label className="flex flex-col gap-1 sm:col-span-2">
        <span className="font-medium text-neutral-700 text-sm">
          Sector ámbito <span className="text-neutral-400 text-xs">(opcional, slug)</span>
        </span>
        <input
          type="text"
          value={form.sector_ambito}
          onChange={(e) =>
            setForm({ ...form, sector_ambito: e.target.value.toLowerCase().replace(/\s+/g, '-') })
          }
          maxLength={100}
          pattern="^[a-z0-9-]+$"
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
          placeholder="Ej: transporte-carga"
        />
      </label>
      {error && (
        <div className="rounded-md border border-danger-200 bg-danger-50 p-2 text-danger-700 text-sm sm:col-span-2">
          {error}
        </div>
      )}
      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-50"
          data-testid="stakeholder-org-create-submit"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Creando…
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" aria-hidden />
              Crear organización
            </>
          )}
        </button>
      </div>
    </form>
  );
}
