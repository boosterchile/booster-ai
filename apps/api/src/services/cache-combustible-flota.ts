import { z } from 'zod';
import type {
  LecturaTrayectosFlota,
  leerTrayectosDeLaFlota,
} from './listar-trayectos-teltonika.js';

/**
 * Lectura guardada de combustible del panel de Booster Fleet
 * (`.specs/booster-fleet-lectura-sin-espera`).
 *
 * Leer y segmentar los 7 días de una flota toma varios segundos. Cada
 * lectura se guarda con el instante en que se hizo:
 *
 * - con menos de 10 minutos, se entrega como lectura al día;
 * - con más, y hasta 24 horas, se entrega solo a quien acepta una
 *   lectura guardada, y se dice que no está al día;
 * - en cualquier otro caso se lee y se espera.
 *
 * Documentos y mantenciones no pasan por acá: se leen siempre en vivo.
 *
 * Lo guardado no es requisito para responder. Si Redis no contesta o lo
 * guardado no sirve, se lee de la base y se registra.
 *
 * Dos consultas de la misma flota que llegan a la vez comparten una sola
 * lectura: la segunda espera a la primera en vez de leer de nuevo. La
 * lectura ocupa memoria mientras dura, y sin esto una pantalla que
 * reintenta la duplicaba.
 */

/** Hasta cuándo una lectura cuenta como al día. */
export const AL_DIA_COMBUSTIBLE_S = 600;
/** Hasta cuándo se puede mostrar una lectura guardada mientras llega la nueva. */
export const TOPE_LECTURA_GUARDADA_S = 86_400;
const PREFIJO = 'fleet:combustible:v2';

/** Lo mínimo de ioredis que usa la caché; así el test no necesita un Redis. */
export interface RedisCombustible {
  get(clave: string): Promise<string | null>;
  set(clave: string, valor: string, modo: 'EX', segundos: number): Promise<unknown>;
}

type Leer = typeof leerTrayectosDeLaFlota;
type ArgsLectura = Parameters<Leer>[0];

/** Lo que tiene que cumplir un valor guardado para usarlo como lectura. */
const guardadoSchema = z.object({
  leidoEn: z.string().datetime(),
  lectura: z
    .object({
      empresaId: z.string(),
      desde: z.string(),
      hasta: z.string(),
      truncado: z.boolean(),
      puntosLeidos: z.number(),
      trayectos: z.array(z.unknown()),
      vehiculos: z.array(z.unknown()),
    })
    .passthrough(),
});

function mensaje(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Envuelve la lectura de combustible con la lectura guardada. Devuelve una
 * función con la misma firma, que además dice en `origen` si el resultado
 * salió de lo guardado o de la base, en `leidoEn` cuándo se leyó y en
 * `alDia` si tiene menos de 10 minutos.
 */
export function leerCombustibleConCache(opts: {
  redis: RedisCombustible | undefined;
  leer: Leer;
  ahora?: () => Date;
}): Leer {
  const ahora = opts.ahora ?? (() => new Date());
  const enCurso = new Map<string, Promise<LecturaTrayectosFlota>>();

  return async (args: ArgsLectura): Promise<LecturaTrayectosFlota> => {
    const clave = [
      PREFIJO,
      args.empresaId,
      args.reparto ?? 'global',
      args.maxPuntos ?? 'defecto',
    ].join(':');

    const guardada = await leerGuardada(args, clave);
    if (guardada) {
      const edadS = (ahora().getTime() - Date.parse(guardada.leidoEn)) / 1000;
      const alDia = edadS < AL_DIA_COMBUSTIBLE_S;
      if (alDia || (args.aceptarGuardada && edadS <= TOPE_LECTURA_GUARDADA_S)) {
        return { ...guardada.lectura, origen: 'cache', leidoEn: guardada.leidoEn, alDia };
      }
    }

    const yaEnCurso = enCurso.get(clave);
    if (yaEnCurso) {
      return yaEnCurso;
    }
    const lectura = leerYGuardar(args, clave).finally(() => {
      enCurso.delete(clave);
    });
    enCurso.set(clave, lectura);
    return lectura;
  };

  async function leerGuardada(
    args: ArgsLectura,
    clave: string,
  ): Promise<{ leidoEn: string; lectura: LecturaTrayectosFlota } | null> {
    const redis = opts.redis;
    if (!redis) {
      return null;
    }
    try {
      const guardado = await redis.get(clave);
      if (guardado === null) {
        return null;
      }
      const parsed = guardadoSchema.safeParse(JSON.parse(guardado));
      if (parsed.success && parsed.data.lectura.empresaId === args.empresaId) {
        return {
          leidoEn: parsed.data.leidoEn,
          lectura: parsed.data.lectura as unknown as LecturaTrayectosFlota,
        };
      }
      args.logger.warn(
        { empresaId: args.empresaId, err: 'forma inesperada' },
        'booster-fleet: la lectura de combustible guardada no sirve, se lee de la base',
      );
    } catch (err) {
      args.logger.warn(
        { empresaId: args.empresaId, err: mensaje(err) },
        'booster-fleet: la lectura de combustible guardada no respondió, se lee de la base',
      );
    }
    return null;
  }

  async function leerYGuardar(args: ArgsLectura, clave: string): Promise<LecturaTrayectosFlota> {
    const leidoEn = ahora().toISOString();
    const lectura = await opts.leer(args);
    // No se espera el guardado: la respuesta no depende de Redis.
    opts.redis
      ?.set(clave, JSON.stringify({ leidoEn, lectura }), 'EX', TOPE_LECTURA_GUARDADA_S)
      .catch((err) => {
        args.logger.warn(
          { empresaId: args.empresaId, err: mensaje(err) },
          'booster-fleet: no se pudo guardar la lectura de combustible',
        );
      });
    return { ...lectura, origen: 'base', leidoEn, alDia: true };
  }
}
