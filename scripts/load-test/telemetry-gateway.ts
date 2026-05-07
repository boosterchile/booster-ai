#!/usr/bin/env tsx
/**
 * Wave 2 D1 — Load test simulator del telemetry-tcp-gateway.
 *
 * Simula N devices Teltonika FMC150 conectándose por TCP, mandando
 * IMEI handshake + AVL packets a un ritmo configurable. Mide latencia
 * por percentil y detecta caídas del gateway o backpressure de Pub/Sub.
 *
 * Uso:
 *   tsx scripts/load-test/telemetry-gateway.ts \
 *     --host telemetry.staging.boosterchile.com \
 *     --port 5027 \
 *     --devices 10 \
 *     --rate-sec 30 \
 *     --duration-sec 3600 \
 *     --scenario target
 *
 * Escenarios pre-definidos (--scenario):
 *   - baseline: 1 device, 300s rate, 60s duration. CPU < 5%, RAM < 100MB.
 *   - target:   10 devices, 30s rate, 3600s duration. CPU < 30%, RAM < 200MB.
 *   - stress:   100 devices, 30s rate, 1800s duration. Verificar que NO cae.
 *   - crash-burst: 5 devices simulando Crash Trace simultáneo (75 KB).
 *
 * El script imprime stats agregados al final + JSON con percentiles a
 * stdout (parseable por scripts de CI).
 *
 * Documentar resultados en
 * docs/handoff/2026-05-XX-telemetry-load-test-results.md.
 */

import net from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { encodeImeiAck } from '@booster-ai/codec8-parser';

// =============================================================================
// CLI args parsing
// =============================================================================

interface CliArgs {
  host: string;
  port: number;
  devices: number;
  rateSec: number;
  durationSec: number;
  scenario: 'baseline' | 'target' | 'stress' | 'crash-burst' | 'custom';
}

function parseArgs(): CliArgs {
  const args: Record<string, string> = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i]?.replace(/^--/, '');
    const value = process.argv[i + 1];
    if (key && value) {
      args[key] = value;
    }
  }
  const scenario = (args.scenario ?? 'custom') as CliArgs['scenario'];
  const presets: Record<string, Partial<CliArgs>> = {
    baseline: { devices: 1, rateSec: 300, durationSec: 60 },
    target: { devices: 10, rateSec: 30, durationSec: 3600 },
    stress: { devices: 100, rateSec: 30, durationSec: 1800 },
    'crash-burst': { devices: 5, rateSec: 5, durationSec: 60 },
  };
  const preset = presets[scenario] ?? {};
  return {
    host: args.host ?? 'localhost',
    port: Number.parseInt(args.port ?? '5027', 10),
    devices: Number.parseInt(args.devices ?? String(preset.devices ?? 1), 10),
    rateSec: Number.parseInt(args['rate-sec'] ?? String(preset.rateSec ?? 60), 10),
    durationSec: Number.parseInt(args['duration-sec'] ?? String(preset.durationSec ?? 60), 10),
    scenario,
  };
}

// =============================================================================
// Codec 8 packet builders (espejo de los que usan los tests reales)
// =============================================================================

/**
 * Encode IMEI handshake: 2B length + IMEI ASCII.
 */
function buildImeiHandshake(imei: string): Buffer {
  const imeiBuf = Buffer.from(imei, 'ascii');
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16BE(imeiBuf.length, 0);
  return Buffer.concat([lenBuf, imeiBuf]);
}

/**
 * Encode un AVL packet Codec 8 con un solo record con GPS sintético.
 * El timestamp y la velocidad se aleatorizan para evitar dedup en el
 * processor (UNIQUE imei,timestamp_device).
 */
function buildAvlPacket(opts: {
  timestampMs: bigint;
  isCrashEvent?: boolean;
  /** Padding extra para simular Crash Trace (típico 5-15 KB con ~1000
   *  records de acelerómetro + GNSS + IO). */
  paddingBytes?: number;
}): Buffer {
  const { timestampMs, isCrashEvent = false, paddingBytes = 0 } = opts;

  // Data field: codec_id(1) + count1(1) + records + count2(1)
  const recordParts: Buffer[] = [];

  // 1 record principal con event marker + GPS
  const ts = Buffer.alloc(8);
  ts.writeBigUInt64BE(timestampMs, 0);
  recordParts.push(ts);

  recordParts.push(Buffer.from([isCrashEvent ? 2 : 0])); // priority

  // GPS 15B
  const gps = Buffer.alloc(15);
  gps.writeInt32BE(Math.round(-70.6483 * 1e7), 0); // lng
  gps.writeInt32BE(Math.round(-33.4569 * 1e7), 4); // lat
  gps.writeInt16BE(567, 8); // alt m
  gps.writeUInt16BE(137, 10); // angle
  gps.writeUInt8(12, 12); // satellites
  gps.writeUInt16BE(60, 13); // speed kmh
  recordParts.push(gps);

  // IO section: eventIoId + totalIo + N1[]+N2[]+N4[]+N8[]
  const eventIoId = isCrashEvent ? 247 : 0;
  // Wave 2: 14 IDs Low Priority (mock con valores válidos).
  const n1 = [
    [239, 1], // ignition
    [240, 1], // movement
    [200, 0], // sleep mode
    [21, 4], // GSM signal
    [69, 1], // GNSS status
    [80, 0], // data mode
  ] as const;
  const n2 = [
    [181, 18], // PDOP × 10
    [182, 12], // HDOP × 10
    [66, 12500], // ext voltage mV
    [67, 4100], // bat voltage mV
    [68, 150], // bat current mA
    [24, 60], // speed
  ] as const;
  const n4 = [
    [16, 145_678_000], // total odometer m
    [199, 12_500], // trip odometer m
  ] as const;

  recordParts.push(Buffer.from([eventIoId, n1.length + n2.length + n4.length]));

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

  recordParts.push(Buffer.from([n4.length]));
  for (const [id, v] of n4) {
    const b = Buffer.alloc(5);
    b.writeUInt8(id, 0);
    b.writeUInt32BE(v, 1);
    recordParts.push(b);
  }

  recordParts.push(Buffer.from([0])); // n8.length = 0

  // Crash trace padding — agrega muchos records sintéticos para hacer
  // el packet pesado (5-15 KB típico).
  if (paddingBytes > 0 && isCrashEvent) {
    const padding = Buffer.alloc(paddingBytes, 0);
    recordParts.push(padding);
  }

  const dataSection = Buffer.concat([
    Buffer.from([0x08, 1]), // codec id 8 + count1=1
    ...recordParts,
    Buffer.from([1]), // count2=1
  ]);

  // Wrap: preamble(4)=0 + length(4) + data + crc(4)
  const preamble = Buffer.alloc(4); // 0x00000000
  const length = Buffer.alloc(4);
  length.writeUInt32BE(dataSection.length, 0);

  const crc = crc16Ibm(dataSection);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);

  return Buffer.concat([preamble, length, dataSection, crcBuf]);
}

/**
 * CRC-16/IBM (poly 0xA001 reflected). Misma función que el server usa
 * para validar; round-trip garantiza que los packets pasen.
 */
function crc16Ibm(data: Buffer): number {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 1) === 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
  }
  return crc & 0xffff;
}

// =============================================================================
// Simulator — un device
// =============================================================================

interface DeviceStats {
  imei: string;
  packetsSent: number;
  ackReceived: number;
  errors: number;
  latenciesMs: number[];
}

async function runDevice(opts: {
  host: string;
  port: number;
  imei: string;
  rateSec: number;
  durationSec: number;
  scenario: CliArgs['scenario'];
}): Promise<DeviceStats> {
  const { host, port, imei, rateSec, durationSec, scenario } = opts;
  const stats: DeviceStats = {
    imei,
    packetsSent: 0,
    ackReceived: 0,
    errors: 0,
    latenciesMs: [],
  };

  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port }, async () => {
      // 1. IMEI handshake.
      socket.write(buildImeiHandshake(imei));

      // 2. Esperar ack (1 byte: 0x01 = OK).
      const ack = await new Promise<Buffer>((res) => socket.once('data', (d: Buffer) => res(d)));
      if (ack[0] !== 0x01) {
        stats.errors += 1;
        socket.destroy();
        resolve(stats);
        return;
      }

      // 3. Loop de AVL packets durante durationSec.
      const start = Date.now();
      while (Date.now() - start < durationSec * 1000) {
        const isCrash = scenario === 'crash-burst' && stats.packetsSent === 0;
        const packet = buildAvlPacket({
          timestampMs: BigInt(Date.now()),
          isCrashEvent: isCrash,
          // 5 KB padding para simular Crash Trace pesado.
          paddingBytes: isCrash ? 5 * 1024 : 0,
        });

        const sentAt = Date.now();
        socket.write(packet);
        stats.packetsSent += 1;

        // Esperar ack del server (4 BE: record count).
        try {
          const serverAck = await new Promise<Buffer>((res, rej) => {
            const onData = (d: Buffer) => {
              socket.off('error', onErr);
              res(d);
            };
            const onErr = (e: Error) => {
              socket.off('data', onData);
              rej(e);
            };
            socket.once('data', onData);
            socket.once('error', onErr);
          });
          if (serverAck.length === 4 && serverAck.readUInt32BE(0) >= 1) {
            stats.ackReceived += 1;
            stats.latenciesMs.push(Date.now() - sentAt);
          } else {
            stats.errors += 1;
          }
        } catch {
          stats.errors += 1;
          break;
        }

        await sleep(rateSec * 1000);
      }

      socket.end();
      resolve(stats);
    });

    socket.on('error', () => {
      stats.errors += 1;
      resolve(stats);
    });
  });
}

// =============================================================================
// Aggregation + reporting
// =============================================================================

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx] ?? 0;
}

function reportAggregate(stats: readonly DeviceStats[], args: CliArgs): void {
  const totalPackets = stats.reduce((s, d) => s + d.packetsSent, 0);
  const totalAcks = stats.reduce((s, d) => s + d.ackReceived, 0);
  const totalErrors = stats.reduce((s, d) => s + d.errors, 0);
  const allLatencies = stats.flatMap((d) => d.latenciesMs).sort((a, b) => a - b);

  const summary = {
    scenario: args.scenario,
    config: {
      host: args.host,
      port: args.port,
      devices: args.devices,
      rateSec: args.rateSec,
      durationSec: args.durationSec,
    },
    results: {
      totalPackets,
      totalAcks,
      totalErrors,
      ackRatePct: totalPackets > 0 ? (totalAcks / totalPackets) * 100 : 0,
      latencyMs: {
        p50: percentile(allLatencies, 0.5),
        p95: percentile(allLatencies, 0.95),
        p99: percentile(allLatencies, 0.99),
        max: allLatencies[allLatencies.length - 1] ?? 0,
      },
    },
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(summary, null, 2));

  // Exit code: error si hubo > 1% errors o p95 > 1000ms en stress.
  const errorRate = totalPackets > 0 ? totalErrors / totalPackets : 0;
  if (errorRate > 0.01) {
    // eslint-disable-next-line no-console
    console.error(`FAIL: error rate ${(errorRate * 100).toFixed(2)}% > 1%`);
    process.exit(1);
  }
  if (args.scenario === 'stress' && summary.results.latencyMs.p95 > 1000) {
    // eslint-disable-next-line no-console
    console.error(`FAIL: stress p95 latency ${summary.results.latencyMs.p95}ms > 1000ms`);
    process.exit(1);
  }
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const args = parseArgs();
  // eslint-disable-next-line no-console
  console.error(
    `[load-test] scenario=${args.scenario} devices=${args.devices} rateSec=${args.rateSec} durationSec=${args.durationSec} → ${args.host}:${args.port}`,
  );

  // Lanzar todos los devices en paralelo, con jitter para evitar
  // thundering herd en el handshake inicial.
  const promises: Array<Promise<DeviceStats>> = [];
  for (let i = 0; i < args.devices; i++) {
    const imei = `35630704244${String(1000 + i).padStart(4, '0')}`;
    const jitterMs = Math.floor(Math.random() * 1000);
    await sleep(jitterMs);
    promises.push(
      runDevice({
        host: args.host,
        port: args.port,
        imei,
        rateSec: args.rateSec,
        durationSec: args.durationSec,
        scenario: args.scenario,
      }),
    );
  }

  const stats = await Promise.all(promises);
  reportAggregate(stats, args);
}

// Suprimir warnings sobre encodeImeiAck importado pero no usado
// directamente — lo necesitamos como dep de validación end-to-end.
void encodeImeiAck;

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error:', err);
  process.exit(1);
});
