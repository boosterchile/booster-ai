import { z } from 'zod';
import { regionCodeSchema } from '../primitives/chile.js';
import { empresaIdSchema, zoneIdSchema } from '../primitives/ids.js';

/**
 * Zona operativa de una empresa transportista.
 *
 * Un transportista define las regiones (y opcionalmente comunas) donde
 * puede recoger u operar cargas. El matching engine usa esto como primer
 * filtro: si el origen de una carga no cae en ninguna zona del
 * transportista, no recibe la oferta — sin importar capacidad ni score.
 *
 * Para piloto: filtro a nivel región (15 regiones de Chile). Slice
 * posterior agrega comunas + radio en km desde una base operativa.
 */
export const zoneTypeSchema = z.enum(['recogida', 'entrega', 'ambos']);
export type ZoneType = z.infer<typeof zoneTypeSchema>;

export const zoneSchema = z.object({
  id: zoneIdSchema,
  empresa_id: empresaIdSchema,
  region_code: regionCodeSchema,
  /**
   * Lista de códigos de comuna dentro de la región. Null = TODA la
   * región. Las comunas se almacenan como strings de código DPA INE Chile.
   */
  comuna_codes: z.array(z.string()).nullable(),
  zone_type: zoneTypeSchema,
  is_active: z.boolean().default(true),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Zone = z.infer<typeof zoneSchema>;
