#!/usr/bin/env tsx
/**
 * W3 (hito CORFO mes 8) — Simulador Codec8 de un envío con 2 sensores:
 * posición GPS + temperatura (IO 72 Dallas Temperature, FMC150).
 *
 * Recorre la ruta costera La Serena ↔ Coquimbo (Ruta 5 / Av. del Mar)
 * mandando frames Codec 8 (0x08) por TCP: handshake IMEI + AVL records con
 * GPS + el set Low Priority mínimo (ignition, movement, voltajes) + IO 72
 * Dallas Temp. El perfil de temperatura "frio" simula una cadena de frío
 * 2-8°C con una excursión térmica breve (10.5°C) a mitad de cada tramo.
 *
 * El IMEI DEBE estar asociado a un vehículo (PATCH /vehiculos/:id desde
 * /admin/dispositivos-pendientes) ANTES de correr esto — si no, el
 * telemetry-processor descarta los records con warn (ver
 * .specs/hito-2-corfo-mes-8/w3-contexto.md, gotcha #2).
 *
 * ── Uso local (gateway corriendo en localhost) ──────────────────────────
 *
 *   pnpm --filter @booster-ai/demo-scripts simulate-envio -- \
 *     --imei 999000000000123
 *
 *   # Ida-vuelta continua, perfil frío, cada 5s (solo para iterar rápido
 *   # en local — en prod respetar el intervalo ≥10s, ver abajo):
 *   pnpm --filter @booster-ai/demo-scripts simulate-envio -- \
 *     --imei 999000000000123 --loop --interval-s 5
 *
 * ── Uso contra PRODUCCIÓN (demo en vivo con IMEI real) ──────────────────
 *
 *   pnpm --filter @booster-ai/demo-scripts simulate-envio -- \
 *     --imei <IMEI-real-15-digitos> \
 *     --host 34.176.126.66 --port 5027 \
 *     --loop
 *
 * Precauciones para la corrida contra prod:
 *   1. Usar el IMEI de 15 dígitos reservado para la demo (asociado de
 *      antemano al vehículo demo vía /admin/dispositivos-pendientes).
 *   2. --interval-s >= 10 (default). El gateway de prod sirve tráfico
 *      real de la flota — no generar carga innecesaria.
 *   3. Cortar con Ctrl+C en cualquier momento; cierra el socket y termina
 *      el proceso de inmediato (no deja conexiones colgando).
 *
 * CLI:
 *   --imei <15 dígitos>   Obligatorio.
 *   --host <string>       Default: localhost
 *   --port <número>       Default: 5027
 *   --interval-s <número> Default: 10
 *   --speed-kmh <número>  Default: 60
 *   --temp-profile frio   Default: frio (único perfil soportado hoy)
 *   --loop                Ida-vuelta continua (sin valor, flag booleano)
 */

import { Socket } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { crc16Ibm, encodeImeiAck } from '@booster-ai/codec8-parser';

// demo CLI script — console output es la UX (noConsole está off para
// scripts/**, ver biome.json).
const log = console.log;

// =============================================================================
// CLI args
// =============================================================================

interface CliArgs {
  imei: string;
  host: string;
  port: number;
  intervalS: number;
  speedKmh: number;
  tempProfile: 'frio';
  loop: boolean;
}

const IMEI_REGEX = /^\d{15}$/;

function parseArgs(): CliArgs {
  const raw = process.argv.slice(2);
  const values: Record<string, string> = {};
  let loop = false;

  for (let i = 0; i < raw.length; i++) {
    const token = raw[i];
    if (token === '--loop') {
      loop = true;
      continue;
    }
    if (token?.startsWith('--')) {
      const key = token.slice(2);
      const value = raw[i + 1];
      if (value !== undefined && !value.startsWith('--')) {
        values[key] = value;
        i += 1;
      }
    }
  }

  const imei = values.imei;
  if (!imei || !IMEI_REGEX.test(imei)) {
    throw new Error(
      `--imei es obligatorio y debe ser 15 dígitos exactos (recibido: ${imei ?? '(vacío)'})`,
    );
  }

  const tempProfile = values['temp-profile'] ?? 'frio';
  if (tempProfile !== 'frio') {
    throw new Error(`--temp-profile solo soporta "frio" en este demo (recibido: "${tempProfile}")`);
  }

  const port = Number.parseInt(values.port ?? '5027', 10);
  const intervalS = Number.parseInt(values['interval-s'] ?? '10', 10);
  const speedKmh = Number.parseInt(values['speed-kmh'] ?? '60', 10);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`--port inválido: ${values.port}`);
  }
  if (!Number.isFinite(intervalS) || intervalS <= 0) {
    throw new Error(`--interval-s inválido: ${values['interval-s']}`);
  }
  if (!Number.isFinite(speedKmh) || speedKmh <= 0) {
    throw new Error(`--speed-kmh inválido: ${values['speed-kmh']}`);
  }

  return {
    imei,
    host: values.host ?? 'localhost',
    port,
    intervalS,
    speedKmh,
    tempProfile: 'frio',
    loop,
  };
}

// =============================================================================
// Ruta La Serena ↔ Coquimbo — waypoints ILUSTRATIVOS
// =============================================================================

interface Waypoint {
  lat: number;
  lng: number;
}

/**
 * Waypoints a mano (NO de un routing API) aproximando el corredor costero
 * La Serena ↔ Coquimbo (Ruta 5 / Av. del Mar). Suficientes para un demo
 * E2E con movimiento geográficamente plausible — no usar como fuente de
 * verdad de la ruta real.
 */
const ROUTE_LA_SERENA_COQUIMBO: readonly Waypoint[] = [
  { lat: -29.9027, lng: -71.2519 }, // La Serena — Plaza de Armas
  { lat: -29.9074, lng: -71.261 }, // Av. Francisco de Aguirre
  { lat: -29.911, lng: -71.2695 }, // Cuatro Esquinas
  { lat: -29.916, lng: -71.274 }, // Av. del Mar — borde costero La Serena
  { lat: -29.925, lng: -71.281 }, // Av. del Mar — tramo medio
  { lat: -29.932, lng: -71.29 }, // Av. del Mar — sector Peñuelas
  { lat: -29.939, lng: -71.298 }, // Desvío La Herradura
  { lat: -29.943, lng: -71.308 }, // Mirador Tres Cruces (límite comunal)
  { lat: -29.947, lng: -71.32 }, // Entrada Coquimbo — Av. Costanera
  { lat: -29.95, lng: -71.33 }, // Coquimbo — sector Muelle
  { lat: -29.9533, lng: -71.3395 }, // Coquimbo — Plaza de Armas
];

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function haversineKm(a: Waypoint, b: Waypoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Rumbo inicial (bearing) de a → b, en grados 0..360. */
function bearingDeg(a: Waypoint, b: Waypoint): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function buildCumulativeDistances(route: readonly Waypoint[]): number[] {
  const cum: number[] = [0];
  for (let i = 1; i < route.length; i++) {
    const prevWp = route[i - 1];
    const wp = route[i];
    if (!prevWp || !wp) {
      continue;
    }
    cum.push((cum[i - 1] ?? 0) + haversineKm(prevWp, wp));
  }
  return cum;
}

/**
 * Posición interpolada a `distanceKm` recorridos desde el inicio de
 * `route` (siempre en el sentido en que está declarado el array, La
 * Serena → Coquimbo), + el rumbo "forward" de ese tramo.
 */
function positionAtDistance(
  route: readonly Waypoint[],
  cumDist: readonly number[],
  distanceKm: number,
): { position: Waypoint; forwardBearingDeg: number } {
  const total = cumDist[cumDist.length - 1] ?? 0;
  const d = Math.max(0, Math.min(distanceKm, total));

  let segIdx = 0;
  while (segIdx < route.length - 2 && (cumDist[segIdx + 1] ?? 0) < d) {
    segIdx += 1;
  }

  const segStart = route[segIdx];
  const segEnd = route[segIdx + 1];
  if (!segStart || !segEnd) {
    throw new Error('ruta de demo inválida: se requieren al menos 2 waypoints');
  }

  const segStartDist = cumDist[segIdx] ?? 0;
  const segEndDist = cumDist[segIdx + 1] ?? segStartDist;
  const segLen = segEndDist - segStartDist;
  const t = segLen > 0 ? (d - segStartDist) / segLen : 0;

  const position: Waypoint = {
    lat: segStart.lat + (segEnd.lat - segStart.lat) * t,
    lng: segStart.lng + (segEnd.lng - segStart.lng) * t,
  };

  return { position, forwardBearingDeg: bearingDeg(segStart, segEnd) };
}

// =============================================================================
// Perfil de temperatura "frio" — cadena de frío 2-8°C + pico a mitad de tramo
// =============================================================================

/**
 * `progress` = fracción 0..1 recorrida del tramo ACTUAL (ida o vuelta). El
 * pico de excursión térmica siempre cae en progress≈0.5, sin importar la
 * dirección de viaje.
 */
function temperatureForProgressFrio(progress: number): number {
  const clamped = Math.max(0, Math.min(1, progress));
  const baseline = 2 + 6 * (0.5 + 0.5 * Math.sin(clamped * Math.PI * 2)); // oscila 2..8°C
  const distToMid = Math.abs(clamped - 0.5);
  const peakHalfWidth = 0.04; // ~4% del tramo alrededor del punto medio
  const peakC = 10.5;
  if (distToMid < peakHalfWidth) {
    const peakFactor = 1 - distToMid / peakHalfWidth;
    return baseline + (peakC - baseline) * peakFactor;
  }
  return baseline;
}

function temperatureForProgress(progress: number, profile: CliArgs['tempProfile']): number {
  switch (profile) {
    case 'frio':
      return temperatureForProgressFrio(progress);
  }
}

// =============================================================================
// Codec 8 packet builders
// =============================================================================

function buildImeiHandshake(imei: string): Buffer {
  const imeiBuf = Buffer.from(imei, 'ascii');
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16BE(imeiBuf.length, 0);
  return Buffer.concat([lenBuf, imeiBuf]);
}

/** °C con signo → uint16 two's complement, décimas de °C (formato IO 72). */
function encodeDallasRawDeciCelsius(temperatureC: number): number {
  const deciCelsius = Math.round(temperatureC * 10);
  return deciCelsius < 0 ? deciCelsius + 0x10000 : deciCelsius;
}

interface AvlPacketOpts {
  timestampMs: bigint;
  latitude: number;
  longitude: number;
  altitudeM: number;
  angleDeg: number;
  speedKmh: number;
  satellites: number;
  temperatureC: number;
}

/**
 * Encode 1 AVL record Codec 8 (0x08) con GPS + IO: el set Low Priority
 * mínimo que ya usa scripts/load-test/telemetry-gateway.ts (ignition,
 * movement, voltajes) + IO 72 Dallas Temperature 1. CRC importado de
 * @booster-ai/codec8-parser — NO reimplementado acá.
 */
function buildAvlPacket(opts: AvlPacketOpts): Buffer {
  const {
    timestampMs,
    latitude,
    longitude,
    altitudeM,
    angleDeg,
    speedKmh,
    satellites,
    temperatureC,
  } = opts;

  const recordParts: Buffer[] = [];

  const ts = Buffer.alloc(8);
  ts.writeBigUInt64BE(timestampMs, 0);
  recordParts.push(ts);

  recordParts.push(Buffer.from([1])); // priority = high

  const gps = Buffer.alloc(15);
  gps.writeInt32BE(Math.round(longitude * 1e7), 0);
  gps.writeInt32BE(Math.round(latitude * 1e7), 4);
  gps.writeInt16BE(altitudeM, 8);
  gps.writeUInt16BE(Math.round(angleDeg) % 360, 10);
  gps.writeUInt8(satellites, 12);
  gps.writeUInt16BE(Math.max(0, Math.round(speedKmh)), 13);
  recordParts.push(gps);

  const movement = speedKmh > 0 ? 1 : 0;
  const n1 = [
    [239, 1], // ignition ON
    [240, movement], // movement
    [200, 0], // sleep mode = no sleep
    [21, 4], // GSM signal, 4/5 bars
    [69, 1], // GNSS status = ON_FIX
    [80, 0], // data mode = Home On Stop/Moving
  ] as const;
  const n2 = [
    [181, 18], // PDOP ×10
    [182, 12], // HDOP ×10
    [66, 12500], // external voltage mV
    [67, 4100], // battery voltage mV
    [68, 150], // battery current mA
    [24, Math.max(0, Math.round(speedKmh))], // speed (AVL 24, redundante con GPS)
    [72, encodeDallasRawDeciCelsius(temperatureC)], // Dallas Temperature 1
  ] as const;

  recordParts.push(Buffer.from([0, n1.length + n2.length])); // eventIoId=0, totalIo
  recordParts.push(Buffer.from([n1.length]));
  for (const [id, v] of n1) {
    recordParts.push(Buffer.from([id, v]));
  }
  recordParts.push(Buffer.from([n2.length]));
  for (const [id, v] of n2) {
    const b = Buffer.alloc(3);
    b.writeUInt8(id, 0);
    b.writeUInt16BE(v, 1);
    recordParts.push(b);
  }
  recordParts.push(Buffer.from([0])); // n4.length = 0
  recordParts.push(Buffer.from([0])); // n8.length = 0

  const dataSection = Buffer.concat([
    Buffer.from([0x08, 1]), // codec id 8 + record count = 1
    ...recordParts,
    Buffer.from([1]), // record count repetido (trailer Codec 8)
  ]);

  const preamble = Buffer.alloc(4); // 0x00000000
  const length = Buffer.alloc(4);
  length.writeUInt32BE(dataSection.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc16Ibm(dataSection) & 0xffff, 0);

  return Buffer.concat([preamble, length, dataSection, crc]);
}

// =============================================================================
// TCP: handshake + loop de AVL packets
// =============================================================================

function waitForData(socket: Socket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const onData = (d: Buffer) => {
      socket.off('error', onError);
      resolve(d);
    };
    const onError = (err: Error) => {
      socket.off('data', onData);
      reject(err);
    };
    socket.once('data', onData);
    socket.once('error', onError);
  });
}

async function main(): Promise<void> {
  const args = parseArgs();
  const cumDist = buildCumulativeDistances(ROUTE_LA_SERENA_COQUIMBO);
  const totalKm = cumDist[cumDist.length - 1] ?? 0;
  const isProdLikeHost = args.host !== 'localhost' && args.host !== '127.0.0.1';

  log('╭─ Booster AI · simulador Codec8 GPS + temperatura (envío demo, W3)');
  log(`│  imei        : ${args.imei}`);
  log(`│  destino     : ${args.host}:${args.port}`);
  log(`│  ruta        : La Serena ↔ Coquimbo (${totalKm.toFixed(1)} km)`);
  log(`│  velocidad   : ${args.speedKmh} km/h · intervalo ${args.intervalS}s`);
  log(`│  perfil temp : ${args.tempProfile}`);
  log(`│  loop        : ${args.loop ? 'sí (ida-vuelta continua)' : 'no (1 ida, luego termina)'}`);
  log('╰─ Ctrl+C corta el proceso en cualquier momento.');
  if (isProdLikeHost) {
    log('');
    log(
      `[demo-telemetry] ⚠ host "${args.host}" no es local — confirmá que el IMEI ${args.imei} es el reservado para la demo y está asociado al vehículo antes de seguir.`,
    );
    if (args.intervalS < 10) {
      log(
        `[demo-telemetry] ⚠ --interval-s ${args.intervalS} < 10s contra un host no-local — el gateway sirve tráfico real de la flota, evitar carga innecesaria.`,
      );
    }
  }
  log('');

  const socket = new Socket();
  process.on('SIGINT', () => {
    log('\n[demo-telemetry] SIGINT recibido — cerrando conexión y saliendo.');
    socket.destroy();
    process.exit(0);
  });

  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.connect(args.port, args.host, () => resolve());
  });
  log(`[demo-telemetry] TCP conectado a ${args.host}:${args.port}`);

  socket.write(buildImeiHandshake(args.imei));
  const handshakeAck = await waitForData(socket);
  const expectedAck = encodeImeiAck(true);
  if (handshakeAck.length !== 1 || handshakeAck[0] !== expectedAck[0]) {
    throw new Error(`handshake rechazado o respuesta inesperada: ${handshakeAck.toString('hex')}`);
  }
  log('[demo-telemetry] handshake ACK recibido (IMEI aceptado por el gateway).');

  let direction: 1 | -1 = 1; // 1 = La Serena → Coquimbo, -1 = vuelta
  let traveledKm = 0;
  let tick = 0;

  while (true) {
    const progress = totalKm > 0 ? traveledKm / totalKm : 0;
    const distanceAlongRoute = direction === 1 ? traveledKm : totalKm - traveledKm;
    const { position, forwardBearingDeg } = positionAtDistance(
      ROUTE_LA_SERENA_COQUIMBO,
      cumDist,
      distanceAlongRoute,
    );
    const angleDeg = direction === 1 ? forwardBearingDeg : (forwardBearingDeg + 180) % 360;
    const temperatureC = temperatureForProgress(progress, args.tempProfile);

    const packet = buildAvlPacket({
      timestampMs: BigInt(Date.now()),
      latitude: position.lat,
      longitude: position.lng,
      altitudeM: 20,
      angleDeg,
      speedKmh: args.speedKmh,
      satellites: 10,
      temperatureC,
    });

    socket.write(packet);
    tick += 1;
    const tramoLabel = direction === 1 ? 'La Serena→Coquimbo' : 'Coquimbo→La Serena';
    log(
      `[demo-telemetry] #${tick} ${tramoLabel} lat=${position.lat.toFixed(5)} ` +
        `lng=${position.lng.toFixed(5)} temp=${temperatureC.toFixed(1)}°C`,
    );

    try {
      const ack = await waitForData(socket);
      if (ack.length === 4 && ack.readUInt32BE(0) >= 1) {
        log(`[demo-telemetry]   ← ACK ${ack.readUInt32BE(0)} record(s) aceptado(s)`);
      } else {
        log(`[demo-telemetry]   ← ACK inesperado: ${ack.toString('hex')}`);
      }
    } catch (err) {
      log(`[demo-telemetry] conexión cerrada esperando ACK: ${(err as Error).message}`);
      break;
    }

    traveledKm += (args.speedKmh * args.intervalS) / 3600;
    if (traveledKm >= totalKm) {
      if (!args.loop) {
        log('[demo-telemetry] llegó al destino. --loop no está activo, terminando.');
        break;
      }
      traveledKm = 0;
      direction = direction === 1 ? -1 : 1;
      log('[demo-telemetry] llegó al destino, invirtiendo dirección (ida-vuelta continua).');
    }

    await sleep(args.intervalS * 1000);
  }

  socket.end();
  log('[demo-telemetry] listo.');
}

main().catch((err: Error) => {
  log(`[demo-telemetry] FATAL: ${err.message}`);
  process.exit(1);
});
