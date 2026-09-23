import type { Logger } from '@booster-ai/logger';
import type { SafetyEvent } from '@booster-ai/shared-schemas';
import type { RecordMessage } from './persist.js';

/**
 * Detección de eventos panic (seguridad física) en records AVL.
 *
 * CONTRATO con infrastructure/telemetry-monitoring.tf: los log-metrics
 * `telemetry/unplug_events` y `telemetry/gnss_jamming_critical_events`
 * filtran `jsonPayload.eventName` (+ `jsonPayload.rawValue=2` para
 * jamming crítico). Hasta este cambio NADIE emitía esos campos y las
 * alertas P0 no podían disparar (auditoría 2026-06-09, riesgo alto).
 * No renombrar los literales sin actualizar el Terraform.
 *
 * El LOG (logPanicEvents) se emite por RECORD: durante una condición
 * sostenida los puntos periódicos siguen trayendo el IO y la métrica de
 * operación debe seguir contando. El aviso al cliente
 * (selectCustomerPanicEvents) solo sale en el record-evento, y el jamming
 * solo en crítico (2). El SMS de respaldo marca eventIoId con el AVL del
 * pánico (wire.ts), así que ese camino sí avisa.
 */

/** AVL 252 — External power unplugged (1 = desconectado). Tamper. */
const AVL_UNPLUG = 252;
/** AVL 318 — GNSS Jamming (0 ok, 1 warning, 2 crítico). */
const AVL_GNSS_JAMMING = 318;

export interface PanicEvent {
  eventName: 'Unplug' | 'GnssJamming';
  avlId: number;
  rawValue: number;
}

export function detectPanicEvents(msg: RecordMessage): PanicEvent[] {
  const events: PanicEvent[] = [];
  for (const entry of msg.record.io.entries) {
    const value = readIoNumber(entry.value);
    if (value === null) {
      continue;
    }
    if (entry.id === AVL_UNPLUG && value === 1) {
      events.push({ eventName: 'Unplug', avlId: entry.id, rawValue: value });
    }
    if (entry.id === AVL_GNSS_JAMMING && value >= 1) {
      events.push({ eventName: 'GnssJamming', avlId: entry.id, rawValue: value });
    }
  }
  return events;
}

/**
 * Subconjunto que sí se avisa al cliente (push + WhatsApp).
 *
 * Teltonika repite el último IO en cada punto periódico (`eventIoId` 0 u
 * otro). Un cable desconectado o un warning de GPS urbano se quedaba
 * pegado y el cliente recibía el mismo aviso cada 10 minutos.
 *
 * - Unplug: solo el record cuyo evento es el 252.
 * - Jamming: solo crítico (2) y solo el record cuyo evento es el 318.
 *   El warning (1) queda en el log de operación; no es un bloqueo.
 */
export function selectCustomerPanicEvents(msg: RecordMessage): PanicEvent[] {
  const eventIoId = msg.record.io.eventIoId;
  const events: PanicEvent[] = [];
  for (const entry of msg.record.io.entries) {
    const value = readIoNumber(entry.value);
    if (value === null) {
      continue;
    }
    if (entry.id === AVL_UNPLUG && value === 1 && eventIoId === AVL_UNPLUG) {
      events.push({ eventName: 'Unplug', avlId: entry.id, rawValue: value });
    }
    if (entry.id === AVL_GNSS_JAMMING && value === 2 && eventIoId === AVL_GNSS_JAMMING) {
      events.push({ eventName: 'GnssJamming', avlId: entry.id, rawValue: value });
    }
  }
  return events;
}

function readIoNumber(value: number | string): number | null {
  const numeric = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(numeric) ? numeric : null;
}

const EVENT_NAME_TO_TYPE: Record<'Unplug' | 'GnssJamming', SafetyEvent['eventType']> = {
  Unplug: 'unplug',
  GnssJamming: 'jamming',
};

/** Publica un SafetyEvent por cada panic que sí se avisa al cliente. */
export async function publishPanicEvents(opts: {
  msg: RecordMessage;
  topicName: string;
  logger: Logger;
  publish: (a: { topicName: string; event: SafetyEvent; logger: Logger }) => Promise<void>;
}): Promise<void> {
  const events = selectCustomerPanicEvents(opts.msg);
  for (const e of events) {
    const event: SafetyEvent = {
      eventType: EVENT_NAME_TO_TYPE[e.eventName],
      imei: opts.msg.imei,
      occurredAt: new Date(Number(opts.msg.record.timestampMs)).toISOString(),
      rawValue: e.rawValue,
    };
    await opts.publish({ topicName: opts.topicName, event, logger: opts.logger });
  }
}

/**
 * Loguea cada evento panic con el shape exacto que esperan los
 * log-metrics. Side-effect de log puro: jamás lanza ni bloquea el ack
 * del record (el evento alerta aunque el device esté pendiente o el
 * persist falle después).
 */
export function logPanicEvents(opts: {
  logger: Logger;
  msg: RecordMessage;
  messageId: string;
}): number {
  const events = detectPanicEvents(opts.msg);
  for (const event of events) {
    opts.logger.warn(
      {
        eventName: event.eventName,
        rawValue: event.rawValue,
        avlId: event.avlId,
        imei: opts.msg.imei,
        vehicleId: opts.msg.vehicleId,
        messageId: opts.messageId,
      },
      `evento panic ${event.eventName} detectado (alerta P0 vía log-metric)`,
    );
  }
  return events.length;
}
