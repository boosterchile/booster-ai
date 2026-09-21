/**
 * Resultado del viaje para el conductor (Slot 3, paso 4 — solo lectura, D3).
 * Envuelve `GET /assignments/:id/resultado` y `GET /assignments/:id/certificate/download`,
 * los equivalentes acotados al conductor asignado de los endpoints del generador.
 */
import { ApiError, api } from '../lib/api-client.js';
import { CertDisabledError, CertNotIssuedError } from '../lib/cert-download.js';

export interface MetricasResultado {
  distance_km_estimated: string | null;
  distance_km_actual: string | null;
  carbon_emissions_kgco2e_estimated: string | null;
  carbon_emissions_kgco2e_actual: string | null;
  precision_method: 'exacto_canbus' | 'modelado' | 'por_defecto';
  glec_version: string;
  route_data_source: 'teltonika_gps' | 'maps_directions' | 'manual_declared' | 'movil_gps' | null;
  coverage_pct: string | null;
  certification_level: 'primario_verificable' | 'secundario_modeled' | 'secundario_default' | null;
  linea_metodo: string | null;
  certificate_pdf_url: string | null;
  certificate_sha256: string | null;
  certificate_kms_key_version: string | null;
  certificate_issued_at: string | null;
}

/**
 * Por qué el cierre guardó cobertura 0. No es el conteo de POST: es la regla
 * que dejó el porcentaje en cero (ADR-028 §5 / ADR-077, sin mezclar fuentes).
 */
export type MotivoCoberturaCero =
  | 'sin_puntos'
  | 'fuera_de_tramo'
  | 'sin_tramo_continuo'
  | 'sin_desplazamiento'
  | 'sin_telemetria_dispositivo'
  | 'medicion_no_cerrada';

export interface CoberturaExplicada {
  motivo: MotivoCoberturaCero | null;
  fuente: 'teltonika_gps' | 'movil_gps';
  puntos_telefono: number;
  puntos_en_tramo: number;
}

export interface ResultadoAsignacion {
  assignment: {
    id: string;
    status: string;
    picked_up_at: string | null;
    delivered_at: string | null;
  };
  trip: { id: string; tracking_code: string };
  metrics: MetricasResultado | null;
  /** Ausente en respuestas viejas. `null` si la cobertura persistida ya es > 0. */
  cobertura?: CoberturaExplicada | null;
  certificate: { issued_at: string | null; sha256: string | null; verify_url: string } | null;
}

export async function getResultadoAsignacion(assignmentId: string): Promise<ResultadoAsignacion> {
  return await api.get<ResultadoAsignacion>(`/assignments/${assignmentId}/resultado`);
}

interface CertDownloadResponse {
  download_url: string;
  expires_in_seconds: number;
  tracking_code: string;
}

/** Abre la signed URL del PDF (Content-Disposition: attachment → descarga). */
export async function descargarCertificadoDeAsignacion(assignmentId: string): Promise<void> {
  try {
    const res = await api.get<CertDownloadResponse>(
      `/assignments/${assignmentId}/certificate/download`,
    );
    window.open(res.download_url, '_blank', 'noopener');
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.code === 'certificate_not_issued') {
        throw new CertNotIssuedError();
      }
      if (err.code === 'certificates_disabled') {
        throw new CertDisabledError();
      }
    }
    throw err;
  }
}
