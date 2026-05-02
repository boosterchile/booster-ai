/**
 * Smoke-test end-to-end del pipeline Teltonika.
 *
 * Simula un device FMC150 conectándose al gateway:
 *   1. TCP connect a HOST:PORT (default 34.176.126.66:5027 — producción).
 *   2. Manda IMEI handshake con un IMEI de test (formato: 999000000000NNN).
 *   3. Espera ACK 0x01.
 *   4. Manda 1 AVL packet con GPS dummy (Santiago, Chile) + timestamp now.
 *   5. Espera ACK 4-byte BE = 1 (records aceptados).
 *   6. Cierra conexión limpia.
 *
 * Verificación: el IMEI aparece en /admin/dispositivos en la PWA dentro de
 * 30s (TanStack Query polling). Si está autorizado, el AVL se persiste en
 * telemetria_puntos.
 *
 * Uso:
 *   pnpm --filter @booster-ai/telemetry-tcp-gateway smoke-test
 *
 * Override:
 *   GATEWAY_HOST=localhost GATEWAY_PORT=5027 pnpm ... smoke-test
 *   IMEI=352093081452103 pnpm ... smoke-test
 */

import { Socket } from 'node:net';
import { encodeImeiAck, crc16Ibm } from '@booster-ai/codec8-parser';

// biome-ignore lint/suspicious/noConsole: smoke-test CLI script — console output es la UX.
const log = console.log;

const HOST = process.env.GATEWAY_HOST ?? '34.176.126.66';
const PORT = Number.parseInt(process.env.GATEWAY_PORT ?? '5027', 10);
// IMEI de test reservado: prefijo 999 no choca con IMEIs reales (rango 1-89,
// 99 es Manufacturers reservado). Cambialo si ya está en dispositivos_pendientes
// y querés simular un device nuevo.
const IMEI = process.env.IMEI ?? `999000000000${String(Date.now()).slice(-3)}`;

function buildHandshake(imei: string): Buffer {
  if (imei.length === 0 || imei.length > 65535) {
    throw new Error(`IMEI inválido: longitud ${imei.length}`);
  }
  const lengthBytes = Buffer.alloc(2);
  lengthBytes.writeUInt16BE(imei.length, 0);
  return Buffer.concat([lengthBytes, Buffer.from(imei, 'ascii')]);
}

function buildAvlPacketSantiago(): Buffer {
  // 1 AVL record con GPS Santiago Centro (-33.4489, -70.6693).
  const data: Buffer[] = [];

  data.push(Buffer.from([0x08, 1])); // codec id + record count

  // Record:
  const ts = Buffer.alloc(8);
  ts.writeBigUInt64BE(BigInt(Date.now()), 0);
  data.push(ts);

  data.push(Buffer.from([1])); // priority = high

  // GPS (15 bytes BE).
  const gps = Buffer.alloc(15);
  gps.writeInt32BE(Math.round(-70.6693 * 1e7), 0); // longitude
  gps.writeInt32BE(Math.round(-33.4489 * 1e7), 4); // latitude
  gps.writeInt16BE(560, 8); // altitude (Santiago ~560m)
  gps.writeUInt16BE(180, 10); // angle
  gps.writeUInt8(12, 12); // satellites
  gps.writeUInt16BE(45, 13); // speed kmh
  data.push(gps);

  // IO section: ningún IO element (lo más mínimo válido).
  data.push(Buffer.from([0, 0])); // event io id = 0, total = 0
  data.push(Buffer.from([0])); // n1 = 0
  data.push(Buffer.from([0])); // n2 = 0
  data.push(Buffer.from([0])); // n4 = 0
  data.push(Buffer.from([0])); // n8 = 0

  data.push(Buffer.from([1])); // record count repeated

  const dataField = Buffer.concat(data);

  // Envoltura: [4B preamble = 0][4B BE length][data][4B BE crc]
  const preamble = Buffer.alloc(4); // 0x00000000
  const length = Buffer.alloc(4);
  length.writeUInt32BE(dataField.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc16Ibm(dataField) & 0xffff, 0);

  return Buffer.concat([preamble, length, dataField, crc]);
}

async function smokeTest(): Promise<void> {
  log(`╭─ Booster AI · Teltonika gateway smoke-test`);
  log(`│  target  : ${HOST}:${PORT}`);
  log(`│  imei    : ${IMEI}`);
  log(`╰─`);

  const socket = new Socket();
  let phase: 'connecting' | 'handshake' | 'avl' | 'done' = 'connecting';
  const handshakeAck = encodeImeiAck(true); // 0x01

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`timeout en fase '${phase}'`));
    }, 15_000);

    socket.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    socket.connect(PORT, HOST, () => {
      log(`✓ TCP conectado`);
      phase = 'handshake';
      socket.write(buildHandshake(IMEI));
      log(`→ handshake enviado (${IMEI.length} bytes IMEI + 2 byte length)`);
    });

    socket.on('data', (chunk: Buffer) => {
      if (phase === 'handshake') {
        if (chunk.length === 1 && chunk[0] === handshakeAck[0]) {
          log(`← handshake ACK 0x01 (aceptado)`);
          phase = 'avl';
          const packet = buildAvlPacketSantiago();
          socket.write(packet);
          log(`→ AVL packet enviado (${packet.length} bytes, 1 record GPS Santiago)`);
        } else {
          clearTimeout(timeout);
          socket.destroy();
          reject(new Error(`handshake rechazado o respuesta inesperada: ${chunk.toString('hex')}`));
        }
      } else if (phase === 'avl') {
        if (chunk.length === 4) {
          const accepted = chunk.readUInt32BE(0);
          log(`← AVL ACK ${accepted} record(s) aceptado(s)`);
          if (accepted === 1) {
            phase = 'done';
            clearTimeout(timeout);
            socket.end();
          } else {
            clearTimeout(timeout);
            socket.destroy();
            reject(new Error(`servidor reportó ${accepted} records aceptados, esperaba 1`));
          }
        } else {
          clearTimeout(timeout);
          socket.destroy();
          reject(new Error(`AVL ACK con longitud inesperada: ${chunk.length} bytes`));
        }
      }
    });

    socket.on('close', () => {
      if (phase === 'done') {
        clearTimeout(timeout);
        resolve();
      } else if (phase !== 'connecting') {
        clearTimeout(timeout);
        reject(new Error(`socket cerrado prematuramente en fase '${phase}'`));
      }
    });
  });

  log(``);
  log(`✓ Smoke-test OK`);
  log(``);
  log(`Próximos pasos:`);
  log(`  1. Abrí https://app.boosterchile.com/app/admin/dispositivos`);
  log(`  2. Esperá <30s (TanStack Query polling) — debería aparecer:`);
  log(`     IMEI ${IMEI}, 1 conexión, hace unos segundos.`);
  log(`  3. Asocialo a cualquier vehículo de prueba (no rompe nada).`);
}

smokeTest().catch((err: Error) => {
  log(``);
  log(`✗ Smoke-test FALLÓ: ${err.message}`);
  process.exit(1);
});
