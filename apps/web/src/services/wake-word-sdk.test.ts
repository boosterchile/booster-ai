import { describe, expect, it, vi } from 'vitest';

const create = vi.fn();
const subscribe = vi.fn(async () => undefined);
const unsubscribe = vi.fn(async () => undefined);
vi.mock('@picovoice/porcupine-web', () => ({ PorcupineWorker: { create } }));
vi.mock('@picovoice/web-voice-processor', () => ({
  WebVoiceProcessor: { subscribe, unsubscribe },
}));

const { cargarSdkPicovoice } = await import('./wake-word-sdk.js');

describe('cargarSdkPicovoice', () => {
  it('crea el worker real y lo suscribe/desuscribe en WebVoiceProcessor', async () => {
    const real = { release: vi.fn(), terminate: vi.fn() };
    create.mockResolvedValue(real);
    const sdk = cargarSdkPicovoice();
    const keyword = {
      publicPath: 'k',
      customWritePath: 'k',
      label: 'oye-booster',
      sensitivity: 0.5,
    };
    const model = { publicPath: 'm', customWritePath: 'm' };
    const cb = vi.fn();
    const worker = await sdk.PorcupineWorker.create('key', keyword, cb, model, {});
    expect(create).toHaveBeenCalledWith('key', keyword, cb, model, {});
    await sdk.WebVoiceProcessor.subscribe(worker);
    await sdk.WebVoiceProcessor.unsubscribe(worker);
    expect(subscribe).toHaveBeenCalledWith(real);
    expect(unsubscribe).toHaveBeenCalledWith(real);
  });

  it('un worker que no salió de este SDK se rechaza', () => {
    const sdk = cargarSdkPicovoice();
    const ajeno = { release: vi.fn(async () => undefined), terminate: vi.fn() };
    expect(() => sdk.WebVoiceProcessor.subscribe(ajeno)).toThrow(/worker desconocido/);
  });
});
