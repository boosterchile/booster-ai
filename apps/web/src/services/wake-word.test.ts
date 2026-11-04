import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type SdkPorcupine,
  type WakeWordController,
  type WakeWordState,
  createWakeWordController,
} from './wake-word.js';

/**
 * SDK falso: registra subscribe/unsubscribe/release y deja disparar la
 * detección con `detectar()`. El controlador real nunca carga WASM en tests.
 */
function sdkFalso(opts: { crearFalla?: Error; subscribeFalla?: Error } = {}) {
  let callback: ((d: { index: number; label: string }) => void) | null = null;
  let errorCallback: ((e: Error) => void) | null = null;
  const worker = { release: vi.fn(async () => undefined), terminate: vi.fn() };
  const create = vi.fn(
    async (
      _accessKey: string,
      _keyword: unknown,
      cb: (d: { index: number; label: string }) => void,
      _model: unknown,
      options?: { processErrorCallback?: (e: Error) => void },
    ) => {
      if (opts.crearFalla) {
        throw opts.crearFalla;
      }
      callback = cb;
      errorCallback = options?.processErrorCallback ?? null;
      return worker;
    },
  );
  const subscribe = vi.fn(async () => {
    if (opts.subscribeFalla) {
      throw opts.subscribeFalla;
    }
  });
  const unsubscribe = vi.fn(async () => undefined);
  const sdk: SdkPorcupine = {
    PorcupineWorker: { create },
    WebVoiceProcessor: { subscribe, unsubscribe },
  };
  return {
    sdk,
    cargarSdk: vi.fn(async () => sdk),
    create,
    subscribe,
    unsubscribe,
    worker,
    detectar: () => callback?.({ index: 0, label: 'oye-booster' }),
    errorProceso: (e: Error) => errorCallback?.(e),
  };
}

const OPTS = {
  accessKey: 'clave-picovoice',
  keywordPath: 'https://cdn.example/oye-booster-cl.ppn',
  modelPath: 'https://cdn.example/porcupine_params_es.pv',
  sensitivity: 0.6,
};

/** Espera a que se resuelvan las promesas encadenadas (subscribe async). */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function estados(c: WakeWordController): WakeWordState[] {
  const lista: WakeWordState[] = [];
  c.on('state', (s) => lista.push(s));
  return lista;
}

describe('PorcupineWakeWordController', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('arranca en idle', () => {
    expect(createWakeWordController().state).toBe('idle');
  });

  it('sin access key o sin modelo → unavailable, emite error y no carga el SDK', async () => {
    for (const faltante of [
      { ...OPTS, accessKey: '' },
      { ...OPTS, keywordPath: '' },
      { ...OPTS, modelPath: '' },
    ]) {
      const f = sdkFalso();
      const c = createWakeWordController({ cargarSdk: f.cargarSdk });
      const errores: string[] = [];
      c.on('error', (e) => errores.push(e.message));
      await c.init({ ...faltante, onWake: () => undefined });
      expect(c.state).toBe('unavailable');
      expect(errores[0]).toMatch(/no disponible/);
      expect(f.cargarSdk).not.toHaveBeenCalled();
      c.enable();
      await flush();
      expect(f.subscribe).not.toHaveBeenCalled();
    }
  });

  it('sin WebAssembly → unavailable sin cargar el SDK', async () => {
    const f = sdkFalso();
    const c = createWakeWordController({ cargarSdk: f.cargarSdk, soportaWasm: () => false });
    await c.init({ ...OPTS, onWake: () => undefined });
    expect(c.state).toBe('unavailable');
    expect(f.cargarSdk).not.toHaveBeenCalled();
  });

  it('init crea el worker con la keyword custom y el modelo, sin pedir el micrófono', async () => {
    const f = sdkFalso();
    const c = createWakeWordController({ cargarSdk: f.cargarSdk });
    const lista = estados(c);
    await c.init({ ...OPTS, onWake: () => undefined });
    expect(lista).toEqual(['initializing', 'idle']);
    const [accessKey, keyword, , model, options] = f.create.mock.calls[0] ?? [];
    expect(accessKey).toBe('clave-picovoice');
    expect(keyword).toEqual({
      publicPath: OPTS.keywordPath,
      label: 'oye-booster',
      sensitivity: 0.6,
      customWritePath: OPTS.keywordPath,
    });
    // La URL es la llave de la caché del SDK: un modelo nuevo (URL nueva) se
    // descarga; el mismo se reutiliza de IndexedDB.
    expect(model).toEqual({ publicPath: OPTS.modelPath, customWritePath: OPTS.modelPath });
    expect(options?.processErrorCallback).toBeTypeOf('function');
    expect(f.subscribe).not.toHaveBeenCalled();
  });

  it('enable suscribe al procesador de voz y pasa a listening', async () => {
    const f = sdkFalso();
    const c = createWakeWordController({ cargarSdk: f.cargarSdk });
    await c.init({ ...OPTS, onWake: () => undefined });
    c.enable();
    await flush();
    expect(f.subscribe).toHaveBeenCalledWith(f.worker);
    expect(c.state).toBe('listening');
  });

  it('enable antes de que termine init activa apenas el worker está listo', async () => {
    const f = sdkFalso();
    const c = createWakeWordController({ cargarSdk: f.cargarSdk });
    const init = c.init({ ...OPTS, onWake: () => undefined });
    c.enable();
    await init;
    await flush();
    expect(c.state).toBe('listening');
    expect(f.subscribe).toHaveBeenCalledTimes(1);
  });

  it('pause libera el micrófono; resume lo vuelve a pedir solo si enable estaba pedido', async () => {
    const f = sdkFalso();
    const c = createWakeWordController({ cargarSdk: f.cargarSdk });
    await c.init({ ...OPTS, onWake: () => undefined });
    c.enable();
    await flush();
    c.pause('vehiculo_en_movimiento');
    await flush();
    expect(f.unsubscribe).toHaveBeenCalledWith(f.worker);
    expect(c.state).toBe('paused');
    c.resume();
    await flush();
    expect(f.subscribe).toHaveBeenCalledTimes(2);
    expect(c.state).toBe('listening');

    c.disable();
    await flush();
    expect(c.state).toBe('idle');
    c.resume();
    await flush();
    expect(f.subscribe).toHaveBeenCalledTimes(2);
  });

  it('pause antes de enable deja el gate puesto: enable no pide el micrófono hasta resume', async () => {
    const f = sdkFalso();
    const c = createWakeWordController({ cargarSdk: f.cargarSdk });
    await c.init({ ...OPTS, onWake: () => undefined });
    c.pause('pestana_oculta');
    c.enable();
    await flush();
    expect(f.subscribe).not.toHaveBeenCalled();
    expect(c.state).toBe('paused');
    c.resume();
    await flush();
    expect(c.state).toBe('listening');
  });

  it('dos gates: resume de uno no reactiva mientras el otro sigue puesto', async () => {
    const f = sdkFalso();
    const c = createWakeWordController({ cargarSdk: f.cargarSdk });
    await c.init({ ...OPTS, onWake: () => undefined });
    c.enable();
    await flush();
    c.pause('vehiculo_en_movimiento');
    c.pause('pestana_oculta');
    c.resume('vehiculo_en_movimiento');
    await flush();
    expect(c.state).toBe('paused');
    c.resume('pestana_oculta');
    await flush();
    expect(c.state).toBe('listening');
  });

  it('detección: emite detection, llama onWake y suelta el micrófono durante la pausa post-detección', async () => {
    vi.useFakeTimers();
    const f = sdkFalso();
    const onWake = vi.fn();
    const c = createWakeWordController({ cargarSdk: f.cargarSdk, pausaTrasDeteccionMs: 8000 });
    const detecciones: number[] = [];
    c.on('detection', (d) => detecciones.push(d.timestamp));
    await c.init({ ...OPTS, onWake });
    c.enable();
    await vi.runOnlyPendingTimersAsync();
    expect(c.state).toBe('listening');

    f.detectar();
    await vi.advanceTimersByTimeAsync(0);
    expect(onWake).toHaveBeenCalledTimes(1);
    expect(detecciones).toHaveLength(1);
    expect(c.state).toBe('detected');
    expect(f.unsubscribe).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(8000);
    expect(c.state).toBe('listening');
    expect(f.subscribe).toHaveBeenCalledTimes(2);
  });

  it('si lo deshabilitan durante la pausa post-detección, no se reactiva', async () => {
    vi.useFakeTimers();
    const f = sdkFalso();
    const c = createWakeWordController({ cargarSdk: f.cargarSdk, pausaTrasDeteccionMs: 8000 });
    await c.init({ ...OPTS, onWake: () => undefined });
    c.enable();
    await vi.advanceTimersByTimeAsync(0);
    f.detectar();
    await vi.advanceTimersByTimeAsync(0);
    c.disable();
    await vi.advanceTimersByTimeAsync(8000);
    expect(c.state).toBe('idle');
    expect(f.subscribe).toHaveBeenCalledTimes(1);
  });

  it('falla al cargar el SDK → error con mensaje', async () => {
    const f = sdkFalso({ crearFalla: new Error('AccessKey inválida') });
    const c = createWakeWordController({ cargarSdk: f.cargarSdk });
    const errores: string[] = [];
    c.on('error', (e) => errores.push(e.message));
    await c.init({ ...OPTS, onWake: () => undefined });
    expect(c.state).toBe('error');
    expect(errores).toEqual(['AccessKey inválida']);
  });

  it('micrófono denegado al suscribir → error', async () => {
    const f = sdkFalso({ subscribeFalla: new Error('Permission denied') });
    const c = createWakeWordController({ cargarSdk: f.cargarSdk });
    const errores: string[] = [];
    c.on('error', (e) => errores.push(e.message));
    await c.init({ ...OPTS, onWake: () => undefined });
    c.enable();
    await flush();
    expect(c.state).toBe('error');
    expect(errores).toEqual(['Permission denied']);
  });

  it('error de proceso del worker → error', async () => {
    const f = sdkFalso();
    const c = createWakeWordController({ cargarSdk: f.cargarSdk });
    await c.init({ ...OPTS, onWake: () => undefined });
    c.enable();
    await flush();
    f.errorProceso(new Error('frame inválido'));
    expect(c.state).toBe('error');
  });

  it('destroy suelta el micrófono, libera y termina el worker y limpia listeners', async () => {
    const f = sdkFalso();
    const c = createWakeWordController({ cargarSdk: f.cargarSdk });
    const fn = vi.fn();
    c.on('state', fn);
    await c.init({ ...OPTS, onWake: () => undefined });
    c.enable();
    await flush();
    fn.mockClear();
    await c.destroy();
    expect(f.unsubscribe).toHaveBeenCalledWith(f.worker);
    expect(f.worker.release).toHaveBeenCalledTimes(1);
    expect(f.worker.terminate).toHaveBeenCalledTimes(1);
    expect(c.state).toBe('idle');
    expect(fn).not.toHaveBeenCalled();
  });

  it('destroy durante init no deja un worker vivo', async () => {
    const f = sdkFalso();
    const c = createWakeWordController({ cargarSdk: f.cargarSdk });
    const init = c.init({ ...OPTS, onWake: () => undefined });
    await c.destroy();
    await init;
    expect(f.worker.release).toHaveBeenCalledTimes(1);
    expect(f.worker.terminate).toHaveBeenCalledTimes(1);
    c.enable();
    await flush();
    expect(f.subscribe).not.toHaveBeenCalled();
  });

  it('on() devuelve unsubscribe y un listener que lanza no rompe al resto', async () => {
    const f = sdkFalso();
    const c = createWakeWordController({ cargarSdk: f.cargarSdk });
    const a = vi.fn(() => {
      throw new Error('listener roto');
    });
    const b = vi.fn();
    const off = c.on('state', b);
    c.on('state', a);
    await c.init({ ...OPTS, onWake: () => undefined });
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
    off();
    b.mockClear();
    c.enable();
    await flush();
    expect(b).not.toHaveBeenCalled();
  });
});
