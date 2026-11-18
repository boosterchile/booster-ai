import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from './logger.js';
import { elegirVistaEmpresa, vistaEmpresaElegida, volverAlPanel } from './vista-admin.js';

/**
 * acceso-usuarios-empresa-panel SC9 — la persona de Booster que también es de
 * una empresa elige, por pestaña, si `/app` la lleva al panel o a la web de su
 * empresa. Sin `sessionStorage`, la web sigue funcionando como hoy (panel).
 */

beforeEach(() => {
  window.sessionStorage.clear();
  vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe('vista-admin', () => {
  it('sin elección, /app sigue yendo al panel', () => {
    expect(vistaEmpresaElegida()).toBe(false);
  });

  it('al elegir la empresa queda guardada en la pestaña', () => {
    elegirVistaEmpresa();
    expect(vistaEmpresaElegida()).toBe(true);
  });

  it('volver al panel limpia la elección', () => {
    elegirVistaEmpresa();
    volverAlPanel();
    expect(vistaEmpresaElegida()).toBe(false);
  });

  it('si leer sessionStorage lanza, cae al panel y lo registra', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(vistaEmpresaElegida()).toBe(false);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('si guardar lanza, no rompe la navegación y lo registra', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => elegirVistaEmpresa()).not.toThrow();
    expect(vistaEmpresaElegida()).toBe(false);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('si limpiar lanza, no rompe la navegación y lo registra', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => volverAlPanel()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
