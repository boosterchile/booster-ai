import type { z } from 'zod';
import {
  AVL_ID_DALLAS,
  type AvlIdDallas,
  DALLAS_TEMPERATURE_IDS,
  DALLAS_TEMPERATURE_RAW_SCHEMAS,
} from './dallas-temperature.js';
import { toSignedInt16 } from './interpret-low-priority.js';

/**
 * Telemetría Dallas Temperature interpretada — 1 campo por sensor
 * conectado (hasta 4), en °C con signo. Opcional porque no todos los
 * records traen los 4 IDs (depende de cuántos sensores 1-Wire están
 * físicamente conectados al FMC150).
 */
export interface DallasTemperatureTelemetry {
  /** AVL 72. °C, sensor 1. */
  dallasTemperature1C?: number;
  /** AVL 73. °C, sensor 2. */
  dallasTemperature2C?: number;
  /** AVL 74. °C, sensor 3. */
  dallasTemperature3C?: number;
  /** AVL 75. °C, sensor 4. */
  dallasTemperature4C?: number;
}

/**
 * Entry desconocida — un ID que llegó pero no está en el catálogo Dallas.
 * El caller loggea esto como `warn` con `{ avlId, value, imei }`.
 */
export interface UnknownEntry {
  id: number;
  value: number | bigint | Uint8Array;
}

/**
 * Entry presente pero RAW inválido según el schema Zod del catálogo (fuera
 * del rango físico del sensor DS18B20, ver `dallas-temperature.ts`). Caller
 * debe loggear como `warn` y continuar — no aborta el record completo.
 */
export interface InvalidEntry {
  id: number;
  value: number | bigint | Uint8Array;
  zodIssues: z.ZodIssue[];
}

export interface DallasTemperatureInterpretResult {
  /** Temperaturas válidas en °C. */
  telemetry: DallasTemperatureTelemetry;
  /** IDs que NO están en el catálogo Dallas (para log). */
  unknownEntries: UnknownEntry[];
  /** IDs en el catálogo pero con RAW que falla el schema (para log). */
  invalidEntries: InvalidEntry[];
}

/**
 * Entry mínimo que la función necesita para interpretar — compatible con
 * `IoEntry` del codec8-parser pero deduplicado acá (mismo motivo que
 * `MinimalIoEntry` en `interpret-low-priority.ts`: evita dependencia
 * circular packages/shared-schemas → packages/codec8-parser).
 */
export interface MinimalIoEntry {
  id: number;
  value: number | bigint | Uint8Array;
  byteSize: 1 | 2 | 4 | 8 | null;
}

/**
 * Interpreta los IO entries Dallas Temperature (72-75) de un AVL record y
 * retorna telemetría tipada en °C.
 *
 * **Diseño** (idéntico a `interpretLowPriority`):
 *   - Pure function. No I/O, no logging.
 *   - Parcial — 0..4 sensores presentes por record.
 *   - Tolerante — un campo malformado no aborta el resto.
 *
 * @example
 *   const r = interpretDallasTemperature([
 *     { id: 72, value: 55, byteSize: 2 },   // 5.5°C
 *   ]);
 *   // r.telemetry → { dallasTemperature1C: 5.5 }
 */
export function interpretDallasTemperature(
  entries: MinimalIoEntry[],
): DallasTemperatureInterpretResult {
  const telemetry: DallasTemperatureTelemetry = {};
  const unknownEntries: UnknownEntry[] = [];
  const invalidEntries: InvalidEntry[] = [];

  for (const entry of entries) {
    if (!DALLAS_TEMPERATURE_IDS.has(entry.id)) {
      unknownEntries.push({ id: entry.id, value: entry.value });
      continue;
    }

    // Todos los sensores Dallas son int16 SIGNED — el codec8-parser entrega
    // raw como uint16 (grupo N2). Convertimos antes de validar, igual que
    // Battery Current en interpret-low-priority.ts.
    const rawForValidation = toSignedInt16(entry.value);

    const schema = DALLAS_TEMPERATURE_RAW_SCHEMAS[entry.id as AvlIdDallas];
    const parsed = schema.safeParse(rawForValidation);
    if (!parsed.success) {
      invalidEntries.push({
        id: entry.id,
        value: entry.value,
        zodIssues: parsed.error.issues,
      });
      continue;
    }

    applyToTelemetry(telemetry, entry.id as AvlIdDallas, parsed.data as number);
  }

  return { telemetry, unknownEntries, invalidEntries };
}

function applyToTelemetry(
  t: DallasTemperatureTelemetry,
  id: AvlIdDallas,
  rawDeciCelsius: number,
): void {
  const celsius = rawDeciCelsius / 10;
  switch (id) {
    case AVL_ID_DALLAS.DALLAS_TEMPERATURE_1:
      t.dallasTemperature1C = celsius;
      return;
    case AVL_ID_DALLAS.DALLAS_TEMPERATURE_2:
      t.dallasTemperature2C = celsius;
      return;
    case AVL_ID_DALLAS.DALLAS_TEMPERATURE_3:
      t.dallasTemperature3C = celsius;
      return;
    case AVL_ID_DALLAS.DALLAS_TEMPERATURE_4:
      t.dallasTemperature4C = celsius;
      return;
  }
}
