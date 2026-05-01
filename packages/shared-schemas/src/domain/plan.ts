import { z } from 'zod';
import { planIdSchema } from '../primitives/ids.js';

/**
 * Plan de suscripción.
 *
 * Slugs en español + `enterprise` (mantiene en inglés por convención B2B).
 * Para piloto se cargan los 4 planes pre-definidos sin billing automático;
 * la asignación a empresa se hace manualmente desde admin.
 *
 * Slice 2: integrar Flow.cl (Chile) o Stripe para subscription billing
 * real con webhooks de pago + downgrade automático en impago.
 */
export const planSlugSchema = z.enum(['gratis', 'estandar', 'pro', 'enterprise']);
export type PlanSlug = z.infer<typeof planSlugSchema>;

/**
 * Feature flags del plan. Plan controla qué features están disponibles.
 */
export const planFeaturesSchema = z.object({
  /** Máximo de cargas activas simultáneas (null = ilimitado). */
  max_active_trips: z.number().int().positive().nullable(),
  /** Máximo de vehículos registrables (null = ilimitado). */
  max_vehicles: z.number().int().positive().nullable(),
  /** Cuántas offers paralelas puede recibir un transportista para una misma carga. */
  max_concurrent_offers: z.number().int().positive(),
  /** Acceso a dashboard analítico avanzado (heatmaps, scoring detallado). */
  advanced_analytics: z.boolean(),
  /** Generación automática de Carta de Porte y DTE (Slice 2+). */
  auto_documents: z.boolean(),
  /** API access para integraciones (TMS/ERP). */
  api_access: z.boolean(),
  /** Prioridad en el matching engine cuando hay empate de score. */
  matching_priority: z.number().int().min(0).max(100),
});
export type PlanFeatures = z.infer<typeof planFeaturesSchema>;

export const planSchema = z.object({
  id: planIdSchema,
  slug: planSlugSchema,
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  monthly_price_clp: z.number().int().nonnegative(),
  features: planFeaturesSchema,
  is_active: z.boolean(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Plan = z.infer<typeof planSchema>;
