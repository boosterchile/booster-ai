import type { Logger } from '@booster-ai/logger';
import { describe, expect, it, vi } from 'vitest';
import { TTL_CACHE_COMBUSTIBLE_S, leerCombustibleConCache } from './cache-combustible-flota.js';
import type { LecturaTrayectosFlota } from './listar-trayectos-teltonika.js';

const EMPRESA = '22222222-2222-4222-8222-222222222222';
const OTRA = '33333333-3333-4333-8333-333333333333';
const T0 = Date.parse('2026-11-17T15:00:00.000Z');

function loggerEspia() {
  const warn = vi.fn();
  const noop = (): void => undefined;
  const logger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn,
    error: noop,
    fatal: noop,
    child: () => logger,
  } as never as Logger;
  return { logger, warn };
}

function lectura(empresaId: string, marca: string): LecturaTrayectosFlota {
  return {
    empresaId,
    desde: marca,
    hasta: marca,
    vehiculosTeltonika: 1,
    truncado: false,
    coberturaDesde: null,
    puntosLeidos: 10,
    puntosEnVentana: 10,
    cta: null,
    ctaSensor: false,
    ctaCapacidadEstanque: false,
    vehiculos: [],
    trayectos: [],
    resumenVehiculo: null,
  };
}

function redisEnMemoria() {
  const datos = new Map<string, string>();
  const ttl = new Map<string, number>();
  return {
    datos,
    ttl,
    get: vi.fn(async (clave: string) => datos.get(clave) ?? null),
    set: vi.fn(async (clave: string, valor: string, _modo: 'EX', segundos: number) => {
      datos.set(clave, valor);
      ttl.set(clave, segundos);
      return 'OK';
    }),
  };
}

function args(empresaId = EMPRESA) {
  return {
    db: {} as never,
    empresaId,
    desde: new Date(T0 - 7 * 86_400_000),
    hasta: new Date(T0),
    reparto: 'por_vehiculo' as const,
    maxPuntos: 400_000,
  };
}

describe('leerCombustibleConCache', () => {
  it('dos consultas de la misma empresa en el mismo tramo leen la telemetría una vez', async () => {
    const redis = redisEnMemoria();
    const { logger } = loggerEspia();
    const leer = vi.fn(async () => lectura(EMPRESA, 'primera'));
    const lector = leerCombustibleConCache({ redis, leer, ahora: () => new Date(T0) });

    const a = await lector({ ...args(), logger });
    const b = await lector({ ...args(), logger });

    expect(leer).toHaveBeenCalledOnce();
    expect(a.origen).toBe('base');
    expect(b.origen).toBe('cache');
    expect(b.desde).toBe('primera');
    expect([...redis.ttl.values()]).toEqual([TTL_CACHE_COMBUSTIBLE_S]);
    expect(TTL_CACHE_COMBUSTIBLE_S).toBe(600);
  });

  it('dos consultas a la vez de la misma empresa comparten una sola lectura', async () => {
    const redis = redisEnMemoria();
    const { logger } = loggerEspia();
    let soltar: (valor: LecturaTrayectosFlota) => void = () => undefined;
    const leer = vi.fn(
      () =>
        new Promise<LecturaTrayectosFlota>((resolve) => {
          soltar = resolve;
        }),
    );
    const lector = leerCombustibleConCache({ redis, leer, ahora: () => new Date(T0) });

    const primera = lector({ ...args(), logger });
    const segunda = lector({ ...args(), logger });
    await vi.waitFor(() => expect(leer).toHaveBeenCalled());
    await Promise.resolve();
    soltar(lectura(EMPRESA, 'compartida'));
    const [a, b] = await Promise.all([primera, segunda]);

    expect(leer).toHaveBeenCalledOnce();
    expect(a.desde).toBe('compartida');
    expect(b.desde).toBe('compartida');
  });

  it('una lectura que falla no deja pegada la siguiente', async () => {
    const { logger } = loggerEspia();
    const leer = vi
      .fn<() => Promise<LecturaTrayectosFlota>>()
      .mockRejectedValueOnce(new Error('base caída'))
      .mockResolvedValueOnce(lectura(EMPRESA, 'segunda'));
    const lector = leerCombustibleConCache({
      redis: redisEnMemoria(),
      leer,
      ahora: () => new Date(T0),
    });

    await expect(lector({ ...args(), logger })).rejects.toThrow('base caída');
    const despues = await lector({ ...args(), logger });
    expect(despues.desde).toBe('segunda');
    expect(leer).toHaveBeenCalledTimes(2);
  });

  it('el tramo siguiente, otra empresa u otro presupuesto leen de nuevo', async () => {
    const redis = redisEnMemoria();
    const { logger } = loggerEspia();
    let reloj = T0;
    const leer = vi.fn(async (o: { empresaId: string }) => lectura(o.empresaId, 'x'));
    const lector = leerCombustibleConCache({ redis, leer, ahora: () => new Date(reloj) });

    await lector({ ...args(), logger });
    await lector({ ...args(OTRA), logger });
    await lector({ ...args(), maxPuntos: 100, logger });
    expect(leer).toHaveBeenCalledTimes(3);

    reloj = T0 + 9 * 60_000;
    await lector({ ...args(), logger });
    expect(leer).toHaveBeenCalledTimes(3);

    reloj = T0 + 10 * 60_000;
    const siguiente = await lector({ ...args(), logger });
    expect(leer).toHaveBeenCalledTimes(4);
    expect(siguiente.origen).toBe('base');
  });

  it('si Redis no responde al leer, lee de la base y lo registra', async () => {
    const redis = redisEnMemoria();
    redis.get.mockRejectedValue(new Error('conexión rechazada'));
    const { logger, warn } = loggerEspia();
    const leer = vi.fn(async () => lectura(EMPRESA, 'directo'));
    const lector = leerCombustibleConCache({ redis, leer, ahora: () => new Date(T0) });

    const resultado = await lector({ ...args(), logger });

    expect(resultado.origen).toBe('base');
    expect(resultado.desde).toBe('directo');
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatchObject({
      empresaId: EMPRESA,
      err: 'conexión rechazada',
    });
  });

  it('si Redis no guarda, igual responde y lo registra', async () => {
    const redis = redisEnMemoria();
    redis.set.mockRejectedValue(new Error('sin memoria'));
    const { logger, warn } = loggerEspia();
    const leer = vi.fn(async () => lectura(EMPRESA, 'directo'));
    const lector = leerCombustibleConCache({ redis, leer, ahora: () => new Date(T0) });

    const resultado = await lector({ ...args(), logger });
    await Promise.resolve();

    expect(resultado.origen).toBe('base');
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ err: 'sin memoria' });
  });

  it('un valor guardado que no es una lectura se descarta y se lee de nuevo', async () => {
    const redis = redisEnMemoria();
    const { logger, warn } = loggerEspia();
    const leer = vi.fn(async () => lectura(EMPRESA, 'fresca'));
    const lector = leerCombustibleConCache({ redis, leer, ahora: () => new Date(T0) });

    await lector({ ...args(), logger });
    for (const clave of redis.datos.keys()) {
      redis.datos.set(clave, '{"no":"es una lectura"');
    }
    const resultado = await lector({ ...args(), logger });

    expect(leer).toHaveBeenCalledTimes(2);
    expect(resultado.origen).toBe('base');
    expect(warn).toHaveBeenCalledOnce();

    for (const clave of redis.datos.keys()) {
      redis.datos.set(clave, JSON.stringify({ empresaId: OTRA, trayectos: 'no' }));
    }
    const otra = await lector({ ...args(), logger });
    expect(leer).toHaveBeenCalledTimes(3);
    expect(otra.origen).toBe('base');
  });

  it('sin Redis configurado lee siempre de la base', async () => {
    const { logger, warn } = loggerEspia();
    const leer = vi.fn(async () => lectura(EMPRESA, 'directo'));
    const lector = leerCombustibleConCache({ redis: undefined, leer, ahora: () => new Date(T0) });

    await lector({ ...args(), logger });
    const segunda = await lector({ ...args(), logger });

    expect(leer).toHaveBeenCalledTimes(2);
    expect(segunda.origen).toBe('base');
    expect(warn).not.toHaveBeenCalled();
  });

  it('la clave no lleva datos de la flota, solo la empresa, el tramo y el presupuesto', async () => {
    const redis = redisEnMemoria();
    const { logger } = loggerEspia();
    const lector = leerCombustibleConCache({
      redis,
      leer: vi.fn(async () => lectura(EMPRESA, 'x')),
      ahora: () => new Date(T0),
    });
    await lector({ ...args(), logger });
    expect([...redis.datos.keys()]).toEqual([
      `fleet:combustible:v1:${EMPRESA}:${Math.floor(T0 / 600_000)}:por_vehiculo:400000`,
    ]);
  });
});
