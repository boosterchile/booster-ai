import type { Logger } from 'pino';
import { stackSinValores } from './serializar-error.js';

/**
 * Integración con Cloud Error Reporting vía Cloud Logging (T10-16, ADR-082).
 *
 * Error Reporting solo agrupa una entrada si el stack está en un campo de
 * primer nivel o si trae `@type` ReportedErrorEvent. Pino serializa el error
 * anidado en `err.stack`, por eso ningún error de backend llegaba al
 * agregador. Cero dependencias nuevas y cero IAM: el SA runtime ya escribe
 * logs, y Error Reporting los lee de ahí.
 *
 * https://cloud.google.com/error-reporting/docs/formatting-error-messages
 */
export const REPORTED_ERROR_EVENT_TYPE =
  'type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent';

/** Nivel numérico de pino para `error`; `fatal` es 60. */
const PINO_LEVEL_ERROR = 50;

export interface ServiceContext {
  service: string;
  version: string;
}

function extraerError(arg: unknown): Error | undefined {
  if (arg instanceof Error) {
    return arg;
  }
  if (typeof arg === 'object' && arg !== null && 'err' in arg) {
    const err = (arg as { err: unknown }).err;
    return err instanceof Error ? err : undefined;
  }
  return undefined;
}

/**
 * Campos que convierten una entrada `error`/`fatal` que trae un `Error` en un
 * evento de Error Reporting. Devuelve `undefined` si la entrada no califica
 * (nivel menor, o sin `Error`: un error de negocio sin stack no es una falla
 * no controlada y no debe abrir un grupo).
 */
export function camposErrorReporting(
  level: number,
  primerArg: unknown,
  serviceContext: ServiceContext,
): Record<string, unknown> | undefined {
  if (level < PINO_LEVEL_ERROR) {
    return undefined;
  }
  const err = extraerError(primerArg);
  if (!err) {
    return undefined;
  }
  return {
    '@type': REPORTED_ERROR_EVENT_TYPE,
    stack_trace: stackSinValores(err),
    serviceContext,
  };
}

/** Subconjunto de `pg.Pool` que usa el registro (sin depender de `pg`). */
export interface PoolConErrores {
  on(evento: 'error', handler: (err: Error) => void): unknown;
}

/**
 * Escucha el evento `error` del pool de Postgres. `pg` lo emite cuando una
 * conexión inactiva se corta; sin listener, Node lo convierte en una
 * excepción no controlada y `registrarErroresNoControlados` termina el
 * proceso. No hay nada que recuperar: `pg` ya descartó esa conexión y abre
 * otra cuando hace falta. Queda como `warn` porque no es una falla del
 * servicio; una consulta que falle por el corte se registra como error aparte.
 */
export function registrarErroresDePool(pool: PoolConErrores, logger: Pick<Logger, 'warn'>): void {
  pool.on('error', (err) => {
    logger.warn({ err }, 'conexión inactiva del pool de Postgres terminó con error');
  });
}

/** Subconjunto de `process` que usa el registro (inyectable en tests). */
export interface ProcesoNode {
  on(evento: 'uncaughtException' | 'unhandledRejection', handler: (arg: unknown) => void): void;
  exit(code: number): void;
}

/**
 * Registra `uncaughtException` y `unhandledRejection`: loguea `fatal` con el
 * error (llega a Error Reporting por el formato de arriba) y termina con 1,
 * igual que el comportamiento por defecto de Node pero sin perder el stack
 * en un stderr sin estructura.
 */
export function registrarErroresNoControlados(
  logger: Pick<Logger, 'fatal'>,
  proceso: ProcesoNode = process,
): void {
  proceso.on('uncaughtException', (arg) => {
    logger.fatal({ err: arg instanceof Error ? arg : new Error(String(arg)) }, 'uncaughtException');
    proceso.exit(1);
  });
  proceso.on('unhandledRejection', (arg) => {
    logger.fatal(
      { err: arg instanceof Error ? arg : new Error(String(arg)) },
      'unhandledRejection',
    );
    proceso.exit(1);
  });
}
