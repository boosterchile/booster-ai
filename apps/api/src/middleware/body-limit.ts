import type { Logger } from '@booster-ai/logger';
import type { Context, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';

/**
 * Límite general del cuerpo de una request. El cuerpo JSON legítimo más grande
 * que recibe la API mide ~17 KiB en el peor caso de codificación (medición en
 * `.specs/limites-entrada-api/spec.md` §2).
 */
export const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

/**
 * Margen para el sobre `multipart/form-data` (boundary y cabeceras de cada
 * parte) que se suma al tope del archivo en las rutas de subida.
 */
export const MULTIPART_ENVELOPE_BYTES = 64 * 1024;

/** Ruta que necesita un límite distinto del general. */
export interface BodyLimitException {
  /** Método HTTP en mayúsculas. */
  method: string;
  /** Ruta completa, anclada con `^…$` para no abrir otras del mismo prefijo. */
  path: RegExp;
  maxBytes: number;
}

export interface BodyLimitOptions {
  logger: Logger;
  defaultMaxBytes: number;
  exceptions?: readonly BodyLimitException[];
}

function assertBytes(valor: number, campo: string): void {
  if (!Number.isInteger(valor) || valor <= 0) {
    throw new RangeError(`body-limit: ${campo} debe ser un entero positivo (recibido ${valor})`);
  }
}

/**
 * Corta con 413 un cuerpo más grande que el límite de su ruta, antes de que lo
 * lea cualquier middleware o handler. Va global y temprano en `server.ts`.
 *
 * Con `Content-Length` decide por la cabecera, sin leer el cuerpo; sin ella
 * (transfer chunked) cuenta los bytes mientras llegan y corta al pasar el
 * límite (`hono/body-limit`).
 */
export function createBodyLimitMiddleware(opts: BodyLimitOptions): MiddlewareHandler {
  assertBytes(opts.defaultMaxBytes, 'defaultMaxBytes');
  const exceptions = opts.exceptions ?? [];
  for (const exception of exceptions) {
    assertBytes(exception.maxBytes, `maxBytes de ${exception.method} ${exception.path}`);
    // Con `g` o `y`, `RegExp.test` guarda `lastIndex` entre llamadas y la
    // misma ruta alternaría entre excepción y límite general.
    if (exception.path.global || exception.path.sticky) {
      throw new RangeError(`body-limit: la ruta ${exception.path} no puede usar las flags g ni y`);
    }
  }

  const crearLimite = (maxBytes: number): MiddlewareHandler =>
    bodyLimit({
      maxSize: maxBytes,
      onError: (c: Context) => {
        opts.logger.warn(
          {
            method: c.req.method,
            path: c.req.path,
            max_bytes: maxBytes,
            content_length: c.req.header('content-length') ?? null,
          },
          'body-limit: cuerpo sobre el límite, 413',
        );
        return c.json(
          { error: 'payload_too_large', code: 'payload_too_large', max_bytes: maxBytes },
          413,
        );
      },
    });

  const limiteGeneral = crearLimite(opts.defaultMaxBytes);
  const limitesExcepcion = exceptions.map((exception) => ({
    exception,
    limite: crearLimite(exception.maxBytes),
  }));

  return async (c, next) => {
    const encontrada = limitesExcepcion.find(
      ({ exception }) => exception.method === c.req.method && exception.path.test(c.req.path),
    );
    return (encontrada?.limite ?? limiteGeneral)(c, next);
  };
}
