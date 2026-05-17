import { z } from 'zod';

/**
 * @booster-ai/shared-schemas — Zona stakeholder (D11 / ADR-041 + ADR-042).
 *
 * Geografía curada para agregaciones del rol `stakeholder_sostenibilidad`.
 *
 * Filter primario (ADR-042 §1): `comuna_codes` array de ISO 3166-2:CL
 * que mapea la zona a una o más comunas chilenas. Un viaje pertenece a
 * la zona si `viaje.originComunaCode = ANY(z.comuna_codes)`.
 *
 * Metadata informativo (ADR-042 §3): `lat_min/max/lng_min/lng_max`
 * (bounding box WGS84 axis-aligned) se mantienen para uso futuro de UI
 * map preview, pero NO se usan para el filtrado de viajes en v2.
 *
 * Slug estable referenciado por la UI. Proceso "nueva zona" en ADR-042.
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

/** Código comuna ISO 3166-2:CL — formato `CL-{REGIÓN}-{COMUNA}` (e.g. `CL-RM-QUI` Quilicura). */
export const comunaCodeSchema = z
  .string()
  .regex(/^CL-[A-Z]{2,3}-[A-Z]{3}$/, 'Código comuna ISO 3166-2:CL inválido (formato: CL-RM-QUI)');

/** Refine garantiza bbox bien formado (cuando se provee) — evita seeds inconsistentes. */
export const zonaStakeholderSchema = z
  .object({
    id: z.string().uuid(),
    slug: zonaStakeholderSlugSchema,
    nombre: z.string().min(3).max(120),
    region_code: z.string().regex(/^CL-[A-Z]{2,3}$/, 'Código ISO 3166-2:CL inválido (e.g. CL-VS)'),
    tipo: zonaStakeholderTipoSchema,
    /** Bbox metadata informativo (ADR-042 §3) — NO usado para filtrado en v2. */
    lat_min: z.number().gte(-90).lte(90),
    lat_max: z.number().gte(-90).lte(90),
    lng_min: z.number().gte(-180).lte(180),
    lng_max: z.number().gte(-180).lte(180),
    /** Filter primario (ADR-042 §1) — comuna codes a los que la zona mapea. */
    comuna_codes: z.array(comunaCodeSchema),
    is_active: z.boolean(),
    creado_en: z.string().datetime(),
    actualizado_en: z.string().datetime(),
  })
  .refine((zona) => zona.lat_min < zona.lat_max, {
    message: 'lat_min debe ser estrictamente menor que lat_max',
    path: ['lat_min'],
  })
  .refine((zona) => zona.lng_min < zona.lng_max, {
    message: 'lng_min debe ser estrictamente menor que lng_max',
    path: ['lng_min'],
  });
export type ZonaStakeholder = z.infer<typeof zonaStakeholderSchema>;
