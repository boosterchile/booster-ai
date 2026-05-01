import { z } from 'zod';
import { cargoTypeSchema } from './domain/cargo-request.js';
import { regionCodeSchema } from './primitives/chile.js';

/**
 * Schema del body POST /trip-requests.
 *
 * Es la creación canónica de una carga (vs `whatsapp_intake_drafts` que es
 * el flow legacy anónimo del bot). El shipper autenticado pasa todos los
 * datos en una sola request; el handler:
 *   1. Crea trip_request con shipper_empresa_id = activeMembership.empresa.id
 *   2. Cambia status a 'pending_match' inmediatamente
 *   3. Dispara matching engine que genera offers a carriers candidatos
 *
 * Slice B.5: scoring geográfico reducido a "carrier tiene zona pickup que
 * cubre la región origen". Slice posterior agregará comuna, distancia desde
 * base, ratings, historial.
 */
export const tripRequestCreateInputSchema = z.object({
  /** Origen — donde se recoge la carga. */
  origin: z.object({
    address_raw: z.string().min(1).max(500),
    region_code: regionCodeSchema,
    /** Código DPA INE de la comuna. Opcional para MVP — el matching no lo usa todavía. */
    comuna_code: z.string().min(1).max(10).optional(),
  }),
  /** Destino — donde se entrega. */
  destination: z.object({
    address_raw: z.string().min(1).max(500),
    region_code: regionCodeSchema,
    comuna_code: z.string().min(1).max(10).optional(),
  }),
  cargo: z.object({
    cargo_type: cargoTypeSchema,
    /** Peso en kg. Filtra vehículos con capacidad menor. */
    weight_kg: z.number().int().positive().max(100_000),
    volume_m3: z.number().int().positive().max(200).optional(),
    description: z.string().max(1_000).optional(),
  }),
  /**
   * Ventana de pickup. El bot WhatsApp manda raw text; aquí esperamos ISO
   * 8601 datetimes parseados por el cliente. Si solo hay fecha, ambos
   * campos comparten valor (rango = día completo).
   */
  pickup_window: z.object({
    start_at: z.string().datetime(),
    end_at: z.string().datetime(),
  }),
  /** Precio sugerido por shipper en CLP. Null = pricing-engine sugiere. */
  proposed_price_clp: z.number().int().nonnegative().nullable(),
});

export type TripRequestCreateInput = z.infer<typeof tripRequestCreateInputSchema>;
