import { Link } from '@tanstack/react-router';
import { ArrowLeft, Banknote, Loader2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { EmptyState } from '../components/EmptyState.js';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import {
  type AdelantoAdminRow,
  type AdelantoStatus,
  type TargetTransicion,
  useAdminAdelantos,
  useTransicionarAdelantoMutation,
} from '../hooks/use-admin-cobra-hoy.js';
import type { MeResponse } from '../hooks/use-me.js';
import { ApiError } from '../lib/api-client.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

const STATUS_FILTERS: Array<{ value: AdelantoStatus | 'todos'; label: string }> = [
  { value: 'todos', label: 'Todos' },
  { value: 'solicitado', label: 'Solicitado' },
  { value: 'aprobado', label: 'Aprobado' },
  { value: 'desembolsado', label: 'Desembolsado' },
  { value: 'cobrado_a_shipper', label: 'Cobrado al shipper' },
  { value: 'mora', label: 'En mora' },
  { value: 'cancelado', label: 'Cancelado' },
  { value: 'rechazado', label: 'Rechazado' },
];

const TRANSICIONES_POR_STATUS: Record<AdelantoStatus, TargetTransicion[]> = {
  solicitado: ['aprobado', 'rechazado', 'cancelado'],
  aprobado: ['desembolsado', 'cancelado', 'rechazado'],
  desembolsado: ['cobrado_a_shipper', 'mora'],
  cobrado_a_shipper: [],
  mora: ['cobrado_a_shipper', 'cancelado'],
  cancelado: [],
  rechazado: [],
};

const LABEL_TRANSICION: Record<TargetTransicion, string> = {
  aprobado: 'Aprobar',
  desembolsado: 'Marcar desembolsado',
  cobrado_a_shipper: 'Marcar cobrado',
  mora: 'Marcar en mora',
  cancelado: 'Cancelar',
  rechazado: 'Rechazar',
};

/**
 * /app/admin/cobra-hoy — surface platform-admin (Booster Chile SpA) para
 * gestionar adelantos de pronto pago. Auth real está en backend (allowlist
 * por email), acá solo damos respuesta UX para usuarios no autorizados.
 */
export function AdminCobraHoyRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        return <AdminCobraHoyPage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function AdminCobraHoyPage({ me }: { me: MeOnboarded }) {
  const [statusFilter, setStatusFilter] = useState<AdelantoStatus | 'todos'>('todos');
  const adelantosQ = useAdminAdelantos(statusFilter === 'todos' ? {} : { status: statusFilter });

  const featureDisabled = adelantosQ.error instanceof ApiError && adelantosQ.error.status === 503;
  const forbidden = adelantosQ.error instanceof ApiError && adelantosQ.error.status === 403;

  return (
    <Layout me={me} title="Admin Cobra Hoy">
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
          <Banknote className="h-6 w-6" aria-hidden />
        </div>
        <div>
          <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">Admin · Cobra Hoy</h1>
          <p className="mt-1 text-neutral-600 text-sm">
            Gestión platform-wide de adelantos solicitados por transportistas. Solo accesible para
            operadores de Booster Chile SpA listados en <code>BOOSTER_PLATFORM_ADMIN_EMAILS</code>.
          </p>
        </div>
      </header>

      {forbidden && (
        <output className="mt-6 block rounded-md border border-danger-500/30 bg-danger-50 p-4 text-danger-700 text-sm">
          Tu cuenta no está en la allowlist de admins platform-wide. Si necesitás acceso, escribí a
          soporte@boosterchile.com.
        </output>
      )}

      {featureDisabled && (
        <output className="mt-6 block rounded-md border border-neutral-200 bg-neutral-50 p-4 text-neutral-700 text-sm">
          El módulo Cobra Hoy no está activo en este entorno.
        </output>
      )}

      {!forbidden && !featureDisabled && (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            {STATUS_FILTERS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setStatusFilter(opt.value)}
                className={`rounded-full px-3 py-1 font-medium text-xs transition ${
                  statusFilter === opt.value
                    ? 'bg-primary-600 text-white'
                    : 'border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {adelantosQ.isLoading && <p className="mt-8 text-neutral-500">Cargando adelantos…</p>}

          {adelantosQ.data && adelantosQ.data.adelantos.length === 0 && (
            <div className="mt-8">
              <EmptyState
                icon={<Banknote className="h-10 w-10" aria-hidden />}
                title="No hay adelantos con este filtro"
                description="Cuando los transportistas soliciten pronto pago verás las solicitudes acá para aprobar, desembolsar o cobrar."
              />
            </div>
          )}

          {adelantosQ.data && adelantosQ.data.adelantos.length > 0 && (
            <div className="mt-6 overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-neutral-200">
                <thead className="bg-neutral-50">
                  <tr>
                    <Th>Solicitado</Th>
                    <Th>Carrier / Shipper</Th>
                    <Th className="text-right">Neto / Adelanto</Th>
                    <Th>Plazo · Tarifa</Th>
                    <Th>Estado</Th>
                    <Th className="text-right">Acciones</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 bg-white">
                  {adelantosQ.data.adelantos.map((a) => (
                    <AdelantoRow key={a.id} adelanto={a} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Layout>
  );
}

function AdelantoRow({ adelanto }: { adelanto: AdelantoAdminRow }) {
  const transicionM = useTransicionarAdelantoMutation();
  const [confirming, setConfirming] = useState<TargetTransicion | null>(null);
  const [notas, setNotas] = useState('');
  const allowed = TRANSICIONES_POR_STATUS[adelanto.status];

  function confirmTransition(target: TargetTransicion) {
    transicionM.mutate(
      {
        adelantoId: adelanto.id,
        targetStatus: target,
        ...(notas.trim() ? { notas: notas.trim() } : {}),
      },
      {
        onSuccess: () => {
          setConfirming(null);
          setNotas('');
        },
      },
    );
  }

  return (
    <>
      <tr className="hover:bg-neutral-50">
        <Td className="text-neutral-600 text-xs">{formatDate(adelanto.creado_en)}</Td>
        <Td>
          <div className="flex flex-col gap-0.5 font-mono text-xs">
            <span title="Carrier">C: {adelanto.empresa_carrier_id.slice(0, 8)}</span>
            <span className="text-neutral-500" title="Shipper">
              S: {adelanto.empresa_shipper_id.slice(0, 8)}
            </span>
          </div>
        </Td>
        <Td className="text-right">
          <div className="flex flex-col gap-0.5">
            <span className="text-neutral-600 text-xs">{fmt(adelanto.monto_neto_clp)}</span>
            <span className="font-semibold text-success-700">
              {fmt(adelanto.monto_adelantado_clp)}
            </span>
          </div>
        </Td>
        <Td className="text-neutral-600 text-xs">
          {adelanto.plazo_dias_shipper}d · {adelanto.tarifa_pct.toFixed(2)}%
        </Td>
        <Td>
          <StatusBadge status={adelanto.status} />
        </Td>
        <Td className="text-right">
          {allowed.length === 0 && <span className="text-neutral-400 text-xs">Estado final</span>}
          {allowed.length > 0 && (
            <div className="flex flex-wrap justify-end gap-1">
              {allowed.map((target) => (
                <button
                  key={target}
                  type="button"
                  onClick={() => setConfirming(target)}
                  disabled={transicionM.isPending}
                  className="rounded-md border border-neutral-300 px-2 py-1 font-medium text-neutral-700 text-xs transition hover:bg-neutral-100 disabled:opacity-60"
                >
                  {LABEL_TRANSICION[target]}
                </button>
              ))}
            </div>
          )}
        </Td>
      </tr>
      {confirming && (
        <tr className="bg-primary-50/50">
          <td colSpan={6} className="px-4 py-4">
            <div className="flex flex-col gap-3">
              <span className="font-medium text-neutral-800 text-sm">
                Confirmar transición: <strong>{adelanto.status}</strong> →{' '}
                <strong>{confirming}</strong>
              </span>
              <textarea
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                placeholder="Notas opcionales (visibles solo a admins)"
                rows={2}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => confirmTransition(confirming)}
                  disabled={transicionM.isPending}
                  className="inline-flex items-center gap-2 rounded-md bg-primary-600 px-3 py-2 font-medium text-sm text-white transition hover:bg-primary-700 disabled:opacity-60"
                >
                  {transicionM.isPending && (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  )}
                  Confirmar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(null);
                    setNotas('');
                  }}
                  className="rounded-md border border-neutral-300 px-3 py-2 font-medium text-neutral-700 text-sm hover:bg-neutral-100"
                >
                  Cancelar
                </button>
                {transicionM.isError && (
                  <span role="alert" className="text-danger-700 text-sm">
                    No pudimos aplicar la transición. Revisá los logs.
                  </span>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function StatusBadge({ status }: { status: AdelantoStatus }) {
  const map: Record<AdelantoStatus, { label: string; className: string }> = {
    solicitado: { label: 'Solicitado', className: 'bg-neutral-100 text-neutral-700' },
    aprobado: { label: 'Aprobado', className: 'bg-primary-50 text-primary-700' },
    desembolsado: { label: 'Desembolsado', className: 'bg-success-50 text-success-700' },
    cobrado_a_shipper: {
      label: 'Cobrado al shipper',
      className: 'bg-success-50 text-success-700',
    },
    mora: { label: 'En mora', className: 'bg-amber-50 text-amber-700' },
    cancelado: { label: 'Cancelado', className: 'bg-neutral-100 text-neutral-500' },
    rechazado: { label: 'Rechazado', className: 'bg-danger-50 text-danger-700' },
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
