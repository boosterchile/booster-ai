import { rutSchema } from '@booster-ai/shared-schemas';
import { z } from 'zod';

/**
 * Tipos públicos del package. Modelan las entradas/salidas de un
 * proveedor DTE (Documento Tributario Electrónico) acreditado por SII
 * Chile, abstractos del provider concreto (Paperless, Bsale, etc.).
 *
 * Ver ADR-007 §"Integración SII DTE" + ADR-015 §"Implementación".
 */

export const dteTypeSchema = z.enum([
  'guia_despacho_52', // DTE Tipo 52 — Ley 19.983
  'factura_33', // DTE Tipo 33 — Factura Electrónica afecta
  'factura_34', // DTE Tipo 34 — Factura Electrónica exenta
]);

export type DteType = z.infer<typeof dteTypeSchema>;

/**
 * Item de detalle de un DTE. Cada DTE puede tener N items.
 * Las facturas tienen items de productos/servicios; las guías de
 * despacho tienen items que describen la mercadería transportada.
 */
export const dteLineItemSchema = z.object({
  /** Descripción del item. */
  nombre: z.string().min(1).max(200),
  cantidad: z.number().positive(),
  unidad: z.string().min(1).max(20),
  /** Precio unitario neto en CLP. */
  precioUnitarioClp: z.number().int().nonnegative(),
  /** Indicador de exento de IVA. */
  exento: z.boolean().default(false),
});

export type DteLineItem = z.infer<typeof dteLineItemSchema>;

/**
 * Datos del receptor del DTE. Para guía de despacho = consignatario;
 * para factura = comprador.
 */
export const dteReceptorSchema = z.object({
  rut: rutSchema,
  razonSocial: z.string().min(2).max(200),
  giro: z.string().min(2).max(80),
  direccion: z.string().min(5).max(300),
  comuna: z.string().min(2).max(100),
  region: z.string().min(2).max(100),
  email: z.string().email().optional(),
});

export type DteReceptor = z.infer<typeof dteReceptorSchema>;

/**
 * Input específico para Guía de Despacho. Incluye datos de transporte
 * que la factura no tiene (origen, destino, vehículo, conductor).
 */
export const guiaDespachoInputSchema = z.object({
  /** RUT del emisor (transportista o Booster como facturador). */
  rutEmisor: rutSchema,
  receptor: dteReceptorSchema,
  /** Detalle de la mercadería transportada. */
  items: z.array(dteLineItemSchema).min(1).max(60),
  /** Origen del transporte. */
  origen: z.object({
    direccion: z.string().min(5).max(300),
    comuna: z.string().min(2).max(100),
  }),
  /** Destino del transporte. */
  destino: z.object({
    direccion: z.string().min(5).max(300),
    comuna: z.string().min(2).max(100),
  }),
  /** Patente del vehículo que transporta. */
  patenteVehiculo: z.string().min(4).max(8),
  /** RUT del transportista (si distinto del emisor). */
  rutTransportista: rutSchema.optional(),
  /** RUT del conductor. */
  rutConductor: rutSchema,
  /** ID interno opcional para idempotencia (deduplica reintentos). */
  idempotencyKey: z.string().min(1).max(80).optional(),
  /** Fecha de emisión (ISO 8601). Default = now() del adapter. */
  fechaEmision: z.string().datetime().optional(),
  /**
   * Indicador de traslado de bienes (Tabla Indicador de Traslado del SII):
   * 1=operación constituye venta, 2=ventas por efectuar, 3=consignaciones,
   * 4=entrega gratuita, 5=traslados internos, 6=otros traslados no venta,
   * 7=guía de devolución, 8=traslado para exportación, 9=venta para
   * exportación.
   */
  indicadorTraslado: z.number().int().min(1).max(9).default(5),
});

export type GuiaDespachoInput = z.infer<typeof guiaDespachoInputSchema>;

export const facturaInputSchema = z.object({
  rutEmisor: rutSchema,
  /** 33 = afecta a IVA, 34 = exenta. */
  tipo: z.enum(['factura_33', 'factura_34']),
  receptor: dteReceptorSchema,
  items: z.array(dteLineItemSchema).min(1).max(60),
  /** Si la factura asocia un viaje (referencia interna Booster). */
  tripId: z.string().uuid().optional(),
  /** Folio de la guía de despacho que sustenta la factura (cuando aplica). */
  refFolioGuia: z.string().max(40).optional(),
  idempotencyKey: z.string().min(1).max(80).optional(),
  fechaEmision: z.string().datetime().optional(),
});

export type FacturaInput = z.infer<typeof facturaInputSchema>;

/**
 * Resultado de emitir un DTE: folio asignado por SII vía proveedor +
 * track_id para consultar status. El XML firmado y el PDF visual los
 * descarga el caller con `getXml(folio)` / `getPdf(folio)` en flujos
 * separados (lazy: muchas veces no hace falta el XML inmediatamente).
 */
export const dteResultSchema = z.object({
  folio: z.string().min(1).max(40),
  type: dteTypeSchema,
  rutEmisor: rutSchema,
  /** Timestamp en que el provider asignó el folio. */
  emittedAt: z.string().datetime(),
  /** ID interno del provider (Paperless trackId, etc) para queries posteriores. */
  providerRef: z.string().min(1).max(120),
  /** URL al PDF visual (signed, expira). */
  pdfUrl: z.string().url().optional(),
  /** URL al XML firmado (signed, expira). */
  xmlUrl: z.string().url().optional(),
  /** Estado SII al momento de respuesta. Asíncrono — usar queryStatus para refresh. */
  status: z.enum(['pendiente', 'aceptado', 'aceptado_con_reparos', 'rechazado']),
});

export type DteResult = z.infer<typeof dteResultSchema>;

export const dteStatusSchema = z.object({
  folio: z.string().min(1).max(40),
  status: z.enum(['pendiente', 'aceptado', 'aceptado_con_reparos', 'rechazado']),
  /** Mensaje del SII si rechazó (motivo). */
  siiMessage: z.string().optional(),
  /** Timestamp de la última actualización del estado. */
  updatedAt: z.string().datetime(),
});

export type DteStatus = z.infer<typeof dteStatusSchema>;

/**
 * Error semántico. Discriminamos error de validación SII (rechazo
 * legal — el DTE está mal formado o tiene datos inválidos para SII)
 * vs error de transporte (proveedor caído, timeout, auth fallida).
 */
export class DteValidationError extends Error {
  constructor(
    public readonly siiCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'DteValidationError';
  }
}

export class DteProviderError extends Error {
  constructor(
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = 'DteProviderError';
  }
}
