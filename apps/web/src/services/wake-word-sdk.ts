import * as porcupine from '@picovoice/porcupine-web';
import { WebVoiceProcessor } from '@picovoice/web-voice-processor';
import type { SdkPorcupine, WorkerPorcupine } from './wake-word.js';

/**
 * Adaptador del SDK real de Picovoice a `SdkPorcupine` (ADR-036, T10-22).
 *
 * Vive en su propio módulo para que `wake-word.ts` lo cargue con `import()`:
 * el SDK y su WASM quedan en un chunk que solo baja quien activó el
 * wake-word con el flag encendido.
 */
export function cargarSdkPicovoice(): SdkPorcupine {
  // WVP suscribe el PorcupineWorker concreto; el mapa lo recupera sin casts.
  const reales = new WeakMap<WorkerPorcupine, porcupine.PorcupineWorker>();
  const real = (worker: WorkerPorcupine): porcupine.PorcupineWorker => {
    const w = reales.get(worker);
    if (!w) {
      throw new Error('wake-word: worker desconocido para WebVoiceProcessor');
    }
    return w;
  };
  return {
    PorcupineWorker: {
      create: async (accessKey, keyword, onDetection, model, options) => {
        const w = await porcupine.PorcupineWorker.create(
          accessKey,
          keyword,
          onDetection,
          model,
          options,
        );
        reales.set(w, w);
        return w;
      },
    },
    WebVoiceProcessor: {
      subscribe: (worker) => WebVoiceProcessor.subscribe(real(worker)),
      unsubscribe: (worker) => WebVoiceProcessor.unsubscribe(real(worker)),
    },
  };
}
