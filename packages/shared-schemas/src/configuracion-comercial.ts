import { z } from 'zod';

/**
 * Configuración comercial en runtime (ADR-079 §3): tasas de comisión por
 * modalidad de carga, precios de servicios en UF, parámetros de
 * financiamiento e impuestos. Vive en la tabla versionada
 * `configuracion_comercial` (espejo de `configuracion_sitio`, ADR-039) y la
 * edita el platform-admin. Claves en snake_case: es el JSON persistido.
 *
 * Los valores NUNCA vienen de env, Terraform ni código: la migración 0059
 * siembra la versión 1 con `CONFIGURACION_COMERCIAL_INICIAL` y desde ahí
 * manda la tabla.
 */

/** Porcentaje 0–100 con a lo más dos decimales. */
const porcentaje = z
  .number()
  .min(0)
  .max(100)
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-9, {
    message: 'a lo más dos decimales',
  });

/** Precio en UF, positivo, a lo más cuatro decimales. */
const uf = z
  .number()
  .positive()
  .refine((v) => Math.abs(Math.round(v * 10_000) - v * 10_000) < 1e-6, {
    message: 'a lo más cuatro decimales',
  });

export const comisionesSchema = z
  .object({
    spot_pct: porcentaje,
    programada_pct: porcentaje,
    retorno_programada_pct: porcentaje.optional(),
  })
  .strict()
  // Invariante contractual de ADR-079 §2: cambiarla exige ADR nuevo.
  .refine((c) => c.spot_pct > c.programada_pct, {
    message: 'spot_pct debe ser mayor que programada_pct (ADR-079 §2)',
    path: ['spot_pct'],
  })
  .refine(
    (c) =>
      c.retorno_programada_pct === undefined ||
      (c.retorno_programada_pct >= c.programada_pct && c.retorno_programada_pct <= c.spot_pct),
    {
      message: 'retorno_programada_pct debe quedar entre programada_pct y spot_pct (ADR-079 §2)',
      path: ['retorno_programada_pct'],
    },
  );

/**
 * Servicios recurrentes y huella (ADR-079 §4). Es también la proyección
 * pública que muestra la página de precios (T10-29): `.strict()` impide que
 * se le cuele una clave de comisión.
 */
export const serviciosPublicosSchema = z
  .object({
    suscripcion_transportista_uf_camion_mes: uf,
    suscripcion_transportista_gestion_flota_uf_camion_mes: uf,
    suscripcion_generador_uf_empresa_mes: uf,
    camiones_sin_cobro_por_transportista: z.number().int().min(0),
    huella_carbono: z
      .object({
        modalidad: z.literal('por_proyecto'),
        precio_referencia_uf: uf.optional(),
      })
      .strict(),
  })
  .strict();

export const financiamientoSchema = z
  .object({
    /** Originación sobre el monto anticipado (ADR-079 Contexto punto 5; semántica en ADR-080). */
    originacion_pct: z.number().min(0.3).max(0.5),
    anticipo_documento_pct: porcentaje,
    plazo_pago_generador_dias: z.number().int().positive(),
    plazo_liberacion_transportista_dias: z.number().int().min(0),
  })
  .strict();

export const configuracionComercialSchema = z
  .object({
    comisiones: comisionesSchema,
    servicios: serviciosPublicosSchema,
    financiamiento: financiamientoSchema,
    impuestos: z.object({ iva_pct: porcentaje }).strict(),
  })
  .strict();

export type ConfiguracionComercial = z.infer<typeof configuracionComercialSchema>;
export type ServiciosPublicos = z.infer<typeof serviciosPublicosSchema>;

/** Valores iniciales de ADR-079 §2–§4 (seed de la versión 1 publicada). */
export const CONFIGURACION_COMERCIAL_INICIAL: ConfiguracionComercial = {
  comisiones: { spot_pct: 20, programada_pct: 10, retorno_programada_pct: 12 },
  servicios: {
    suscripcion_transportista_uf_camion_mes: 1,
    suscripcion_transportista_gestion_flota_uf_camion_mes: 1.5,
    suscripcion_generador_uf_empresa_mes: 1,
    camiones_sin_cobro_por_transportista: 1,
    huella_carbono: { modalidad: 'por_proyecto' },
  },
  financiamiento: {
    originacion_pct: 0.4,
    anticipo_documento_pct: 90,
    plazo_pago_generador_dias: 30,
    plazo_liberacion_transportista_dias: 5,
  },
  impuestos: { iva_pct: 19 },
};

/**
 * ADR-079 §5 — claves que NUNCA llegan a transportista ni conductor (API,
 * bot, notificaciones). El guard de visibilidad del api y su test de
 * contrato usan esta lista.
 */
export const CLAVES_PRIVADAS_GENERADOR = [
  'comision_pct',
  'comision_clp',
  'iva_comision_clp',
  'precio_generador_clp',
  'total_factura_generador_clp',
  'comision_pct_aplicada',
] as const;
