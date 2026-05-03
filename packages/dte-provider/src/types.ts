/**
 * Schemas Zod + types para DTEs (SII Chile).
 *
 * Diseñados para que el código consumer (apps/document-service) valide
 * los inputs ANTES de enviar al provider externo y outputs ANTES de
 * persistir en BD. Todo input externo pasa por Zod (CLAUDE.md §7).
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * RUT chileno con formato `XXXXXXXX-Y` donde Y es DV (0-9 o K).
 * No validamos el dígito verificador acá — el provider lo hace.
 * Solo formato sintáctico.
 */
const rutSchema = z.string().regex(/^\d{1,8}-[0-9Kk]$/, {
  message: 'RUT debe tener formato XXXXXXXX-Y (Y=0-9 o K)',
});

/**
 * Patente chilena. Acepta formatos viejos (4 letras + 2 dígitos: AB-CD-12)
 * y nuevos (LL-LL-NN o LL-NN-NN). Lenient — el provider valida estricto.
 */
const patenteSchema = z
  .string()
  .min(6)
  .max(10)
  .regex(/^[A-Z0-9-]+$/i, {
    message: 'Patente solo letras, dígitos, guiones',
  });

const moneyClpSchema = z.number().int({ message: 'CLP es entero (no fracciones)' }).nonnegative();

// ---------------------------------------------------------------------------
// DteItem (línea de la guía/factura)
// ---------------------------------------------------------------------------

export const dteItemSchema = z
  .object({
    descripcion: z.string().min(1).max(1000),
    cantidad: z.number().positive(),
    precioUnitarioClp: moneyClpSchema,
    /**
     * Código SKU/interno del emisor. Opcional. Si se incluye, va en el XML
     * DTE como `<CdgItem>`.
     */
    codigoItem: z.string().max(35).optional(),
    /**
     * Unidad de medida (ej. "UN", "KG", "TON", "VIAJE", "M3"). Default "UN".
     * SII XML schema acepta hasta 10 chars en el campo `<UnmdItem>`.
     */
    unidadMedida: z.string().max(10).default('UN'),
  })
  .strict();

export type DteItem = z.infer<typeof dteItemSchema>;

// ---------------------------------------------------------------------------
// TransporteInfo (campos específicos de Guía de Despacho)
// ---------------------------------------------------------------------------

export const transporteInfoSchema = z
  .object({
    rutChofer: rutSchema,
    nombreChofer: z.string().min(1).max(100),
    patente: patenteSchema,
    /**
     * Dirección literal del destino. SII pide texto, no coordenadas.
     */
    direccionDestino: z.string().min(1).max(200),
    comunaDestino: z.string().min(1).max(60),
    /**
     * RUT del transportista si distinto del emisor (cuando Booster emite
     * en nombre del shipper pero el carrier es un tercero). Opcional.
     */
    rutTransportista: rutSchema.optional(),
  })
  .strict();

export type TransporteInfo = z.infer<typeof transporteInfoSchema>;

// ---------------------------------------------------------------------------
// GuiaDespachoInput (DTE 52)
// ---------------------------------------------------------------------------

export const guiaDespachoInputSchema = z
  .object({
    rutEmisor: rutSchema,
    razonSocialEmisor: z.string().min(1).max(100),
    rutReceptor: rutSchema,
    razonSocialReceptor: z.string().min(1).max(100),
    fechaEmision: z.date(),
    items: z.array(dteItemSchema).min(1, {
      message: 'Guía de despacho requiere al menos 1 item',
    }),
    transporte: transporteInfoSchema,
    /**
     * Folio externo del caller (ej. trackingCode `BOO-XXXXXX` del trip).
     * No es el folio SII — eso lo asigna SII al validar. Sirve para que
     * el caller correlacione su request con el resultado en logs.
     */
    referenciaExterna: z.string().min(1).max(40).optional(),
    /**
     * Tipo de despacho según SII:
     *   1 = "Operación constituye venta"
     *   2 = "Ventas por efectuar"
     *   3 = "Consignaciones"
     *   4 = "Entrega gratuita"
     *   5 = "Traslados internos"
     *   6 = "Otros traslados no venta"
     *   7 = "Guía de devolución"
     * Default 5 (traslados internos) para retornos vacíos típicos.
     */
    tipoDespacho: z
      .union([
        z.literal(1),
        z.literal(2),
        z.literal(3),
        z.literal(4),
        z.literal(5),
        z.literal(6),
        z.literal(7),
      ])
      .default(5),
  })
  .strict();

export type GuiaDespachoInput = z.infer<typeof guiaDespachoInputSchema>;

// ---------------------------------------------------------------------------
// FacturaInput (DTE 33 afecta IVA, DTE 34 exenta)
// ---------------------------------------------------------------------------

export const facturaInputSchema = z
  .object({
    tipoDte: z.union([z.literal(33), z.literal(34)]),
    rutEmisor: rutSchema,
    razonSocialEmisor: z.string().min(1).max(100),
    giroEmisor: z.string().min(1).max(80),
    rutReceptor: rutSchema,
    razonSocialReceptor: z.string().min(1).max(100),
    giroReceptor: z.string().min(1).max(80),
    fechaEmision: z.date(),
    items: z.array(dteItemSchema).min(1),
    /**
     * Referencia opcional a una Guía de Despacho ya emitida (folio SII).
     * Cuando facturamos un viaje ya despachado, el SII pide vincular la
     * factura a la guía vía referencia con tipo "DTE 52".
     */
    referenciaGuia: z
      .object({
        folio: z.string(),
        fechaEmision: z.date(),
      })
      .optional(),
    referenciaExterna: z.string().min(1).max(40).optional(),
  })
  .strict();

export type FacturaInput = z.infer<typeof facturaInputSchema>;

// ---------------------------------------------------------------------------
// DteResult (output del emit)
// ---------------------------------------------------------------------------

export const dteResultSchema = z
  .object({
    /** Folio asignado por SII (único por (rutEmisor, tipoDte)). */
    folio: z.string().min(1),
    /** Tipo DTE del documento emitido (52=Guía, 33=Factura afecta, 34=exenta). */
    tipoDte: z.union([z.literal(33), z.literal(34), z.literal(52)]),
    rutEmisor: rutSchema,
    fechaEmision: z.date(),
    /** XML firmado del DTE — para archivo legal 6 años. */
    xmlSigned: z.string().min(1),
    /** SHA-256 del XML para integrity check post-storage. */
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    /** PDF visual del documento — para humanos. */
    pdfBase64: z.string().min(1).optional(),
    /** Track ID interno del provider (para queryStatus posterior). */
    providerTrackId: z.string().min(1).optional(),
    /** Estado inicial del DTE post-emisión. */
    status: z.enum(['accepted', 'pending_sii_validation', 'rejected']),
  })
  .strict();

export type DteResult = z.infer<typeof dteResultSchema>;

// ---------------------------------------------------------------------------
// DteStatus (output de queryStatus)
// ---------------------------------------------------------------------------

export const dteStatusSchema = z
  .object({
    folio: z.string(),
    tipoDte: z.union([z.literal(33), z.literal(34), z.literal(52)]),
    rutEmisor: rutSchema,
    /**
     * - `accepted`: SII validó. Documento legalmente válido.
     * - `pending_sii_validation`: enviado, esperando respuesta SII (puede
     *   tomar minutos a horas en producción real).
     * - `rejected`: SII rechazó (errores en el XML, RUT inválido, etc.).
     * - `cancelled`: anulado posteriormente (DTE de anulación emitido).
     */
    status: z.enum(['accepted', 'pending_sii_validation', 'rejected', 'cancelled']),
    /** Si `rejected`, descripción del motivo. */
    rejectionReason: z.string().optional(),
    lastCheckedAt: z.date(),
  })
  .strict();

export type DteStatus = z.infer<typeof dteStatusSchema>;

/**
 * Environment de SII al que apunta el provider.
 * - `certification`: ambiente de pruebas (folios no oficiales). Usar
 *   durante desarrollo + onboarding.
 * - `production`: SII real, folios oficiales con valor legal.
 */
export type DteEnvironment = 'certification' | 'production';

// ---------------------------------------------------------------------------
// DteProvider interface
// ---------------------------------------------------------------------------

/**
 * Contrato de cualquier adapter de DTE. Implementaciones esperadas:
 *
 * - `MockDteProvider` — para tests + dev local. Incluida en este package.
 * - `BsaleAdapter` — provider recomendado en ADR-007. **Pendiente**.
 * - `PaperlessAdapter` — alternativa. **Pendiente**.
 *
 * Los adapters reales hacen HTTP calls al provider, manejan auth (API
 * keys + certificate), serializan a XML SII, y traducen los errores del
 * provider a las clases tipadas de `errors.ts`.
 */
export interface DteProvider {
  /**
   * Indica el environment SII al que apunta este provider. El caller
   * típicamente no lo necesita en runtime, pero sirve para logs y para
   * diferenciar dev vs prod en alertas.
   */
  readonly environment: DteEnvironment;

  /**
   * Emite una Guía de Despacho Electrónica (DTE Tipo 52). Ley 19.983.
   *
   * Flow esperado:
   *   1. Validar input con `guiaDespachoInputSchema` (caller debería pre-validar).
   *   2. Construir XML DTE según schema SII.
   *   3. Firmar con certificado del emisor.
   *   4. Enviar al SII (vía provider). Recibir folio.
   *   5. Generar PDF visual (opcional pero recomendado).
   *   6. Retornar `DteResult` con folio + xmlSigned + sha256.
   *
   * @throws {DteValidationError} si el input no pasa schema.
   * @throws {DteRejectedBySiiError} si SII rechaza (formato, RUT, etc.).
   * @throws {DteCertificateError} si el certificado del emisor falla.
   * @throws {DteProviderUnavailableError} si el provider está down.
   */
  emitGuiaDespacho(input: GuiaDespachoInput): Promise<DteResult>;

  /**
   * Emite una Factura Electrónica (DTE Tipo 33 afecta IVA o 34 exenta).
   * Ley 20.727.
   */
  emitFactura(input: FacturaInput): Promise<DteResult>;

  /**
   * Consulta el estado actual del DTE en SII (post-emisión, los DTEs
   * pueden tomar minutos a horas en aceptarse formalmente).
   *
   * @throws {DteNotFoundError} si el folio no existe para ese RUT/tipo.
   */
  queryStatus(args: {
    folio: string;
    rutEmisor: string;
    tipoDte: 33 | 34 | 52;
  }): Promise<DteStatus>;
}
