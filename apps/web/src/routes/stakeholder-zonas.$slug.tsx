import { Link, Navigate, useParams } from '@tanstack/react-router';
import { ArrowLeft, Shield } from 'lucide-react';
import type { ReactNode } from 'react';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import type { MeResponse } from '../hooks/use-me.js';
import {
  type BucketCombustible,
  type BucketHora,
  type BucketTipoCarga,
  useStakeholderAgregaciones,
} from '../services/stakeholder-aggregations-client.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

/** D11/ADR-041 — Drill-down de zona stakeholder con k-anonymity ≥ 5. */
export function StakeholderZonasDetalleRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        if (ctx.me.active_membership?.role !== 'stakeholder_sostenibilidad') {
          return <Navigate to="/app" />;
        }
        return <StakeholderZonaDetalle me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function StakeholderZonaDetalle({ me }: { me: MeOnboarded }) {
  const { slug } = useParams({ from: '/app/stakeholder/zonas/$slug' });
  const { data, isLoading, error } = useStakeholderAgregaciones(slug);

  return (
    <Layout me={me} title={`Zona ${slug}`}>
      <Link
        to="/app/stakeholder/zonas"
        className="inline-flex items-center gap-1 text-neutral-500 text-sm hover:text-neutral-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Zonas
      </Link>
      <h1 className="mt-4 font-bold text-3xl text-neutral-900 tracking-tight">{slug}</h1>
      {isLoading && <p className="mt-4 text-neutral-500 text-sm">Cargando…</p>}
      {error && (
        <p className="mt-4 text-red-700 text-sm">No se pudieron cargar las agregaciones.</p>
      )}
      {data && (
        <>
          <p className="mt-2 text-neutral-600 text-sm">
            Ventana: {data.metodologia.ventana_dias}d · k-anonymity ≥ {data.metodologia.k_anonymity}
            <Shield className="ml-2 inline h-4 w-4 text-emerald-700" aria-hidden />
          </p>

          <Section title="Por hora del día">
            <ul className="mt-3 space-y-1 text-sm">
              {data.por_hora_del_dia.map((b) => (
                <BarRow
                  key={`h-${b.hora}`}
                  label={`${String(b.hora).padStart(2, '0')}:00`}
                  bucket={b}
                />
              ))}
            </ul>
          </Section>

          <Section title="Por tipo de carga">
            <ul className="mt-3 space-y-1 text-sm">
              {data.por_tipo_carga.map((b: BucketTipoCarga) => (
                <BarRow key={`t-${b.tipo}`} label={b.tipo} bucket={b} />
              ))}
            </ul>
          </Section>

          <Section title="Por combustible">
            <ul className="mt-3 space-y-1 text-sm">
              {data.por_combustible.map((b: BucketCombustible) => (
                <BarRow key={`f-${b.fuel_type}`} label={b.fuel_type} bucket={b} />
              ))}
            </ul>
          </Section>
        </>
      )}
    </Layout>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8 rounded-md border border-neutral-200 bg-white p-4">
      <h2 className="font-semibold text-lg text-neutral-900">{title}</h2>
      {children}
    </section>
  );
}

function BarRow({
  label,
  bucket,
}: {
  label: string;
  bucket: BucketHora | BucketTipoCarga | BucketCombustible;
}) {
  if (bucket.viajes == null) {
    return (
      <li className="flex justify-between text-neutral-400">
        <span>{label}</span>
        <span className="text-xs italic">Sin data suficiente</span>
      </li>
    );
  }
  return (
    <li className="flex justify-between text-neutral-800">
      <span>{label}</span>
      <span>
        {bucket.viajes} viajes · {bucket.co2e_kg?.toFixed(1) ?? '—'} kg CO₂e
      </span>
    </li>
  );
}
