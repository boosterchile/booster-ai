import type { SafetyEvent } from '@booster-ai/shared-schemas';

/**
 * Construye el SafetyEvent 'crash' a partir de los datos del crash trace.
 *
 * Función pura: no tiene efectos secundarios ni dependencias de módulo.
 * El timestamp proviene de `trace.crashTimestampMs` (BigInt serializado a
 * number por el caller) — es el mismo valor que usa `persistCrashTrace`
 * para el campo `timestamp` de BigQuery.
 */
export function buildCrashSafetyEvent(opts: {
  imei: string;
  vehicleId: string | null;
  occurredAtMs: number | string;
}): SafetyEvent {
  return {
    eventType: 'crash',
    imei: opts.imei,
    ...(opts.vehicleId ? { vehicleId: opts.vehicleId } : {}),
    occurredAt: new Date(Number(opts.occurredAtMs)).toISOString(),
  };
}
