import { Link } from '@tanstack/react-router';
import { ArrowLeft, Download, FileText, Receipt } from 'lucide-react';
import type { ReactNode } from 'react';
import { EmptyState, emptyStateActionClass } from '../components/EmptyState.js';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import {
  type DteStatusValue,
  type LiquidacionRow,
  type LiquidacionStatus,
  useLiquidaciones,
} from '../hooks/use-liquidaciones.js';
import type { MeResponse } from '../hooks/use-me.js';
import { ApiError } from '../lib/api-client.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

/**
 * /app/liquidaciones — listado del carrier de sus liquidaciones de
 * viajes entregados (ADR-031 §4.1).
 *
 * Cada fila muestra trip, monto bruto, comisión Booster, neto al
 * carrier, IVA y status de la liquidación. Si tiene DTE emitido,
 * muestra folio + descarga del PDF.
 *
 * Flag-gated por backend (503 → banner). Acceso restringido a
 * empresas con `is_transportista` (403 → mensaje claro).
 */
export function LiquidacionesRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        const isCarrier = ctx.me.active_membership?.empresa?.is_transportista ?? false;
        if (!isCarrier) {
          return <NoCarrierPermission />;
        }
        return <LiquidacionesPage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function LiquidacionesPage({ me }: { me: MeOnboarded }) {
  const liqsQ = useLiquidaciones();

  const featureDisabled = liqsQ.error instanceof ApiError && liqsQ.error.status === 503;
  const forbidden = liqsQ.error instanceof ApiError && liqsQ.error.status === 403;

  return (
    <Layout me={me} title="Liquidaciones">
      <div className="flex items-center gap-3">
        <Link
          to="/app"
          className="inline-flex items-center gap-1 text-neutral-500 text-sm hover:text-neutral-700"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Inicio
        </Link>
      </div>

      <header className="mt-4 flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
          <Receipt className="h-6 w-6" aria-hidden />
        </div>
        <div>
          <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">Liquidaciones</h1>
          <p className="mt-1 text-neutral-600 text-sm">
            Cada viaje entregado genera una liquidación con monto bruto, comisión Booster, IVA y
            neto al transportista. Cuando el SII acepta el DTE, podrás descargar la factura.
          </p>
        </div>
      </header>

      {forbidden && (
        <output className="mt-6 block rounded-md border border-danger-500/30 bg-danger-50 p-4 text-danger-700 text-sm">
          Las liquidaciones son exclusivas de empresas transportistas. Si tu rol cambió, contactá al
          admin de tu empresa.
        </output>
      )}

      {featureDisabled && (
        <output className="mt-6 block rounded-md border border-neutral-200 bg-neutral-50 p-4 text-neutral-700 text-sm">
          Las liquidaciones aún no están activas en este entorno.
        </output>
      )}

      {!forbidden && !featureDisabled && liqsQ.isLoading && (
        <p className="mt-8 text-neutral-500">Cargando liquidaciones…</p>
      )}

      {!forbidden && !featureDisabled && liqsQ.data && liqsQ.data.liquidaciones.length === 0 && (
        <div className="mt-8">
          <EmptyState
            icon={<FileText className="h-10 w-10" aria-hidden />}
            title="Aún no tienes liquidaciones"
            description="Cuando un viaje entregado se procese, la liquidación aparecerá aquí con el desglose y el DTE Tipo 33 de la comisión Booster."
            action={
              <Link to="/app/ofertas" className={emptyStateActionClass}>
                Ver ofertas activas
              </Link>
            }
          />
        </div>
      )}

      {!forbidden && !featureDisabled && liqsQ.data && liqsQ.data.liquidaciones.length > 0 && (
        <>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SummaryCard title="Liquidaciones" value={liqsQ.data.liquidaciones.length.toString()} />
            <SummaryCard
              title="Total bruto"
              value={fmt(sumByField(liqsQ.data.liquidaciones, 'monto_bruto_clp'))}
            />
            <SummaryCard
              title="Total neto recibido"
              value={fmt(sumByField(liqsQ.data.liquidaciones, 'monto_neto_carrier_clp'))}
            />
          </div>

          <div className="mt-6 overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-neutral-200">
              <thead className="bg-neutral-50">
                <tr>
                  <Th>Creada</Th>
                  <Th>Trip</Th>
                  <Th className="text-right">Monto bruto</Th>
                  <Th className="text-right">Comisión</Th>
                  <Th className="text-right">Neto</Th>
                  <Th>Estado</Th>
                  <Th>DTE</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 bg-white">
                {liqsQ.data.liquidaciones.map((l) => (
                  <tr key={l.liquidacion_id} className="hover:bg-neutral-50">
                    <Td className="text-neutral-600 text-xs">{formatDate(l.creado_en)}</Td>
                    <Td>
                      <Link
                        to="/app/asignaciones/$id"
                        params={{ id: l.asignacion_id }}
                        className="font-mono text-primary-700 text-xs hover:underline"
                      >
                        {l.tracking_code}
                      </Link>
                    </Td>
                    <Td className="text-right font-medium">{fmt(l.monto_bruto_clp)}</Td>
                    <Td className="text-right text-neutral-600 text-xs">
                      {fmt(l.comision_clp)} ({l.comision_pct.toFixed(2)}%)
                    </Td>
                    <Td className="text-right font-semibold text-success-700">
                      {fmt(l.monto_neto_carrier_clp)}
                    </Td>
                    <Td>
                      <StatusBadge status={l.status} />
                    </Td>
                    <Td>
                      <DteCell row={l} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-neutral-500 text-xs">
            Las liquidaciones se calculan con la metodología{' '}
            <code>{liqsQ.data.liquidaciones[0]?.pricing_methodology_version}</code> capturada al
            momento del cierre del viaje. Cambios futuros a comisión o IVA no se aplican
            retroactivamente.
          </p>
        </>
      )}
    </Layout>
  );
}

function DteCell({ row }: { row: LiquidacionRow }) {
  if (!row.dte_folio) {
    return <span className="text-neutral-400 text-xs">—</span>;
  }
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2">
        <span className="font-mono text-neutral-900 text-xs">{row.dte_folio}</span>
        <DteStatusBadge status={row.dte_status} />
      </div>
      {row.dte_pdf_url && (
        <a
          href={row.dte_pdf_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-1 rounded-md border border-neutral-300 px-2 py-0.5 font-medium text-primary-700 text-xs transition hover:bg-primary-50"
        >
          <Download className="h-3 w-3" aria-hidden />
          PDF
        </a>
      )}
    </div>
  );
}

function NoCarrierPermission() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="font-semibold text-neutral-900 text-xl">Sin permisos</h2>
        <p className="mt-2 text-neutral-600 text-sm">
          Las liquidaciones son exclusivas de empresas transportistas.
        </p>
        <Link to="/app" className="mt-4 inline-block text-primary-600 underline">
          Volver al inicio
        </Link>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: LiquidacionStatus }) {
  const map: Record<LiquidacionStatus, { label: string; className: string }> = {
    pending_consent: {
      label: 'Pendiente consent',
      className: 'bg-amber-50 text-amber-700',
    },
    lista_para_dte: {
      label: 'Lista para DTE',
      className: 'bg-neutral-100 text-neutral-700',
    },
    dte_emitido: {
      label: 'DTE emitido',
      className: 'bg-primary-50 text-primary-700',
    },
    pagada_al_carrier: {
      label: 'Pagada',
      className: 'bg-success-50 text-success-700',
    },
    disputa: {
      label: 'En disputa',
      className: 'bg-danger-50 text-danger-700',
    },
  };
  const v = map[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium text-xs ${v.className}`}
    >
      {v.label}
    </span>
  );
}

function DteStatusBadge({ status }: { status: DteStatusValue | null }) {
  if (!status) {
    return null;
  }
  const map: Record<DteStatusValue, { label: string; className: string }> = {
    en_proceso: { label: 'SII en proceso', className: 'bg-neutral-100 text-neutral-600' },
    aceptado: { label: 'SII aceptado', className: 'bg-success-50 text-success-700' },
    reparable: { label: 'SII reparable', className: 'bg-amber-50 text-amber-700' },
    rechazado: { label: 'SII rechazado', className: 'bg-danger-50 text-danger-700' },
    anulado: { label: 'Anulado', className: 'bg-neutral-100 text-neutral-500' },
  };
  const v = map[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0 font-medium text-[10px] ${v.className}`}
    >
      {v.label}
    </span>
  );
}

function Th({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <th
      className={`px-4 py-2 text-left font-medium text-neutral-500 text-xs uppercase tracking-wider ${className}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <td className={`px-4 py-3 align-top text-neutral-800 text-sm ${className}`}>{children}</td>
  );
}

function SummaryCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <span className="font-medium text-neutral-500 text-xs uppercase tracking-wider">{title}</span>
      <div className="mt-2 font-semibold text-2xl text-neutral-900">{value}</div>
    </div>
  );
}

function sumByField<K extends keyof LiquidacionRow>(items: LiquidacionRow[], field: K): number {
  return items.reduce((acc, l) => {
    const v = l[field];
    return acc + (typeof v === 'number' ? v : 0);
  }, 0);
}

function fmt(clp: number): string {
  return `$ ${clp.toLocaleString('es-CL')}`;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('es-CL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Santiago',
  }).format(new Date(iso));
}
