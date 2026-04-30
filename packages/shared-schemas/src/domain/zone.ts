import { z } from 'zod';
import { regionCodeSchema } from '../primitives/chile.js';
import { empresaIdSchema, zoneIdSchema } from '../primitives/ids.js';

/**
 * Zona operativa de una empresa carrier.
 *
 * Un carrier define las regiones (y opcionalmente comunas) donde puede
 * recoger u operar cargas. El matching engine usa esto como primer
 * filtro: si el origen de una carga no cae en ninguna zona del carrier,
 * no recibe la oferta — sin importar capacidad ni score.
 *
 * Para el lunes piloto: filtro a nivel región (15 regiones de Chile).
 * Slice 2+: agregar comunas + radio en km desde una base operativa.
 */
export const zoneTypeSchema = z.enum([
  'pickup', // Puede recoger cargas en esta zona
  'delivery', // Puede entregar cargas en esta zona
  'both', // Ambas
]);
export type ZoneType = z.infer<typeof zoneTypeSchema>;

export const zoneSchema = z.object({
  id: zoneIdSchema,
  empresa_id: empresaIdSchema,
  region_code: regionCodeSchema,
  /**
   * Lista de códigos de comuna dentro de la región. Null = TODA la región.
   * Las comunas se almacenan como strings de código DPA del INE Chile.
   */
  comuna_codes: z.array(z.string()).nullable(),
  zone_type: zoneTypeSchema,
  is_active: z.boolean().default(true),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Zone = z.infer<typeof zoneSchema>;
