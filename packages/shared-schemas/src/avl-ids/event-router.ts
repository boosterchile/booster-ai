import type { z } from 'zod';
import { AVL_ID_EVENT, EVENT_AVL_IDS, EVENT_RAW_SCHEMAS } from './high-panic.js';
import type { MinimalIoEntry } from './interpret-low-priority.js';

/**
 * Channel de routing — corresponde 1:1 a un Pub/Sub topic Booster.
 *
 *   - `safety-p0`: eventos de máxima criticidad (Crash, Unplug, GNSS
 *     Jamming critical). Despierta SMS + push admin + WhatsApp shipper.
 *     Topic Pub/Sub: `telemetry-events-safety-p0`.
 *
 *   - `security-p1`: eventos de seguridad / antirrobo (Tow, Auto
 *     Geofence exit). Solo push admin. Topic: `telemetry-events-security-p1`.
 *
 *   - `eco-score`: inputs para el algoritmo de Eco Score del carrier
 *     (Idling, Green Driving, Over Speeding). No despierta a nadie —
 *     se agrega offline. Topic: `telemetry-events-eco-score`.
 *
 *   - `trip-transitions`: state changes del trip (Trip start/end,
 *     Geofence pickup/dropoff). Consumido por trip-state-machine y
 *     api/services/trip-events. Topic: `telemetry-events-trip-transitions`.
 */
export type EventChannel = 'safety-p0' | 'security-p1' | 'eco-score' | 'trip-transitions';

/** Priority del evento — sirve para que el consumer decida cadencia de
 *  notificación. Mapping desde la spec Teltonika:
 *    Panic → 'panic'  (máxima prioridad operacional)
 *    High  → 'high'   (alta prioridad pero NO interrupt al humano)
 */
export type EventPriority = 'panic' | 'high';

/**
 * Evento ruteado — payload publicable a Pub/Sub.
 *
 * El consumer hace `JSON.parse(message.data.toString())` y obtiene este
 * objeto directamente. Los Buffer values nunca aparecen en estos
 * eventos (los eventuales son siempre numéricos según la spec).
 */
export interface RoutedEvent {
  /** Topic / channel destination. */
  channel: EventChannel;
  priority: EventPriority;
  /** AVL ID origen del evento. */
  avlId: number;
  /** Nombre legible (Crash, Unplug, etc.) — útil para logs y mensajes. */
  eventName: string;
  /** Valor RAW validado del evento. Conserva la semántica de la spec
   *  (ej. para `Green Driving`: 1=acc, 2=brake, 3=corner). */
  rawValue: number;
}

/**
 * Mapping ID → metadata estática del evento. Útil para construir
 * RoutedEvent y para tests.
 */
const EVENT_METADATA: Record<
  number,
  { channel: EventChannel; priority: EventPriority; eventName: string }
> = {
  [AVL_ID_EVENT.CRASH]: { channel: 'safety-p0', priority: 'panic', eventName: 'Crash' },
  [AVL_ID_EVENT.UNPLUG]: { channel: 'safety-p0', priority: 'panic', eventName: 'Unplug' },
  [AVL_ID_EVENT.GNSS_JAMMING]: {
    channel: 'safety-p0',
    priority: 'panic',
    eventName: 'GnssJamming',
  },
  [AVL_ID_EVENT.TOWING]: { channel: 'security-p1', priority: 'high', eventName: 'Towing' },
  [AVL_ID_EVENT.AUTO_GEOFENCE]: {
    channel: 'security-p1',
    priority: 'high',
    eventName: 'AutoGeofence',
  },
  [AVL_ID_EVENT.EXCESSIVE_IDLING]: {
    channel: 'eco-score',
    priority: 'high',
    eventName: 'ExcessiveIdling',
  },
  [AVL_ID_EVENT.GREEN_DRIVING]: {
    channel: 'eco-score',
    priority: 'high',
    eventName: 'GreenDriving',
  },
  [AVL_ID_EVENT.OVER_SPEEDING]: {
    channel: 'eco-score',
    priority: 'high',
    eventName: 'OverSpeeding',
  },
  [AVL_ID_EVENT.TRIP]: {
    channel: 'trip-transitions',
    priority: 'high',
    eventName: 'Trip',
  },
  [AVL_ID_EVENT.GEOFENCE_ZONE]: {
    channel: 'trip-transitions',
    priority: 'high',
    eventName: 'GeofenceZone',
  },
};

/**
 * Reportes de un AVL ID eventual que llegó pero falló la validación
 * Zod. Igual que en `interpretLowPriority`, son tolerantes —
 * un valor malformado no aborta el procesamiento del record entero.
 */
export interface InvalidEventEntry {
  id: number;
  value: number | bigint | Uint8Array;
  zodIssues: z.ZodIssue[];
}

export interface RouteEventResult {
  /** Lista de eventos ruteados (puede ser empty si el record no trae
   *  ningún AVL ID eventual). Los eventos llegan en el orden de aparición
   *  en el record. */
  events: RoutedEvent[];
  /** Entries de eventuales con RAW inválido. Caller los loggea como warn. */
  invalidEvents: InvalidEventEntry[];
}

/**
 * Detecta los AVL IDs eventuales (Panic / High Priority) en un record y
 * retorna eventos listos para publicar a Pub/Sub.
 *
 * **Diseño**:
 *   - Pure function. No I/O — el caller (gateway o processor) hace el
 *     publish a Pub/Sub.
 *   - Tolerante: un valor malformado se reporta en `invalidEvents` y
 *     no aborta el resto.
 *   - Evento por entry — un solo record con N eventos eventuales genera
 *     N eventos ruteados (raro pero soportado).
 *   - Ignora silenciosamente IDs que NO están en el catálogo de
 *     eventuales (esos se interpretan en otro lado, ej. Low Priority).
 *
 * @example
 *   routeEvent([
 *     { id: 247, value: 1, byteSize: 1 },        // Crash
 *     { id: 24, value: 80, byteSize: 2 },        // Speed (Low Priority, ignorado)
 *     { id: 318, value: 2, byteSize: 1 },        // GNSS Jamming critical
 *   ])
 *   // → { events: [
 *   //     { channel: 'safety-p0', priority: 'panic', avlId: 247, eventName: 'Crash', rawValue: 1 },
 *   //     { channel: 'safety-p0', priority: 'panic', avlId: 318, eventName: 'GnssJamming', rawValue: 2 },
 *   //   ], invalidEvents: [] }
 */
export function routeEvent(entries: MinimalIoEntry[]): RouteEventResult {
  const events: RoutedEvent[] = [];
  const invalidEvents: InvalidEventEntry[] = [];

  for (const entry of entries) {
    if (!EVENT_AVL_IDS.has(entry.id)) {
      // Ignorar silenciosamente — IDs que no son eventuales se procesan
      // en otro lado (Low Priority Monitoring, Geofence numerados, etc.).
      continue;
    }

    const schema = EVENT_RAW_SCHEMAS[entry.id as keyof typeof EVENT_RAW_SCHEMAS];
    const parsed = schema.safeParse(entry.value);
    if (!parsed.success) {
      invalidEvents.push({
        id: entry.id,
        value: entry.value,
        zodIssues: parsed.error.issues,
      });
      continue;
    }

    const meta = EVENT_METADATA[entry.id];
    if (!meta) {
      // Defensivo: si EVENT_AVL_IDS dijo que está en el catálogo pero
      // EVENT_METADATA no tiene metadata, es un bug. No publicar evento
      // sin channel definido.
      continue;
    }

    events.push({
      channel: meta.channel,
      priority: meta.priority,
      avlId: entry.id,
      eventName: meta.eventName,
      rawValue: parsed.data as number,
    });
  }

  return { events, invalidEvents };
}

/**
 * Mapping channel → topic Pub/Sub. Los topics se crean en
 * `infrastructure/messaging.tf`. Mantener sincronizado.
 */
export const CHANNEL_TO_PUBSUB_TOPIC: Record<EventChannel, string> = {
  'safety-p0': 'telemetry-events-safety-p0',
  'security-p1': 'telemetry-events-security-p1',
  'eco-score': 'telemetry-events-eco-score',
  'trip-transitions': 'telemetry-events-trip-transitions',
};
