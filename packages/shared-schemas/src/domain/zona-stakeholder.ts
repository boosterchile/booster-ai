import { z } from 'zod';

/**
 * @booster-ai/shared-schemas — Zona stakeholder (D11 / ADR-041).
 *
 * Geografía curada para agregaciones del rol `stakeholder_sostenibilidad`.
 * Bounding box rectangular axis-aligned (lat/lng WGS84). Slug estable
 * referenciado por la UI. Proceso "nueva zona" en ADR-041.
 */

/** Tipo de zona — sincronizar con pgEnum `tipo_zona_stakeholder`. */
export const zonaStakeholderTipoSchema = z.enum([
  'puerto',
  'mercado_abastos',
  'polo_industrial',
  'zona_franca',
]);
export type ZonaStakeholderTipo = z.infer<typeof zonaStakeholderTipoSchema>;

export const zonaStakeholderSlugSchema = z
  .string()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9-]+$/, 'Slug en minúsculas, dígitos y guiones (e.g. puerto-valparaiso)');

/** Refine garantiza bbox bien formado — evita seeds que producen result set vacío silencioso. */
export const zonaStakeholderSchema = z
  .object({
    id: z.string().uuid(),
    slug: zonaStakeholderSlugSchema,
    nombre: z.string().min(3).max(120),
    region_code: z.string().regex(/^CL-[A-Z]{2,3}$/, 'Código ISO 3166-2:CL inválido (e.g. CL-VS)'),
    tipo: zonaStakeholderTipoSchema,
    lat_min: z.number().gte(-90).lte(90),
    lat_max: z.number().gte(-90).lte(90),
    lng_min: z.number().gte(-180).lte(180),
    lng_max: z.number().gte(-180).lte(180),
    is_active: z.boolean(),
    creado_en: z.string().datetime(),
    actualizado_en: z.string().datetime(),
  })
  .refine((z) => z.lat_min < z.lat_max, {
    message: 'lat_min debe ser estrictamente menor que lat_max',
    path: ['lat_min'],
  })
  .refine((z) => z.lng_min < z.lng_max, {
    message: 'lng_min debe ser estrictamente menor que lng_max',
    path: ['lng_min'],
  });
export type ZonaStakeholder = z.infer<typeof zonaStakeholderSchema>;
