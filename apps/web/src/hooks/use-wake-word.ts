import { useEffect, useRef, useState } from 'react';
import { type StoppedDetector, createStoppedDetector } from '../services/stopped-detector.js';
import {
  type WakeWordController,
  type WakeWordState,
  createWakeWordController,
} from '../services/wake-word.js';

/**
 * ADR-036 — Hook que monta el `WakeWordController` con los gates de
 * §Activación condicionada:
 *
 *   - **Vehículo**: el micrófono solo escucha con el vehículo detenido
 *     (`stopped-detector`, mismo gate que el coaching por voz). Mientras no
 *     haya lectura `stopped`, queda en pausa.
 *   - **Pestaña**: oculta (pantalla apagada, app en segundo plano) → pausa.
 *
 * Con `enabled=false` el hook queda inerte: no carga el SDK ni pide el
 * micrófono. Al desmontar, `destroy()` suelta el micrófono y el worker.
 */

export const GATE_VEHICULO = 'vehiculo_no_detenido';
export const GATE_PESTANA = 'pestana_oculta';

export interface UseWakeWordOptions {
  /** Flag + preferencia del conductor + config disponible. */
  enabled: boolean;
  accessKey: string;
  keywordPath: string;
  modelPath: string;
  sensitivity?: number;
  /** Se llama en cada detección de "Oye Booster". */
  onWake: () => void;
  /** Inyectables para tests. */
  crearController?: () => WakeWordController;
  crearDetector?: () => StoppedDetector;
}

export interface UseWakeWordResult {
  state: WakeWordState;
}

export function useWakeWord(opts: UseWakeWordOptions): UseWakeWordResult {
  const [state, setState] = useState<WakeWordState>('idle');
  const onWakeRef = useRef(opts.onWake);
  const crearControllerRef = useRef(opts.crearController ?? (() => createWakeWordController()));
  const crearDetectorRef = useRef(opts.crearDetector ?? (() => createStoppedDetector()));

  useEffect(() => {
    onWakeRef.current = opts.onWake;
  }, [opts.onWake]);

  const { enabled, accessKey, keywordPath, modelPath, sensitivity } = opts;

  useEffect(() => {
    if (!enabled) {
      setState('idle');
      return undefined;
    }
    const controller = crearControllerRef.current();
    const offState = controller.on('state', setState);

    // Gates antes de enable: así nunca abre el micrófono sin pasar por ellos.
    controller.pause(GATE_VEHICULO);
    const actualizarPestana = (): void => {
      if (document.visibilityState === 'hidden') {
        controller.pause(GATE_PESTANA);
      } else {
        controller.resume(GATE_PESTANA);
      }
    };
    actualizarPestana();
    document.addEventListener('visibilitychange', actualizarPestana);

    const detector = crearDetectorRef.current();
    const offDetector = detector.subscribe((s) => {
      if (s === 'stopped') {
        controller.resume(GATE_VEHICULO);
      } else {
        controller.pause(GATE_VEHICULO);
      }
    });

    void controller
      .init({
        accessKey,
        keywordPath,
        modelPath,
        ...(sensitivity === undefined ? {} : { sensitivity }),
        onWake: () => onWakeRef.current(),
      })
      .then(() => controller.enable());

    return () => {
      offDetector();
      detector.stop();
      document.removeEventListener('visibilitychange', actualizarPestana);
      offState();
      void controller.destroy();
    };
  }, [enabled, accessKey, keywordPath, modelPath, sensitivity]);

  return { state };
}
