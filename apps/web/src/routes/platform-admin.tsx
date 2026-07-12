import {
  type OrganizacionStakeholder,
  STAKEHOLDER_ORG_TYPE_LABEL,
  type StakeholderOrgType,
} from '@booster-ai/shared-schemas';
import { RegisterProvider } from '@booster-ai/ui-components';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, Building2, Loader2, LogOut, Plus, ShieldCheck } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { ImpersonationPicker } from '../components/ImpersonationPicker.js';
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

export function PlatformAdminRoute() {
  return <ProtectedRoute meRequirement="skip">{() => <PlatformAdminPage />}</ProtectedRoute>;
}

function PlatformAdminPage() {
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
            <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">
              Operaciones de plataforma
            </h1>
            <p className="mt-2 max-w-2xl text-neutral-600 text-sm">
              Herramientas internas de Booster: comparación de algoritmo de asignación,
              observabilidad, configuración del sitio, organizaciones stakeholder e impersonación
              auditada.
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

        <StakeholderOrgsSection />

        <RegisterProvider register="operador" density="comoda" className="mt-8 block">
          <ImpersonationPicker />
        </RegisterProvider>
      </main>
    </div>
  );
}

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshTick es un trigger de refresh intencional (handleCreated lo incrementa); el efecto no lo lee, pero debe re-ejecutarse cuando cambia.
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshTick es un trigger de refresh intencional (handleInvited lo incrementa); el efecto no lo lee, pero debe re-ejecutarse cuando cambia.
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
