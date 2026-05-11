import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config as appConfig } from '../../src/config.js';
import { __resetDteEmitterCache, getDteEmitter } from '../../src/services/dte-emitter-factory.js';

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => noopLogger,
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  __resetDteEmitterCache();
});
afterEach(() => {
  __resetDteEmitterCache();
});

describe('getDteEmitter', () => {
  it('DTE_PROVIDER=disabled → null', () => {
    appConfig.DTE_PROVIDER = 'disabled';
    expect(getDteEmitter(noopLogger)).toBeNull();
  });

  it('DTE_PROVIDER=mock → MockDteAdapter instance (no exige creds)', () => {
    appConfig.DTE_PROVIDER = 'mock';
    const emitter = getDteEmitter(noopLogger);
    expect(emitter).not.toBeNull();
    // Smoke test del contrato.
    expect(typeof emitter?.emitFactura).toBe('function');
    expect(typeof emitter?.emitGuiaDespacho).toBe('function');
    expect(typeof emitter?.queryStatus).toBe('function');
    expect(typeof emitter?.voidDocument).toBe('function');
  });

  it('DTE_PROVIDER=sovos sin creds → null + warn', () => {
    appConfig.DTE_PROVIDER = 'sovos';
    appConfig.SOVOS_API_KEY = undefined;
    appConfig.SOVOS_BASE_URL = undefined;
    const emitter = getDteEmitter(noopLogger);
    expect(emitter).toBeNull();
    expect(noopLogger.warn).toHaveBeenCalled();
  });

  it('DTE_PROVIDER=sovos con creds → SovosDteAdapter instance', () => {
    appConfig.DTE_PROVIDER = 'sovos';
    appConfig.SOVOS_API_KEY = 'test-key';
    appConfig.SOVOS_BASE_URL = 'https://api.sovos.cl/v1';
    const emitter = getDteEmitter(noopLogger);
    expect(emitter).not.toBeNull();
    expect(typeof emitter?.emitFactura).toBe('function');
  });

  it('caché: segundo getDteEmitter con misma config retorna mismo instance', () => {
    appConfig.DTE_PROVIDER = 'mock';
    const e1 = getDteEmitter(noopLogger);
    const e2 = getDteEmitter(noopLogger);
    expect(e1).toBe(e2);
  });

  it('caché: cambio de provider invalida y crea nuevo instance', () => {
    appConfig.DTE_PROVIDER = 'mock';
    const e1 = getDteEmitter(noopLogger);
    appConfig.DTE_PROVIDER = 'disabled';
    const e2 = getDteEmitter(noopLogger);
    expect(e1).not.toBe(e2);
    expect(e2).toBeNull();
  });

  it('__resetDteEmitterCache fuerza nueva creación', () => {
    appConfig.DTE_PROVIDER = 'mock';
    const e1 = getDteEmitter(noopLogger);
    __resetDteEmitterCache();
    const e2 = getDteEmitter(noopLogger);
    expect(e1).not.toBe(e2);
    expect(e2).not.toBeNull();
  });
});
