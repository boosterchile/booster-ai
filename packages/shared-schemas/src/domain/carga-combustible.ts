import { z } from 'zod';

/**
 * Registro de cargas de combustible (`.specs/registro-cargas-combustible`,
 * decisión D4 del PO). Litros cargados con su fecha y hora: con ellos Booster
 * compara lo cargado contra lo que quemó el motor (IO 83) en el período, que es
 * lo único que ve pérdidas chicas de 10–20 L. Tabla `cargas_combustible`
 * (migración 0093).
 */

export const LITROS_CARGA_MAX = 2000;
/** Ninguna carga es anterior a esta fecha: el primer equipo Teltonika es de 2024. */
export const CARGADA_EN_MINIMA = '2024-01-01T00:00:00.000Z';
/** Tolerancia por la diferencia de reloj del navegador. */
export const CARGADA_EN_FUTURO_MAX_MS = 5 * 60 * 1000;

export const crearCargaCombustibleBodySchema = z.object({
  cargada_en: z
    .string()
    .datetime({ offset: true })
    .refine((v) => Date.parse(v) >= Date.parse(CARGADA_EN_MINIMA), {
      message: 'La fecha es anterior a 2024.',
    })
    .refine((v) => Date.parse(v) <= Date.now() + CARGADA_EN_FUTURO_MAX_MS, {
      message: 'La fecha está en el futuro.',
    }),
  litros: z
    .number()
    .positive()
    .max(LITROS_CARGA_MAX)
    .transform((v) => Math.round(v * 10) / 10)
    .refine((v) => v > 0, { message: 'Los litros tienen que ser mayores que cero.' }),
  lugar: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v ? v : null)),
});
export type CrearCargaCombustibleBody = z.infer<typeof crearCargaCombustibleBodySchema>;

export const cargaCombustibleSchema = z.object({
  id: z.string(),
  vehiculo_id: z.string(),
  cargada_en: z.string(),
  litros: z.number(),
  lugar: z.string().nullable(),
  registrada_en: z.string(),
  anulada_en: z.string().nullable(),
});
export type CargaCombustible = z.infer<typeof cargaCombustibleSchema>;

export const respuestaCargaCombustibleSchema = z.object({ carga: cargaCombustibleSchema });
export const listaCargasCombustibleSchema = z.object({ cargas: z.array(cargaCombustibleSchema) });
