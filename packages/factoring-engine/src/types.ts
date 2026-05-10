/**
 * Tipos puros del modelo de factoring v1 (ADR-029 + ADR-032).
 */

export interface CalcularTarifaInput {
  /** Monto neto al carrier post-comisión Booster, en CLP integer. */
  montoNetoClp: number;
  /** Plazo de pago del shipper en días corridos. */
  plazoDiasShipper: number;
}

export interface CalcularTarifaOutput {
  montoNetoClp: number;
  plazoDiasShipper: number;
  /** Tarifa aplicada en porcentaje (ej. 1.5, 3.0). */
  tarifaPct: number;
  /** Tarifa en CLP integer. = round(montoNeto * tarifaPct / 100). */
  tarifaClp: number;
  /** Monto que el carrier recibe hoy. = montoNeto - tarifa. */
  montoAdelantadoClp: number;
  /** Versión semver de la metodología (auditoría). */
  factoringMethodologyVersion: string;
}

export interface EvaluarShipperInput {
  /** Score Equifax/Dicom/Sentinel (0-1000 según Equifax CL). */
  equifaxScore: number | null;
  /** RUT activo en SII (verificable via SII Webservices). */
  rutActivo: boolean;
  /** Antigüedad operacional en meses. */
  antiguedadMeses: number;
  /** Morosidad reportada en últimos 12 meses (booleano agregado). */
  morosidadUltimo12m: boolean;
  /**
   * Total CLP que Booster ya tiene adelantado a otros carriers para
   * trips de este shipper, NO COBRADO todavía. Threshold para no
   * concentrar exposición.
   */
  exposicionActualClp: number;
}

export interface EvaluarShipperOutput {
  approved: boolean;
  /** Límite revolving máximo simultaneo no-cobrado para este shipper. */
  limitExposureClp: number;
  /** Razón legible si approved=false; null si approved=true. */
  motivo: string | null;
  /** Cuándo expira esta decisión (default 30 días). */
  expiresAt: Date;
  /** Indica si la decisión es por auto-reglas o requiere revisión manual. */
  decidedBy: 'automatico' | 'manual_requerido';
}

export interface EvaluarShipperParams {
  input: EvaluarShipperInput;
  /** epoch ms del "hoy" — inyectable para tests deterministas. */
  hoyMs: number;
  /** Días de validez de la decisión. Default 30. */
  validezDias?: number;
}
