import { describe, expect, it } from 'vitest';
import { createDteEmitter } from './factory.js';
import { MockAdapter } from './mock-adapter.js';
import { PaperlessAdapter } from './paperless-adapter.js';

describe('createDteEmitter', () => {
  it('provider=mock → MockAdapter', () => {
    const emitter = createDteEmitter({ provider: 'mock' });
    expect(emitter).toBeInstanceOf(MockAdapter);
  });

  it('provider=paperless → PaperlessAdapter', () => {
    const emitter = createDteEmitter({
      provider: 'paperless',
      apiKey: 'test-key',
      baseUrl: 'https://api.sandbox.paperless.cl/v1',
    });
    expect(emitter).toBeInstanceOf(PaperlessAdapter);
  });

  it('respeta timeoutMs explícito', () => {
    const emitter = createDteEmitter({
      provider: 'paperless',
      apiKey: 'k',
      baseUrl: 'https://x',
      timeoutMs: 5000,
    });
    expect((emitter as PaperlessAdapter).getTimeoutMs()).toBe(5000);
  });

  it('default timeoutMs = 30000', () => {
    const emitter = createDteEmitter({
      provider: 'paperless',
      apiKey: 'k',
      baseUrl: 'https://x',
    });
    expect((emitter as PaperlessAdapter).getTimeoutMs()).toBe(30_000);
  });
});
