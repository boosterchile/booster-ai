import { readFileSync } from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import { createLogger } from '@booster-ai/logger';
import { PubSub } from '@google-cloud/pubsub';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { loadConfig } from './config.js';
import { handleConnection } from './connection-handler.js';
import { CrashTracePublisher, TelemetryPublisher } from './pubsub-publisher.js';

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

  const connectionDeps = {
    db,
    publisher,
    crashPublisher,
    logger,
    idleTimeoutSec: config.IDLE_TIMEOUT_SEC,
  };

  // -------------------------------------------------------------------------
  // SERVIDOR 1: TCP plain port 5027 (existente)
  // -------------------------------------------------------------------------

  const plainServer = net.createServer((socket) => {
    handleConnection(socket, connectionDeps);
  });
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

    const tlsContext = tls.createSecureContext({
      cert,
      key,
      // Aceptamos TLS 1.2+. Devices Teltonika FMC150 soportan TLS 1.2;
      // 1.3 también pero sin negociación si el firmware es antiguo.
      minVersion: 'TLSv1.2',
    });

    tlsServer = tls.createServer(
      {
        SNICallback: (_servername, cb) => cb(null, tlsContext),
        // Devices Teltonika no presentan client cert — solo verifican el
        // server cert contra raíces públicas. requestCert: false explícito.
        requestCert: false,
      },
      (socket) => {
        // tls.TLSSocket extiende net.Socket — pasable directamente al
        // handler que ya espera net.Socket.
        handleConnection(socket, connectionDeps);
      },
    );
    tlsServer.on('error', (err) => {
      logger.error({ err, port: config.TLS_PORT }, 'tls server error');
    });
    tlsServer.on('tlsClientError', (err, socket) => {
      logger.warn(
        {
          err,
          remoteAddress: socket.remoteAddress,
          remotePort: socket.remotePort,
        },
        'tls handshake error — cliente con cert chain inválido o protocolo viejo',
      );
    });
    tlsServer.listen(config.TLS_PORT, () => {
      logger.info({ port: config.TLS_PORT }, 'listening for Teltonika TLS connections');
    });
  } else {
    logger.warn('TLS_CERT_PATH/TLS_KEY_PATH no configurados — listener TLS deshabilitado');
  }

  // -------------------------------------------------------------------------
  // Graceful shutdown
  // -------------------------------------------------------------------------

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutdown requested');
    const closes = [
      new Promise<void>((resolve) => plainServer.close(() => resolve())),
      tlsServer
        ? new Promise<void>((resolve) => tlsServer?.close(() => resolve()))
        : Promise.resolve(),
    ];
    try {
      await Promise.all(closes);
      logger.info('servers closed');
    } catch (err) {
      logger.error({ err }, 'error closing servers');
    }
    try {
      await publisher.flush();
      logger.info('publisher flushed');
    } catch (e) {
      logger.error({ err: e }, 'error flushing publisher');
    }
    try {
      await pool.end();
      logger.info('pg pool closed');
    } catch (e) {
      logger.error({ err: e }, 'error closing pg pool');
    }
    process.exit(0);
  };

  // Hard kill después de 30s si las conexiones no cierran.
  const forceExit = (signal: string) => {
    void shutdown(signal);
    setTimeout(() => {
      logger.warn('shutdown timeout, forcing exit');
      process.exit(1);
    }, 30_000).unref();
  };

  process.on('SIGTERM', () => forceExit('SIGTERM'));
  process.on('SIGINT', () => forceExit('SIGINT'));
}

main().catch((err) => {
  const bootstrapLogger = createLogger({
    service: '@booster-ai/telemetry-tcp-gateway',
    level: 'fatal',
  });
  bootstrapLogger.fatal({ err }, 'Fatal startup error');
  process.exit(1);
});
