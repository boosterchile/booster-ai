import { z } from 'zod';

/** Evento de seguridad física emitido por telemetry-processor al topic safety-p0. */
export const safetyEventSchema = z.object({
  eventType: z.enum(['crash', 'unplug', 'jamming']),
  /** IMEI del device que emitió. Siempre presente (clave de routing). */
  imei: z.string().min(1),
  /** UUID del vehículo si el processor lo resolvió; el consumer hace fallback por IMEI si falta. */
  vehicleId: z.string().uuid().optional(),
  /** ISO-8601 UTC del evento. */
  occurredAt: z.string().datetime(),
  /** Valor crudo del IO (ej. jamming: 1 warning, 2 crítico). */
  rawValue: z.number().int().optional(),
});

export type SafetyEvent = z.infer<typeof safetyEventSchema>;
