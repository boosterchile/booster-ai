import { z } from 'zod';

/**
 * Catálogo de AVL IDs **Dallas Temperature 1-4** del Teltonika FMC150
 * (sensores 1-Wire DS18B20 conectados al device, hasta 4 simultáneos).
 *
 * Spec canónica:
 *   https://wiki.teltonika-gps.com/view/FMC150_Teltonika_Data_Sending_Parameters_ID
 *
 * Estos schemas validan el valor **ya convertido a signed** (mismo patrón
 * que `AVL_ID.BATTERY_CURRENT` en `low-priority.ts`): el codec8-parser
 * entrega `IoEntry.value` como uint16 SIEMPRE sin signo (grupo N2, 2
 * bytes); la conversión a int16 (two's complement) vive en
 * `interpret-dallas-temperature.ts`, ANTES de validar contra estos
 * schemas. La unidad RAW es décimas de °C con signo.
 *
 * **Rango físico DS18B20** (datasheet Maxim/Dallas): -55°C a +125°C.
 * No hay una fuente confiable en el repo sobre un valor sentinel
 * específico de Teltonika para "sensor desconectado" (grep: cero
 * referencias a Dallas antes de este módulo). Por eso el schema RAW
 * rechaza cualquier lectura fuera del rango físico del sensor y la
 * capa de interpretación la reporta como `invalidEntries` (sin dato)
 * en vez de inventar un mapeo semántico no verificado. Nota: el
 * sentinel "desconectado" 0x8000 documentado para otros devices
 * Teltonika (-3276.8°C) cae naturalmente fuera de este rango, así que
 * el chequeo físico lo cubre sin necesidad de un caso especial.
 *
 * Layout de la tabla:
 *
 * | AVL ID | Nombre               | Tipo RAW    | Unidades       |
 * |--------|----------------------|-------------|----------------|
 * | 72     | Dallas Temperature 1 | int16 signed| décimas de °C  |
 * | 73     | Dallas Temperature 2 | int16 signed| décimas de °C  |
 * | 74     | Dallas Temperature 3 | int16 signed| décimas de °C  |
 * | 75     | Dallas Temperature 4 | int16 signed| décimas de °C  |
 */

/** Singleton: ID numérico fijo de cada sensor Dallas en la spec FMC150. */
export const AVL_ID_DALLAS = {
  DALLAS_TEMPERATURE_1: 72,
  DALLAS_TEMPERATURE_2: 73,
  DALLAS_TEMPERATURE_3: 74,
  DALLAS_TEMPERATURE_4: 75,
} as const;

export type AvlIdDallas = (typeof AVL_ID_DALLAS)[keyof typeof AVL_ID_DALLAS];

/** Set de IDs Dallas — usado por interpret() para clasificar entries. */
export const DALLAS_TEMPERATURE_IDS: ReadonlySet<number> = new Set(Object.values(AVL_ID_DALLAS));

/** Rango físico del sensor DS18B20 (datasheet), en °C. */
export const DALLAS_TEMPERATURE_MIN_C = -55;
export const DALLAS_TEMPERATURE_MAX_C = 125;

// =============================================================================
// SCHEMA RAW (valida el valor YA CONVERTIDO a signed, en décimas de °C)
// =============================================================================

/** AVL 72-75 — Dallas Temperature (int16 SIGNED, décimas de °C). Rango
 *  físico DS18B20: -550..1250 (-55.0°C..125.0°C). Fuera de rango = sensor
 *  desconectado/corrupto → `invalidEntries`, no `telemetry`. */
export const dallasTemperatureRawSchema = z
  .number()
  .int()
  .min(DALLAS_TEMPERATURE_MIN_C * 10)
  .max(DALLAS_TEMPERATURE_MAX_C * 10);
export type DallasTemperatureRaw = z.infer<typeof dallasTemperatureRawSchema>;

// =============================================================================
// MAP { id → schema } — usado por interpret() para validar de forma genérica
// =============================================================================

export const DALLAS_TEMPERATURE_RAW_SCHEMAS: Record<AvlIdDallas, z.ZodTypeAny> = {
  [AVL_ID_DALLAS.DALLAS_TEMPERATURE_1]: dallasTemperatureRawSchema,
  [AVL_ID_DALLAS.DALLAS_TEMPERATURE_2]: dallasTemperatureRawSchema,
  [AVL_ID_DALLAS.DALLAS_TEMPERATURE_3]: dallasTemperatureRawSchema,
  [AVL_ID_DALLAS.DALLAS_TEMPERATURE_4]: dallasTemperatureRawSchema,
};
