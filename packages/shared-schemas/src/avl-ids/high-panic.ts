import { z } from 'zod';

/**
 * Catálogo de AVL IDs **High / Panic Priority** del Teltonika FMC150
 * que generan records EVENTUALES (no en cada packet regular). Son los
 * diferenciadores de seguridad que justifican el contrato anual de un
 * carrier grande: Crash, Unplug, GNSS Jamming, Tow, etc.
 *
 * Spec canónica:
 *   https://wiki.teltonika-gps.com/view/FMC150_Teltonika_Data_Sending_Parameters_ID
 *
 * Layout de la tabla:
 *
 * | AVL ID | Nombre              | Priority | Valor                       | Channel Booster      |
 * |--------|---------------------|----------|-----------------------------|----------------------|
 * | 247    | Crash Detection     | Panic    | 1 = crash detected          | safety-p0            |
 * | 252    | Unplug              | Panic    | 1 = power unplugged         | safety-p0            |
 * | 318    | GNSS Jamming        | Panic    | 0/1/2 = none/warning/crit   | safety-p0            |
 * | 246    | Towing              | High     | 1 = towing detected         | security-p1          |
 * | 175    | Auto Geofence       | High     | 0 = inside, 1 = exited      | security-p1          |
 * | 251    | Excessive Idling    | High     | 1 = idle, 0 = idle ended    | eco-score            |
 * | 253    | Green Driving Type  | High     | 1=acc / 2=brake / 3=corner  | eco-score            |
 * | 255    | Over Speeding       | High     | 1 = overspeed, 0 = back     | eco-score            |
 * | 250    | Trip                | High     | 1 = start, 0 = end          | trip-transitions     |
 * | 155    | Geofence Zone (1-50)| High     | 0 = outside, 1 = inside     | trip-transitions     |
 *
 * Routing: ver `routeEvent()` en event-router.ts.
 */

/** ID numérico fijo de cada AVL parameter eventual. */
export const AVL_ID_EVENT = {
  CRASH: 247,
  UNPLUG: 252,
  GNSS_JAMMING: 318,
  TOWING: 246,
  AUTO_GEOFENCE: 175,
  EXCESSIVE_IDLING: 251,
  GREEN_DRIVING: 253,
  OVER_SPEEDING: 255,
  TRIP: 250,
  GEOFENCE_ZONE: 155,
} as const;

export type AvlIdEvent = (typeof AVL_ID_EVENT)[keyof typeof AVL_ID_EVENT];

export const EVENT_AVL_IDS: ReadonlySet<number> = new Set(Object.values(AVL_ID_EVENT));

// =============================================================================
// SCHEMAS RAW
// =============================================================================

/** AVL 247 — Crash Detection. 1 = crash detected. Solo aparece como evento Panic. */
export const crashRawSchema = z.literal(1);
export type CrashRaw = z.infer<typeof crashRawSchema>;

/** AVL 252 — Unplug. 1 = power cable disconnected (tamper / sabotaje). */
export const unplugRawSchema = z.literal(1);
export type UnplugRaw = z.infer<typeof unplugRawSchema>;

/** AVL 318 — GNSS Jamming. 0 = none, 1 = warning, 2 = critical (probable
 *  intento de robo del vehículo con bloqueador GPS). */
export const gnssJammingRawSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);
export type GnssJammingRaw = z.infer<typeof gnssJammingRawSchema>;

/** AVL 246 — Towing. 1 = towing detected (vehículo siendo remolcado sin
 *  estar encendido — alarma antirrobo). */
export const towingRawSchema = z.literal(1);
export type TowingRaw = z.infer<typeof towingRawSchema>;

/** AVL 175 — Auto Geofence. 0 = inside, 1 = exited (vehículo salió de
 *  zona segura cuando estaba estacionado). */
export const autoGeofenceRawSchema = z.union([z.literal(0), z.literal(1)]);
export type AutoGeofenceRaw = z.infer<typeof autoGeofenceRawSchema>;

/** AVL 251 — Excessive Idling. 1 = idle excessive started, 0 = ended. */
export const excessiveIdlingRawSchema = z.union([z.literal(0), z.literal(1)]);
export type ExcessiveIdlingRaw = z.infer<typeof excessiveIdlingRawSchema>;

/** AVL 253 — Green Driving Type. 1 = harsh acceleration, 2 = harsh
 *  braking, 3 = harsh cornering. */
export const greenDrivingRawSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type GreenDrivingRaw = z.infer<typeof greenDrivingRawSchema>;

/** AVL 255 — Over Speeding. 1 = started, 0 = ended. */
export const overSpeedingRawSchema = z.union([z.literal(0), z.literal(1)]);
export type OverSpeedingRaw = z.infer<typeof overSpeedingRawSchema>;

/** AVL 250 — Trip. 1 = trip start, 0 = trip end. */
export const tripRawSchema = z.union([z.literal(0), z.literal(1)]);
export type TripRaw = z.infer<typeof tripRawSchema>;

/** AVL 155 — Geofence Zone (1-50). 0 = outside, 1 = inside. Booster lo usa
 *  para confirmar pickup/dropoff cuando el shipper define geofences en
 *  origen/destino del trip. */
export const geofenceZoneRawSchema = z.union([z.literal(0), z.literal(1)]);
export type GeofenceZoneRaw = z.infer<typeof geofenceZoneRawSchema>;

// =============================================================================
// MAP { id → schema }
// =============================================================================

export const EVENT_RAW_SCHEMAS: Record<AvlIdEvent, z.ZodTypeAny> = {
  [AVL_ID_EVENT.CRASH]: crashRawSchema,
  [AVL_ID_EVENT.UNPLUG]: unplugRawSchema,
  [AVL_ID_EVENT.GNSS_JAMMING]: gnssJammingRawSchema,
  [AVL_ID_EVENT.TOWING]: towingRawSchema,
  [AVL_ID_EVENT.AUTO_GEOFENCE]: autoGeofenceRawSchema,
  [AVL_ID_EVENT.EXCESSIVE_IDLING]: excessiveIdlingRawSchema,
  [AVL_ID_EVENT.GREEN_DRIVING]: greenDrivingRawSchema,
  [AVL_ID_EVENT.OVER_SPEEDING]: overSpeedingRawSchema,
  [AVL_ID_EVENT.TRIP]: tripRawSchema,
  [AVL_ID_EVENT.GEOFENCE_ZONE]: geofenceZoneRawSchema,
};
