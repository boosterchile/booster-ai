import { z } from 'zod';
import {
  NOTAS_MAX,
  REFERENCIA_MAX,
  cargoDescriptionSchema,
  cargoVolumeM3Schema,
  cargoWeightKgSchema,
  consigneeSchema,
  lugarSchema,
  pickupWindowSchema,
} from '../trip-request-create.js';
import { cargoTypeSchema } from './cargo-request.js';

/**
 * Edición de una carga (spec editar-anular-cargas §5–6). La regla de qué se
 * edita en qué estado es `clasificarEdicion` (@booster-ai/trip-state-machine);
 * acá viven los bodies y los payloads de eventos, validados con Zod al
 * escribir y al leer.
 */

/** Texto libre editable: sin espacios; vacío o null borran el campo. */
function textoEditable(max: number) {
  return z
    .string()
    .trim()
    .max(max, `Hasta ${max} caracteres`)
    .nullable()
    .transform((v) => (v ? v : null));
}

/**
 * Body de `PATCH /trip-requests-v2/:id/datos-libres`. Solo los campos que el
 * generador edita sin aceptación del transportista (§12-P4); `.strict()` para
 * que un campo material no se cuele por esta ruta.
 */
export const datosLibresInputSchema = z
  .object({
    consignee: consigneeSchema.nullable().optional(),
    notes: textoEditable(NOTAS_MAX).optional(),
    reference: textoEditable(REFERENCIA_MAX).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Indica al menos un campo para actualizar',
  });

export type DatosLibresInput = z.infer<typeof datosLibresInputSchema>;

const CAMPOS_LIBRES_SCHEMA = z.enum(['consignee', 'notes', 'reference']);

/**
 * Campos que el generador puede proponer después del match en esta versión.
 * Precio y modalidad (`CAMPOS_COMERCIALES`) se suman cuando exista su
 * recálculo (PR8); hasta entonces `.strict()` los rechaza.
 */
export const CAMPOS_PROPONIBLES = [
  'origin',
  'destination',
  'cargo_type',
  'weight_kg',
  'volume_m3',
  'description',
  'pickup_window',
] as const;

export type CampoPropuesto = (typeof CAMPOS_PROPONIBLES)[number];

const CAMPO_PROPUESTO_SCHEMA = z.enum(CAMPOS_PROPONIBLES);

function alMenosUnCampo(v: object): boolean {
  return Object.keys(v).length > 0;
}

/**
 * Body de `POST /trip-requests-v2/:id/solicitudes-cambio` (§6.3). Solo los
 * campos propuestos; reutiliza las reglas de creación, incluida la ventana
 * de recogida futura.
 */
export const cambioPropuestoSchema = z
  .object({
    origin: lugarSchema.optional(),
    destination: lugarSchema.optional(),
    cargo_type: cargoTypeSchema.optional(),
    weight_kg: cargoWeightKgSchema.optional(),
    volume_m3: cargoVolumeM3Schema.nullable().optional(),
    description: cargoDescriptionSchema.nullable().optional(),
    pickup_window: pickupWindowSchema.optional(),
  })
  .strict()
  .refine(alMenosUnCampo, { message: 'Indica al menos un campo para cambiar' });

export type CambioPropuesto = z.infer<typeof cambioPropuestoSchema>;

const lugarGuardadoSchema = z.object({
  address_raw: z.string(),
  region_code: z.string().nullable(),
  comuna_code: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
});

/**
 * Lectura de `solicitudes_cambio_viaje.cambios` y `valores_anteriores`. Sin
 * las reglas que dependen del momento (una ventana ya pasada sigue siendo un
 * valor válido para mostrar) ni las de formato de entrada.
 */
export const cambiosGuardadosSchema = z
  .object({
    origin: lugarGuardadoSchema.partial({ comuna_code: true, latitude: true, longitude: true }),
    destination: lugarGuardadoSchema.partial({
      comuna_code: true,
      latitude: true,
      longitude: true,
    }),
    cargo_type: cargoTypeSchema,
    // Nulos solo en cargas antiguas (intake por WhatsApp); una propuesta nunca los trae.
    weight_kg: z.number().nullable(),
    volume_m3: z.number().nullable(),
    description: z.string().nullable(),
    pickup_window: z.object({ start_at: z.string(), end_at: z.string() }).nullable(),
  })
  .partial()
  .strict();

export type CambiosGuardados = z.infer<typeof cambiosGuardadosSchema>;

/** Payload del evento `cambio_solicitado`. */
export const cambioSolicitadoPayloadSchema = z.object({
  solicitud_id: z.string().uuid(),
  campos: z.array(CAMPO_PROPUESTO_SCHEMA).min(1),
});

export type CambioSolicitadoPayload = z.infer<typeof cambioSolicitadoPayloadSchema>;

export const MOTIVOS_INVALIDACION = [
  'viaje_cancelado',
  'datos_cambiaron',
  'viaje_no_asignado',
] as const;

export type MotivoInvalidacion = (typeof MOTIVOS_INVALIDACION)[number];

/** Payload del evento `cambio_respondido`. `invalidado` exige el motivo. */
export const cambioRespondidoPayloadSchema = z.discriminatedUnion('resultado', [
  z.object({
    solicitud_id: z.string().uuid(),
    resultado: z.enum(['aceptado', 'rechazado', 'retirado']),
  }),
  z.object({
    solicitud_id: z.string().uuid(),
    resultado: z.literal('invalidado'),
    motivo_invalidacion: z.enum(MOTIVOS_INVALIDACION),
  }),
]);

export type CambioRespondidoPayload = z.infer<typeof cambioRespondidoPayloadSchema>;

/**
 * Payload del evento `carga_editada` en modo `libre`. Lleva solo los nombres
 * de los campos: el destinatario y las notas pueden tener datos personales, y
 * `eventos_viaje` es append-only.
 */
export const cargaEditadaPayloadSchema = z.discriminatedUnion('modo', [
  z.object({
    modo: z.literal('libre'),
    campos: z.array(CAMPOS_LIBRES_SCHEMA).min(1),
  }),
  /** El transportista aceptó una solicitud: valores antes y después de esos campos. */
  z.object({
    modo: z.literal('cambio_aceptado'),
    solicitud_id: z.string().uuid(),
    campos: z.array(CAMPO_PROPUESTO_SCHEMA).min(1),
    antes: cambiosGuardadosSchema,
    despues: cambiosGuardadosSchema,
  }),
]);

export type CargaEditadaPayload = z.infer<typeof cargaEditadaPayloadSchema>;
