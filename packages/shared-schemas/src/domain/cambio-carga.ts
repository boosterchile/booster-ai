import { z } from 'zod';
import { NOTAS_MAX, REFERENCIA_MAX, consigneeSchema } from '../trip-request-create.js';

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
 * Payload del evento `carga_editada` en modo `libre`. Lleva solo los nombres
 * de los campos: el destinatario y las notas pueden tener datos personales, y
 * `eventos_viaje` es append-only.
 */
export const cargaEditadaPayloadSchema = z.discriminatedUnion('modo', [
  z.object({
    modo: z.literal('libre'),
    campos: z.array(CAMPOS_LIBRES_SCHEMA).min(1),
  }),
]);

export type CargaEditadaPayload = z.infer<typeof cargaEditadaPayloadSchema>;
