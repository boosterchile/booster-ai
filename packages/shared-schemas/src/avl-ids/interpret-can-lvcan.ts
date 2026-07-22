import {
  AVL_ID_CAN,
  type AvlIdCan,
  CAN_FUEL_CONSUMED_L_SCALE,
  CAN_FUEL_LEVEL_L_SCALE,
  CAN_LVCAN_IDS,
  CAN_LVCAN_RAW_SCHEMAS,
  CAN_MILEAGE_KM_SCALE,
} from './can-lvcan.js';
import type { InvalidEntry, MinimalIoEntry, UnknownEntry } from './interpret-low-priority.js';

/**
 * Telemetría CAN LVCAN v1 interpretada — 1 campo por parámetro presente.
 * Todos opcionales: el CAN solo llega con el motor encendido, y no todo
 * ping trae los 4 (depende del bus). Ausente ⇒ campo `undefined`.
 */
export interface CanLvcanTelemetry {
  /** AVL 81. Velocidad del vehículo por CAN, km/h. */
  vehicleSpeedKmh?: number;
  /** AVL 84. Nivel de combustible, litros (raw ×0.1). */
  fuelLevelL?: number;
  /** AVL 85. RPM del motor. */
  engineRpm?: number;
  /** AVL 89. Nivel de combustible, %. */
  fuelLevelPct?: number;
  /** AVL 83. Combustible consumido acumulado, litros (raw ×0.1). Capa 2 — se usa por Δ. */
  fuelConsumedL?: number;
  /** AVL 87. Odómetro CAN acumulado, km (raw metros /1000). Capa 2 — se usa por Δ. */
  totalMileageKm?: number;
}

export interface CanLvcanInterpretResult {
  /** Parámetros CAN válidos. */
  telemetry: CanLvcanTelemetry;
  /** IDs que NO están en el catálogo CAN v1 (para log). */
  unknownEntries: UnknownEntry[];
  /** IDs en el catálogo pero con RAW que falla el schema (para log). */
  invalidEntries: InvalidEntry[];
}

/**
 * Interpreta los IO entries CAN LVCAN v1 (81/84/85/89) de un AVL record y
 * retorna telemetría tipada en unidades canónicas.
 *
 * **Diseño** (idéntico a `interpretDallasTemperature`):
 *   - Pure function. No I/O, no logging.
 *   - Parcial — 0..4 parámetros presentes por record.
 *   - Tolerante — un campo malformado no aborta el resto.
 *
 * A diferencia de Dallas, los CAN son **unsigned** (sin `toSignedInt16`).
 * Un `value` bigint/bytes (grupo equivocado) cae a NaN → `invalidEntries`.
 *
 * @example
 *   const r = interpretCanLvcan([
 *     { id: 84, value: 520, byteSize: 2 },   // 52.0 L
 *   ]);
 *   // r.telemetry → { fuelLevelL: 52.0 }
 */
export function interpretCanLvcan(entries: MinimalIoEntry[]): CanLvcanInterpretResult {
  const telemetry: CanLvcanTelemetry = {};
  const unknownEntries: UnknownEntry[] = [];
  const invalidEntries: InvalidEntry[] = [];

  for (const entry of entries) {
    if (!CAN_LVCAN_IDS.has(entry.id)) {
      unknownEntries.push({ id: entry.id, value: entry.value });
      continue;
    }

    // CAN LVCAN son unsigned: el uint del parser va directo, sin conversión.
    // Un value que no sea `number` (bigint del grupo N8, o bytes) no aplica a
    // estos IDs → NaN, que el schema rechaza como invalid.
    const raw = typeof entry.value === 'number' ? entry.value : Number.NaN;

    const schema = CAN_LVCAN_RAW_SCHEMAS[entry.id as AvlIdCan];
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      invalidEntries.push({
        id: entry.id,
        value: entry.value,
        zodIssues: parsed.error.issues,
      });
      continue;
    }

    applyToTelemetry(telemetry, entry.id as AvlIdCan, parsed.data as number);
  }

  return { telemetry, unknownEntries, invalidEntries };
}

function applyToTelemetry(t: CanLvcanTelemetry, id: AvlIdCan, raw: number): void {
  switch (id) {
    case AVL_ID_CAN.CAN_VEHICLE_SPEED:
      t.vehicleSpeedKmh = raw;
      return;
    case AVL_ID_CAN.CAN_FUEL_LEVEL_L:
      t.fuelLevelL = raw * CAN_FUEL_LEVEL_L_SCALE;
      return;
    case AVL_ID_CAN.CAN_ENGINE_RPM:
      t.engineRpm = raw;
      return;
    case AVL_ID_CAN.CAN_FUEL_LEVEL_PCT:
      t.fuelLevelPct = raw;
      return;
    case AVL_ID_CAN.CAN_FUEL_CONSUMED_L:
      t.fuelConsumedL = raw * CAN_FUEL_CONSUMED_L_SCALE;
      return;
    case AVL_ID_CAN.CAN_TOTAL_MILEAGE:
      t.totalMileageKm = raw * CAN_MILEAGE_KM_SCALE;
      return;
  }
}
