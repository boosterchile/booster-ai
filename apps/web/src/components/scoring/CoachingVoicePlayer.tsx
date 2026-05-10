import { Pause, Volume2 } from 'lucide-react';
import { type ChangeEvent, useEffect, useMemo, useState } from 'react';
import {
  type CoachingVoiceController,
  type VoiceState,
  createCoachingVoice,
  loadAutoplayPreference,
  saveAutoplayPreference,
} from '../../services/coaching-voice.js';

/**
 * Botón único para reproducir el coaching IA por voz al conductor
 * (Phase 3 PR-J3, redefinida tras feedback PO — ver
 * playbooks/002-canal-coaching-voz-no-whatsapp.md).
 *
 * **Diseño hands-free**:
 *   - Un solo botón de acción primaria (Play/Pause). Toggle con tap.
 *   - Preferencia de auto-play persistida en localStorage. Default OFF
 *     (mute). Cuando ON, el componente arranca a hablar al montarse —
 *     útil para que el conductor termine el viaje, abra el detalle, y
 *     escuche sin tocar nada.
 *   - Un único checkbox secundario para activar auto-play en futuros
 *     viajes ("Escuchar automáticamente al terminar viajes"). Visible
 *     solo cuando el state es 'idle' o 'speaking', no en 'unsupported'.
 *   - Sin slider de volumen, sin rate, sin elección de voz. Lo decide
 *     el OS.
 *
 * **Degradación**:
 *   - Si el browser no soporta speechSynthesis (rarísimo en 2026 —
 *     IE/legacy), el player se oculta. El mensaje sigue visible en
 *     texto en la `BehaviorScoreCard` parent.
 *
 * **Accesibilidad**:
 *   - aria-pressed refleja state de play.
 *   - aria-live="polite" anuncia "Reproduciendo coaching" / "Coaching
 *     terminado" al lector de pantalla, sin interrumpir.
 */

export interface CoachingVoicePlayerProps {
  /** Texto del coaching a reproducir. */
  message: string;
  /**
   * Inyectable para tests. Default: createCoachingVoice() singleton
   * por mount. Tests pueden pasar uno con synth stubeado.
   */
  controller?: CoachingVoiceController;
}

export function CoachingVoicePlayer({ message, controller }: CoachingVoicePlayerProps) {
  // useMemo evita re-construir el controller en cada render. La función
  // factory crea su propia instancia de speechSynthesis singleton, así
  // que dos players en la misma página comparten la cola del browser
  // (uno cancela al otro al hacer play — comportamiento deseado).
  const ctrl = useMemo(() => controller ?? createCoachingVoice(), [controller]);
  const [state, setState] = useState<VoiceState>(ctrl.getState());
  const [autoplayEnabled, setAutoplayEnabled] = useState(() => loadAutoplayPreference());

  useEffect(() => {
    return ctrl.subscribe(setState);
  }, [ctrl]);

  // Auto-play opt-in: al montar con preferencia activa, hablar de inmediato.
  // No re-disparamos en cada cambio de message — el conductor abrió el
  // detalle del trip, escuchó una vez, listo. Si quiere repetir, click
  // manual.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberadamente solo al mount
  useEffect(() => {
    if (autoplayEnabled && state === 'idle' && message.trim().length > 0) {
      ctrl.play(message);
    }
  }, []);

  if (state === 'unsupported') {
    // El navegador no soporta TTS. Ocultarse — el texto sigue visible
    // arriba en la card parent, no perdemos información.
    return null;
  }

  const isSpeaking = state === 'speaking';
  const isError = state === 'error';

  const handleToggle = (): void => {
    if (isSpeaking) {
      ctrl.stop();
    } else {
      ctrl.play(message);
    }
  };

  const handleAutoplayChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const next = e.target.checked;
    setAutoplayEnabled(next);
    saveAutoplayPreference(next);
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3" data-testid="coaching-voice-player">
      <button
        type="button"
        onClick={handleToggle}
        aria-pressed={isSpeaking}
        aria-label={isSpeaking ? 'Detener reproducción' : 'Escuchar coaching por voz'}
        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium text-xs transition ${
          isSpeaking
            ? 'bg-primary-700 text-white hover:bg-primary-800'
            : 'bg-primary-50 text-primary-700 ring-1 ring-primary-700/20 hover:bg-primary-100'
        }`}
      >
        {isSpeaking ? (
          <>
            <Pause className="h-3.5 w-3.5" aria-hidden />
            <span>Detener</span>
          </>
        ) : (
          <>
            <Volume2 className="h-3.5 w-3.5" aria-hidden />
            <span>Escuchar</span>
          </>
        )}
      </button>

      <label className="inline-flex cursor-pointer items-center gap-1.5 text-neutral-600 text-xs">
        <input
          type="checkbox"
          checked={autoplayEnabled}
          onChange={handleAutoplayChange}
          className="h-3.5 w-3.5 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
        />
        <span>Reproducir automáticamente al terminar viajes</span>
      </label>

      {/* Live region para lectores de pantalla. No visible. */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {isSpeaking ? 'Reproduciendo coaching' : ''}
        {isError ? 'Error reproduciendo audio. El texto sigue disponible.' : ''}
      </span>

      {isError && (
        <span className="text-amber-700 text-xs">
          No se pudo reproducir el audio. El texto está disponible arriba.
        </span>
      )}
    </div>
  );
}
