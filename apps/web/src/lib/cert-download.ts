/**
 * Helper para descargar el certificado de huella de carbono de un viaje.
 *
 * Flujo:
 *   1. Llama a GET /trip-requests-v2/:id/certificate/download.
 *   2. El backend devuelve { download_url, expires_in_seconds, tracking_code }.
 *   3. Abrimos `download_url` en una nueva pestaña — el browser baja el PDF
 *      directo desde GCS (no proxiamos por el api).
 *
 * Por qué no usar window.location.href: el TTL de la signed URL es 5
 * minutos. Si el user clickea, hace algo, y vuelve atrás, el botón debería
 * seguir funcionando. Una pestaña nueva preserva el contexto del listado.
 *
 * Errores conocidos del endpoint:
 *   - 404 certificate_not_issued — el wire fire-and-forget aún no terminó
 *     o falló. UI debería mostrar "Generando certificado, intenta en unos
 *     segundos" en lugar de un error genérico.
 *   - 503 certificates_disabled — env vars KMS/GCS no inyectadas en el
 *     api (entorno dev). UI muestra "Certificados deshabilitados en este
 *     entorno".
 */

import { ApiError, api } from './api-client.js';

export interface CertDownloadResponse {
  download_url: string;
  expires_in_seconds: number;
  tracking_code: string;
}

export class CertNotIssuedError extends Error {
  constructor() {
    super('El certificado todavía no fue emitido');
    this.name = 'CertNotIssuedError';
  }
}

export class CertDisabledError extends Error {
  constructor() {
    super('Los certificados están deshabilitados en este entorno');
    this.name = 'CertDisabledError';
  }
}

/**
 * Descarga el certificado: pide la signed URL al api y la abre en una
 * pestaña nueva. Lanza CertNotIssuedError o CertDisabledError según el
 * caso para que el caller pueda mostrar UX específica.
 */
export async function descargarCertificadoDeViaje(tripId: string): Promise<void> {
  try {
    const res = await api.get<CertDownloadResponse>(
      `/trip-requests-v2/${tripId}/certificate/download`,
    );
    // window.open con target=_blank — la signed URL viene con
    // Content-Disposition: attachment, así que el browser dispara la
    // descarga sin abrir un PDF embebido.
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
