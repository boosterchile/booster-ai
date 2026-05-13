import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type WakeWordState, createWakeWordController } from './wake-word.js';

/**
 * Tests del stub controller. Cubre la API contract para que cuando se
 * swap con la implementación Porcupine real, los call sites sigan
 * funcionando idéntico.
 */

describe('WakeWordController (stub Wave 5 PR 1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('start state es "idle"', () => {
    const c = createWakeWordController();
    expect(c.state).toBe('idle');
  });

  it('init() con accessKey vacío → unavailable + emite error', async () => {
    const c = createWakeWordController();
    const states: WakeWordState[] = [];
    c.on('state', (s) => states.push(s));
    const errors: string[] = [];
    c.on('error', (e) => errors.push(e.message));
    await c.init({ accessKey: '', modelPath: '', onWake: () => {} });
    expect(c.state).toBe('unavailable');
    expect(states).toContain('unavailable');
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/Wake-word no disponible/);
  });

  it('init() con accessKey + modelPath → todavía unavailable (PR 2 wire pendiente)', async () => {
    const c = createWakeWordController();
    await c.init({
      accessKey: 'pico-key-123',
      modelPath: '/wake-word/oye-booster-cl.ppn',
      onWake: () => {},
    });
    // Stub no implementa Porcupine wire todavía — resolve unavailable
    // hasta Wave 5 PR 2. El test futuro a invertir: esperar 'listening'.
    expect(c.state).toBe('unavailable');
  });

  it('enable() es no-op cuando state=unavailable', async () => {
    const c = createWakeWordController();
    await c.init({ accessKey: '', modelPath: '', onWake: () => {} });
    c.enable();
    expect(c.state).toBe('unavailable');
  });

  it('on(state) suscribe múltiples listeners y unsubscribe limpio', async () => {
    const c = createWakeWordController();
    const a: WakeWordState[] = [];
    const b: WakeWordState[] = [];
    const unsubA = c.on('state', (s) => a.push(s));
    c.on('state', (s) => b.push(s));
    await c.init({ accessKey: '', modelPath: '', onWake: () => {} });
    expect(a).toEqual(['unavailable']);
    expect(b).toEqual(['unavailable']);
    unsubA();
    await c.destroy();
    // Tras unsub A no debería recibir más; b sí podría si re-init, pero
    // destroy limpió listeners.
    expect(c.state).toBe('idle'); // destroy resetea
  });

  it('destroy() limpia state y listeners', async () => {
    const c = createWakeWordController();
    const states: WakeWordState[] = [];
    c.on('state', (s) => states.push(s));
    await c.init({ accessKey: '', modelPath: '', onWake: () => {} });
    await c.destroy();
    expect(c.state).toBe('idle');
  });

  it('listener que throw no rompe el broadcaster', async () => {
    const c = createWakeWordController();
    const ok: WakeWordState[] = [];
    c.on('state', () => {
      throw new Error('boom');
    });
    c.on('state', (s) => ok.push(s));
    await c.init({ accessKey: '', modelPath: '', onWake: () => {} });
    // El segundo listener debe haber recibido el estado.
    expect(ok).toContain('unavailable');
  });
});
