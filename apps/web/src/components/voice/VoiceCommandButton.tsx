import { Mic, MicOff, Square } from 'lucide-react';
import { useVoiceCommand } from '../../hooks/use-voice-command.js';
import type {
  CommandIntent,
  RecognizedCommand,
  VoiceCommandController,
} from '../../services/voice-commands.js';

/**
 * Botón push-to-talk grande para el conductor (Phase 4 PR-K3).
 *
 * **Diseño hands-free**:
 *   - Un solo botón circular grande (≥ 64px hit-area según WCAG SC 2.5.5).
 *   - Tap para empezar a escuchar (mic abre); el browser cierra solo
 *     cuando detecta silencio o el conductor toca "Detener".
 *   - 4 estados visuales:
 *     - idle: Mic icon, fondo neutro, "Toca para hablar"
 *     - listening: Square icon (símbolo de stop), fondo primary
 *       pulsante, "Escuchando…"
 *     - processing: spinner sutil, "Procesando…"
 *     - error: MicOff icon + texto "Permitir micrófono" si denegado
 *   - Si el browser no soporta Web Speech Recognition (Firefox), el
 *     botón se oculta. El caller debe proveer fallback visual (botones
 *     comunes).
 *
 * **Accesibilidad**:
 *   - aria-pressed refleja listening.
 *   - aria-live="polite" anuncia transcript reconocido o "no entendí".
 *
 * **Composición**:
 *   El botón es deliberadamente "tonto" — recibe handlers como props,
 *   no sabe de assignments ni offers. Cada pantalla del conductor
 *   monta este botón con su propio set de intents soportados.
 */

export interface VoiceCommandButtonProps {
  /**
   * Intents que esta pantalla acepta. Si el conductor dice un comando
   * fuera del set, se dispara `onUnknown` (con feedback "no se puede
   * hacer eso aquí") en vez de la acción.
   */
  acceptedIntents: ReadonlySet<CommandIntent>;
  /** Handler para cada intent reconocido + aceptado. */
  onCommand: (cmd: RecognizedCommand) => void;
  /** Opcional: handler para intent fuera del set aceptado. */
  onUnknown?: (cmd: RecognizedCommand) => void;
  /** Inyectable para tests. */
  recognizer?: VoiceCommandController;
  /**
   * Label visible debajo del botón. Default "Toca para hablar".
   * Algunas pantallas pueden personalizar ("Toca y di entregado").
   */
  idleLabel?: string;
}

export function VoiceCommandButton({
  acceptedIntents,
  onCommand,
  onUnknown,
  recognizer,
  idleLabel = 'Toca para hablar',
}: VoiceCommandButtonProps) {
  const { state, lastUnrecognized, start, stop } = useVoiceCommand({
    acceptedIntents,
    onCommand,
    ...(onUnknown ? { onUnknown } : {}),
    ...(recognizer ? { recognizer } : {}),
  });

  if (state === 'unsupported') {
    return null;
  }

  const isListening = state === 'listening';
  const isProcessing = state === 'processing';
  const isError = state === 'error';

  const handleClick = (): void => {
    if (isListening || isProcessing) {
      stop();
    } else {
      start();
    }
  };

  const buttonLabel = (() => {
    if (isError) {
      return 'Permitir micrófono';
    }
    if (isListening) {
      return 'Detener';
    }
    if (isProcessing) {
      return 'Procesando…';
    }
    return 'Hablar';
  })();

  const ariaLabel = (() => {
    if (isError) {
      return 'Activar permisos del micrófono';
    }
    if (isListening) {
      return 'Detener escucha';
    }
    return 'Activar comando por voz';
  })();

  return (
    <div className="flex flex-col items-center gap-2" data-testid="voice-command-button">
      <button
        type="button"
        onClick={handleClick}
        aria-pressed={isListening}
        aria-label={ariaLabel}
        disabled={isProcessing}
        className={[
          'flex h-20 w-20 items-center justify-center rounded-full transition',
          'shadow-lg',
          isListening
            ? 'animate-pulse bg-primary-700 text-white'
            : isError
              ? 'bg-amber-100 text-amber-800 ring-2 ring-amber-500'
              : 'bg-primary-50 text-primary-700 ring-2 ring-primary-700/30 hover:bg-primary-100',
        ].join(' ')}
      >
        {isError ? (
          <MicOff className="h-8 w-8" aria-hidden />
        ) : isListening ? (
          <Square className="h-8 w-8" aria-hidden />
        ) : (
          <Mic className="h-8 w-8" aria-hidden />
        )}
      </button>

      <p className="font-medium text-neutral-800 text-sm">{buttonLabel}</p>
      {!isListening && !isError && !isProcessing && (
        <p className="text-neutral-500 text-xs">{idleLabel}</p>
      )}
      {isError && (
        <p className="max-w-[200px] text-center text-amber-700 text-xs">
          Activa el micrófono en los ajustes del navegador para usar comandos por voz.
        </p>
      )}

      {/* Live region para feedback no-visual. */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {isListening ? 'Escuchando comando' : ''}
        {lastUnrecognized && state === 'idle'
          ? `No entendí: ${lastUnrecognized}. Intenta otra vez.`
          : ''}
      </span>

      {lastUnrecognized && state === 'idle' && (
        <p
          className="max-w-[240px] text-center text-neutral-500 text-xs"
          data-testid="voice-unrecognized-hint"
        >
          No entendí "{lastUnrecognized}". Intenta de nuevo.
        </p>
      )}
    </div>
  );
}
