import { crc16Ibm, parseAvlPacket, parseImeiHandshake } from '@booster-ai/codec8-parser';
import { describe, expect, it } from 'vitest';
import { buildAvlPacket, buildImeiHandshake } from './simulate-envio-telemetry.js';

/**
 * Round-trip REAL simulador → parser (W3, hito CORFO mes 8).
 *
 * Reemplaza la verificación manual que se hizo con un
 * `_manual-fake-gateway.ts` temporal (borrado, nunca commiteado) contra el
 * TCP gateway real antes de la demo en vivo. Este test ejercita el MISMO
 * camino de bytes sin sockets: `buildAvlPacket`/`buildImeiHandshake` (el
 * encoder que usa el CLI de demo, `scripts/demo/simulate-envio-telemetry.ts`)
 * contra `parseAvlPacket`/`parseImeiHandshake`/`crc16Ibm`
 * (`@booster-ai/codec8-parser`, el decoder real que usa
 * `apps/telemetry-tcp-gateway`). Si cualquiera de los dos lados diverge del
 * protocolo Codec 8 — o si un cambio futuro al encoder rompe el formato que
 * el gateway espera — este test lo detecta sin necesidad de un TCP gateway
 * corriendo ni de intervención manual antes de la próxima demo.
 */

const IMEI_DEMO = '999000000000123';

describe('simulador demo W3 — round-trip handshake', () => {
  it('el handshake construido por el simulador parsea al IMEI exacto', () => {
    const handshake = buildImeiHandshake(IMEI_DEMO);
    const parsed = parseImeiHandshake(handshake);
    expect(parsed.imei).toBe(IMEI_DEMO);
  });
});

describe('simulador demo W3 — round-trip AVL packet (GPS + IO 72 temperatura)', () => {
  const baseOpts = {
    timestampMs: 1751500000000n, // 2025-07-02 ~21:26 UTC, arbitrario pero fijo
    latitude: -29.9027, // La Serena — Plaza de Armas (waypoint real de la ruta demo)
    longitude: -71.2519,
    altitudeM: 42,
    angleDeg: 137,
    speedKmh: 62,
    satellites: 11,
  };

  it('el packet parsea sin error y el CRC-16/IBM del trailer es válido', () => {
    const packet = buildAvlPacket({ ...baseOpts, temperatureC: 5.2 });

    // No debe tirar (parseAvlPacket valida el CRC internamente y lanza
    // CodecCrcError si no matchea).
    expect(() => parseAvlPacket(packet)).not.toThrow();

    // Verificación EXPLÍCITA e independiente con crc16Ibm sobre los bytes
    // reales del data field (preamble 4B + length 4B, luego data field,
    // luego trailer de 4B donde los 2 hi son 0 y los 2 lo son el CRC).
    const dataFieldLength = packet.readUInt32BE(4);
    const dataField = packet.subarray(8, 8 + dataFieldLength);
    const trailer = packet.readUInt32BE(8 + dataFieldLength);
    expect(trailer >>> 16).toBe(0); // hi 2 bytes del trailer siempre 0
    expect(crc16Ibm(dataField)).toBe(trailer & 0xffff);
  });

  it('recordCount es 1 (el simulador manda 1 record por packet)', () => {
    const packet = buildAvlPacket({ ...baseOpts, temperatureC: 5.2 });
    const parsed = parseAvlPacket(packet);
    expect(parsed.recordCount).toBe(1);
    expect(parsed.records).toHaveLength(1);
  });

  it('GPS hace round-trip exacto (lat/lng/alt/angle/sats/speed)', () => {
    const packet = buildAvlPacket({ ...baseOpts, temperatureC: 5.2 });
    const record = parseAvlPacket(packet).records[0];
    expect(record).toBeDefined();
    if (!record) {
      return;
    }
    expect(record.gps.latitude).toBe(baseOpts.latitude);
    expect(record.gps.longitude).toBe(baseOpts.longitude);
    expect(record.gps.altitude).toBe(baseOpts.altitudeM);
    expect(record.gps.angle).toBe(baseOpts.angleDeg);
    expect(record.gps.satellites).toBe(baseOpts.satellites);
    expect(record.gps.speedKmh).toBe(baseOpts.speedKmh);
  });

  it("IO 72 (Dallas Temperature 1) codifica una temperatura NEGATIVA como two's complement uint16 (-20.0°C → 0xff38)", () => {
    const packet = buildAvlPacket({ ...baseOpts, temperatureC: -20.0 });
    const record = parseAvlPacket(packet).records[0];
    expect(record).toBeDefined();
    if (!record) {
      return;
    }
    const io72 = record.io.entries.find((e) => e.id === 72);
    expect(io72).toBeDefined();
    expect(io72?.byteSize).toBe(2);
    expect(io72?.value).toBe(0xff38); // 65336 decimal — two's complement de -200 (décimas de °C)
  });

  it('IO 72 (Dallas Temperature 1) codifica una temperatura POSITIVA directo en décimas de °C (8.5°C → 0x0055)', () => {
    const packet = buildAvlPacket({ ...baseOpts, temperatureC: 8.5 });
    const record = parseAvlPacket(packet).records[0];
    expect(record).toBeDefined();
    if (!record) {
      return;
    }
    const io72 = record.io.entries.find((e) => e.id === 72);
    expect(io72).toBeDefined();
    expect(io72?.byteSize).toBe(2);
    expect(io72?.value).toBe(0x0055); // 85 decimal, sin wraparound (sin signo)
  });
});
