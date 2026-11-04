import { z } from 'zod';

/**
 * Pago de un viaje bajo mandato de cobro (ADR-080 §2).
 *
 * Valores en español snake_case, alineados con los enums SQL `modo_flujo` y
 * `tipo_evento_pago` (`apps/api/src/db/schema.ts`). La máquina de estados
 * pura vive en `@booster-ai/factoring-engine` (`mandato-cobro.ts`).
 */

/** Régimen con que se pagó una liquidación (ADR-080 §5). */
export const modoFlujoSchema = z.enum(['conector', 'mandato_cobro']);
export type ModoFlujo = z.infer<typeof modoFlujoSchema>;

export const tipoEventoPagoSchema = z.enum([
  'recepcion_conforme',
  'cobro_registrado',
  'mora_registrada',
  'liberacion_booster',
  'anticipo_operador',
  'disputa_abierta',
  'disputa_resuelta',
]);
export type TipoEventoPagoDominio = z.infer<typeof tipoEventoPagoSchema>;

/** Eventos que registra el platform-admin desde la conciliación. */
export const tipoEventoAdminSchema = z.enum([
  'cobro_registrado',
  'liberacion_booster',
  'anticipo_operador',
  'disputa_resuelta',
]);
export type TipoEventoAdmin = z.infer<typeof tipoEventoAdminSchema>;

const CON_MONTO: ReadonlySet<TipoEventoAdmin> = new Set([
  'cobro_registrado',
  'liberacion_booster',
  'anticipo_operador',
]);

/**
 * Body de `POST /admin/mandato-cobro/:asignacionId/eventos`. La evidencia es
 * obligatoria: referencia del abono, de la transferencia, id del adelanto o
 * de la resolución.
 */
export const registrarEventoAdminSchema = z
  .object({
    tipo: tipoEventoAdminSchema,
    monto_clp: z.number().int().positive().optional(),
    evidencia_ref: z.string().trim().min(1).max(200),
    ocurrido_en: z.string().datetime({ offset: true }),
    detalle: z.string().trim().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (CON_MONTO.has(v.tipo) && v.monto_clp === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['monto_clp'],
        message: `monto_clp es obligatorio para ${v.tipo}`,
      });
    }
    if (!CON_MONTO.has(v.tipo) && v.monto_clp !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['monto_clp'],
        message: `${v.tipo} no lleva monto`,
      });
    }
  });
export type RegistrarEventoAdmin = z.infer<typeof registrarEventoAdminSchema>;

/** Body de `POST /trip-requests-v2/:id/disputa`: el generador objeta la recepción. */
export const abrirDisputaSchema = z.object({
  motivo: z.string().trim().min(10).max(500),
});
export type AbrirDisputa = z.infer<typeof abrirDisputaSchema>;
