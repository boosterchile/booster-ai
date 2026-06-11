import type { SmsFallbackPayload } from './parser.js';

/**
 * Body del wire `telemetry-events` para el path SMS (BSTR vía Twilio).
 * El shape DEBE parsear con `telemetryRecordMessageSchema` de
 * @booster-ai/shared-schemas — el contrato canónico que valida el
 * processor al consumir; el test de contrato (wire-contract.test) lo
 * asegura, igual que en el TCP gateway (review 2026-06-11: este era el
 * segundo productor sin barrera anti-drift, justo en el path de pánico).
 */
export function buildWireFromBstr(payload: SmsFallbackPayload) {
  return {
    imei: payload.imei,
    vehicleId: null, // resuelto downstream por el processor (lookup por IMEI)
    record: {
      timestampMs: String(payload.timestampMs),
      priority: 2 as const, // panic — los SMS solo se mandan para Panic events
      gps: {
        longitude: payload.longitude,
        latitude: payload.latitude,
        altitude: 0,
        angle: 0,
        satellites: 0,
        speedKmh: payload.speedKmh,
      },
      io: {
        eventIoId: payload.avlId,
        totalIo: 1,
        entries: [
          {
            id: payload.avlId,
            value: payload.rawValue,
            byteSize: 1 as const,
          },
        ],
      },
    },
  };
}
