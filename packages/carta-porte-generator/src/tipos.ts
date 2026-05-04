import { rutSchema } from '@booster-ai/shared-schemas';
import { z } from 'zod';

/**
 * Tipos de input para emitir una Carta de Porte. Reflejan los datos
 * exigidos por la Ley 18.290 Art. 174 (transporte de carga por carretera
 * en Chile). Validados con Zod en el orchestrator antes de generar el
 * PDF — preferimos fallar temprano (en API boundary) que generar un
 * documento con campos faltantes.
 *
 * Naming bilingüe: TS camelCase, valores legales en español. Los
 * subjects (porteador/cargador/consignatario/conductor) tienen el mismo
 * shape — usamos un schema base `personaSchema`.
 */

const personaSchema = z.object({
  nombre: z.string().min(2).max(200),
  rut: rutSchema,
  direccion: z.string().min(5).max(300),
  comuna: z.string().min(2).max(100),
  region: z.string().min(2).max(100),
  /** Opcional. Email de contacto. */
  email: z.string().email().optional(),
  /** Opcional. Teléfono de contacto. */
  telefono: z.string().max(30).optional(),
});

export const cartaPorteInputSchema = z.object({
  /**
   * Folio interno de Booster (no SII — la carta de porte no requiere
   * folio del SII). Único globalmente; típicamente `cp-{trip_id}`.
   */
  folio: z.string().min(1).max(40),
  /** ISO 8601. Fecha de emisión. */
  emittedAt: z.string().datetime(),

  /** Porteador = transportista que ejecuta el viaje. */
  porteador: personaSchema,

  /** Cargador = generador de carga (shipper). */
  cargador: personaSchema,

  /** Consignatario = receptor de la carga. Si es el mismo cargador, repetir. */
  consignatario: personaSchema,

  /** Origen del transporte. */
  origen: z.object({
    direccion: z.string().min(5).max(300),
    comuna: z.string().min(2).max(100),
    region: z.string().min(2).max(100),
  }),

  /** Destino del transporte. */
  destino: z.object({
    direccion: z.string().min(5).max(300),
    comuna: z.string().min(2).max(100),
    region: z.string().min(2).max(100),
  }),

  /** Características de la carga (Art. 174 §"naturaleza, cantidad, peso..."). */
  carga: z.object({
    naturaleza: z.string().min(2).max(200),
    /** Cantidad numérica. Unit en `unidad`. */
    cantidad: z.number().positive(),
    unidad: z.string().min(1).max(20),
    /** Peso bruto en kg. */
    pesoKg: z.number().positive(),
    /** Volumen en m³. Opcional (no aplica para carga seca por ej). */
    volumenM3: z.number().positive().optional(),
    embalaje: z.string().min(1).max(100),
    /** Observaciones operacionales (refrigeración requerida, frágil, etc). */
    observaciones: z.string().max(500).optional(),
  }),

  /** Vehículo asignado al transporte. */
  vehiculo: z.object({
    /** Patente. Format: AB1234 (Chile). */
    patente: z.string().min(4).max(8),
    tipo: z.string().min(2).max(50),
    /** Año-modelo. */
    anioModelo: z.number().int().min(1980).max(2100).optional(),
    color: z.string().max(30).optional(),
  }),

  /** Conductor (driver). */
  conductor: z.object({
    nombre: z.string().min(2).max(200),
    rut: rutSchema,
    /** Número de licencia profesional Clase A2/A3/A4/A5. */
    licenciaNumero: z.string().min(3).max(40),
    licenciaClase: z.string().min(1).max(10),
  }),

  /**
   * Precio acordado del flete en CLP (con IVA). Va en la carta de
   * porte como referencia comercial; no es obligatorio por Ley 18.290
   * pero sí buena práctica.
   */
  precioFleteClp: z.number().int().positive().optional(),

  /** URL al endpoint de verificación + QR del PDF. */
  verifyUrl: z.string().url().optional(),
});

export type CartaPorteInput = z.infer<typeof cartaPorteInputSchema>;

/**
 * Resultado de emitir una carta de porte. El caller decide qué hacer
 * con los bytes (típicamente persistir vía `@booster-ai/document-indexer`
 * con type='carta_porte' y retention 6 años).
 */
export interface ResultadoEmisionCartaPorte {
  /** PDF firmado con PAdES embebido. */
  pdfFirmado: Buffer;
  /** SHA-256 hex (lowercase) del PDF firmado completo. */
  pdfSha256: string;
  /** Versión de la KMS key usada para firmar. */
  kmsKeyVersion: string;
  /** Timestamp de la firma (signing time del PKCS7). */
  signingTime: Date;
  /** Folio Booster usado en el PDF. */
  folio: string;
}

/**
 * Config de infra para la emisión: bucket no aplica acá (el caller
 * persiste con document-indexer), pero sí los IDs de KMS para firmar.
 */
export interface ConfigInfra {
  /** Resource ID de la KMS key. */
  kmsKeyId: string;
  /** Bucket de certificados (donde vive el cert X.509 self-signed compartido). */
  certBucket: string;
}
