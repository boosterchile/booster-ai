/**
 * Schemas Zod del input para `generarCartaPorte`. Modelan la información
 * mínima requerida por la **Ley 18.290 del Tránsito (Art. 174)** para
 * Carta de Porte chilena.
 *
 * Diseño: el caller (típicamente apps/document-service) construye este
 * shape desde sus propios models de domain (Trip + Empresa + Vehicle +
 * Driver) y se lo pasa al generador. El package es agnóstico al schema
 * Drizzle — solo conoce este shape.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** RUT chileno con formato `XXXXXXXX-Y`. */
const rutSchema = z.string().regex(/^\d{1,8}-[0-9Kk]$/, {
  message: 'RUT debe tener formato XXXXXXXX-Y',
});

const patenteSchema = z
  .string()
  .min(6)
  .max(10)
  .regex(/^[A-Z0-9-]+$/i, { message: 'Patente solo letras, dígitos, guiones' });

// ---------------------------------------------------------------------------
// Sub-objects
// ---------------------------------------------------------------------------

export const empresaInfoSchema = z
  .object({
    rut: rutSchema,
    razonSocial: z.string().min(1).max(100),
    giro: z.string().min(1).max(80),
    direccion: z.string().min(1).max(200),
    comuna: z.string().min(1).max(60),
    telefono: z.string().min(1).max(20).optional(),
    email: z.string().email().max(100).optional(),
  })
  .strict();

export type EmpresaInfo = z.infer<typeof empresaInfoSchema>;

export const conductorInfoSchema = z
  .object({
    rut: rutSchema,
    nombreCompleto: z.string().min(1).max(100),
    /**
     * Número de licencia. Ley 18.290 exige Clase A para transporte
     * comercial; el campo acepta cualquier string para que el caller
     * persista lo que tenga disponible.
     */
    numeroLicencia: z.string().min(1).max(40),
    claseLicencia: z.enum(['A1', 'A2', 'A3', 'A4', 'A5', 'B', 'C', 'D', 'E', 'F']),
    fechaVencimientoLicencia: z.date().optional(),
  })
  .strict();

export type ConductorInfo = z.infer<typeof conductorInfoSchema>;

export const vehiculoInfoSchema = z
  .object({
    patente: patenteSchema,
    marca: z.string().min(1).max(40),
    modelo: z.string().min(1).max(40),
    anio: z
      .number()
      .int()
      .gte(1980)
      .lte(new Date().getFullYear() + 1),
    capacidadKg: z.number().positive(),
    /**
     * Tipo de vehículo según Ministerio de Transportes.
     * - `camion_simple`: 2-3 ejes, hasta ~10 toneladas
     * - `camion_pesado`: 3+ ejes, sobre 10 toneladas
     * - `tracto_camion`: chasis sin caja, tira semirremolque
     * - `furgon`: vehículo cerrado <3.5 toneladas
     * - `otro`: si no cuadra en los anteriores
     */
    tipoVehiculo: z.enum(['camion_simple', 'camion_pesado', 'tracto_camion', 'furgon', 'otro']),
  })
  .strict();

export type VehiculoInfo = z.infer<typeof vehiculoInfoSchema>;

export const ubicacionSchema = z
  .object({
    direccion: z.string().min(1).max(200),
    comuna: z.string().min(1).max(60),
    region: z.string().min(1).max(60),
    /**
     * Coordenadas opcionales. Si están, se incluyen como QR / metadata
     * para trazabilidad GPS — útil para auditorías ESG.
     */
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
  })
  .strict();

export type Ubicacion = z.infer<typeof ubicacionSchema>;

export const cargaInfoSchema = z
  .object({
    /**
     * Naturaleza de la carga (descripción legible). Ej. "Material de
     * construcción - cemento ensacado".
     */
    descripcion: z.string().min(1).max(300),
    pesoKg: z.number().positive(),
    /**
     * Cantidad de bultos/unidades. SII pide número entero para algunos
     * tipos; aquí lo dejamos number positive para flexibilidad.
     */
    cantidad: z.number().positive(),
    unidadMedida: z.string().min(1).max(20),
    /**
     * Tipo de carga según taxonomía interna Booster (matchea
     * `cargoTypeEnum` del schema). Útil para aggregation ESG.
     */
    tipoCarga: z
      .enum([
        'general',
        'frigorifica',
        'peligrosa',
        'frio',
        'liquidos',
        'graneles',
        'construccion',
        'agricola',
        'ganado',
        'otra',
      ])
      .default('general'),
    /**
     * Valor declarado en CLP (para seguro). Opcional.
     */
    valorDeclaradoClp: z.number().int().nonnegative().optional(),
  })
  .strict();

export type CargaInfo = z.infer<typeof cargaInfoSchema>;

// ---------------------------------------------------------------------------
// CartaPorteInput (top-level)
// ---------------------------------------------------------------------------

export const cartaPorteInputSchema = z
  .object({
    /**
     * Tracking code interno de Booster (ej. "BOO-XXXXXX"). Se incluye
     * en el QR del PDF para que un fiscalizador pueda escanear y verificar
     * online en https://app.boosterchile.com/v/{trackingCode}.
     */
    trackingCode: z.string().min(1).max(40),
    fechaEmision: z.date(),
    /** Fecha y hora prevista de salida. */
    fechaSalida: z.date(),
    /** Tiempo estimado en horas (opcional). */
    duracionEstimadaHoras: z.number().positive().max(96).optional(),
    /** Generador de la carga (shipper). Ley 18.290 lo llama "remitente". */
    remitente: empresaInfoSchema,
    /** Transportista que ejecuta el viaje. */
    transportista: empresaInfoSchema,
    conductor: conductorInfoSchema,
    vehiculo: vehiculoInfoSchema,
    origen: ubicacionSchema,
    destino: ubicacionSchema,
    cargas: z.array(cargaInfoSchema).min(1, {
      message: 'Carta de porte requiere al menos 1 carga',
    }),
    /**
     * Folio externo del DTE Guía de Despacho asociado, si ya fue emitido.
     * Se incluye como referencia cruzada SII ↔ Carta de Porte. Opcional
     * porque puede que la guía DTE se emita después.
     */
    folioGuiaDte: z.string().min(1).max(40).optional(),
    /**
     * Observaciones libres que el shipper o carrier quieran adjuntar
     * (instrucciones de entrega, restricciones de horario, etc.).
     */
    observaciones: z.string().max(2000).optional(),
  })
  .strict();

export type CartaPorteInput = z.infer<typeof cartaPorteInputSchema>;

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface CartaPorteResult {
  /** PDF binary (no firmado — la firma KMS la hace el caller). */
  pdfBuffer: Uint8Array;
  /** SHA-256 hex del PDF binary, para integrity check + storage indexing. */
  sha256: string;
  /**
   * Tamaño del PDF en bytes. Útil para logs + alertas si crece
   * sospechosamente (e.g. items duplicados).
   */
  sizeBytes: number;
}
