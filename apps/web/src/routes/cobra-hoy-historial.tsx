import { Link } from '@tanstack/react-router';
import { AlertTriangle, ArrowLeft, Banknote, Clock3, MessageSquare } from 'lucide-react';
import type { ReactNode } from 'react';
import { EmptyState, emptyStateActionClass } from '../components/EmptyState.js';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { type AdelantoHistorial, useHistorialCobraHoy } from '../hooks/use-cobra-hoy.js';
import type { MeResponse } from '../hooks/use-me.js';
import { ApiError } from '../lib/api-client.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

/**
 * /app/cobra-hoy/historial — listado dedicado de adelantos solicitados
 * por el transportista (Booster Cobra Hoy, ADR-029 v1 / ADR-032).
 *
 * Origen: GET /me/cobra-hoy/historial (filtra por activeMembership.empresa).
 * Si el flag está off (503) muestra un banner explicativo. Si la empresa
 * no es transportista, mensaje claro de "sin permisos".
 */
export function CobraHoyHistorialRoute() {
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
        return <HistorialPage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function HistorialPage({ me }: { me: MeOnboarded }) {
  const histQ = useHistorialCobraHoy({ enabled: true });

  const featureDisabled = histQ.error instanceof ApiError && histQ.error.status === 503;

  return (
    <Layout me={me} title="Cobra hoy">
      <div className="flex items-center gap-3">
        <Link
          to="/app"
          className="inline-flex items-center gap-1 text-neutral-500 text-sm hover:text-neutral-700"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Inicio
        </Link>
      </div>

      <header className="mt-4 flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-success-50 text-success-700">
            <Banknote className="h-6 w-6" aria-hidden />
          </div>
          <div>
            <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">Pronto pago</h1>
            <p className="mt-1 text-neutral-600 text-sm">
              Recibe el monto neto de tus viajes entregados hoy mismo, descontando una tarifa
              transparente. Booster cobra al shipper en su plazo; tú no esperas.
            </p>
          </div>
        </div>
      </header>

      {featureDisabled && (
        <output className="mt-6 block rounded-md border border-neutral-200 bg-neutral-50 p-4 text-neutral-700 text-sm">
          La opción de pronto pago todavía no está activa en este entorno. Cuando se habilite, verás
          aquí el historial de tus solicitudes.
        </output>
      )}

      {!featureDisabled && histQ.isLoading && (
        <p className="mt-8 text-neutral-500">Cargando historial…</p>
      )}

      {!featureDisabled && histQ.error && !(histQ.error instanceof ApiError) && (
        <p className="mt-8 text-danger-700">
          No pudimos cargar el historial. Inténtalo en un momento.
        </p>
      )}

      {!featureDisabled && histQ.data && histQ.data.adelantos.length === 0 && (
        <div className="mt-8">
          <EmptyState
            icon={<Clock3 className="h-10 w-10" aria-hidden />}
            title="Aún no tienes solicitudes de pronto pago"
            description="Cuando un viaje quede entregado y liquidado, podrás solicitar el adelanto desde la pantalla del viaje. Acá quedará el historial."
            action={
              <Link to="/app/ofertas" className={emptyStateActionClass}>
                Ver ofertas activas
              </Link>
            }
          />
        </div>
      )}

      {!featureDisabled && histQ.data && histQ.data.adelantos.length > 0 && (
        <>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SummaryCard title="Solicitudes" value={histQ.data.adelantos.length.toString()} />
            <SummaryCard
              title="Total adelantado"
              value={fmt(sumAdelantado(histQ.data.adelantos))}
            />
            <SummaryCard title="Total tarifa" value={fmt(sumTarifa(histQ.data.adelantos))} />
          </div>

          <div className="mt-6 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-neutral-200">
              <thead className="bg-neutral-50">
                <tr>
                  <Th>Solicitado</Th>
                  <Th>Asignación</Th>
                  <Th className="text-right">Monto neto</Th>
                  <Th className="text-right">Tarifa</Th>
                  <Th className="text-right">Recibido</Th>
                  <Th>Estado</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 bg-white">
                {histQ.data.adelantos.flatMap((a) => [
                  <tr key={a.id} className="hover:bg-neutral-50">
                    <Td className="text-neutral-600 text-xs">{formatDate(a.creado_en)}</Td>
                    <Td>
                      <Link
                        to="/app/asignaciones/$id"
                        params={{ id: a.asignacion_id }}
                        className="font-mono text-primary-700 text-xs hover:underline"
                      >
                        {a.asignacion_id.slice(0, 8)}
                      </Link>
                    </Td>
                    <Td className="text-right font-medium">{fmt(a.monto_neto_clp)}</Td>
                    <Td className="text-right text-neutral-600 text-xs">
                      {fmt(a.tarifa_clp)} ({a.tarifa_pct.toFixed(2)}%)
                    </Td>
                    <Td className="text-right font-semibold text-success-700">
                      {fmt(a.monto_adelantado_clp)}
                    </Td>
                    <Td>
                      <StatusBadge status={a.status} />
                    </Td>
                  </tr>,
                  a.nota_visible ? (
                    <tr key={`${a.id}-nota`} className="bg-neutral-50/50">
                      <td colSpan={6} className="px-4 pt-0 pb-3">
                        <NotaCarrier status={a.status} message={a.nota_visible} />
                      </td>
                    </tr>
                  ) : null,
                ])}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-neutral-500 text-xs">
            La tarifa de pronto pago se calcula con la metodología{' '}
            <code>factoring-v1.0-cl-2026.06</code>. Ver{' '}
            <Link to="/legal/cobra-hoy" className="text-primary-700 underline">
              términos completos
            </Link>
            .
          </p>
        </>
      )}
    </Layout>
  );
}

function NoCarrierPermission() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="font-semibold text-neutral-900 text-xl">Sin permisos</h2>
        <p className="mt-2 text-neutral-600 text-sm">
          El pronto pago es exclusivo de empresas transportistas. Si tu rol cambió, contactá al
          admin de tu empresa.
        </p>
        <Link to="/app" className="mt-4 inline-block text-primary-600 underline">
          Volver al inicio
        </Link>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: AdelantoHistorial['status'] }) {
  const map: Record<AdelantoHistorial['status'], { label: string; className: string }> = {
    solicitado: {
      label: 'Solicitado',
      className: 'bg-neutral-100 text-neutral-700',
    },
    aprobado: {
      label: 'Aprobado',
      className: 'bg-primary-50 text-primary-700',
    },
    desembolsado: {
      label: 'Desembolsado',
      className: 'bg-success-50 text-success-700',
    },
    cobrado_a_shipper: {
      label: 'Cobrado al shipper',
      className: 'bg-success-50 text-success-700',
    },
    mora: {
      label: 'En mora',
      className: 'bg-amber-50 text-amber-700',
    },
    cancelado: {
      label: 'Cancelado',
      className: 'bg-neutral-100 text-neutral-500',
    },
    rechazado: {
      label: 'Rechazado',
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

/**
 * Mensaje del admin al carrier — solo para estados rechazado / cancelado / mora.
 * Color y icono varían según severidad: rechazado/cancelado en danger, mora en amber.
 */
function NotaCarrier({
  status,
  message,
}: {
  status: AdelantoHistorial['status'];
  message: string;
}) {
  const isDanger = status === 'rechazado' || status === 'cancelado';
  const tone = isDanger
    ? 'border-danger-500/30 bg-danger-50 text-danger-700'
    : 'border-amber-500/30 bg-amber-50 text-amber-700';
  const Icon = isDanger ? AlertTriangle : MessageSquare;
  return (
    <output className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${tone}`}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        <strong className="font-medium">Nota del equipo Booster:</strong> {message}
      </span>
    </output>
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

function sumAdelantado(items: AdelantoHistorial[]): number {
  return items.reduce((acc, a) => acc + a.monto_adelantado_clp, 0);
}

function sumTarifa(items: AdelantoHistorial[]): number {
  return items.reduce((acc, a) => acc + a.tarifa_clp, 0);
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
