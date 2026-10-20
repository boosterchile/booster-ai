import { z } from 'zod';
import { cargoTypeSchema } from './domain/cargo-request.js';
import { type RegionCode, regionCodeSchema } from './primitives/chile.js';
import { comunasDeRegion } from './primitives/comunas-chile.js';

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

const addressSchema = z
  .string()
  .trim()
  .min(MIN_ADDRESS_LENGTH, 'Ingresa una dirección (mínimo 5 caracteres)')
  .max(500, 'La dirección es demasiado larga');

/**
 * Región obligatoria con mensaje en español. El enum pelado responde en
 * inglés con la lista completa de códigos cuando el select queda en «».
 */
const regionRequeridaSchema = z.string().transform((valor, ctx): RegionCode => {
  const parsed = regionCodeSchema.safeParse(valor);
  if (!parsed.success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Selecciona una región' });
    return z.NEVER;
  }
  return parsed.data;
});

const latitudSchema = z.number().finite().gte(-90).lte(90);
const longitudSchema = z.number().finite().gte(-180).lte(180);

/** Caja de Chile continental, Pascua y el extremo sur. Fuera de esto no es un punto del viaje. */
const CHILE_LAT_MIN = -56;
const CHILE_LAT_MAX = -17;
const CHILE_LNG_MIN = -110;
const CHILE_LNG_MAX = -66;

/**
 * Un extremo del viaje. `comuna_code` es el CUT/INE (5 dígitos) cuando el
 * selector lo conoce; se mantiene string ≤ 10 para no cerrarle la puerta a
 * un cliente que ya mande otro código corto. Lat/lng van juntas o no van:
 * el pin, la sugerencia o el link las llenan. Sin ellas el viaje se crea
 * igual y, en el origen, Routes API sigue como respaldo.
 */
const lugarSchema = z
  .object({
    address_raw: addressSchema,
    region_code: regionRequeridaSchema,
    comuna_code: z.string().trim().min(1).max(10).optional(),
    latitude: latitudSchema.optional(),
    longitude: longitudSchema.optional(),
  })
  .superRefine((lugar, ctx) => {
    const tieneLat = lugar.latitude !== undefined;
    const tieneLng = lugar.longitude !== undefined;
    if (tieneLat !== tieneLng) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [tieneLat ? 'longitude' : 'latitude'],
        message: 'Latitud y longitud van juntas',
      });
      return;
    }
    if (tieneLat && tieneLng && lugar.latitude !== undefined && lugar.longitude !== undefined) {
      if (lugar.latitude === 0 || lugar.longitude === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['latitude'],
          message: 'Coordenadas no válidas',
        });
        return;
      }
      if (
        lugar.latitude < CHILE_LAT_MIN ||
        lugar.latitude > CHILE_LAT_MAX ||
        lugar.longitude < CHILE_LNG_MIN ||
        lugar.longitude > CHILE_LNG_MAX
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['latitude'],
          message: 'El punto tiene que estar en Chile',
        });
      }
    }
    if (
      lugar.comuna_code !== undefined &&
      !comunasDeRegion(lugar.region_code).some((comuna) => comuna.code === lugar.comuna_code)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['comuna_code'],
        message: 'La comuna no pertenece a la región',
      });
    }
  });

export const tripRequestCreateInputSchema = z
  .object({
    /** Origen — donde se recoge la carga. */
    origin: lugarSchema,
    /** Destino — donde se entrega. */
    destination: lugarSchema,
    cargo: z.object({
      cargo_type: cargoTypeSchema,
      /** Peso en kg. Filtra vehículos con capacidad menor. */
      weight_kg: z
        .number({
          invalid_type_error: 'Ingresa el peso en kg',
          required_error: 'Ingresa el peso en kg',
        })
        .int('Ingresa el peso en kg')
        .positive('El peso tiene que ser mayor a 0')
        .max(100_000, 'El peso máximo es 100.000 kg'),
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
    /**
     * ADR-079 §2 — modalidad comercial (define la tasa de comisión).
     * `programada` exige contrato programado habilitado; default `spot`.
     */
    modalidad_carga: z.enum(['spot', 'programada']).default('spot'),
    /**
     * Phase 5 PR-L3b — Datos opcionales del consignee (destinatario en
     * el lugar de entrega). Si están presentes:
     *   - El link público de tracking se envía DIRECTAMENTE al
     *     consignee vía WhatsApp al asignar (vs forwarding manual del
     *     shipper).
     *   - El destinatario aparece como rol abstracto en el chat
     *     conductor↔destinatario (futuro PR-L5).
     *
     * Opt-in deliberado: el shipper típico tiene la relación con el
     * consignee y prefiere NO compartir su número con plataforma —
     * solo quien quiere la experiencia "Uber-like" para su recipient
     * llena estos campos.
     */
    consignee: z
      .object({
        /** Nombre legible del destinatario. Para mostrar en saludo del template. */
        name: z.string().trim().min(1).max(100).optional(),
        /**
         * Phone E.164 (con +). Validamos formato pero NO carrier-side —
         * Twilio rechazará al envío si el número no tiene WhatsApp.
         */
        phone_e164: z
          .string()
          .regex(/^\+\d{8,15}$/, 'Debe estar en formato E.164 (+56912345678)')
          .optional(),
      })
      .optional(),
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
