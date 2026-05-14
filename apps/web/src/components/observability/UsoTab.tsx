import {
  useObservabilityTwilio,
  useObservabilityWorkspace,
} from '../../hooks/use-observability.js';
import { CurrencyValue } from './CurrencyValue.js';
import { KpiCard } from './KpiCard.js';

/**
 * Tab Uso — Twilio (balance + categorías MTD) + Google Workspace
 * (seats + costo mensual). Ambos servicios soportan graceful
 * degradation: si no están configurados, se muestra estado
 * "no disponible" sin crashear el dashboard.
 */
export function UsoTab() {
  const twilio = useObservabilityTwilio();
  const workspace = useObservabilityWorkspace();

  return (
    <div className="space-y-6">
      <section>
        <h2 className="font-semibold text-lg text-neutral-900">Twilio (WhatsApp + SMS)</h2>
        <p className="mt-1 mb-3 text-neutral-500 text-xs">
          Balance + top categorías del mes en curso.
        </p>
        {twilio.isLoading ? (
          <SkeletonRect height={140} />
        ) : twilio.data?.available ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <KpiCard
                label="Balance Twilio"
                value={
                  <div className="space-y-1">
                    <div className="font-bold text-2xl">
                      ${twilio.data.balance.balanceUsd.toFixed(2)} USD
                    </div>
                    <div className="text-neutral-500 text-sm">
                      ≈ <CurrencyValue amountClp={twilio.data.balance.balanceClp} size="sm" />
                    </div>
                  </div>
                }
                description="Saldo prepago disponible."
                status={twilio.data.balance.balanceUsd < 10 ? 'critical' : 'healthy'}
              />
              <KpiCard
                label="Categorías facturadas (mes)"
                value={<span className="font-bold text-2xl">{twilio.data.usage.length}</span>}
                description="Top 10 ordenadas por costo USD."
                status="neutral"
              />
            </div>
            {twilio.data.usage.length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-neutral-100 border-b text-left text-neutral-500 text-xs">
                    <th className="py-2 font-medium">Categoría</th>
                    <th className="py-2 font-medium">Descripción</th>
                    <th className="py-2 text-right font-medium">Uso</th>
                    <th className="py-2 text-right font-medium">USD</th>
                    <th className="py-2 text-right font-medium">CLP</th>
                  </tr>
                </thead>
                <tbody>
                  {twilio.data.usage.map((u) => (
                    <tr key={u.category} className="border-neutral-50 border-b last:border-0">
                      <td className="py-2 text-neutral-700">{u.category}</td>
                      <td className="py-2 text-neutral-500 text-xs">{u.description}</td>
                      <td className="py-2 text-right text-neutral-700 tabular-nums">
                        {u.usage.toLocaleString('es-CL')} {u.usageUnit}
                      </td>
                      <td className="py-2 text-right tabular-nums">${u.priceUsd.toFixed(2)}</td>
                      <td className="py-2 text-right font-medium tabular-nums">
                        ${u.priceClp.toLocaleString('es-CL')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="rounded-md bg-neutral-50 p-3 text-neutral-500 text-sm">
                Sin uso facturado este mes.
              </div>
            )}
          </div>
        ) : (
          <UnavailableBox
            title="Twilio no configurado"
            reason={twilio.data && !twilio.data.available ? twilio.data.reason : undefined}
          />
        )}
      </section>

      <section>
        <h2 className="font-semibold text-lg text-neutral-900">Google Workspace</h2>
        <p className="mt-1 mb-3 text-neutral-500 text-xs">
          Seats activos + suspendidos. Precios USD/seat configurables vía env var.
        </p>
        {workspace.isLoading ? (
          <SkeletonRect height={140} />
        ) : workspace.data?.available ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <KpiCard
              label="Seats totales"
              value={<span className="font-bold text-3xl">{workspace.data.totalSeats}</span>}
              description={`${workspace.data.activeSeats} activos · ${workspace.data.suspendedSeats} suspendidos`}
              status="neutral"
            />
            <KpiCard
              label="Costo mensual"
              value={<CurrencyValue amountClp={workspace.data.monthlyCostClp} size="xl" />}
              description={`≈ $${workspace.data.monthlyCostUsd.toFixed(2)} USD`}
              status="neutral"
            />
            <KpiCard
              label="Breakdown por SKU"
              value={
                <span className="text-2xl">{Object.keys(workspace.data.seatsBySku).length}</span>
              }
              description={
                Object.entries(workspace.data.seatsBySku)
                  .map(([sku, n]) => `${sku}: ${n}`)
                  .join(' · ') || 'Sin licencias detectadas'
              }
              status="neutral"
            />
          </div>
        ) : (
          <UnavailableBox
            title="Workspace no configurado"
            reason={workspace.data?.reason}
            hint="Sigue el runbook docs/runbooks/2026-05-13-workspace-admin-sdk-setup.md para habilitar Domain-Wide Delegation."
          />
        )}
      </section>
    </div>
  );
}

function SkeletonRect({ height }: { height: number }) {
  return (
    <div
      className="animate-pulse rounded-md bg-neutral-100"
      style={{ height }}
      aria-label="Cargando"
    />
  );
}

function UnavailableBox({
  title,
  reason,
  hint,
}: {
  title: string;
  reason?: string | undefined;
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4 text-sm">
      <div className="font-medium text-neutral-900">{title}</div>
      {reason && <div className="mt-1 text-neutral-600 text-xs">{reason}</div>}
      {hint && <div className="mt-2 text-neutral-500 text-xs">{hint}</div>}
    </div>
  );
}
