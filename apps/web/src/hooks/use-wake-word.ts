import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type WakeWordController,
  type WakeWordState,
  createWakeWordController,
} from '../services/wake-word.js';

/**
 * ADR-036 — Hook React que envuelve el `WakeWordController` y lo integra
 * con el ciclo de vida del componente que lo monta.
 *
 * Responsabilidades:
 *   - Crear el controller en mount.
 *   - Llamar a `init()` con la access key (de env) + path al modelo.
 *   - Suscribirse a eventos de estado para que la UI re-renderee.
 *   - Limpiar (`destroy()`) en unmount.
 *
 * NO maneja:
 *   - El gating por vehicle-stopped (eso vive en `useDriverStoppedGate`
 *     que pause/resume este hook). Ver ADR-036 § "Activación condicionada".
 *   - El persisted preference del toggle (eso vive en
 *     services/coaching-voice.ts pattern, replicar acá si se decide).
 *
 * Estado expuesto:
 *   - `state`: `WakeWordState` actual del controller.
 *   - `isEnabled`: ¿el caller pidió enable()?
 *   - `enable()` / `disable()` / `pause()` / `resume()`: pass-through.
 *
 * Onwake: el caller pasa la función `onWake` que se ejecutará cuando
 * el wake-word se detecte. Debe ser idempotente y rápida (~16ms).
 */

export interface UseWakeWordResult {
  state: WakeWordState;
  isEnabled: boolean;
  enable: () => void;
  disable: () => void;
  pause: (reason: string) => void;
  resume: () => void;
}

export interface UseWakeWordOptions {
  /** Si false, el hook queda inerte (no inicializa SDK). */
  enabled: boolean;
  /**
   * Access key Picovoice. Provisto via env (Vite `VITE_PICOVOICE_ACCESS_KEY`).
   * Si vacío, el controller resuelve a `'unavailable'`.
   */
  accessKey: string;
  /**
   * URL al modelo .ppn custom. Vacío hasta que tengamos
   * `oye-booster-cl.ppn` entrenado.
   */
  modelPath: string;
  /**
   * Callback al detectar wake-word.
   */
  onWake: () => void;
}

export function useWakeWord(opts: UseWakeWordOptions): UseWakeWordResult {
  const [state, setState] = useState<WakeWordState>('idle');
  const [isEnabled, setIsEnabled] = useState(false);
  const controllerRef = useRef<WakeWordController | null>(null);
  const onWakeRef = useRef(opts.onWake);

  // Mantener onWake fresca sin re-trigger del effect.
  useEffect(() => {
    onWakeRef.current = opts.onWake;
  }, [opts.onWake]);

  // Init / destroy lifecycle.
  useEffect(() => {
    if (!opts.enabled) {
      return undefined;
    }
    let cancelled = false;
    const controller = createWakeWordController();
    controllerRef.current = controller;

    const unsub = controller.on('state', (s) => {
      if (!cancelled) {
        setState(s);
      }
    });

    void controller
      .init({
        accessKey: opts.accessKey,
        modelPath: opts.modelPath,
        onWake: () => onWakeRef.current(),
      })
      .catch(() => {
        if (!cancelled) {
          setState('error');
        }
      });

    return () => {
      cancelled = true;
      unsub();
      void controller.destroy();
      controllerRef.current = null;
    };
  }, [opts.enabled, opts.accessKey, opts.modelPath]);

  const enable = useCallback(() => {
    setIsEnabled(true);
    controllerRef.current?.enable();
  }, []);
  const disable = useCallback(() => {
    setIsEnabled(false);
    controllerRef.current?.disable();
  }, []);
  const pause = useCallback((reason: string) => {
    controllerRef.current?.pause(reason);
  }, []);
  const resume = useCallback(() => {
    controllerRef.current?.resume();
  }, []);

  return {
    state,
    isEnabled,
    enable,
    disable,
    pause,
    resume,
  };
}
