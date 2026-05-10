import { CheckCircle2, Loader2, Truck } from 'lucide-react';
import { useState } from 'react';
import { useConfirmarEntregaMutation } from '../../hooks/use-confirmar-entrega.js';
import { ApiError } from '../../lib/api-client.js';
import type { VoiceCommandController } from '../../services/voice-commands.js';
import { VoiceCommandButton } from '../voice/VoiceCommandButton.js';

/**
 * Card de confirmación de entrega para el conductor (Phase 4 PR-K4).
 *
 * **Surface**: visible en `/app/asignaciones/:id` cuando el trip está
 * asignado o en proceso (NO entregado). Es la pantalla activa que el
 * conductor mira al volante en los últimos minutos del viaje.
 *
 * **Inputs paralelos**:
 *   - **Voz** (primario, hands-free): VoiceCommandButton con intent
 *     `confirmar_entrega`. El conductor dice "entregado" / "ya
 *     entregué" / "confirmar entrega" → dispara mutation.
 *   - **Botón visual** (fallback): "Sí, ya entregué" para casos donde
 *     el mic falla, está denegado, o el navegador no soporta Speech
 *     Recognition.
 *
 * **Doble confirmación**:
 *   El comando primario (voz O botón) NO dispara la mutation directo —
 *   abre un estado "confirmando" donde el conductor debe ratificar
 *   tocando el botón visible o diciendo "entregado" otra vez. Esto
 *   evita falsos positivos catastróficos: si el conductor está
 *   conversando y dice "entrega" como sustantivo, queremos un segundo
 *   gesture intencional antes de marcar el trip como entregado.
 *
 *   El estado `confirming` también muestra un timer de 4s con auto-cancel
 *   — si no se ratifica en ese tiempo, vuelve a `idle`.
 */

const CONFIRM_TIMEOUT_MS = 4000;

export interface DeliveryConfirmCardProps {
  assignmentId: string;
  /** Para tests: stub del recognizer pasado al VoiceCommandButton. */
  recognizer?: VoiceCommandController;
  /** Callback opcional cuando la mutation tiene éxito. */
  onConfirmed?: () => void;
}

type LocalState = 'idle' | 'confirming' | 'submitting' | 'success' | 'error';

export function DeliveryConfirmCard({
  assignmentId,
  recognizer,
  onConfirmed,
}: DeliveryConfirmCardProps) {
  const [localState, setLocalState] = useState<LocalState>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmTimer, setConfirmTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const mutation = useConfirmarEntregaMutation();

  const cancelConfirmTimer = (): void => {
    if (confirmTimer !== null) {
      clearTimeout(confirmTimer);
      setConfirmTimer(null);
    }
  };

  const handleFirstConfirm = (): void => {
    if (localState !== 'idle') {
      return;
    }
    setLocalState('confirming');
    const t = setTimeout(() => {
      setLocalState('idle');
      setConfirmTimer(null);
    }, CONFIRM_TIMEOUT_MS);
    setConfirmTimer(t);
  };

  const handleRatify = (): void => {
    if (localState !== 'confirming') {
      return;
    }
    cancelConfirmTimer();
    setLocalState('submitting');
    setErrorMsg(null);
    mutation.mutate(
      { assignmentId },
      {
        onSuccess: () => {
          setLocalState('success');
          onConfirmed?.();
        },
        onError: (err) => {
          setLocalState('error');
          if (err instanceof ApiError) {
            const details = (err.details ?? {}) as {
              code?: string;
              current_status?: string;
            };
            if (err.code === 'invalid_status' || details.code === 'invalid_status') {
              setErrorMsg(
                `Este viaje está en estado "${details.current_status ?? 'desconocido'}". No se puede confirmar entrega.`,
              );
            } else if (
              err.code === 'forbidden_owner_mismatch' ||
              details.code === 'forbidden_owner_mismatch'
            ) {
              setErrorMsg('No tienes permisos para confirmar este viaje.');
            } else {
              setErrorMsg('No se pudo confirmar la entrega. Intenta otra vez.');
            }
          } else {
            setErrorMsg('Sin conexión. Verifica tu red e intenta otra vez.');
          }
        },
      },
    );
  };

  const handleCancel = (): void => {
    cancelConfirmTimer();
    setLocalState('idle');
    setErrorMsg(null);
  };

  // Voice integration: 1er comando "entregado" → confirming;
  // 2do comando "entregado" → ratify. Comando "cancelar" en cualquier
  // estado → cancel.
  const onVoiceCommand = (cmd: { intent: string }): void => {
    if (cmd.intent === 'cancelar') {
      handleCancel();
      return;
    }
    if (cmd.intent === 'confirmar_entrega') {
      if (localState === 'idle') {
        handleFirstConfirm();
      } else if (localState === 'confirming') {
        handleRatify();
      }
    }
  };

  if (localState === 'success') {
    return (
      <section
        aria-label="Entrega confirmada"
        className="border-success-200 border-b bg-success-50 px-4 py-4"
      >
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-6 w-6 text-success-700" aria-hidden />
          <div>
            <p className="font-semibold text-sm text-success-800">Entrega confirmada</p>
            <p className="mt-0.5 text-success-700 text-xs">
              Procesando coaching y certificado de carbono…
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Confirmar entrega"
      className="border-neutral-200 border-b bg-white px-4 py-4"
    >
      <div className="flex items-start gap-3">
        <Truck className="mt-0.5 h-6 w-6 shrink-0 text-primary-700" aria-hidden />
        <div className="flex-1">
          <p className="font-semibold text-neutral-900 text-sm">¿Ya entregaste la carga?</p>
          <p className="mt-0.5 text-neutral-600 text-xs">
            {localState === 'idle' &&
              'Di "entregado" o toca el botón. Te pediremos confirmar antes de cerrar el viaje.'}
            {localState === 'confirming' &&
              'Confirma diciendo "entregado" otra vez o tocando el botón verde.'}
            {localState === 'submitting' && 'Confirmando con el sistema…'}
            {localState === 'error' && (errorMsg ?? 'No se pudo confirmar. Intenta otra vez.')}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <VoiceCommandButton
          acceptedIntents={new Set(['confirmar_entrega', 'cancelar'])}
          onCommand={onVoiceCommand}
          {...(recognizer ? { recognizer } : {})}
          idleLabel='Di "entregado"'
        />

        <div className="flex flex-1 flex-col gap-2">
          {localState === 'idle' && (
            <button
              type="button"
              onClick={handleFirstConfirm}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary-50 px-4 py-3 font-medium text-primary-700 text-sm ring-1 ring-primary-700/30 hover:bg-primary-100"
            >
              Sí, ya entregué
            </button>
          )}
          {localState === 'confirming' && (
            <>
              <button
                type="button"
                onClick={handleRatify}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-success-700 px-4 py-3 font-semibold text-sm text-white shadow hover:bg-success-800"
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden /> Confirmar entrega
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="text-neutral-500 text-xs underline"
              >
                Cancelar (volver atrás)
              </button>
            </>
          )}
          {localState === 'submitting' && (
            <div className="inline-flex items-center justify-center gap-2 rounded-md bg-neutral-100 px-4 py-3 text-neutral-600 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Confirmando…
            </div>
          )}
          {localState === 'error' && (
            <button
              type="button"
              onClick={handleFirstConfirm}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-amber-50 px-4 py-3 font-medium text-amber-800 text-sm ring-1 ring-amber-500 hover:bg-amber-100"
            >
              Reintentar
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
