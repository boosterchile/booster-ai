import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type CommandIntent,
  type RecognitionState,
  type RecognizedCommand,
  type VoiceCommandController,
  createVoiceCommandRecognizer,
} from '../services/voice-commands.js';

/**
 * Hook que encapsula el ciclo de vida del recognizer de comandos por
 * voz (Phase 4 PR-K3). El componente caller pasa los intents que le
 * interesan + sus handlers; el hook se ocupa del subscribe/unsubscribe,
 * del state, y de exponer los métodos start/stop/abort al componente.
 *
 * **Filtrado por intents soportados**:
 *   El caller pasa un set de intents que tiene sentido en su contexto
 *   (ej. la pantalla de detalle de assignment soporta `confirmar_entrega`
 *   y `repetir`, pero no `aceptar_oferta`). Si el conductor dice un
 *   comando fuera del set, el hook lo trata como `onUnknown` (feedback
 *   "no entiendo eso acá") en vez de disparar la acción incorrecta.
 *
 * **Auto-stop tras comando**:
 *   Push-to-talk natural: cuando reconoce un comando válido, llamamos
 *   `stop()` automáticamente (el recognizer ya devolvió un final
 *   result; el browser dispara onend en cualquier caso, pero el stop
 *   explícito acelera la transición a 'idle').
 */

export interface UseVoiceCommandOpts {
  /**
   * Set de intents que el caller acepta. Si el recognizer detecta un
   * intent fuera de este set, llama a `onUnknown` con el comando
   * detectado (para feedback "no entiendo eso acá"). Default: todos
   * los intents soportados.
   */
  acceptedIntents?: ReadonlySet<CommandIntent>;
  /** Handler para cada intent reconocido + aceptado. */
  onCommand?: (cmd: RecognizedCommand) => void;
  /**
   * Handler para intent reconocido pero NO en `acceptedIntents`. Útil
   * para dar feedback "no se puede hacer eso aquí".
   */
  onUnknown?: (cmd: RecognizedCommand) => void;
  /**
   * Handler para transcript final que el parser no pudo mapear a
   * ningún intent. Útil para feedback "no te entendí".
   */
  onUnrecognized?: (transcript: string) => void;
  /**
   * Inyectable para tests. Default: createVoiceCommandRecognizer().
   */
  recognizer?: VoiceCommandController;
}

export interface UseVoiceCommandResult {
  /** Estado del recognizer. */
  state: RecognitionState;
  /** Última transcripción no reconocida (para feedback "no entendí"). */
  lastUnrecognized: string | null;
  /** Inicia listening (push-to-talk). */
  start: () => void;
  /** Detiene listening sin abortar. */
  stop: () => void;
  /** Aborta inmediatamente. */
  abort: () => void;
}

export function useVoiceCommand(opts: UseVoiceCommandOpts = {}): UseVoiceCommandResult {
  const {
    recognizer: injectedRecognizer,
    acceptedIntents,
    onCommand,
    onUnknown,
    onUnrecognized,
  } = opts;

  // Mantenemos los handlers en refs para no re-suscribir cada render
  // si el caller pasa funciones inline.
  const onCommandRef = useRef(onCommand);
  const onUnknownRef = useRef(onUnknown);
  const onUnrecognizedRef = useRef(onUnrecognized);
  onCommandRef.current = onCommand;
  onUnknownRef.current = onUnknown;
  onUnrecognizedRef.current = onUnrecognized;

  const recognizer = useMemo<VoiceCommandController>(
    () => injectedRecognizer ?? createVoiceCommandRecognizer(),
    [injectedRecognizer],
  );

  const [state, setState] = useState<RecognitionState>(() => recognizer.getState());
  const [lastUnrecognized, setLastUnrecognized] = useState<string | null>(null);

  useEffect(() => {
    const unsubState = recognizer.subscribe(setState);
    const unsubCmd = recognizer.onCommand((cmd) => {
      if (acceptedIntents && !acceptedIntents.has(cmd.intent)) {
        onUnknownRef.current?.(cmd);
        return;
      }
      onCommandRef.current?.(cmd);
      // Auto-stop para liberar el mic.
      recognizer.stop();
    });
    const unsubUnrec = recognizer.onUnrecognized((t) => {
      setLastUnrecognized(t);
      onUnrecognizedRef.current?.(t);
    });
    return () => {
      unsubState();
      unsubCmd();
      unsubUnrec();
      // Si el componente se desmonta mientras escucha, abortamos para
      // soltar el mic — sin esto el browser puede mantenerlo activo
      // hasta el next gesture.
      recognizer.abort();
    };
  }, [recognizer, acceptedIntents]);

  return {
    state,
    lastUnrecognized,
    start: () => recognizer.start(),
    stop: () => recognizer.stop(),
    abort: () => recognizer.abort(),
  };
}
