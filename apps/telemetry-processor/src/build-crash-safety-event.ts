import type { SafetyEvent } from '@booster-ai/shared-schemas';

/**
 * Construye el SafetyEvent 'crash' a partir de los datos del crash trace.
 *
 * Función pura: no tiene efectos secundarios ni dependencias de módulo.
 * El timestamp proviene de `trace.crashTimestampMs` (BigInt serializado a
 * number por el caller) — es el mismo valor que usa `persistCrashTrace`
 * para el campo `timestamp` de BigQuery.
 */
/**
 * Pico mínimo, en G, para avisar al cliente. En reposo el acelerómetro
 * marca ~1 G (gravedad). Un golpe de patio o un badén suele quedar bajo
 * 3 G; una colisión que vale un WhatsApp no. La traza se archiva igual.
 * Si no hubo muestras parseadas el pico es 0 y sí se avisa: no escondemos
 * un crash cuyo acelerómetro no pudimos leer.
 */
export const CUSTOMER_CRASH_MIN_G = 3;

export function shouldNotifyCustomerCrash(peakGForce: number): boolean {
  if (!Number.isFinite(peakGForce) || peakGForce <= 0) {
    return true;
  }
  return peakGForce >= CUSTOMER_CRASH_MIN_G;
}

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
