import { AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react';
import { useState } from 'react';
import {
  INCIDENT_TYPES,
  INCIDENT_TYPE_LABELS,
  type IncidentType,
  useReportarIncidenteMutation,
} from '../../hooks/use-reportar-incidente.js';
import { useVoiceCommand } from '../../hooks/use-voice-command.js';
import { ApiError } from '../../lib/api-client.js';
import type { RecognizedCommand, VoiceCommandController } from '../../services/voice-commands.js';
import { VoiceCommandButton } from '../voice/VoiceCommandButton.js';

/**
 * Card de reportar incidente para el conductor (Phase 4 PR-K6b).
 *
 * Visible en `/app/asignaciones/:id` cuando el trip está activo
 * (asignado | en_proceso). Cierra el loop voice-first del
 * `marcar_incidente` intent del PR-K2 framework.
 *
 * **UX hands-free**:
 *   - Estado idle: botón secundario "Reportar incidente" (botón
 *     pequeño, no compite visualmente con el StatusCard de entrega).
 *   - Voice command "marcar incidente" / "tengo un problema" →
 *     abre el panel de selección de tipo.
 *   - Panel: 5 botones grandes (≥56px hit-area) uno por tipo. El
 *     conductor toca o dice el tipo.
 *   - Comando "cancelar" en cualquier estado → cierra panel.
 *   - Submit → toast success / error, no requiere navegación.
 *
 * **NO incluye**:
 *   - Foto / archivo adjunto (PR-K6c futuro)
 *   - Descripción libre (PR-K6c — voice dictation o teclado)
 *   - Selección de severidad (todos los incidentes son operacionales,
 *     no jerarquizamos en v1)
 *
 * El backend persiste el incidente como tripEvent — el shipper lo ve
 * en el timeline del trip (futuro PR-K6c agregará push notif).
 */

export interface IncidentReportCardProps {
  assignmentId: string;
  /** Inyectable para tests. */
  recognizer?: VoiceCommandController;
}

type LocalState = 'idle' | 'selecting' | 'submitting' | 'success' | 'error';

const SUCCESS_TOAST_MS = 5000;

export function IncidentReportCard({ assignmentId, recognizer }: IncidentReportCardProps) {
  const [localState, setLocalState] = useState<LocalState>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const mutation = useReportarIncidenteMutation();

  const openPanel = (): void => {
    setLocalState('selecting');
    setErrorMsg(null);
  };

  const closePanel = (): void => {
    setLocalState('idle');
    setErrorMsg(null);
  };

  // Voice listener a nivel de la card — vive independiente del
  // VoiceCommandButton que solo aparece en idle. Esto permite que
  // "cancelar" funcione mientras el panel de selección está abierto
  // (cuando el VoiceCommandButton está unmounted).
  const handleVoiceCommand = (cmd: RecognizedCommand): void => {
    if (cmd.intent === 'cancelar') {
      closePanel();
      return;
    }
    if (cmd.intent === 'marcar_incidente') {
      // setLocalState con función para evitar stale closure: si el
      // estado ya cambió a selecting/submitting/etc., no re-abrimos.
      setLocalState((prev) => (prev === 'idle' ? 'selecting' : prev));
    }
  };

  useVoiceCommand({
    acceptedIntents: new Set(['marcar_incidente', 'cancelar']),
    onCommand: handleVoiceCommand,
    ...(recognizer ? { recognizer } : {}),
  });

  const submitIncident = (incidentType: IncidentType): void => {
    setLocalState('submitting');
    setErrorMsg(null);
    mutation.mutate(
      { assignmentId, incidentType },
      {
        onSuccess: () => {
          setLocalState('success');
          // Auto-volver a idle tras un tiempo para dejar la card lista
          // si el conductor reporta otro incidente en el mismo trip.
          setTimeout(() => setLocalState('idle'), SUCCESS_TOAST_MS);
        },
        onError: (err) => {
          setLocalState('error');
          if (err instanceof ApiError && err.status === 403) {
            setErrorMsg('No tienes permisos para reportar incidentes en este viaje.');
          } else if (err instanceof ApiError && err.status === 404) {
            setErrorMsg('No se encontró el viaje. Refresca la página.');
          } else if (err instanceof ApiError) {
            setErrorMsg('No se pudo registrar el incidente. Intenta otra vez.');
          } else {
            setErrorMsg('Sin conexión. Verifica tu red e intenta otra vez.');
          }
        },
      },
    );
  };

  if (localState === 'success') {
    return (
      <section
        aria-label="Incidente reportado"
        className="border-success-200 border-b bg-success-50 px-4 py-3"
      >
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-success-700" aria-hidden />
          <p className="font-medium text-sm text-success-800">
            Incidente reportado. El generador de carga fue notificado.
          </p>
        </div>
      </section>
    );
  }

  if (localState === 'idle') {
    return (
      <section
        aria-label="Reportar incidente"
        className="border-neutral-200 border-b bg-white px-4 py-3"
      >
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={openPanel}
            className="inline-flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 font-medium text-amber-800 text-sm ring-1 ring-amber-500/30 hover:bg-amber-100"
            data-testid="incident-open-button"
          >
            <AlertTriangle className="h-4 w-4" aria-hidden />
            Reportar incidente
          </button>
          <span className="text-neutral-500 text-xs">o di "marcar incidente"</span>
          {/* VoiceCommandButton compacto al lado para activar el flow
              hands-free. Comparte intents marcar_incidente + cancelar. */}
          {/* VoiceCommandButton solo en idle — el listener real vive
              en useVoiceCommand a nivel de IncidentReportCard, así que
              "cancelar" funciona aún cuando este botón está unmounted
              (panel de selección abierto). */}
          <VoiceCommandButton
            acceptedIntents={new Set(['marcar_incidente', 'cancelar'])}
            onCommand={() => undefined /* no-op: listener vive arriba */}
            {...(recognizer ? { recognizer } : {})}
            idleLabel='Di "incidente"'
          />
        </div>
      </section>
    );
  }

  // Panel selecting: 5 botones grandes (uno por tipo) + voz cancel.
  return (
    <section
      aria-label="Selecciona tipo de incidente"
      className="border-amber-200 border-b bg-amber-50 px-4 py-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <p className="font-semibold text-amber-900 text-sm">¿Qué tipo de incidente?</p>
        <button
          type="button"
          onClick={closePanel}
          aria-label="Cancelar"
          disabled={localState === 'submitting'}
          className="rounded p-1 text-amber-700 hover:bg-amber-100 disabled:opacity-50"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {INCIDENT_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => submitIncident(t)}
            disabled={localState === 'submitting'}
            className="flex min-h-[56px] items-center justify-center rounded-md bg-white px-4 py-3 font-medium text-amber-900 text-sm ring-1 ring-amber-500/30 hover:bg-amber-100 disabled:opacity-50"
            data-testid={`incident-type-${t}`}
          >
            {INCIDENT_TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      {localState === 'submitting' && (
        <div className="mt-3 inline-flex items-center gap-2 text-amber-800 text-xs">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Registrando…
        </div>
      )}

      {localState === 'error' && errorMsg && (
        <p className="mt-3 text-amber-900 text-xs" data-testid="incident-error">
          {errorMsg}
        </p>
      )}
    </section>
  );
}
