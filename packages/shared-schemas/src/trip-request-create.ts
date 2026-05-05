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

/** Mínimo de caracteres para una dirección razonable (calle + altura o nombre). */
const MIN_ADDRESS_LENGTH = 5;

/**
 * Lead time mínimo entre `start_at` y `now()`. 30 minutos da margen para
 * matching + notificación a transportista, sin frustrar al shipper que
 * está cargando algo "para ahora".
 */
const MIN_PICKUP_LEAD_MS = 30 * 60 * 1000;

/**
 * Ventana máxima entre `start_at` y `end_at`. 30 días es generoso para
 * cargas planificadas; previene errores tipo "1 año" por typo.
 */
const MAX_PICKUP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const addressSchema = z.string().trim().min(MIN_ADDRESS_LENGTH).max(500);

export const tripRequestCreateInputSchema = z
  .object({
    /** Origen — donde se recoge la carga. */
    origin: z.object({
      address_raw: addressSchema,
      region_code: regionCodeSchema,
      /** Código DPA INE de la comuna. Opcional para MVP — el matching no lo usa todavía. */
      comuna_code: z.string().min(1).max(10).optional(),
    }),
    /** Destino — donde se entrega. */
    destination: z.object({
      address_raw: addressSchema,
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
     *
     * Reglas adicionales (`superRefine` abajo):
     *   - `start_at` debe ser futuro con margen (`MIN_PICKUP_LEAD_MS`).
     *   - `end_at` debe ser estrictamente posterior a `start_at`.
     *   - El rango total no puede exceder `MAX_PICKUP_WINDOW_MS` (30 días).
     */
    pickup_window: z.object({
      start_at: z.string().datetime(),
      end_at: z.string().datetime(),
    }),
    /** Precio sugerido por shipper en CLP. Null = pricing-engine sugiere. */
    proposed_price_clp: z.number().int().nonnegative().nullable(),
  })
  .superRefine((data, ctx) => {
    const startMs = Date.parse(data.pickup_window.start_at);
    const endMs = Date.parse(data.pickup_window.end_at);

    // Z.string().datetime() ya validó formato; parseInt no debería fallar.
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      return;
    }

    if (startMs <= Date.now() + MIN_PICKUP_LEAD_MS - 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pickup_window', 'start_at'],
        message: 'La ventana debe empezar al menos 30 minutos en el futuro',
      });
    }

    if (endMs <= startMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pickup_window', 'end_at'],
        message: '"Hasta" debe ser estrictamente posterior a "Desde"',
      });
    } else if (endMs - startMs > MAX_PICKUP_WINDOW_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pickup_window', 'end_at'],
        message: 'La ventana de pickup no puede exceder 30 días',
      });
    }
  });

export type TripRequestCreateInput = z.infer<typeof tripRequestCreateInputSchema>;

/**
 * Constantes exportadas para que el cliente (form) muestre el mismo
 * mensaje y el mismo lead-time sin duplicar lógica.
 */
export const TRIP_REQUEST_CREATE_LIMITS = {
  MIN_ADDRESS_LENGTH,
  MIN_PICKUP_LEAD_MS,
  MAX_PICKUP_WINDOW_MS,
} as const;
