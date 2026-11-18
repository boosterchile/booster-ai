import { z } from 'zod';
import type {
  LecturaTrayectosFlota,
  leerTrayectosDeLaFlota,
} from './listar-trayectos-teltonika.js';

/**
 * Caché de la lectura de combustible del panel de Booster Fleet
 * (`.specs/booster-fleet-ventana-completa` §4.3).
 *
 * Leer y segmentar los 7 días de una flota cuesta: se guarda el resultado
 * por empresa y por tramo de 10 minutos, para que dos consultas seguidas
 * —o dos pestañas— lean la telemetría una sola vez y vean lo mismo.
 * Documentos y mantenciones no pasan por acá: se leen siempre en vivo.
 *
 * La caché no es requisito para responder. Si Redis no contesta o lo
 * guardado no sirve, se lee de la base y se registra.
 */

export const TTL_CACHE_COMBUSTIBLE_S = 600;
const TRAMO_MS = TTL_CACHE_COMBUSTIBLE_S * 1000;
const PREFIJO = 'fleet:combustible:v1';

/** Lo mínimo de ioredis que usa la caché; así el test no necesita un Redis. */
export interface RedisCombustible {
  get(clave: string): Promise<string | null>;
  set(clave: string, valor: string, modo: 'EX', segundos: number): Promise<unknown>;
}

type Leer = typeof leerTrayectosDeLaFlota;
type ArgsLectura = Parameters<Leer>[0];

/** Lo que tiene que cumplir un valor guardado para usarlo como lectura. */
const lecturaGuardadaSchema = z
  .object({
    empresaId: z.string(),
    desde: z.string(),
    hasta: z.string(),
    truncado: z.boolean(),
    puntosLeidos: z.number(),
    trayectos: z.array(z.unknown()),
    vehiculos: z.array(z.unknown()),
  })
  .passthrough();

function mensaje(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Envuelve la lectura de combustible con la caché. Devuelve una función con
 * la misma firma, que además dice en `origen` si el resultado salió de la
 * caché o de la base.
 */
export function leerCombustibleConCache(opts: {
  redis: RedisCombustible | undefined;
  leer: Leer;
  ahora?: () => Date;
}): Leer {
  const ahora = opts.ahora ?? (() => new Date());

  return async (args: ArgsLectura): Promise<LecturaTrayectosFlota> => {
    const redis = opts.redis;
    if (!redis) {
      return { ...(await opts.leer(args)), origen: 'base' };
    }

    const tramo = Math.floor(ahora().getTime() / TRAMO_MS);
    const clave = [
      PREFIJO,
      args.empresaId,
      tramo,
      args.reparto ?? 'global',
      args.maxPuntos ?? 'defecto',
    ].join(':');

    try {
      const guardado = await redis.get(clave);
      if (guardado !== null) {
        const parsed = lecturaGuardadaSchema.safeParse(JSON.parse(guardado));
        if (parsed.success && parsed.data.empresaId === args.empresaId) {
          return { ...(parsed.data as unknown as LecturaTrayectosFlota), origen: 'cache' };
        }
        args.logger.warn(
          { empresaId: args.empresaId, err: 'forma inesperada' },
          'booster-fleet: lo guardado en la caché de combustible no sirve, se lee de la base',
        );
      }
    } catch (err) {
      args.logger.warn(
        { empresaId: args.empresaId, err: mensaje(err) },
        'booster-fleet: la caché de combustible no respondió, se lee de la base',
      );
    }

    const lectura = await opts.leer(args);
    // No se espera el guardado: la respuesta no depende de Redis.
    redis.set(clave, JSON.stringify(lectura), 'EX', TTL_CACHE_COMBUSTIBLE_S).catch((err) => {
      args.logger.warn(
        { empresaId: args.empresaId, err: mensaje(err) },
        'booster-fleet: no se pudo guardar la lectura de combustible en la caché',
      );
    });
    return { ...lectura, origen: 'base' };
  };
}
