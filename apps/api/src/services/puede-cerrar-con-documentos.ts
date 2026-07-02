import type { ExtractionStatus } from '@booster-ai/shared-schemas';

/**
 * Regla de cierre flexible (frente F4, ADR-070, dominio crítico).
 *
 * Función PURA que decide si una orden de transporte (`viajes`) puede
 * transicionar a `entregado` según la política documental, aislada de la
 * orquestación de DB/transacciones para ser testeable sin red.
 *
 * Invariantes (spec §7 + §10):
 *   - `REQUIRE_DOCUMENT_TO_CLOSE=true` (default): la orden requiere ≥1
 *     documento **subido** (la fila existe), independiente del estado de
 *     extracción. Solo aplica a órdenes creadas en/después de la fecha de
 *     corte (`REQUIRE_DOCUMENT_TO_CLOSE_SINCE`). Las órdenes legacy/en-curso
 *     (creadas antes del corte) quedan EXENTAS — no se bloquea un viaje en
 *     ruta por falta de documento.
 *   - `REQUIRE_TED_DECODE=false` (default): el TED decodificado NO es
 *     condición de cierre. Un documento subido cuyo TED quedó `fallido` o
 *     `pendiente` igual permite cerrar. Con el override `=true`, se exige al
 *     menos un documento `decodificado`.
 *
 * No toca la tabla de transiciones de `trip-state-machine`: la legalidad
 * `asignado|en_proceso → entregado` no cambia; esto es una PRECONDICIÓN de
 * negocio adicional.
 */

export interface FlagsCierreDocumental {
  /** REQUIRE_DOCUMENT_TO_CLOSE. */
  requireDocumentToClose: boolean;
  /** REQUIRE_TED_DECODE. */
  requireTedDecode: boolean;
  /**
   * Fecha de corte (REQUIRE_DOCUMENT_TO_CLOSE_SINCE). El guard solo aplica a
   * órdenes con `creado_en >= esta fecha`. `null` => aplica a todas (sin
   * exención legacy) cuando el flag está ON.
   */
  requireDocumentSince: Date | null;
}

export interface DocumentoParaCierre {
  extractionStatus: ExtractionStatus;
}

export type RazonCierre =
  | 'flag_off'
  | 'orden_legacy_exenta'
  | 'documento_requerido'
  | 'ted_no_decodificado'
  | 'documento_presente';

export interface ResultadoCierreDocumental {
  puedeCerrar: boolean;
  razon: RazonCierre;
}

export function puedeCerrarConDocumentos(input: {
  flags: FlagsCierreDocumental;
  /** `viajes.creado_en` de la orden. */
  tripCreatedAt: Date;
  documentos: readonly DocumentoParaCierre[];
}): ResultadoCierreDocumental {
  const { flags, tripCreatedAt, documentos } = input;

  // Flag OFF → sin precondición documental.
  if (!flags.requireDocumentToClose) {
    return { puedeCerrar: true, razon: 'flag_off' };
  }

  // Exención legacy: órdenes creadas antes del corte no requieren documento.
  if (flags.requireDocumentSince !== null && tripCreatedAt < flags.requireDocumentSince) {
    return { puedeCerrar: true, razon: 'orden_legacy_exenta' };
  }

  // Requiere ≥1 documento subido (fila existe), cualquier estado de extracción.
  if (documentos.length === 0) {
    return { puedeCerrar: false, razon: 'documento_requerido' };
  }

  // REQUIRE_TED_DECODE=true → exige al menos un documento decodificado.
  if (flags.requireTedDecode) {
    const hayDecodificado = documentos.some((d) => d.extractionStatus === 'decodificado');
    if (!hayDecodificado) {
      return { puedeCerrar: false, razon: 'ted_no_decodificado' };
    }
  }

  return { puedeCerrar: true, razon: 'documento_presente' };
}
