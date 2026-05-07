/**
 * @booster-ai/shared-schemas/avl-ids
 *
 * Catálogo de AVL IDs Teltonika FMC150 + interpretadores de unidades.
 * El parser binario (`@booster-ai/codec8-parser`) entrega entries
 * agnósticos `{ id, value, byteSize }`; este módulo los convierte a
 * objetos tipados con unidades canónicas Booster.
 *
 * Estructura por wave del rollout:
 *   - low-priority.ts            — 14 IDs Wave 2 Low Priority (Track B1)
 *   - interpret-low-priority.ts  — interpretador Low Priority
 *   - high-panic.ts              — 10 IDs Wave 2 eventuales (Track B2)
 *   - event-router.ts            — routing de eventuales a Pub/Sub topics
 *
 * El parser binario sigue siendo agnóstico de IDs por diseño (ver
 * tipos.ts del codec8-parser): este package es donde reside la
 * **semántica**. Tanto `apps/telemetry-tcp-gateway` como
 * `apps/telemetry-processor` lo consumen.
 */

export {
  AVL_ID,
  LOW_PRIORITY_IDS,
  LOW_PRIORITY_RAW_SCHEMAS,
  type AvlIdLowPriority,
  ignitionRawSchema,
  movementRawSchema,
  sleepModeRawSchema,
  gsmSignalRawSchema,
  gnssStatusRawSchema,
  gnssPdopRawSchema,
  gnssHdopRawSchema,
  externalVoltageRawSchema,
  batteryVoltageRawSchema,
  batteryCurrentRawSchema,
  speedRawSchema,
  totalOdometerRawSchema,
  tripOdometerRawSchema,
  dataModeRawSchema,
  type IgnitionRaw,
  type MovementRaw,
  type SleepModeRaw,
  type GsmSignalRaw,
  type GnssStatusRaw,
  type GnssPdopRaw,
  type GnssHdopRaw,
  type ExternalVoltageRaw,
  type BatteryVoltageRaw,
  type BatteryCurrentRaw,
  type SpeedRaw,
  type TotalOdometerRaw,
  type TripOdometerRaw,
  type DataModeRaw,
} from './low-priority.js';

export {
  interpretLowPriority,
  type LowPriorityTelemetry,
  type LowPriorityInterpretResult,
  type MinimalIoEntry,
  type UnknownEntry,
  type InvalidEntry,
} from './interpret-low-priority.js';

export {
  AVL_ID_EVENT,
  EVENT_AVL_IDS,
  EVENT_RAW_SCHEMAS,
  type AvlIdEvent,
  crashRawSchema,
  unplugRawSchema,
  gnssJammingRawSchema,
  towingRawSchema,
  autoGeofenceRawSchema,
  excessiveIdlingRawSchema,
  greenDrivingRawSchema,
  overSpeedingRawSchema,
  tripRawSchema,
  geofenceZoneRawSchema,
  type CrashRaw,
  type UnplugRaw,
  type GnssJammingRaw,
  type TowingRaw,
  type AutoGeofenceRaw,
  type ExcessiveIdlingRaw,
  type GreenDrivingRaw,
  type OverSpeedingRaw,
  type TripRaw,
  type GeofenceZoneRaw,
} from './high-panic.js';

export {
  routeEvent,
  CHANNEL_TO_PUBSUB_TOPIC,
  type EventChannel,
  type EventPriority,
  type RoutedEvent,
  type RouteEventResult,
  type InvalidEventEntry,
} from './event-router.js';
