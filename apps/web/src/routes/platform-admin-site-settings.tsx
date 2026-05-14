import { DEFAULT_SITE_CONFIG, type SiteConfig, siteConfigSchema } from '@booster-ai/shared-schemas';
import { Link, Navigate } from '@tanstack/react-router';
import {
  ArrowLeft,
  Building2,
  Eye,
  History,
  Image as ImageIcon,
  Loader2,
  Palette,
  Save,
  Type,
  Upload,
} from 'lucide-react';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import type { MeResponse } from '../hooks/use-me.js';
import { getApiUrl } from '../lib/api-url.js';
import { firebaseAuth } from '../lib/firebase.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

interface PublishedRow {
  id: string;
  version: number;
  config: SiteConfig;
  publicada: boolean;
  notaPublicacion: string | null;
  creadoPorEmail: string;
  creadoEn: string;
}

interface AdminSiteSettingsResponse {
  published: PublishedRow | null;
  history: PublishedRow[];
}

/**
 * ADR-039 — Site Settings Editor.
 *
 * Surface admin restringido a `BOOSTER_PLATFORM_ADMIN_EMAILS` (validado
 * en backend). Permite:
 *
 *   - Editar identity (logo, color), hero (copy), certificaciones,
 *     4 persona cards, copy de onboarding y login.
 *   - Subir logo SVG/PNG/JPG (max 500 KB) → GCS público.
 *   - Crear borrador, publicar, ver history y rollback a versión X.
 *
 * El frontend público lee la versión publicada vía
 * `GET /public/site-settings` (cache 5min). Fallback hardcoded en
 * `DEFAULT_SITE_CONFIG`.
 */
export function PlatformAdminSiteSettingsRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        return <Page me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

async function authHeaders(): Promise<Record<string, string>> {
  const user = firebaseAuth.currentUser;
  if (!user) {
    throw new Error('Sin user autenticado.');
  }
  const token = await user.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
}

function Page({ me }: { me: MeOnboarded }) {
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [config, setConfig] = useState<SiteConfig>(DEFAULT_SITE_CONFIG);
  const [history, setHistory] = useState<PublishedRow[]>([]);
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusType, setStatusType] = useState<'success' | 'error' | null>(null);
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  useEffect(() => {
    void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchData() {
    try {
      const headers = await authHeaders();
      const res = await fetch(`${getApiUrl()}/admin/site-settings`, { headers });
      if (res.status === 403) {
        setForbidden(true);
        setLoading(false);
        return;
      }
      const body = (await res.json()) as AdminSiteSettingsResponse;
      setHistory(body.history);
      if (body.published) {
        setConfig(body.published.config);
        setPublishedVersion(body.published.version);
      }
    } catch (err) {
      setStatusType('error');
      setStatusMessage(`No pude cargar la configuración: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  function update<K extends keyof SiteConfig>(section: K, patch: Partial<SiteConfig[K]>) {
    setConfig((prev) => ({
      ...prev,
      [section]: { ...(prev[section] as object), ...patch },
    }));
    setDirty(true);
  }

  function updatePersonaCard(idx: number, patch: Partial<SiteConfig['persona_cards'][number]>) {
    setConfig((prev) => {
      const next = [...prev.persona_cards];
      next[idx] = { ...next[idx], ...patch } as SiteConfig['persona_cards'][number];
      return { ...prev, persona_cards: next as SiteConfig['persona_cards'] };
    });
    setDirty(true);
  }

  function updateCertifications(line: string) {
    const list = line
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    setConfig((prev) => ({ ...prev, certifications: list }));
    setDirty(true);
  }

  function updatePersonaHighlights(idx: number, text: string) {
    const list = text
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    updatePersonaCard(idx, { highlights: list });
  }

  async function handleLogoUpload(file: File) {
    setUploadingLogo(true);
    setStatusMessage(null);
    try {
      const user = firebaseAuth.currentUser;
      if (!user) {
        throw new Error('Sin user autenticado.');
      }
      const token = await user.getIdToken();
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${getApiUrl()}/admin/site-settings/assets`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        throw new Error(body.error ?? 'upload_failed');
      }
      update('identity', { logo_url: body.url });
      setStatusType('success');
      setStatusMessage('Logo subido. Recuerda guardar y publicar.');
    } catch (err) {
      setStatusType('error');
      setStatusMessage(`Error subiendo logo: ${(err as Error).message}`);
    } finally {
      setUploadingLogo(false);
    }
  }

  async function handleSaveDraft(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setStatusMessage(null);

    const parsed = siteConfigSchema.safeParse(config);
    if (!parsed.success) {
      setStatusType('error');
      setStatusMessage(`Validación falló: ${parsed.error.issues[0]?.message ?? 'config inválida'}`);
      setSubmitting(false);
      return;
    }

    try {
      const headers = await authHeaders();
      const res = await fetch(`${getApiUrl()}/admin/site-settings/draft`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ config: parsed.data }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        draft?: PublishedRow;
        error?: string;
      };
      if (!res.ok || !body.draft) {
        throw new Error(body.error ?? 'draft_failed');
      }
      // Publicar inmediatamente.
      const pubRes = await fetch(`${getApiUrl()}/admin/site-settings/publish`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ id: body.draft.id }),
      });
      if (!pubRes.ok) {
        const pubBody = (await pubRes.json()) as { error?: string };
        throw new Error(pubBody.error ?? 'publish_failed');
      }
      setStatusType('success');
      setStatusMessage(`Versión ${body.draft.version} publicada.`);
      setDirty(false);
      setPublishedVersion(body.draft.version);
      await fetchData();
    } catch (err) {
      setStatusType('error');
      setStatusMessage(`Error al publicar: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRollback(targetVersion: number) {
    if (
      !window.confirm(
        `¿Revertir el sitio a la versión ${targetVersion}? Esto despublica la versión actual.`,
      )
    ) {
      return;
    }
    setSubmitting(true);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${getApiUrl()}/admin/site-settings/rollback`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ target_version: targetVersion }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? 'rollback_failed');
      }
      setStatusType('success');
      setStatusMessage(`Rollback a versión ${targetVersion} OK.`);
      await fetchData();
      setDirty(false);
    } catch (err) {
      setStatusType('error');
      setStatusMessage(`Error en rollback: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  }

  function handleRestoreDefaults() {
    if (
      !window.confirm(
        'Esto reemplaza el formulario con los valores hardcoded por defecto. NO se publica automáticamente — debes apretar "Guardar y publicar" para que aplique.',
      )
    ) {
      return;
    }
    setConfig(DEFAULT_SITE_CONFIG);
    setDirty(true);
    setStatusMessage('Defaults cargados en el form. Revisa y publica.');
    setStatusType('success');
  }

  if (forbidden) {
    return <Navigate to="/app" />;
  }

  if (loading) {
    return (
      <Layout me={me} title="Configuración del sitio">
        <div className="flex min-h-[400px] items-center justify-center text-neutral-500">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden />
          Cargando configuración…
        </div>
      </Layout>
    );
  }

  return (
    <Layout me={me} title="Configuración del sitio">
      <div className="flex items-center justify-between gap-3">
        <Link
          to="/app/platform-admin"
          className="inline-flex items-center gap-1 text-neutral-500 text-sm hover:text-neutral-700"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Platform admin
        </Link>
        <div className="flex items-center gap-2">
          {publishedVersion !== null && (
            <span className="rounded-md border border-neutral-200 bg-white px-2.5 py-1 font-medium text-neutral-700 text-xs">
              Versión publicada: <strong className="text-neutral-900">{publishedVersion}</strong>
            </span>
          )}
          {dirty && (
            <span className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 font-medium text-amber-900 text-xs">
              Cambios sin publicar
            </span>
          )}
        </div>
      </div>

      <header className="mt-4 flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
          <Palette className="h-6 w-6" aria-hidden />
        </div>
        <div>
          <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">
            Configuración del sitio
          </h1>
          <p className="mt-1 max-w-2xl text-neutral-600 text-sm">
            Edita marca, hero, certificaciones y cards de personas que se muestran en{' '}
            <strong>demo.boosterchile.com</strong>. Los cambios aplican con cache de 5 minutos.
            ADR-039.
          </p>
        </div>
      </header>

      {statusMessage && (
        <output
          className={`mt-6 block rounded-md border px-4 py-3 text-sm ${
            statusType === 'success'
              ? 'border-primary-300 bg-primary-50 text-primary-900'
              : 'border-rose-300 bg-rose-50 text-rose-900'
          }`}
        >
          {statusMessage}
        </output>
      )}

      <form onSubmit={handleSaveDraft} className="mt-8 space-y-10">
        <IdentitySection
          config={config}
          onChange={(patch) => update('identity', patch)}
          onUploadLogo={handleLogoUpload}
          uploading={uploadingLogo}
        />

        <HeroSection config={config} onChange={(patch) => update('hero', patch)} />

        <CertificationsSection values={config.certifications} onChange={updateCertifications} />

        <PersonaCardsSection
          cards={config.persona_cards}
          onChange={updatePersonaCard}
          onChangeHighlights={updatePersonaHighlights}
        />

        <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-end gap-3 rounded-lg border border-neutral-200 bg-white p-4 shadow-md">
          <button
            type="button"
            onClick={handleRestoreDefaults}
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 font-medium text-neutral-700 text-sm hover:bg-neutral-50"
          >
            Restaurar defaults
          </button>
          <a
            href="https://demo.boosterchile.com/demo"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-2 font-medium text-neutral-700 text-sm hover:bg-neutral-50"
          >
            <Eye className="h-4 w-4" aria-hidden />
            Abrir demo en nueva pestaña
          </a>
          <button
            type="submit"
            disabled={submitting || !dirty}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary-600 px-4 py-2 font-semibold text-sm text-white shadow-sm hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Save className="h-4 w-4" aria-hidden />
            )}
            Guardar y publicar
          </button>
        </div>
      </form>

      <HistorySection history={history} onRollback={handleRollback} submitting={submitting} />
    </Layout>
  );
}

// =============================================================================
// SECTIONS
// =============================================================================

function SectionHeader({
  Icon,
  title,
  description,
}: {
  Icon: typeof Building2;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 border-neutral-200 border-b pb-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-neutral-100 text-neutral-700">
        <Icon className="h-4 w-4" aria-hidden />
      </div>
      <div>
        <h2 className="font-semibold text-lg text-neutral-900">{title}</h2>
        <p className="text-neutral-500 text-sm">{description}</p>
      </div>
    </div>
  );
}

function InputField({
  label,
  value,
  onChange,
  maxLength,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="block">
      <span className="block font-medium text-neutral-700 text-sm">{label}</span>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        placeholder={placeholder}
        className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-neutral-900 text-sm shadow-xs focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
      />
      {maxLength && (
        <span className="mt-1 block text-right text-neutral-400 text-xs">
          {value.length} / {maxLength}
        </span>
      )}
    </label>
  );
}

function TextareaField({
  label,
  value,
  onChange,
  maxLength,
  rows = 3,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  rows?: number;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="block">
      <span className="block font-medium text-neutral-700 text-sm">{label}</span>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        rows={rows}
        placeholder={placeholder}
        className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-neutral-900 text-sm shadow-xs focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
      />
      {maxLength && (
        <span className="mt-1 block text-right text-neutral-400 text-xs">
          {value.length} / {maxLength}
        </span>
      )}
    </label>
  );
}

function IdentitySection({
  config,
  onChange,
  onUploadLogo,
  uploading,
}: {
  config: SiteConfig;
  onChange: (patch: Partial<SiteConfig['identity']>) => void;
  onUploadLogo: (file: File) => void | Promise<void>;
  uploading: boolean;
}) {
  return (
    <section className="space-y-4">
      <SectionHeader
        Icon={ImageIcon}
        title="Identidad de marca"
        description="Logo principal, color de acento, favicon."
      />

      <div className="flex flex-wrap items-start gap-6">
        <div>
          <span className="block font-medium text-neutral-700 text-sm">Logo actual</span>
          <div className="mt-2 flex h-24 w-24 items-center justify-center rounded-lg border border-neutral-200 bg-white p-2">
            <img
              src={config.identity.logo_url ?? '/icons/icon.svg'}
              alt={config.identity.logo_alt}
              className="max-h-full max-w-full"
            />
          </div>
        </div>
        <div className="flex-1 space-y-3">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-2 font-medium text-neutral-700 text-sm hover:bg-neutral-50">
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Upload className="h-4 w-4" aria-hidden />
            )}
            Subir nuevo logo (SVG / PNG / JPG, máx 500 KB)
            <input
              type="file"
              accept="image/svg+xml,image/png,image/jpeg"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  void onUploadLogo(file);
                }
              }}
              disabled={uploading}
            />
          </label>
          {config.identity.logo_url && (
            <button
              type="button"
              onClick={() => onChange({ logo_url: undefined })}
              className="ml-2 text-rose-700 text-sm hover:underline"
            >
              Restaurar logo default
            </button>
          )}
          <InputField
            label="Texto alternativo (alt)"
            value={config.identity.logo_alt}
            onChange={(v) => onChange({ logo_alt: v })}
            maxLength={60}
          />
          <InputField
            label="Color primario (hex, ej. #1fa058) — opcional"
            value={config.identity.primary_color ?? ''}
            onChange={(v) => onChange({ primary_color: v || undefined })}
            maxLength={7}
            placeholder="#1fa058"
          />
        </div>
      </div>
    </section>
  );
}

function HeroSection({
  config,
  onChange,
}: {
  config: SiteConfig;
  onChange: (patch: Partial<SiteConfig['hero']>) => void;
}) {
  return (
    <section className="space-y-4">
      <SectionHeader
        Icon={Type}
        title="Hero — propuesta de valor"
        description="Headline (2 líneas), subtítulo y microcopy del demo landing."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <InputField
          label="Línea 1 del headline"
          value={config.hero.headline_line1}
          onChange={(v) => onChange({ headline_line1: v })}
          maxLength={80}
        />
        <InputField
          label="Línea 2 del headline (acento color)"
          value={config.hero.headline_line2}
          onChange={(v) => onChange({ headline_line2: v })}
          maxLength={80}
        />
      </div>
      <TextareaField
        label="Subhead (propuesta de valor extendida)"
        value={config.hero.subhead}
        onChange={(v) => onChange({ subhead: v })}
        maxLength={500}
        rows={3}
      />
      <InputField
        label="Microcopy (CTA secundaria)"
        value={config.hero.microcopy}
        onChange={(v) => onChange({ microcopy: v })}
        maxLength={200}
      />
    </section>
  );
}

function CertificationsSection({
  values,
  onChange,
}: {
  values: string[];
  onChange: (line: string) => void;
}) {
  return (
    <section className="space-y-4">
      <SectionHeader
        Icon={Building2}
        title="Certificaciones"
        description="Una por línea. Máximo 8. Se muestran como badges en el hero."
      />
      <TextareaField
        label="Lista de certificaciones (una por línea)"
        value={values.join('\n')}
        onChange={onChange}
        rows={5}
        placeholder={'GLEC v3.0\nGHG Protocol\nISO 14064\nk-anonymity ≥ 5'}
      />
    </section>
  );
}

function PersonaCardsSection({
  cards,
  onChange,
  onChangeHighlights,
}: {
  cards: SiteConfig['persona_cards'];
  onChange: (idx: number, patch: Partial<SiteConfig['persona_cards'][number]>) => void;
  onChangeHighlights: (idx: number, text: string) => void;
}) {
  return (
    <section className="space-y-4">
      <SectionHeader
        Icon={Building2}
        title="Cards de personas"
        description="4 cards (shipper, carrier, conductor, stakeholder). Editables individualmente."
      />

      <div className="space-y-6">
        {cards.map((card, idx) => (
          <div
            key={card.persona}
            className="rounded-lg border border-neutral-200 bg-neutral-50 p-4"
          >
            <h3 className="mb-3 font-semibold text-neutral-900 text-sm uppercase tracking-wider">
              {card.persona}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <InputField
                label="Rol (etiqueta)"
                value={card.role}
                onChange={(v) => onChange(idx, { role: v })}
                maxLength={50}
              />
              <InputField
                label="Nombre entidad"
                value={card.entity_name}
                onChange={(v) => onChange(idx, { entity_name: v })}
                maxLength={80}
              />
            </div>
            <div className="mt-3">
              <InputField
                label="Tagline"
                value={card.tagline}
                onChange={(v) => onChange(idx, { tagline: v })}
                maxLength={200}
              />
            </div>
            <div className="mt-3">
              <TextareaField
                label="Highlights (uno por línea, máx 5)"
                value={card.highlights.join('\n')}
                onChange={(v) => onChangeHighlights(idx, v)}
                rows={4}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function HistorySection({
  history,
  onRollback,
  submitting,
}: {
  history: PublishedRow[];
  onRollback: (version: number) => void;
  submitting: boolean;
}) {
  if (history.length === 0) {
    return null;
  }

  return (
    <section className="mt-10 rounded-lg border border-neutral-200 bg-white p-5">
      <div className="mb-3 flex items-center gap-2">
        <History className="h-5 w-5 text-neutral-700" aria-hidden />
        <h2 className="font-semibold text-lg text-neutral-900">Historial</h2>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-neutral-200 border-b text-left text-neutral-500 text-xs uppercase">
            <th className="py-2">Versión</th>
            <th className="py-2">Estado</th>
            <th className="py-2">Creado</th>
            <th className="py-2">Por</th>
            <th className="py-2">Nota</th>
            <th className="py-2 text-right">Acción</th>
          </tr>
        </thead>
        <tbody>
          {history.map((row) => (
            <tr key={row.id} className="border-neutral-100 border-b">
              <td className="py-2 font-semibold">{row.version}</td>
              <td className="py-2">
                {row.publicada ? (
                  <span className="rounded bg-primary-100 px-2 py-0.5 font-medium text-primary-800 text-xs">
                    Publicada
                  </span>
                ) : (
                  <span className="text-neutral-500">Histórica</span>
                )}
              </td>
              <td className="py-2 text-neutral-600">
                {new Date(row.creadoEn).toLocaleString('es-CL')}
              </td>
              <td className="py-2 text-neutral-700">{row.creadoPorEmail}</td>
              <td className="py-2 text-neutral-600">{row.notaPublicacion ?? '—'}</td>
              <td className="py-2 text-right">
                {!row.publicada && (
                  <button
                    type="button"
                    onClick={() => onRollback(row.version)}
                    disabled={submitting}
                    className="text-primary-700 text-sm hover:underline disabled:opacity-50"
                  >
                    Rollback
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
