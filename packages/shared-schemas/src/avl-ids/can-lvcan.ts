import { z } from 'zod';

/**
 * Catálogo de AVL IDs **CAN / LVCAN v1** del adaptador CAN Teltonika
 * (LVCAN200/ALLCAN300) sobre el FMC150. v1 mapea los 4 parámetros
 * confirmados en runtime (device PLFL57, imei 860693084796730):
 *
 * | AVL ID | Nombre Teltonika    | Tipo RAW | Unidad / escala   |
 * |--------|---------------------|----------|-------------------|
 * | 81     | Vehicle Speed (CAN) | uint16   | km/h (directo)    |
 * | 84     | Fuel Level          | uint16   | litros (raw ×0.1) |
 * | 85     | Engine RPM          | uint16   | rpm (directo)     |
 * | 89     | Fuel Level          | uint8    | % (directo)       |
 *
 * Spec canónica:
 *   https://wiki.teltonika-gps.com/view/FMC150_Teltonika_Data_Sending_Parameters_ID
 *
 * A diferencia de Dallas Temperature (72-75, int16 SIGNED), estos son
 * **unsigned** — el codec8-parser entrega el uint directo, sin conversión
 * two's complement. La única escala es `×0.1 L` en el ID 84.
 *
 * Capa 2 (historial de vehículo) suma dos **contadores acumulados** —
 * se leen por Δ (último − primero de una ventana), no como estado puntual:
 *
 * | AVL ID | Nombre Teltonika    | Tipo RAW | Unidad / escala   |
 * |--------|---------------------|----------|-------------------|
 * | 83     | Fuel Consumed       | uint32   | litros (raw ×0.1) |
 * | 87     | CAN Total Mileage   | uint32   | km (raw /1000, m) |
 *
 * Fuera de catálogo (persistidos crudos en `io_data`, no mapeados):
 * 82 accelerator pedal, 90, y OEM 1xx/1xxx. Este módulo es aditivo:
 * NO toca `low-priority.ts`, `dallas-temperature.ts` ni `high-panic.ts`.
 */

/** Singleton: ID numérico fijo de cada parámetro CAN en la spec FMC150. */
export const AVL_ID_CAN = {
  CAN_VEHICLE_SPEED: 81,
  CAN_FUEL_CONSUMED_L: 83,
  CAN_FUEL_LEVEL_L: 84,
  CAN_ENGINE_RPM: 85,
  CAN_TOTAL_MILEAGE: 87,
  CAN_FUEL_LEVEL_PCT: 89,
} as const;

export type AvlIdCan = (typeof AVL_ID_CAN)[keyof typeof AVL_ID_CAN];

/** Set de IDs CAN v1 — usado por interpret() para clasificar entries. */
export const CAN_LVCAN_IDS: ReadonlySet<number> = new Set(Object.values(AVL_ID_CAN));

/** Fuel Level (AVL 84) — factor RAW→litros. */
export const CAN_FUEL_LEVEL_L_SCALE = 0.1;

/** Fuel Consumed (AVL 83) — factor RAW→litros (mismo ×0.1 que el nivel). */
export const CAN_FUEL_CONSUMED_L_SCALE = 0.1;

/** CAN Total Mileage (AVL 87) — factor RAW(metros)→km. */
export const CAN_MILEAGE_KM_SCALE = 0.001;

// =============================================================================
// SCHEMAS RAW (validan el uint crudo del ping; rango físico sano). Fuera de
// rango = bus corrupto / grupo equivocado → `invalidEntries`, no `telemetry`.
// =============================================================================

/** AVL 81 — Vehicle Speed (uint, km/h). Cap físico generoso 300 km/h. */
export const canVehicleSpeedRawSchema = z.number().int().min(0).max(300);
export type CanVehicleSpeedRaw = z.infer<typeof canVehicleSpeedRawSchema>;

/** AVL 84 — Fuel Level (uint, ×0.1 L). Cap 30000 raw = 3000 L (camión grande). */
export const canFuelLevelLRawSchema = z.number().int().min(0).max(30000);
export type CanFuelLevelLRaw = z.infer<typeof canFuelLevelLRawSchema>;

/** AVL 85 — Engine RPM (uint, rpm). Cap 20000 (muy por encima de redline). */
export const canEngineRpmRawSchema = z.number().int().min(0).max(20000);
export type CanEngineRpmRaw = z.infer<typeof canEngineRpmRawSchema>;

/** AVL 89 — Fuel Level (uint, %). Rango físico 0..100. */
export const canFuelLevelPctRawSchema = z.number().int().min(0).max(100);
export type CanFuelLevelPctRaw = z.infer<typeof canFuelLevelPctRawSchema>;

/** AVL 83 — Fuel Consumed (uint32 acumulado, ×0.1 L). Cap uint32. */
export const canFuelConsumedRawSchema = z.number().int().min(0).max(4294967295);
export type CanFuelConsumedRaw = z.infer<typeof canFuelConsumedRawSchema>;

/** AVL 87 — CAN Total Mileage (uint32 acumulado, metros). Cap uint32. */
export const canTotalMileageRawSchema = z.number().int().min(0).max(4294967295);
export type CanTotalMileageRaw = z.infer<typeof canTotalMileageRawSchema>;

// =============================================================================
// MAP { id → schema } — usado por interpret() para validar de forma genérica.
// =============================================================================

export const CAN_LVCAN_RAW_SCHEMAS: Record<AvlIdCan, z.ZodTypeAny> = {
  [AVL_ID_CAN.CAN_VEHICLE_SPEED]: canVehicleSpeedRawSchema,
  [AVL_ID_CAN.CAN_FUEL_CONSUMED_L]: canFuelConsumedRawSchema,
  [AVL_ID_CAN.CAN_FUEL_LEVEL_L]: canFuelLevelLRawSchema,
  [AVL_ID_CAN.CAN_ENGINE_RPM]: canEngineRpmRawSchema,
  [AVL_ID_CAN.CAN_TOTAL_MILEAGE]: canTotalMileageRawSchema,
  [AVL_ID_CAN.CAN_FUEL_LEVEL_PCT]: canFuelLevelPctRawSchema,
};
