import type { Logger } from '@booster-ai/logger';

/**
 * Drenaje de conexiones en shutdown (SIGTERM de GKE).
 *
 * El shutdown previo esperaba `server.close()` — que solo resuelve cuando
 * las conexiones TERMINAN SOLAS, cosa que las sesiones Teltonika long-lived
 * jamás hacen (keepalive 60s, idle 300s) → el timer de 30s ganaba SIEMPRE
 * ("shutdown timeout, forcing exit") y `flush()`/`pool.end()` nunca corrían.
 *
 * Diseño:
 *  - `createDrainController`: registro de sockets vivos + contador de
 *    operaciones EN VUELO por conexión. `processBuffer` corre sin serializar
 *    (un `void` por chunk), así que un socket es drenable SOLO en
 *    quiescencia real (contador 0) — cortar a mitad de un publish+ACK
 *    dejaría al device sin ACK a segundos de recibirlo.
 *  - `buildShutdown`: al SIGTERM cierra listeners (dejan de aceptar), drena
 *    con budget < grace de GKE, y recién entonces flush + pool.end + exit(0).
 *    El hard-exit (exit(1)) queda como ÚLTIMA red si algo se cuelga.
 *
 * Datos: cortar sin ACK no pierde nada (ACK-post-publish + dedup DB por
 * UNIQUE imei+timestamp_device) — el drenaje convierte "sesión matada a
 * mitad de packet" en "FIN limpio con ACK entregado".
 */

/** Superficie mínima de net.Socket que necesita el drenaje (testeable). */
export interface DrainableSocket {
  end(): void;
  destroy(): void;
  once(event: 'close', cb: () => void): unknown;
}

/** Contrato que consume connection-handler para marcar ops en vuelo. */
export interface OpTracker {
  beginOp(socket: DrainableSocket): void;
  endOp(socket: DrainableSocket): void;
}

export interface DrainResult {
  outcome: 'drained' | 'budget_excedido';
  cerrados: number;
  restantes: number;
}

export interface DrainController extends OpTracker {
  register(socket: DrainableSocket): void;
  isDraining(): boolean;
  drain(budgetMs: number): Promise<DrainResult>;
  readonly active: number;
}

export function createDrainController(logger: Logger): DrainController {
  const conns = new Map<DrainableSocket, { inFlight: number }>();
  let draining = false;
  let cerrados = 0;
  let onAllClosed: (() => void) | null = null;

  const closeIfQuiescent = (socket: DrainableSocket): void => {
    const conn = conns.get(socket);
    if (draining && conn && conn.inFlight === 0) {
      // FIN limpio: el device ve cierre ordenado y reconecta con backoff.
      socket.end();
    }
  };

  return {
    register(socket) {
      conns.set(socket, { inFlight: 0 });
      socket.once('close', () => {
        if (conns.delete(socket)) {
          cerrados += 1;
        }
        if (draining && conns.size === 0) {
          onAllClosed?.();
        }
      });
    },

    beginOp(socket) {
      const conn = conns.get(socket);
      if (conn) {
        conn.inFlight += 1;
      }
    },

    endOp(socket) {
      const conn = conns.get(socket);
      if (!conn) {
        return;
      }
      conn.inFlight = Math.max(0, conn.inFlight - 1);
      closeIfQuiescent(socket);
    },

    isDraining() {
      return draining;
    },

    drain(budgetMs) {
      draining = true;
      cerrados = 0;
      logger.info({ activas: conns.size, budgetMs }, 'drenaje iniciado');
      if (conns.size === 0) {
        return Promise.resolve({ outcome: 'drained' as const, cerrados, restantes: 0 });
      }
      // Los quiescentes se cierran YA; los que tienen ops en vuelo cierran
      // en su endOp final (closeIfQuiescent).
      for (const socket of [...conns.keys()]) {
        closeIfQuiescent(socket);
      }
      return new Promise((resolve) => {
        // El barrido de arriba puede haber cerrado TODO sincrónicamente
        // (sockets fake en tests; imposible con net.Socket real, cuyo
        // 'close' siempre es asíncrono) — sin este re-chequeo, la
        // notificación se perdería y ganaría el budget.
        if (conns.size === 0) {
          resolve({ outcome: 'drained', cerrados, restantes: 0 });
          return;
        }
        const timer = setTimeout(() => {
          onAllClosed = null;
          resolve({ outcome: 'budget_excedido', cerrados, restantes: conns.size });
        }, budgetMs);
        timer.unref?.();
        onAllClosed = () => {
          clearTimeout(timer);
          resolve({ outcome: 'drained', cerrados, restantes: 0 });
        };
      });
    },

    get active() {
      return conns.size;
    },
  };
}

export interface ShutdownDeps {
  logger: Logger;
  /** Cierra ambos listeners (plain + TLS): dejan de aceptar. No espera. */
  closeListeners: () => void;
  drainController: DrainController;
  /** Budget del drenaje. DEBE ser < grace GKE − preStop − margen. */
  drainBudgetMs: number;
  /** Última red: si el shutdown completo se cuelga, exit(1) acá. */
  hardExitMs: number;
  flush: () => Promise<void>;
  closePool: () => Promise<void>;
  exit: (code: number) => void;
}

export function buildShutdown(deps: ShutdownDeps): { onSignal: (signal: string) => void } {
  const { logger, closeListeners, drainController, drainBudgetMs, hardExitMs, flush, closePool } =
    deps;
  let started = false;
  let hardTimer: ReturnType<typeof setTimeout> | null = null;

  const finish = (code: number): void => {
    if (hardTimer) {
      clearTimeout(hardTimer);
    }
    deps.exit(code);
  };

  const run = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutdown requested');
    closeListeners();
    const result = await drainController.drain(drainBudgetMs);
    logger.info({ ...result }, 'drenaje terminado');
    try {
      await flush();
      logger.info('publisher flushed');
    } catch (err) {
      logger.error({ err }, 'error flushing publisher');
    }
    try {
      await closePool();
      logger.info('pg pool closed');
    } catch (err) {
      logger.error({ err }, 'error closing pg pool');
    }
    finish(0);
  };

  return {
    onSignal(signal) {
      if (started) {
        return;
      }
      started = true;
      hardTimer = setTimeout(() => {
        logger.warn('shutdown timeout, forcing exit');
        deps.exit(1);
      }, hardExitMs);
      hardTimer.unref?.();
      run(signal).catch((err) => {
        logger.error({ err }, 'shutdown falló');
        finish(1);
      });
    },
  };
}
