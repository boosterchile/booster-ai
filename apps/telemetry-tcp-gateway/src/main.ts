import { readFileSync } from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import { createLogger } from '@booster-ai/logger';
import { PubSub } from '@google-cloud/pubsub';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { loadConfig } from './config.js';
import { handleConnection } from './connection-handler.js';
import { buildShutdown, createDrainController } from './drain.js';
import { CrashTracePublisher, TelemetryPublisher } from './pubsub-publisher.js';
import { createConnectionGuard, createSlidingWindowLimiter } from './rate-limiter.js';
import { attachTlsObservability } from './tls-observability.js';
import { buildTlsServerOptions } from './tls-server.js';

/**
 * Entry point del telemetry-tcp-gateway.
 *
 * Long-lived TCP server (NO sirve en Cloud Run — por eso GKE Autopilot).
 * Una conexión por device Teltonika. Por device:
 *   1. Handshake IMEI → resolución vehiculo / dispositivos_pendientes.
 *   2. Loop de AVL packets → publish a Pub/Sub `telemetry-events`.
 *   3. ACK BE 4B record count para que el device libere su buffer.
 *
 * Wave 3 (Track D3): listening dual en dos ports:
 *   - 5027 plain TCP (existente, para devices Wave 1/2 sin TLS).
 *   - 5061 TLS 1.2+ (Wave 3, devices migrados con cert pinned).
 * Ambos sirven el mismo `handleConnection`. Cuando todos los devices
 * estén en Wave 3 podemos apagar el plain port con un solo deploy.
 *
 * Graceful shutdown: SIGTERM → cerrar listening ports + esperar
 * conexiones existentes a que terminen (con timeout) + flush Pub/Sub.
 */

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({
    service: '@booster-ai/telemetry-tcp-gateway',
    version: process.env.SERVICE_VERSION ?? '0.0.0-dev',
    level: config.LOG_LEVEL,
    pretty: config.NODE_ENV === 'development',
  });

  const tlsEnabled = Boolean(config.TLS_CERT_PATH && config.TLS_KEY_PATH);

  logger.info(
    {
      plainPort: config.PORT,
      tlsPort: tlsEnabled ? config.TLS_PORT : null,
      project: config.GOOGLE_CLOUD_PROJECT,
      topic: config.PUBSUB_TOPIC_TELEMETRY,
    },
    'telemetry-tcp-gateway starting',
  );

  // Postgres pool (compartido entre conexiones).
  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30_000,
  });
  const db = drizzle(pool);

  // Pub/Sub client (singleton).
  const pubsub = new PubSub({ projectId: config.GOOGLE_CLOUD_PROJECT });
  const publisher = new TelemetryPublisher(pubsub, config.PUBSUB_TOPIC_TELEMETRY, logger);
  const crashPublisher = config.PUBSUB_TOPIC_CRASH_TRACES
    ? new CrashTracePublisher(pubsub, config.PUBSUB_TOPIC_CRASH_TRACES, logger)
    : null;

  if (!crashPublisher) {
    logger.warn('PUBSUB_TOPIC_CRASH_TRACES no configurado — Crash Trace publish DESHABILITADO');
  }

  // Rate limiting in-memory per-pod (audit P1-L). El guard acota conexiones
  // concurrentes (FDs/memoria); el limiter acota enrollments de IMEIs nuevos
  // (crecimiento de dispositivos_pendientes).
  const connectionGuard = createConnectionGuard(config.MAX_CONCURRENT_CONNECTIONS);
  const enrollmentLimiter = createSlidingWindowLimiter({
    maxEvents: config.ENROLLMENT_RATE_MAX,
    windowMs: config.ENROLLMENT_RATE_WINDOW_SEC * 1000,
  });

  // Registro de sockets vivos + quiescencia para el drenaje de shutdown.
  const drainController = createDrainController(logger);

  const connectionDeps = {
    db,
    publisher,
    crashPublisher,
    logger,
    idleTimeoutSec: config.IDLE_TIMEOUT_SEC,
    enrollmentLimiter,
    drain: drainController,
  };

  // Acepta una conexión bajo el cap concurrente: si está lleno, rechaza
  // inmediatamente (destroy) sin tocar la DB ni asignar buffers. Libera el slot
  // al cerrarse el socket. Compartido por el plain y el TLS server.
  const acceptConnection = (socket: net.Socket): void => {
    if (!connectionGuard.tryAcquire()) {
      logger.warn(
        {
          active: connectionGuard.active,
          max: config.MAX_CONCURRENT_CONNECTIONS,
          sourceIp: socket.remoteAddress ?? null,
        },
        'cap de conexiones concurrentes alcanzado — rechazando conexión (P1-L)',
      );
      socket.destroy();
      return;
    }
    if (drainController.isDraining()) {
      // Los listeners ya cerraron, pero una conexión puede colarse en la
      // carrera: durante el drain no se aceptan sesiones nuevas.
      connectionGuard.release();
      socket.destroy();
      return;
    }
    drainController.register(socket);
    socket.once('close', () => connectionGuard.release());
    handleConnection(socket, connectionDeps);
  };

  // -------------------------------------------------------------------------
  // SERVIDOR 1: TCP plain port 5027 (existente)
  // -------------------------------------------------------------------------

  const plainServer = net.createServer(acceptConnection);
  plainServer.on('error', (err) => {
    logger.error({ err, port: config.PORT }, 'plain server error');
  });
  plainServer.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, 'listening for Teltonika plain TCP connections');
  });

  // -------------------------------------------------------------------------
  // SERVIDOR 2: TLS port 5061 (Wave 3, opcional vía cert paths)
  // -------------------------------------------------------------------------

  let tlsServer: tls.Server | null = null;
  if (tlsEnabled) {
    let cert: Buffer;
    let key: Buffer;
    try {
      cert = readFileSync(config.TLS_CERT_PATH);
      key = readFileSync(config.TLS_KEY_PATH);
    } catch (err) {
      logger.fatal(
        { err, certPath: config.TLS_CERT_PATH, keyPath: config.TLS_KEY_PATH },
        'no se pudo leer cert/key TLS — abortando',
      );
      process.exit(1);
    }

    // Options extraídas a tls-server.ts (factory testeable): cert/key en la
    // raíz para clientes sin SNI + SNICallback para los que sí la mandan.
    tlsServer = tls.createServer(buildTlsServerOptions(cert, key), (socket) => {
      // tls.TLSSocket extiende net.Socket — pasable directamente al
      // acceptConnection (cap concurrente + handler).
      acceptConnection(socket);
    });
    tlsServer.on('error', (err) => {
      logger.error({ err, port: config.TLS_PORT }, 'tls server error');
    });
    // Fallos de handshake TLS: la IP se captura pre-handshake y el mensaje
    // emite err.code/err.message crudos sin afirmar causa — ver
    // tls-observability.ts (bug de observabilidad verificado en prod:
    // remoteAddress vacío + mensaje que contradecía el ECONNRESET real).
    attachTlsObservability(tlsServer, logger);
    tlsServer.listen(config.TLS_PORT, () => {
      logger.info({ port: config.TLS_PORT }, 'listening for Teltonika TLS connections');
    });
  } else {
    logger.warn('TLS_CERT_PATH/TLS_KEY_PATH no configurados — listener TLS deshabilitado');
  }

  // -------------------------------------------------------------------------
  // Graceful shutdown con drenaje de sockets (ver drain.ts)
  //
  // Presupuestos vs GKE: terminationGracePeriodSeconds=60 (primary) − preStop
  // sleep 5 − margen ≈ 55s utilizables (DR: 90s). El shutdown anterior
  // esperaba server.close() (que jamás resuelve con sesiones long-lived) y
  // moría SIEMPRE en el hard-exit de 30s sin flush ni pool.end.
  // -------------------------------------------------------------------------

  const DRAIN_BUDGET_MS = 40_000;
  const HARD_EXIT_MS = 45_000; // última red; < 55s efectivos del grace

  const { onSignal } = buildShutdown({
    logger,
    closeListeners: () => {
      // Solo dejar de aceptar — el cierre de las conexiones vivas es del
      // drain, no del close() (cuyo callback jamás llega con sesiones vivas).
      plainServer.close();
      tlsServer?.close();
    },
    drainController,
    drainBudgetMs: DRAIN_BUDGET_MS,
    hardExitMs: HARD_EXIT_MS,
    flush: () => publisher.flush(),
    closePool: () => pool.end(),
    exit: (code) => process.exit(code),
  });

  process.on('SIGTERM', () => onSignal('SIGTERM'));
  process.on('SIGINT', () => onSignal('SIGINT'));
}

main().catch((err) => {
  const bootstrapLogger = createLogger({
    service: '@booster-ai/telemetry-tcp-gateway',
    level: 'fatal',
  });
  bootstrapLogger.fatal({ err }, 'Fatal startup error');
  process.exit(1);
});
