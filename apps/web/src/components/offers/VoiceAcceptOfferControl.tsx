import { CheckCircle2, Info, Loader2, Mic } from 'lucide-react';
import { useState } from 'react';
import { useAcceptOfferMutation } from '../../hooks/use-offers.js';
import { useVoiceCommand } from '../../hooks/use-voice-command.js';
import { ApiError } from '../../lib/api-client.js';
import type { RecognizedCommand, VoiceCommandController } from '../../services/voice-commands.js';
import { VoiceCommandButton } from '../voice/VoiceCommandButton.js';

/**
 * Control hands-free para aceptar oferta por voz (Phase 4 PR-K7).
 *
 * Cierra el último intent del voice command framework: `aceptar_oferta`.
 *
 * **UX deliberadamente conservadora**: aceptar oferta es contrato — un
 * falso positivo de voz puede comprometer al carrier a un viaje no
 * deseado. Por eso:
 *
 *   1. **Solo se renderiza cuando hay EXACTAMENTE 1 oferta pendiente**.
 *      Con ≥2 ofertas, el conductor debe tocar la que quiere aceptar
 *      manualmente — el comando de voz se vuelve ambiguo y peligroso.
 *      Cuando offerCount=0, tampoco se monta (no hay caller).
 *
 *   2. **Doble confirmación**. Voice "aceptar oferta" → estado
 *      `confirming` con timer 4s + botón verde grande. Para ratificar,
 *      el conductor debe decir "aceptar" otra vez O tocar el botón.
 *      Si una conversación incluye "aceptar" como verbo casual, NO
 *      cierra la oferta.
 *
 *   3. **Cancel reverter**. Comando "cancelar" en cualquier estado
 *      vuelve a idle.
 *
 * Mismo patrón que DeliveryConfirmCard (PR-K4): la primera UX
 * voice-first crítica de Booster.
 */

const CONFIRM_TIMEOUT_MS = 4000;

export interface VoiceAcceptOfferControlProps {
  /** ID de la oferta única pendiente. Required — la card se monta solo cuando offerCount=1. */
  offerId: string;
  /** Tracking code legible para mostrar en la pregunta. */
  trackingCode: string;
  /** Inyectable para tests. */
  recognizer?: VoiceCommandController;
  /** Callback opcional post-success (e.g. para navegar al detalle). */
  onAccepted?: () => void;
}

type LocalState = 'idle' | 'confirming' | 'submitting' | 'success' | 'error';

export function VoiceAcceptOfferControl({
  offerId,
  trackingCode,
  recognizer,
  onAccepted,
}: VoiceAcceptOfferControlProps) {
  const [localState, setLocalState] = useState<LocalState>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmTimer, setConfirmTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const mutation = useAcceptOfferMutation();

  const cancelConfirmTimer = (): void => {
    if (confirmTimer !== null) {
      clearTimeout(confirmTimer);
      setConfirmTimer(null);
    }
  };

  const enterConfirming = (): void => {
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

  const ratify = (): void => {
    if (localState !== 'confirming') {
      return;
    }
    cancelConfirmTimer();
    setLocalState('submitting');
    setErrorMsg(null);
    mutation.mutate(
      { offerId },
      {
        onSuccess: () => {
          setLocalState('success');
          onAccepted?.();
        },
        onError: (err) => {
          setLocalState('error');
          if (err instanceof ApiError && err.status === 409) {
            setErrorMsg('Esta oferta ya no está disponible. Se actualizó la lista.');
          } else if (err instanceof ApiError && err.status === 410) {
            setErrorMsg('La oferta expiró antes de que la aceptaras.');
          } else if (err instanceof ApiError) {
            setErrorMsg('No se pudo aceptar la oferta. Intenta otra vez.');
          } else {
            setErrorMsg('Sin conexión. Verifica tu red e intenta otra vez.');
          }
        },
      },
    );
  };

  const cancel = (): void => {
    cancelConfirmTimer();
    setLocalState('idle');
    setErrorMsg(null);
  };

  // Voice listener a nivel de control (no solo dentro del
  // VoiceCommandButton). Patrón establecido en IncidentReportCard
  // (PR-K6b) y DeliveryConfirmCard (PR-K4).
  //
  // useVoiceCommand mantiene `onCommandRef.current` actualizado en cada
  // render, así que el closure sobre `localState` captura el valor
  // fresco al momento del comando (no el stale de cuando se subscribió).
  const onVoiceCommand = (cmd: RecognizedCommand): void => {
    if (cmd.intent === 'cancelar') {
      cancel();
      return;
    }
    if (cmd.intent === 'aceptar_oferta') {
      if (localState === 'idle') {
        enterConfirming();
      } else if (localState === 'confirming') {
        ratify();
      }
    }
  };

  useVoiceCommand({
    acceptedIntents: new Set(['aceptar_oferta', 'cancelar']),
    onCommand: onVoiceCommand,
    ...(recognizer ? { recognizer } : {}),
  });

  if (localState === 'success') {
    return (
      <section
        aria-label="Oferta aceptada"
        className="rounded-lg border border-success-200 bg-success-50 p-4"
        data-testid="voice-accept-success"
      >
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-success-700" aria-hidden />
          <p className="font-medium text-sm text-success-800">
            Oferta {trackingCode} aceptada. Procesando asignación…
          </p>
        </div>
      </section>
    );
  }

  if (localState === 'submitting') {
    return (
      <section
        aria-label="Procesando aceptación"
        className="rounded-lg border border-neutral-200 bg-white p-4"
      >
        <div className="flex items-center gap-3 text-neutral-600 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Aceptando oferta {trackingCode}…
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Aceptar oferta por voz"
      className="rounded-lg border border-primary-200 bg-primary-50/40 p-4"
      data-testid="voice-accept-control"
    >
      <div className="flex items-start gap-3">
        <Mic className="mt-0.5 h-5 w-5 shrink-0 text-primary-700" aria-hidden />
        <div className="flex-1">
          <p className="font-semibold text-primary-900 text-sm">Aceptar por voz</p>
          <p className="mt-0.5 text-neutral-600 text-xs">
            {localState === 'idle' &&
              `Di "aceptar oferta" o usa el botón Aceptar de abajo. Pedimos confirmar antes de cerrar el contrato.`}
            {localState === 'confirming' &&
              `Confirma diciendo "aceptar" otra vez o tocando el botón verde.`}
            {localState === 'error' && (errorMsg ?? 'No se pudo aceptar.')}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <VoiceCommandButton
          acceptedIntents={new Set(['aceptar_oferta', 'cancelar'])}
          onCommand={() => undefined /* no-op: listener vive en useVoiceCommand arriba */}
          {...(recognizer ? { recognizer } : {})}
          idleLabel='Di "aceptar oferta"'
        />

        {localState === 'confirming' && (
          <>
            <button
              type="button"
              onClick={ratify}
              className="inline-flex items-center gap-2 rounded-md bg-success-700 px-4 py-3 font-semibold text-sm text-white shadow hover:bg-success-800"
              data-testid="voice-accept-confirm"
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              Confirmar aceptación · {trackingCode}
            </button>
            <button type="button" onClick={cancel} className="text-neutral-500 text-xs underline">
              Cancelar
            </button>
          </>
        )}

        {localState === 'error' && (
          <button
            type="button"
            onClick={cancel}
            className="inline-flex items-center gap-2 rounded-md bg-amber-50 px-4 py-3 font-medium text-amber-800 text-sm ring-1 ring-amber-500 hover:bg-amber-100"
          >
            Volver
          </button>
        )}
      </div>

      {localState === 'idle' && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-neutral-500">
          <Info className="mt-px h-3 w-3 shrink-0" aria-hidden />
          Solo aparece cuando hay una sola oferta pendiente — si hay más, tócala manualmente.
        </p>
      )}
    </section>
  );
}
