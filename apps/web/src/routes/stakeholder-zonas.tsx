import { STAKEHOLDER_ORG_TYPE_LABEL } from '@booster-ai/shared-schemas';
import { Link, Navigate } from '@tanstack/react-router';
import { ArrowLeft, Building2, MapPin, Shield, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import type { MeResponse } from '../hooks/use-me.js';
import { type ZonaCard, useStakeholderZonas } from '../services/stakeholder-aggregations-client.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

/**
 * D11/T11 — Cards stakeholder con data real desde /stakeholder/zonas.
 * ZONAS_DEMO eliminado; TanStack Query pull real con k-anonymity ≥ 5
 * server-side (ADR-041).
 */
export function StakeholderZonasRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        if (ctx.me.active_membership?.role !== 'stakeholder_sostenibilidad') {
          return <Navigate to="/app" />;
        }
        return <StakeholderZonasPage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

const TIPO_LABEL: Record<ZonaCard['tipo'] | string, string> = {
  puerto: 'Puerto',
  mercado_abastos: 'Mercado de abastos',
  polo_industrial: 'Polo industrial',
  zona_franca: 'Zona franca',
};
const TIPO_COLOR: Record<string, string> = {
  puerto: 'bg-sky-50 text-sky-700',
  mercado_abastos: 'bg-amber-50 text-amber-700',
  polo_industrial: 'bg-neutral-100 text-neutral-700',
  zona_franca: 'bg-violet-50 text-violet-700',
};

function StakeholderZonasPage({ me }: { me: MeOnboarded }) {
  const org = me.active_membership?.organizacion_stakeholder ?? null;
  const { data, isLoading, error } = useStakeholderZonas();
  const zonas = data?.zonas ?? [];

  return (
    <Layout me={me} title="Zonas de impacto">
      <div className="flex items-center gap-3">
        <Link
          to="/app"
          className="inline-flex items-center gap-1 text-neutral-500 text-sm hover:text-neutral-700"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> Inicio
        </Link>
      </div>

      <header className="mt-4 flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-violet-50 text-violet-700">
          <TrendingUp className="h-6 w-6" aria-hidden />
        </div>
        <div>
          <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">
            Zonas de impacto logístico
          </h1>
          <p className="mt-1 max-w-2xl text-neutral-600 text-sm">
            Flujos de transporte agregados en zonas críticas con <strong>k-anonymity ≥ 5</strong>.
            Ninguna celda identifica empresas individuales — ver{' '}
            <a
              href="https://github.com/boosterchile/booster-ai/blob/main/docs/adr/041-stakeholder-geo-aggregations-bounding-boxes-k-anonymity.md"
              className="text-violet-700 underline"
            >
              ADR-041
            </a>
            .
          </p>
        </div>
      </header>

      {org && (
        <div
          className="mt-6 flex flex-wrap items-center gap-3 rounded-md border border-violet-200 bg-violet-50/50 p-4 text-sm"
          data-testid="stakeholder-org-context"
        >
          <Building2 className="h-4 w-4 shrink-0 text-violet-700" aria-hidden />
          <div className="text-violet-900">
            <span className="font-semibold">{org.nombre_legal}</span>{' '}
            <span className="text-violet-700 text-xs">
              · {STAKEHOLDER_ORG_TYPE_LABEL[org.tipo]}
            </span>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2 text-violet-700 text-xs">
            <span className="rounded bg-violet-100 px-2 py-0.5">
              Ámbito: {org.region_ambito ? `Región ${org.region_ambito}` : 'Nacional'}
            </span>
            {org.sector_ambito && (
              <span className="rounded bg-violet-100 px-2 py-0.5">Sector: {org.sector_ambito}</span>
            )}
          </div>
        </div>
      )}

      <section className="mt-8">
        <h2 className="font-semibold text-neutral-900 text-xl">Zonas monitoreadas</h2>
        {isLoading && (
          <p className="mt-2 text-neutral-500 text-sm" data-testid="zonas-loading">
            Cargando…
          </p>
        )}
        {error && (
          <p className="mt-2 text-red-700 text-sm" data-testid="zonas-error">
            No se pudieron cargar las zonas.
          </p>
        )}
        {data && zonas.length === 0 && (
          <p className="mt-2 text-neutral-500 text-sm" data-testid="zonas-empty">
            No hay zonas activas.
          </p>
        )}
        {data && zonas.length > 0 && (
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {zonas.map((z) => (
              <ZonaCardView key={z.id} zona={z} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-10 rounded-lg border border-neutral-200 bg-white p-5">
        <h2 className="font-semibold text-neutral-900 text-lg">Metodología</h2>
        <ul className="mt-3 space-y-2 text-neutral-700 text-sm">
          <li className="flex items-start gap-2">
            <Shield className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden />
            <span>k-anonymity ≥ 5 por celda zona × hora × tipo carga.</span>
          </li>
          <li className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" aria-hidden />
            <span>Bounding boxes predefinidos por zona; expandible por migration.</span>
          </li>
          <li className="flex items-start gap-2">
            <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-neutral-700" aria-hidden />
            <span>Sin PII ni identidad de shippers / carriers / conductores individuales.</span>
          </li>
        </ul>
      </section>
    </Layout>
  );
}

function ZonaCardView({ zona }: { zona: ZonaCard }) {
  const tipoLabel = TIPO_LABEL[zona.tipo] ?? zona.tipo;
  const tipoColor = TIPO_COLOR[zona.tipo] ?? 'bg-neutral-100 text-neutral-700';
  const insufficient = zona.insufficient_data;

  return (
    <div
      className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm transition hover:border-primary-300"
      data-testid={`zona-${zona.slug}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-neutral-900">{zona.nombre}</h3>
          <p className="text-neutral-500 text-xs">{zona.region}</p>
        </div>
        <span className={`shrink-0 rounded-md px-2 py-0.5 font-medium text-xs ${tipoColor}`}>
          {tipoLabel}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <Stat
          label="Viajes (30 días)"
          value={
            insufficient ? (
              <span className="text-neutral-400 italic">Sin data suficiente</span>
            ) : (
              (zona.viajes_30d ?? 0).toLocaleString('es-CL')
            )
          }
        />
        <Stat
          label="CO₂e total"
          value={
            insufficient ? (
              <span className="text-neutral-400 italic">—</span>
            ) : (
              `${((zona.co2e_total_kg ?? 0) / 1000).toFixed(1)} t`
            )
          }
        />
        <Stat
          label="Horario pico"
          value={
            insufficient || zona.horario_pico_inicio == null ? (
              <span className="text-neutral-400 italic">—</span>
            ) : (
              `${String(zona.horario_pico_inicio).padStart(2, '0')}:00 – ${String(zona.horario_pico_fin).padStart(2, '0')}:00`
            )
          }
          className="col-span-2"
        />
      </dl>

      <Link
        to="/app/stakeholder/zonas/$slug"
        params={{ slug: zona.slug }}
        className="mt-4 inline-flex w-full items-center justify-center rounded-md border border-primary-300 px-3 py-1.5 font-medium text-primary-700 text-xs hover:bg-primary-50"
      >
        Drill-down →
      </Link>
    </div>
  );
}

function Stat({
  label,
  value,
  className = '',
}: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-neutral-500 uppercase tracking-wider">{label}</dt>
      <dd className="mt-0.5 font-semibold text-neutral-900 text-sm">{value}</dd>
    </div>
  );
}
