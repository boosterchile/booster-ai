import { Banknote, CheckCircle2, Loader2, X } from 'lucide-react';
import { useState } from 'react';
import { useCotizacionCobraHoy, useSolicitarCobraHoyMutation } from '../../hooks/use-cobra-hoy.js';
import { ApiError } from '../../lib/api-client.js';

/**
 * Botón "Cobra hoy" + modal de confirmación. Para uso en
 * `/asignaciones/:id` cuando el trip está entregado.
 *
 * Comportamiento:
 *   - Si la feature está disabled (backend 503), el botón no se muestra
 *     (la query enabled=true falla silenciosa).
 *   - Click → abre modal con desglose (monto neto, tarifa, recibirás).
 *   - Confirmar → POST + cierra modal con confirmación visual.
 *   - Estado de la asignación se traduce a copy claro.
 */
export function CobraHoyButton({ asignacionId }: { asignacionId: string }) {
  const [modalOpen, setModalOpen] = useState(false);

  function open() {
    setModalOpen(true);
  }

  function close() {
    setModalOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="inline-flex items-center gap-2 rounded-md bg-success-700 px-4 py-2 font-medium text-sm text-white shadow-xs transition hover:bg-success-700/90"
      >
        <Banknote className="h-4 w-4" aria-hidden />
        Cobra hoy
      </button>
      {modalOpen && <CobraHoyModal asignacionId={asignacionId} onClose={close} />}
    </>
  );
}

function CobraHoyModal({
  asignacionId,
  onClose,
}: {
  asignacionId: string;
  onClose: () => void;
}) {
  const cotizQ = useCotizacionCobraHoy(asignacionId, { enabled: true });
  const solicitarM = useSolicitarCobraHoyMutation(asignacionId);

  // 503 → backend dice feature disabled. Mostrar mensaje claro y cerrar.
  const featureDisabled = cotizQ.error instanceof ApiError && cotizQ.error.status === 503;
  // 409 no_liquidacion → trip aún no se liquidó.
  const noLiquidacion =
    cotizQ.error instanceof ApiError &&
    cotizQ.error.status === 409 &&
    cotizQ.error.code === 'no_liquidacion';

  return (
    <dialog
      open
      aria-modal="true"
      aria-labelledby="cobra-hoy-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
    >
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <h2 id="cobra-hoy-modal-title" className="font-semibold text-lg text-neutral-900">
            Cobra hoy
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-neutral-500 transition hover:bg-neutral-100"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {cotizQ.isLoading && (
          <p className="mt-4 text-neutral-600 text-sm">Calculando cotización…</p>
        )}

        {featureDisabled && (
          <output className="mt-4 block rounded-md border border-neutral-200 bg-neutral-50 p-3 text-neutral-700 text-sm">
            La opción de pronto pago no está activa en este entorno todavía.
          </output>
        )}

        {noLiquidacion && (
          <output className="mt-4 block rounded-md border border-neutral-200 bg-neutral-50 p-3 text-neutral-700 text-sm">
            Tu viaje aún no fue liquidado. Apenas se confirme la entrega y se calcule la comisión,
            podrás solicitar pronto pago.
          </output>
        )}

        {cotizQ.data && (
          <>
            <p className="mt-3 text-neutral-700 text-sm">
              Recibe el monto neto del viaje hoy mismo, descontando una tarifa de pronto pago
              transparente sobre la comisión Booster ya deducida.
            </p>
            <dl className="mt-4 space-y-2 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm">
              <Row label="Monto neto del viaje" value={fmt(cotizQ.data.monto_neto_clp)} />
              <Row
                label={`Tarifa pronto pago (${cotizQ.data.tarifa_pct.toFixed(2)}%)`}
                value={`- ${fmt(cotizQ.data.tarifa_clp)}`}
                tone="muted"
              />
              <hr className="my-1 border-neutral-200" />
              <Row
                label="Recibes hoy"
                value={fmt(cotizQ.data.monto_adelantado_clp)}
                tone="emphasis"
              />
            </dl>
            <p className="mt-2 text-neutral-500 text-xs">
              Plazo del shipper: {cotizQ.data.plazo_dias_shipper} días corridos. Booster cobra al
              shipper en su fecha; tú no esperas.
            </p>
          </>
        )}

        {solicitarM.isSuccess && solicitarM.data && (
          <output className="mt-4 flex items-center gap-2 rounded-md border border-success-500/30 bg-success-50 p-3 text-success-700 text-sm">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            {solicitarM.data.already_requested
              ? 'Ya tenías una solicitud en curso para este viaje.'
              : 'Solicitud recibida. Te avisaremos cuando se desembolse.'}
          </output>
        )}

        {solicitarM.isError && (
          <output
            role="alert"
            className="mt-4 block rounded-md border border-danger-500/30 bg-danger-50 p-3 text-danger-700 text-sm"
          >
            No pudimos procesar la solicitud. Intenta de nuevo en unos minutos.
          </output>
        )}

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-neutral-300 px-3 py-2 font-medium text-neutral-700 text-sm transition hover:bg-neutral-100"
          >
            {solicitarM.isSuccess ? 'Cerrar' : 'Cancelar'}
          </button>
          {cotizQ.data && !solicitarM.isSuccess && (
            <button
              type="button"
              onClick={() => solicitarM.mutate()}
              disabled={solicitarM.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-success-700 px-4 py-2 font-medium text-sm text-white shadow-xs transition hover:bg-success-700/90 disabled:opacity-60"
            >
              {solicitarM.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Banknote className="h-4 w-4" aria-hidden />
              )}
              {solicitarM.isPending ? 'Solicitando…' : 'Confirmar y recibir hoy'}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'muted' | 'emphasis';
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt
        className={
          tone === 'emphasis' ? 'font-medium text-neutral-900' : 'text-neutral-600 text-sm'
        }
      >
        {label}
      </dt>
      <dd
        className={
          tone === 'emphasis'
            ? 'font-bold text-success-700'
            : tone === 'muted'
              ? 'text-neutral-700'
              : 'font-medium text-neutral-900'
        }
      >
        {value}
      </dd>
    </div>
  );
}

function fmt(clp: number): string {
  return `$ ${clp.toLocaleString('es-CL')}`;
}
