import { z } from 'zod';

/**
 * Catálogo de AVL IDs **Low Priority Monitoring** del Teltonika FMC150
 * que vienen incluidos en cada AVL packet regular cuando Wave 2 los
 * activa con `Operand = Monitoring`.
 *
 * Spec canónica:
 *   https://wiki.teltonika-gps.com/view/FMC150_Teltonika_Data_Sending_Parameters_ID
 *
 * Estos schemas validan el **valor RAW** que el codec8-parser entrega
 * en `IoEntry.value` (sin transformación de unidades). El conversor a
 * unidades canónicas vive en `interpret-low-priority.ts` —
 * mantenemos esa separación porque el RAW es lo que la spec Teltonika
 * documenta y valida; los wraparounds y escalas son responsabilidad
 * de Booster.
 *
 * Layout de la tabla:
 *
 * | AVL ID | Nombre           | Tipo RAW | Unidades | Función Booster                        |
 * |--------|------------------|----------|----------|----------------------------------------|
 * | 239    | Ignition         | bool     | —        | Trip start/end signal                  |
 * | 240    | Movement         | bool     | —        | DAQ + trip-state-machine               |
 * | 200    | Sleep Mode       | enum 0-4 | —        | Diagnóstico telemetría                 |
 * | 21     | GSM Signal       | uint8    | bars 0-5 | Métrica salud red                      |
 * | 69     | GNSS Status      | enum 0-4 | —        | Diagnóstico GPS                        |
 * | 181    | GNSS PDOP        | uint16   | ×10      | Calidad fix → filtrar PDOP > 5         |
 * | 182    | GNSS HDOP        | uint16   | ×10      | Calidad fix                            |
 * | 66     | External Voltage | uint16   | mV       | Detección unplug + diagnóstico         |
 * | 67     | Battery Voltage  | uint16   | mV       | Salud device                           |
 * | 68     | Battery Current  | int16    | mA       | Salud device (carga/descarga)          |
 * | 24     | Speed            | uint16   | km/h     | DAQ + over-speeding + GLEC             |
 * | 16     | Total Odometer   | uint32   | metros   | GLEC distance acumulada                |
 * | 199    | Trip Odometer    | uint32   | metros   | trip-state-machine                     |
 * | 80     | Data Mode        | enum 0-5 | —        | Home/Roaming/Unknown                   |
 */

/** Singleton: ID numérico fijo de cada AVL parameter en la spec FMC150. */
export const AVL_ID = {
  IGNITION: 239,
  MOVEMENT: 240,
  SLEEP_MODE: 200,
  GSM_SIGNAL: 21,
  GNSS_STATUS: 69,
  GNSS_PDOP: 181,
  GNSS_HDOP: 182,
  EXTERNAL_VOLTAGE: 66,
  BATTERY_VOLTAGE: 67,
  BATTERY_CURRENT: 68,
  SPEED: 24,
  TOTAL_ODOMETER: 16,
  TRIP_ODOMETER: 199,
  DATA_MODE: 80,
} as const;

export type AvlIdLowPriority = (typeof AVL_ID)[keyof typeof AVL_ID];

/** Set de IDs Low Priority — usado por interpret() para clasificar entries. */
export const LOW_PRIORITY_IDS: ReadonlySet<number> = new Set(Object.values(AVL_ID));

// =============================================================================
// SCHEMAS RAW (validan el valor entregado por codec8-parser sin transformar)
// =============================================================================

/** AVL 239 — Ignition (1 byte). 1 = on, 0 = off. */
export const ignitionRawSchema = z.union([z.literal(0), z.literal(1)]);
export type IgnitionRaw = z.infer<typeof ignitionRawSchema>;

/** AVL 240 — Movement (1 byte). 1 = vehículo en movimiento, 0 = estático. */
export const movementRawSchema = z.union([z.literal(0), z.literal(1)]);
export type MovementRaw = z.infer<typeof movementRawSchema>;

/** AVL 200 — Sleep Mode (1 byte, enum 0-4):
 *  0 = No sleep, 1 = GPS Sleep, 2 = Deep Sleep, 3 = Online Deep Sleep, 4 = Ultra Deep Sleep. */
export const sleepModeRawSchema = z.number().int().min(0).max(4);
export type SleepModeRaw = z.infer<typeof sleepModeRawSchema>;

/** AVL 21 — GSM Signal Strength (1 byte, 0-5 bars). */
export const gsmSignalRawSchema = z.number().int().min(0).max(5);
export type GsmSignalRaw = z.infer<typeof gsmSignalRawSchema>;

/** AVL 69 — GNSS Status (1 byte, enum 0-4):
 *  0 = OFF, 1 = ON_FIX, 2 = ON_NO_FIX, 3 = ON_SLEEP, 4 = OFF_NO_FIX. */
export const gnssStatusRawSchema = z.number().int().min(0).max(4);
export type GnssStatusRaw = z.infer<typeof gnssStatusRawSchema>;

/** AVL 181 — GNSS PDOP (uint16, valor ×10). RAW 50 = PDOP 5.0. */
export const gnssPdopRawSchema = z.number().int().nonnegative();
export type GnssPdopRaw = z.infer<typeof gnssPdopRawSchema>;

/** AVL 182 — GNSS HDOP (uint16, valor ×10). RAW 30 = HDOP 3.0. */
export const gnssHdopRawSchema = z.number().int().nonnegative();
export type GnssHdopRaw = z.infer<typeof gnssHdopRawSchema>;

/** AVL 66 — External Voltage (uint16, mV). Detecta unplug si cae a 0 con
 *  ignición ON. */
export const externalVoltageRawSchema = z.number().int().nonnegative();
export type ExternalVoltageRaw = z.infer<typeof externalVoltageRawSchema>;

/** AVL 67 — Battery Voltage interna (uint16, mV). */
export const batteryVoltageRawSchema = z.number().int().nonnegative();
export type BatteryVoltageRaw = z.infer<typeof batteryVoltageRawSchema>;

/** AVL 68 — Battery Current (**int16 SIGNED**, mA). Negativo = descarga. */
export const batteryCurrentRawSchema = z.number().int();
export type BatteryCurrentRaw = z.infer<typeof batteryCurrentRawSchema>;

/** AVL 24 — Speed (uint16, km/h). */
export const speedRawSchema = z.number().int().nonnegative();
export type SpeedRaw = z.infer<typeof speedRawSchema>;

/** AVL 16 — Total Odometer (uint32, metros). Distancia acumulada total
 *  desde la fabricación del device. Wraparound cada 4.29B metros (~4.29M km). */
export const totalOdometerRawSchema = z.number().int().nonnegative();
export type TotalOdometerRaw = z.infer<typeof totalOdometerRawSchema>;

/** AVL 199 — Trip Odometer (uint32, metros). Distancia del trip activo.
 *  Reset cada ignición OFF. */
export const tripOdometerRawSchema = z.number().int().nonnegative();
export type TripOdometerRaw = z.infer<typeof tripOdometerRawSchema>;

/** AVL 80 — Data Mode (1 byte, enum 0-5):
 *  0 = Home On Stop, 1 = Home On Moving, 2 = Roaming On Stop,
 *  3 = Roaming On Moving, 4 = Unknown On Stop, 5 = Unknown On Moving. */
export const dataModeRawSchema = z.number().int().min(0).max(5);
export type DataModeRaw = z.infer<typeof dataModeRawSchema>;

// =============================================================================
// MAP { id → schema } — usado por interpret() para validar de forma genérica
// =============================================================================

export const LOW_PRIORITY_RAW_SCHEMAS: Record<AvlIdLowPriority, z.ZodTypeAny> = {
  [AVL_ID.IGNITION]: ignitionRawSchema,
  [AVL_ID.MOVEMENT]: movementRawSchema,
  [AVL_ID.SLEEP_MODE]: sleepModeRawSchema,
  [AVL_ID.GSM_SIGNAL]: gsmSignalRawSchema,
  [AVL_ID.GNSS_STATUS]: gnssStatusRawSchema,
  [AVL_ID.GNSS_PDOP]: gnssPdopRawSchema,
  [AVL_ID.GNSS_HDOP]: gnssHdopRawSchema,
  [AVL_ID.EXTERNAL_VOLTAGE]: externalVoltageRawSchema,
  [AVL_ID.BATTERY_VOLTAGE]: batteryVoltageRawSchema,
  [AVL_ID.BATTERY_CURRENT]: batteryCurrentRawSchema,
  [AVL_ID.SPEED]: speedRawSchema,
  [AVL_ID.TOTAL_ODOMETER]: totalOdometerRawSchema,
  [AVL_ID.TRIP_ODOMETER]: tripOdometerRawSchema,
  [AVL_ID.DATA_MODE]: dataModeRawSchema,
};
