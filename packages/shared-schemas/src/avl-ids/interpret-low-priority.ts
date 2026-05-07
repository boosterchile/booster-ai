import type { z } from 'zod';
import { AVL_ID, LOW_PRIORITY_IDS, LOW_PRIORITY_RAW_SCHEMAS } from './low-priority.js';

/**
 * Telemetría Low Priority interpretada — campos en unidades canónicas
 * Booster (no RAW Teltonika). Los campos son OPCIONALES porque no
 * todos los IDs vienen en cada AVL record (depende de qué eventos
 * dispararon el record y de la config de envío del device).
 *
 * Convenciones de unidades (todas SI o derivadas estándar):
 *   - voltajes en mV (entero)
 *   - corrientes en mA (entero, signed)
 *   - velocidades en km/h (entero)
 *   - distancias en metros (entero)
 *   - PDOP/HDOP como decimales (raw / 10)
 *   - GSM signal en bars 0-5 (entero)
 *   - enums numéricos (sleepMode, gnssStatus, dataMode) preservados
 *     como su valor RAW; el caller debe consultar la spec o un
 *     diccionario para nombrar los estados.
 */
export interface LowPriorityTelemetry {
  /** AVL 239. true = ignition on. */
  ignition?: boolean;
  /** AVL 240. true = vehículo en movimiento. */
  movement?: boolean;
  /** AVL 200. 0=No sleep, 1=GPS, 2=Deep, 3=Online Deep, 4=Ultra Deep. */
  sleepMode?: number;
  /** AVL 21. Bars 0-5. */
  gsmSignalBars?: number;
  /** AVL 69. 0=OFF, 1=ON_FIX, 2=ON_NO_FIX, 3=ON_SLEEP, 4=OFF_NO_FIX. */
  gnssStatus?: number;
  /** AVL 181. PDOP decimal (raw / 10). Recomendación: filtrar records con > 5. */
  gnssPdop?: number;
  /** AVL 182. HDOP decimal (raw / 10). */
  gnssHdop?: number;
  /** AVL 66. Voltaje externo en mV. */
  externalVoltageMv?: number;
  /** AVL 67. Voltaje interno de la batería del device, mV. */
  batteryVoltageMv?: number;
  /** AVL 68. Corriente de la batería del device, mA. NEGATIVO = descarga. */
  batteryCurrentMa?: number;
  /** AVL 24. Velocidad GPS, km/h. */
  speedKmh?: number;
  /** AVL 16. Odómetro total acumulado del device, metros. */
  totalOdometerM?: number;
  /** AVL 199. Odómetro del trip activo, metros (reset por ignición OFF). */
  tripOdometerM?: number;
  /** AVL 80. 0..5 — Home/Roaming/Unknown × Stop/Moving. */
  dataMode?: number;
}

/**
 * Entry desconocida — un ID que llegó pero no está en el catálogo.
 * El caller (gateway/processor) loggea esto como `warn` con
 * `{ avlId, value, imei }` para detectar configuraciones del device
 * que se salieron del perfil oficial sin romper la pipeline.
 */
export interface UnknownEntry {
  id: number;
  value: number | bigint | Uint8Array;
}

/**
 * Entry presente pero RAW inválido según el schema Zod del catálogo.
 * Caller debe loggear como `warn` y continuar — un valor fuera de
 * rango (ej. GSM signal = 15) puede indicar corrupción de buffer o
 * cambio de spec sin actualizar el código. No abortamos el record
 * completo por un campo malo.
 */
export interface InvalidEntry {
  id: number;
  value: number | bigint | Uint8Array;
  zodIssues: z.ZodIssue[];
}

export interface LowPriorityInterpretResult {
  /** Telemetría con campos válidos en unidades canónicas. */
  telemetry: LowPriorityTelemetry;
  /** IDs que NO están en el catálogo Low Priority (para log). */
  unknownEntries: UnknownEntry[];
  /** IDs en el catálogo pero con RAW que falla el schema (para log). */
  invalidEntries: InvalidEntry[];
}

/**
 * Entry mínimo que la función necesita para interpretar — compatible con
 * `IoEntry` del codec8-parser pero deduplicado acá para evitar
 * dependencia circular packages/shared-schemas → packages/codec8-parser.
 */
export interface MinimalIoEntry {
  id: number;
  value: number | bigint | Uint8Array;
  byteSize: 1 | 2 | 4 | 8 | null;
}

/**
 * Interpreta los IO entries Low Priority de un AVL record y retorna
 * telemetría tipada en unidades canónicas Booster.
 *
 * **Diseño**:
 *   - Pure function. No I/O, no logging — el caller decide cómo manejar
 *     unknownEntries / invalidEntries.
 *   - Parcial — un record puede traer 0..14 IDs presentes; los ausentes
 *     no aparecen en `telemetry`.
 *   - Tolerante — un campo malformado no aborta el resto. Aborta solo
 *     ese campo y lo reporta en `invalidEntries`.
 *
 * @example
 *   const r = interpretLowPriority([
 *     { id: 239, value: 1, byteSize: 1 },
 *     { id: 24, value: 80, byteSize: 2 },
 *     { id: 999, value: 42, byteSize: 1 },
 *   ]);
 *   // r.telemetry  → { ignition: true, speedKmh: 80 }
 *   // r.unknownEntries → [{ id: 999, value: 42 }]
 *   // r.invalidEntries → []
 */
export function interpretLowPriority(entries: MinimalIoEntry[]): LowPriorityInterpretResult {
  const telemetry: LowPriorityTelemetry = {};
  const unknownEntries: UnknownEntry[] = [];
  const invalidEntries: InvalidEntry[] = [];

  for (const entry of entries) {
    if (!LOW_PRIORITY_IDS.has(entry.id)) {
      unknownEntries.push({ id: entry.id, value: entry.value });
      continue;
    }

    // Battery Current (AVL 68) es int16 SIGNED — el codec8-parser entrega
    // raw como uint16. Convertimos antes de validar para que el schema
    // numérico signed funcione.
    const rawForValidation =
      entry.id === AVL_ID.BATTERY_CURRENT ? toSignedInt16(entry.value) : entry.value;

    const schema = LOW_PRIORITY_RAW_SCHEMAS[entry.id as keyof typeof LOW_PRIORITY_RAW_SCHEMAS];
    const parsed = schema.safeParse(rawForValidation);
    if (!parsed.success) {
      invalidEntries.push({
        id: entry.id,
        value: entry.value,
        zodIssues: parsed.error.issues,
      });
      continue;
    }

    applyToTelemetry(telemetry, entry.id, parsed.data);
  }

  return { telemetry, unknownEntries, invalidEntries };
}

/**
 * Convierte un valor uint16 a int16 con signo (two's complement).
 * Si recibe BigInt o Buffer (no aplicable a battery current), retorna
 * NaN para que el schema falle limpiamente.
 */
function toSignedInt16(value: number | bigint | Uint8Array): number {
  if (typeof value !== 'number') {
    return Number.NaN;
  }
  return value > 0x7fff ? value - 0x10000 : value;
}

function applyToTelemetry(t: LowPriorityTelemetry, id: number, value: number): void {
  switch (id) {
    case AVL_ID.IGNITION:
      t.ignition = value === 1;
      return;
    case AVL_ID.MOVEMENT:
      t.movement = value === 1;
      return;
    case AVL_ID.SLEEP_MODE:
      t.sleepMode = value;
      return;
    case AVL_ID.GSM_SIGNAL:
      t.gsmSignalBars = value;
      return;
    case AVL_ID.GNSS_STATUS:
      t.gnssStatus = value;
      return;
    case AVL_ID.GNSS_PDOP:
      t.gnssPdop = value / 10;
      return;
    case AVL_ID.GNSS_HDOP:
      t.gnssHdop = value / 10;
      return;
    case AVL_ID.EXTERNAL_VOLTAGE:
      t.externalVoltageMv = value;
      return;
    case AVL_ID.BATTERY_VOLTAGE:
      t.batteryVoltageMv = value;
      return;
    case AVL_ID.BATTERY_CURRENT:
      t.batteryCurrentMa = value;
      return;
    case AVL_ID.SPEED:
      t.speedKmh = value;
      return;
    case AVL_ID.TOTAL_ODOMETER:
      t.totalOdometerM = value;
      return;
    case AVL_ID.TRIP_ODOMETER:
      t.tripOdometerM = value;
      return;
    case AVL_ID.DATA_MODE:
      t.dataMode = value;
      return;
  }
}
