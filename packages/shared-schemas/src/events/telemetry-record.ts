import { z } from 'zod';

/**
 * CONTRATO CANÓNICO del topic Pub/Sub `telemetry-events` (wire format).
 *
 * Productores: telemetry-tcp-gateway (TCP Teltonika, batching 100/100ms)
 * y sms-fallback-gateway (BSTR vía Twilio). Consumidor: telemetry-processor.
 *
 * Historia (auditoría 2026-06-09, riesgo alto): este shape vivía
 * DUPLICADO — interface en el gateway + espejo Zod copiado a mano en el
 * processor; un cambio en el publisher sin actualizar el espejo producía
 * descarte silencioso (el consumer ack-ea mensajes malformados). Desde
 * 2026-06-11 esta es la única definición: el gateway la valida en su
 * test de contrato (`buildWireRecordMessage`) y el processor la usa para
 * validar al consumir.
 *
 * Notas de wire:
 *   - `timestampMs` viaja como string (BigInt no es JSON-serializable).
 *   - `entries[].value` puede ser number o string (bigints y Buffers se
 *     serializan a string/base64 en el gateway).
 *   - `vehicleId` null = device sin asociar (el processor intenta
 *     resolverlo por IMEI; si no, descarta con warn).
 */
export const telemetryRecordMessageSchema = z.object({
  imei: z.string().min(8).max(20),
  vehicleId: z.string().uuid().nullable(),
  record: z.object({
    timestampMs: z.string(),
    priority: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    gps: z.object({
      longitude: z.number(),
      latitude: z.number(),
      altitude: z.number(),
      angle: z.number(),
      satellites: z.number(),
      speedKmh: z.number(),
    }),
    io: z.object({
      eventIoId: z.number(),
      totalIo: z.number(),
      entries: z.array(
        z.object({
          id: z.number(),
          value: z.union([z.number(), z.string()]),
          byteSize: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8), z.null()]),
        }),
      ),
    }),
  }),
});

export type TelemetryRecordMessage = z.infer<typeof telemetryRecordMessageSchema>;
