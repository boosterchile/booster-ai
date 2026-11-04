import { CONFIGURACION_COMERCIAL_INICIAL } from '@booster-ai/shared-schemas';
import { describe, expect, it, vi } from 'vitest';
import {
  TTL_CACHE_CONFIGURACION_COMERCIAL_MS,
  crearLectorConfiguracionComercial,
  seccionesCambiadas,
} from './configuracion-comercial.js';

const version = (n: number) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  version: n,
  config: CONFIGURACION_COMERCIAL_INICIAL,
  vigenteDesde: new Date('2026-10-08T12:00:00Z'),
  notaCambio: `v${n}`,
  creadoPorEmail: 'admin@boosterchile.com',
  creadoEn: new Date('2026-10-08T12:00:00Z'),
});

describe('seccionesCambiadas', () => {
  it('lista las secciones con algún valor distinto', () => {
    const nueva = {
      ...CONFIGURACION_COMERCIAL_INICIAL,
      comisiones: { ...CONFIGURACION_COMERCIAL_INICIAL.comisiones, spot_pct: 18 },
      impuestos: { iva_pct: 19 },
    };
    expect(seccionesCambiadas(CONFIGURACION_COMERCIAL_INICIAL, nueva)).toEqual(['comisiones']);
  });

  it('sin anterior, todas las secciones cuentan como cambiadas', () => {
    expect(seccionesCambiadas(null, CONFIGURACION_COMERCIAL_INICIAL)).toEqual([
      'comisiones',
      'servicios',
      'financiamiento',
      'impuestos',
    ]);
  });

  it('idéntica → ninguna', () => {
    expect(
      seccionesCambiadas(
        CONFIGURACION_COMERCIAL_INICIAL,
        structuredClone(CONFIGURACION_COMERCIAL_INICIAL),
      ),
    ).toEqual([]);
  });
});

describe('crearLectorConfiguracionComercial (ADR-079 §3: caché ≤ 60 s)', () => {
  it('el TTL por defecto no supera 60 s', () => {
    expect(TTL_CACHE_CONFIGURACION_COMERCIAL_MS).toBeLessThanOrEqual(60_000);
  });

  it('cachea dentro del TTL y relee al vencer', async () => {
    let t = 0;
    const leer = vi.fn().mockResolvedValueOnce(version(1)).mockResolvedValueOnce(version(2));
    const lector = crearLectorConfiguracionComercial({ leer, ttlMs: 60_000, ahora: () => t });

    expect((await lector.obtener()).version).toBe(1);
    t = 59_999;
    expect((await lector.obtener()).version).toBe(1);
    expect(leer).toHaveBeenCalledTimes(1);
    t = 60_000;
    expect((await lector.obtener()).version).toBe(2);
    expect(leer).toHaveBeenCalledTimes(2);
  });

  it('invalidar fuerza la relectura (publicación en esta instancia)', async () => {
    const leer = vi.fn().mockResolvedValueOnce(version(1)).mockResolvedValueOnce(version(2));
    const lector = crearLectorConfiguracionComercial({ leer, ahora: () => 0 });
    await lector.obtener();
    lector.invalidar();
    expect((await lector.obtener()).version).toBe(2);
  });

  it('un error de lectura no se cachea', async () => {
    const leer = vi
      .fn()
      .mockRejectedValueOnce(new Error('db caída'))
      .mockResolvedValueOnce(version(1));
    const lector = crearLectorConfiguracionComercial({ leer, ahora: () => 0 });
    await expect(lector.obtener()).rejects.toThrow('db caída');
    expect((await lector.obtener()).version).toBe(1);
  });
});
