import { z } from 'zod';
import { addressSchema } from '../primitives/geo.js';
import { cargoRequestIdSchema, generadorCargaIdSchema } from '../primitives/ids.js';
import { vehicleTypeSchema } from './vehicle.js';

/**
 * Tipos de carga (canónico). Valores en español snake_case sin tildes para
 * coincidir 1:1 con el enum SQL `tipo_carga`.
 */
export const cargoTypeSchema = z.enum([
  'carga_seca',
  'perecible',
  'refrigerada',
  'congelada',
  'fragil',
  'peligrosa',
  'liquida',
  'construccion',
  'agricola',
  'ganado',
  'otra',
]);
export type CargoType = z.infer<typeof cargoTypeSchema>;

/**
 * @drift-status intentional-pre-materialization
 * @clase I
 * @materialization-trigger Slice 2 WhatsApp NLU flow (ADR-006 §acceptance)
 * @depends-on
 *   - docs/adr/006-whatsapp-primary-channel.md §acceptance ("CargoRequest válido desde conversación de 4-6 turnos")
 *   - docs/adr/008-pwa-multirole.md (route NewCargoRequest.tsx planificada)
 *   - docs/adr/010-marketing-site-and-commerce.md (onboarding wizard "Crea tu primera carga")
 *   - skills/empty-leg-matching/SKILL.md (input central del algoritmo de matching)
 *   - packages/shared-schemas/src/domain/trip.ts (cargo_request_id es FK estructural YA activa)
 *   - packages/shared-schemas/src/trip-request.ts (comentario roadmap Slice 2)
 * @review-on next-touch
 * @triaged-in .specs/s1-drift-coverage-e2e/t1.3-discovery.md (2026-05-18 Sprint S1a T1.3)
 *
 * `cargoRequestStatusSchema` y `cargoRequestSchema` son **scaffolding deliberado del roadmap** —
 * el dominio Zod define el concepto antes de que exista su contraparte SQL (`cargo_requests`
 * table). NO es drift accidental ni FP heurístico ni decisión arquitectónica pendiente: es
 * la categoría taxonómica **Clase I — Intentional pre-materialization** definida en
 * `.specs/s1-drift-coverage-e2e/inventory-classification.md` §Nomenclatura.
 *
 * El drift-inventory script flaggeará este schema como divergencia hasta que se implemente
 * el parsing de `@drift-status` (T1.x.parser follow-up no bloqueante en `plan-s1a.md`).
 * Mientras tanto, este caso se mantiene en la lista de Clase I del classification doc.
 */
export const cargoRequestStatusSchema = z.enum([
  'borrador',
  'abierta',
  'emparejando',
  'emparejada',
  'cancelada',
  'expirada',
]);
export type CargoRequestStatus = z.infer<typeof cargoRequestStatusSchema>;

export const cargoRequestSchema = z.object({
  id: cargoRequestIdSchema,
  generador_carga_id: generadorCargaIdSchema,
  origin: addressSchema,
  destination: addressSchema,
  cargo_type: cargoTypeSchema,
  cargo_description: z.string().min(1),
  weight_kg: z.number().positive(),
  volume_m3: z.number().positive().optional(),
  required_vehicle_type: vehicleTypeSchema,
  pickup_earliest_at: z.string().datetime(),
  pickup_latest_at: z.string().datetime(),
  deliver_by_at: z.string().datetime(),
  budget_clp: z.number().int().positive().optional(),
  special_instructions: z.string().optional(),
  status: cargoRequestStatusSchema,
  origin_channel: z.enum(['web', 'whatsapp', 'api']),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type CargoRequest = z.infer<typeof cargoRequestSchema>;
