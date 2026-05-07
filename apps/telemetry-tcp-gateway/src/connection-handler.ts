import type { Socket } from 'node:net';
import {
  CodecCrcError,
  CodecParseError,
  encodeAvlAck,
  encodeImeiAck,
  isCrashTracePacket,
  parseAvlPacket,
  parseImeiHandshake,
} from '@booster-ai/codec8-parser';
import type { Logger } from '@booster-ai/logger';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { resolveImei } from './imei-auth.js';
import type { CrashTracePublisher, TelemetryPublisher } from './pubsub-publisher.js';

/**
 * Lifecycle de una conexión TCP de un device Teltonika:
 *
 *   ┌─ socket connect ────────────────────────────────────────┐
 *   │                                                          │
 *   │  1. Espera primer chunk (≤2s) → parseImeiHandshake.     │
 *   │     - Falla → encodeImeiAck(false) + close.             │
 *   │                                                          │
 *   │  2. Resuelve IMEI → vehicleId (o pendiente).            │
 *   │     - Send encodeImeiAck(true) (siempre, incluso si     │
 *   │       pendiente — el device queda mandando data y el    │
 *   │       admin lo asocia desde el panel).                  │
 *   │                                                          │
 *   │  3. Loop: lee chunks, busca AVL packets completos       │
 *   │     (4B preamble + 4B length + N bytes data + 4B CRC),  │
 *   │     parsea, publica a Pub/Sub, ACK 4B BE record count.  │
 *   │     Network Ping bytes (0xFF) entre packets se ignoran  │
 *   │     silenciosamente — ver skipNetworkPings().           │
 *   │                                                          │
 *   │  4. Idle timeout o socket close → cleanup.              │
 *   │                                                          │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Manejo de chunked reads: TCP no garantiza que un AVL packet llegue
 * en un solo `data` event. Acumulamos bytes en un buffer interno y
 * parseamos cuando hay suficiente. Si llega más de un packet en el
 * mismo chunk, los procesamos secuencialmente.
 *
 * Network Ping (Wave 2 device profile FMC150): el device manda un byte
 * 0xFF cada N segundos (configurado en "Network Ping Timeout") para
 * mantener NAT abierto. No es un AVL packet — el gateway debe
 * descartarlo sin generar errores ni cerrar la conexión.
 */

/**
 * Descarta bytes 0xFF aislados al inicio del buffer (Network Ping del
 * device para mantener NAT abierto). Wave 2 activa este comportamiento
 * en los FMC150; sin este skip el gateway ve 0xFF como preamble inválido
 * y mata la conexión, dejando al device sin telemetría.
 *
 * Pure function. Retorna un nuevo Buffer con prefix 0xFF removido. Si el
 * buffer no empieza con 0xFF, lo retorna sin modificar.
 */
export function skipNetworkPings(buffer: Buffer): Buffer {
  let offset = 0;
  while (offset < buffer.length && buffer[offset] === 0xff) {
    offset += 1;
  }
  return offset === 0 ? buffer : buffer.subarray(offset);
}

export interface ConnectionDeps {
  db: NodePgDatabase<Record<string, unknown>>;
  publisher: TelemetryPublisher;
  /** Publisher al topic crash-traces (Wave 2 B3). Si null, los crash
   *  traces no se publican como packet (env sin bucket configurado);
   *  los records individuales siguen yendo al topic telemetry-events. */
  crashPublisher: CrashTracePublisher | null;
  logger: Logger;
  idleTimeoutSec: number;
}

interface ConnectionState {
  imei: string | null;
  vehicleId: string | null;
  pendingDeviceId: string | null;
  buffer: Buffer;
  recordsReceived: number;
  recordsPublished: number;
  receivedFirstHandshake: boolean;
}

export function handleConnection(socket: Socket, deps: ConnectionDeps): void {
  const { db, publisher, crashPublisher, logger, idleTimeoutSec } = deps;
  const sourceIp = socket.remoteAddress ?? null;
  const childLogger = logger.child({
    component: 'connection-handler',
    sourceIp,
    sourcePort: socket.remotePort ?? null,
  });

  const state: ConnectionState = {
    imei: null,
    vehicleId: null,
    pendingDeviceId: null,
    buffer: Buffer.alloc(0),
    recordsReceived: 0,
    recordsPublished: 0,
    receivedFirstHandshake: false,
  };

  socket.setNoDelay(true);
  socket.setKeepAlive(true, 60_000);
  socket.setTimeout(idleTimeoutSec * 1000);

  socket.on('timeout', () => {
    childLogger.info({ ...summary(state) }, 'idle timeout, cerrando conexión');
    socket.destroy();
  });

  socket.on('error', (err) => {
    childLogger.warn({ err }, 'socket error');
  });

  socket.on('close', () => {
    childLogger.info({ ...summary(state) }, 'conexión cerrada');
  });

  socket.on('data', (chunk: Buffer) => {
    state.buffer = state.buffer.length === 0 ? chunk : Buffer.concat([state.buffer, chunk]);

    // Mientras tengamos bytes para procesar, drain.
    void processBuffer({
      state,
      socket,
      db,
      publisher,
      crashPublisher,
      logger: childLogger,
      sourceIp,
    }).catch((err) => {
      childLogger.error({ err }, 'error procesando buffer, cerrando conexión');
      socket.destroy();
    });
  });
}

async function processBuffer(opts: {
  state: ConnectionState;
  socket: Socket;
  db: NodePgDatabase<Record<string, unknown>>;
  publisher: TelemetryPublisher;
  crashPublisher: CrashTracePublisher | null;
  logger: Logger;
  sourceIp: string | null;
}): Promise<void> {
  const { state, socket, db, publisher, crashPublisher, logger, sourceIp } = opts;

  // Fase 1: handshake IMEI.
  if (!state.receivedFirstHandshake) {
    if (state.buffer.length < 2) {
      return; // necesitamos al menos los 2 bytes de length
    }
    const declaredLen = state.buffer.readUInt16BE(0);
    if (state.buffer.length < 2 + declaredLen) {
      return; // todavía falta IMEI completo
    }

    try {
      const { imei } = parseImeiHandshake(state.buffer.subarray(0, 2 + declaredLen));
      state.imei = imei;
      state.buffer = state.buffer.subarray(2 + declaredLen);

      const resolution = await resolveImei({ db, logger, imei, sourceIp });
      state.vehicleId = resolution.vehicleId;
      state.pendingDeviceId = resolution.pendingDeviceId;
      state.receivedFirstHandshake = true;

      socket.write(encodeImeiAck(true));
      logger.info(
        { imei, vehicleId: state.vehicleId, pendingDeviceId: state.pendingDeviceId },
        'handshake IMEI completado',
      );
    } catch (err) {
      logger.warn({ err, sourceIp }, 'handshake IMEI inválido, rechazando conexión');
      socket.write(encodeImeiAck(false));
      socket.destroy();
      return;
    }
  }

  // Fase 2: AVL packets (puede haber 0..N en el buffer).
  // skipNetworkPings se invoca en cada iteración para descartar 0xFF
  // aislados que pueden llegar entre packets (Wave 2 Network Ping).
  while (true) {
    state.buffer = skipNetworkPings(state.buffer);
    if (state.buffer.length < 8) {
      return; // necesitamos al menos 8 bytes para preamble + length
    }
    const preamble = state.buffer.readUInt32BE(0);
    if (preamble !== 0x00000000) {
      logger.warn(
        { preamble: preamble.toString(16), imei: state.imei },
        'preamble inesperado, descartando bytes y cerrando',
      );
      socket.destroy();
      return;
    }
    const dataLen = state.buffer.readUInt32BE(4);
    const totalLen = 8 + dataLen + 4;
    if (state.buffer.length < totalLen) {
      // Aún falta data, esperamos más bytes.
      return;
    }

    const packetBuf = state.buffer.subarray(0, totalLen);
    state.buffer = state.buffer.subarray(totalLen);

    try {
      const packet = parseAvlPacket(packetBuf);
      state.recordsReceived += packet.recordCount;

      // Post-handshake state.imei está garantizado set (sino habríamos
      // returneado en la rama de handshake). Lo aliasamos para evitar
      // non-null assertion y para que TS lo trate como string.
      const imei = state.imei ?? '';

      // Detección Crash Trace (Wave 2 B3): si el packet contiene un
      // record con eventIoId=247 priority=panic, publicamos el packet
      // ENTERO al topic crash-traces para forensics. Independiente del
      // publish record-by-record (que sigue para que telemetria_puntos
      // tenga las ubicaciones individuales).
      if (crashPublisher && isCrashTracePacket(packet)) {
        try {
          await crashPublisher.publishCrashTrace({
            imei,
            vehicleId: state.vehicleId,
            packet,
          });
        } catch (err) {
          // El crash-trace fallido no debe bloquear el ACK al device:
          // los records individuales todavía van a Pub/Sub y luego a DB.
          // El log permite reproc manual desde el JSON capturado.
          logger.error(
            { err, imei, vehicleId: state.vehicleId },
            'fallo publicar crash-trace, continuando con records individuales',
          );
        }
      }

      // Publicamos cada record por separado.
      const publishes = packet.records.map((rec) =>
        publisher.publishRecord({
          imei,
          vehicleId: state.vehicleId,
          record: rec,
        }),
      );
      const messageIds = await Promise.all(publishes);
      state.recordsPublished += messageIds.length;

      // ACK al device — el conteo le dice cuántos records aceptamos.
      // Si fallara la publish para alguno, igual respondemos el total
      // (ya está en Pub/Sub o lo logueamos para reproc); evitar que el
      // device acumule y bloqueé su buffer interno.
      socket.write(encodeAvlAck(packet.recordCount));

      logger.info(
        {
          imei: state.imei,
          vehicleId: state.vehicleId,
          recordCount: packet.recordCount,
          codec: packet.codecId,
        },
        'avl packet procesado',
      );
    } catch (err) {
      if (err instanceof CodecCrcError) {
        logger.warn({ err, imei: state.imei }, 'CRC inválido, ack 0 + cerramos');
      } else if (err instanceof CodecParseError) {
        logger.warn({ err, imei: state.imei }, 'parse error, ack 0 + cerramos');
      } else {
        logger.error({ err, imei: state.imei }, 'error inesperado procesando packet');
      }
      socket.write(encodeAvlAck(0));
      socket.destroy();
      return;
    }
  }
}

function summary(state: ConnectionState) {
  return {
    imei: state.imei,
    vehicleId: state.vehicleId,
    recordsReceived: state.recordsReceived,
    recordsPublished: state.recordsPublished,
  };
}
