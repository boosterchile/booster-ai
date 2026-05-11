import { z } from 'zod';

/**
 * Tipos canónicos del package @booster-ai/dte-provider (ADR-024).
 *
 * El package implementa adapter-pattern para emisión de Documentos
 * Tributarios Electrónicos (DTEs) en Chile, con expansión LATAM
 * pre-validada. Los tipos están en una capa neutral — cada adapter
 * (Sovos, Bsale, Mock, futuros) traduce hacia/desde su API específica.
 */

/**
 * Tipo de DTE según SII Chile (códigos oficiales del catálogo SII).
 *   - 33 = Factura Electrónica
 *   - 52 = Guía de Despacho Electrónica
 *   - 56 = Nota de Débito Electrónica
 *   - 61 = Nota de Crédito Electrónica
 *
 * Para v1 sólo soportamos 33 (factura comisión Booster al carrier) y
 * 52 (guía de despacho del carrier al generador). Los demás se agregan
 * cuando un flujo concreto los necesite.
 */
export const dteTipoSchema = z.union([z.literal(33), z.literal(52)]);
export type DteTipo = z.infer<typeof dteTipoSchema>;

/** RUT chileno formato `XX.XXX.XXX-X` o `XXXXXXXX-X`. Validación estricta. */
export const rutSchema = z
  .string()
  .regex(
    /^[0-9]{1,2}(\.[0-9]{3}){2}-[0-9Kk]$|^[0-9]{7,8}-[0-9Kk]$/,
    'RUT inválido (formato esperado: XX.XXX.XXX-X o XXXXXXXX-X)',
  );

/**
 * Detalle de un ítem en el DTE. Para v1 mantenemos el modelo simple
 * (descripción + monto). Sovos acepta más campos opcionales (unidad,
 * descuento por línea, etc.) que agregaremos cuando un caller los
 * necesite.
 */
export const itemSchema = z.object({
  descripcion: z.string().min(1).max(1000),
  /** Monto NETO en CLP (sin IVA). Entero positivo. */
  montoNetoClp: z.number().int().positive(),
  /** Si el ítem es exento de IVA (DL 825 Art. 12-E para operaciones financieras). */
  exento: z.boolean().default(false),
});
export type Item = z.infer<typeof itemSchema>;

/**
 * Input canónico para emitir Factura Electrónica (DTE 33).
 *
 * El monto bruto se calcula adapter-side a partir de los items + IVA
 * 19% sobre items no-exentos. Sovos devuelve el monto total que
 * registra en SII; debe coincidir con nuestra computación local
 * (cross-check defensivo).
 */
export const facturaInputSchema = z.object({
  emisor: z.object({
    rut: rutSchema,
    razonSocial: z.string().min(1).max(200),
    giro: z.string().min(1).max(80),
    direccion: z.string().min(1).max(200),
    comuna: z.string().min(1).max(60),
  }),
  receptor: z.object({
    rut: rutSchema,
    razonSocial: z.string().min(1).max(200),
    giro: z.string().min(1).max(80).optional(),
    direccion: z.string().min(1).max(200).optional(),
    comuna: z.string().min(1).max(60).optional(),
  }),
  /** Fecha de emisión en `YYYY-MM-DD` (zona Santiago). */
  fechaEmision: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z.array(itemSchema).min(1),
  /**
   * Referencia opcional a otro DTE (ej. nota crédito → factura
   * original). Sovos lo acepta como TpoDocRef + FolioRef.
   */
  referencia: z
    .object({
      tipoDoc: dteTipoSchema,
      folio: z.string().min(1),
    })
    .optional(),
});
export type FacturaInput = z.infer<typeof facturaInputSchema>;

/**
 * Input canónico para emitir Guía de Despacho Electrónica (DTE 52).
 *
 * Para Booster, emitido por el carrier al generador de carga por el
 * monto bruto del viaje. Ley 18.290 art. 1° y SII Resolución Exenta
 * 138/2003.
 */
export const guiaDespachoInputSchema = z.object({
  emisor: z.object({
    rut: rutSchema,
    razonSocial: z.string().min(1).max(200),
    giro: z.string().min(1).max(80),
    direccion: z.string().min(1).max(200),
    comuna: z.string().min(1).max(60),
  }),
  receptor: z.object({
    rut: rutSchema,
    razonSocial: z.string().min(1).max(200),
    direccion: z.string().min(1).max(200),
    comuna: z.string().min(1).max(60),
  }),
  fechaEmision: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  origen: z.object({
    direccion: z.string().min(1).max(200),
    comuna: z.string().min(1).max(60),
  }),
  destino: z.object({
    direccion: z.string().min(1).max(200),
    comuna: z.string().min(1).max(60),
  }),
  items: z.array(itemSchema).min(1),
  /** Patente del vehículo que transporta la carga. */
  patenteVehiculo: z.string().min(1).max(10),
});
export type GuiaDespachoInput = z.infer<typeof guiaDespachoInputSchema>;

/**
 * Resultado de una emisión exitosa. El folio es la fuente de verdad
 * para futuras consultas, anulaciones y reportes.
 */
export const dteResultSchema = z.object({
  /** Folio asignado por SII Chile vía el adapter. */
  folio: z.string().min(1),
  /** Tipo de DTE emitido (33, 52, etc.). */
  tipo: dteTipoSchema,
  /** RUT emisor (para queries posteriores). */
  rutEmisor: rutSchema,
  /** Timestamp de emisión en ISO 8601 UTC. */
  emitidoEn: z.string().datetime(),
  /** Monto total en CLP que registra SII (neto + IVA si aplica). */
  montoTotalClp: z.number().int().nonnegative(),
  /** URL al PDF firmado del DTE (cuando el adapter la expone). */
  pdfUrl: z.string().url().optional(),
  /** Track ID del provider para auditoría — opaque, no se parsea. */
  providerTrackId: z.string().optional(),
});
export type DteResult = z.infer<typeof dteResultSchema>;

/**
 * Status canónico de un DTE en SII. Mapeo agnóstico al provider.
 *   - aceptado    = SII ACEPTADO OK (terminal happy).
 *   - rechazado   = SII RECHAZADO (terminal, requiere reemisión).
 *   - reparable   = SII ACEPTADO CON REPAROS (operable, pero hay observaciones).
 *   - en_proceso  = SII no ha respondido aún (intermedio).
 *   - anulado     = nota crédito asociada totalizó el monto (terminal).
 */
export const dteStatusValueSchema = z.enum([
  'aceptado',
  'rechazado',
  'reparable',
  'en_proceso',
  'anulado',
]);
export type DteStatusValue = z.infer<typeof dteStatusValueSchema>;

export const dteStatusSchema = z.object({
  folio: z.string(),
  tipo: dteTipoSchema,
  rutEmisor: rutSchema,
  status: dteStatusValueSchema,
  /** Mensaje libre del provider (ej. razón de rechazo). */
  mensaje: z.string().optional(),
  /** Si está anulado: folio de la nota crédito que lo anuló. */
  folioAnulacion: z.string().optional(),
});
export type DteStatus = z.infer<typeof dteStatusSchema>;
