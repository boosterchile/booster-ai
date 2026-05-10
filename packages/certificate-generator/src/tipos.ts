/**
 * Tipos compartidos del certificate-generator.
 *
 * Diseño:
 *   - Las funciones de generación PDF + firma + upload son independientes
 *     y se componen en `emitirCertificado()`. Se pueden testear por
 *     separado (PDF sin firma, firma sin upload, etc.).
 *   - Los tipos de input son agnósticos al schema de Drizzle — el caller
 *     en apps/api mapea de `trips` + `tripMetrics` + `empresas` a estos.
 *     Sin esta indirección el package quedaría acoplado al schema y
 *     romper schema rompería el package.
 */

/**
 * Datos del viaje necesarios para imprimir el certificado. Subset de
 * `trips` mapeado por el caller.
 */
export interface DatosViajeCertificado {
  trackingCode: string;
  origenDireccion: string;
  origenRegionCode: string | null;
  destinoDireccion: string;
  destinoRegionCode: string | null;
  cargoTipo: string;
  cargoPesoKg: number | null;
  pickupAt: Date | null;
  deliveredAt: Date | null;
}

/**
 * Métricas de carbono ya calculadas. Subset de `tripMetrics`.
 *
 * Si `distanciaKmActual` o `kgco2eActual` están presentes, se usan ESOS
 * (precision exacto_canbus o modelado post-entrega). Si no, se usa el
 * estimado.
 */
export interface DatosMetricasCertificado {
  distanciaKmEstimated: number | null;
  distanciaKmActual: number | null;
  kgco2eWtwEstimated: number | null;
  kgco2eWtwActual: number | null;
  kgco2eTtw: number | null;
  kgco2eWtt: number | null;
  combustibleConsumido: number | null;
  combustibleUnidad: 'L' | 'm3' | 'kWh' | 'kg' | null;
  intensidadGco2ePorTonKm: number | null;
  precisionMethod: 'exacto_canbus' | 'modelado' | 'por_defecto';
  glecVersion: string;
  emissionFactorUsado: number;
  fuenteFactores: string;
  calculatedAt: Date;
  /**
   * ADR-028 — Origen del polyline real recorrido. Junto con
   * `precisionMethod` y `coveragePct` determina `certificationLevel`. Si
   * está ausente, el cert se renderiza con `precisionMethod` como única
   * señal (legacy path, backwards-compatible).
   */
  routeDataSource?: 'teltonika_gps' | 'maps_directions' | 'manual_declared';
  /**
   * ADR-028 — Fracción del trip cubierta por la fuente principal,
   * [0..100]. Si está ausente, no se imprime en el cert.
   */
  coveragePct?: number;
  /**
   * ADR-028 — Nivel de certificación derivado al cierre del trip. Si está
   * ausente, asumimos `primario_verificable` (legacy path); el cert sale
   * con header "CERTIFICADO". Cuando está presente:
   *   - `primario_verificable` → header "CERTIFICADO DE HUELLA DE CARBONO"
   *   - `secundario_modeled` o `secundario_default` → header "REPORTE
   *     ESTIMATIVO DE HUELLA DE CARBONO" + disclaimer prominente.
   */
  certificationLevel?: 'primario_verificable' | 'secundario_modeled' | 'secundario_default';
  /**
   * ADR-028 — Factor de incertidumbre publicado en el cert. Si está
   * presente y > 0, se imprime "X.XX ± Y.YY kg CO2e" junto al número
   * principal. Decimal en [0, 1].
   */
  uncertaintyFactor?: number;
}

/**
 * Datos de la empresa shipper que recibe el certificado.
 */
export interface DatosEmpresaCertificado {
  id: string;
  legalName: string;
  rut: string | null;
}

/**
 * Datos de la empresa transportista (assignment.empresa_id). Opcional
 * porque el certificado puede emitirse antes de tener assignment final
 * (ej. para preview).
 */
export interface DatosTransportistaCertificado {
  legalName: string | null;
  rut: string | null;
  vehiclePlate: string | null;
}

/**
 * Configuración del backend KMS / GCS para las funciones que hacen I/O.
 */
export interface ConfigInfra {
  /**
   * Resource ID completo de la KMS key (sin :versions). Ejemplo:
   *   projects/booster-ai-494222/locations/southamerica-west1/keyRings/booster-ai-keyring/cryptoKeys/certificate-carbono-signing
   *
   * El emisor pinea internamente la versión activa cuando llama a sign
   * (ver `firmar-pades.ts`); persistir la versión específica permite
   * validar después incluso si la key rota.
   */
  kmsKeyId: string;
  /**
   * Nombre del bucket GCS donde guardar el PDF firmado, el sidecar y el
   * cert X.509. Ejemplo: `booster-ai-documents`. El path se construye
   * internamente (`certificates/{empresaId}/{trackingCode}.pdf`, etc.).
   */
  certificatesBucket: string;
}

/**
 * Resultado de emitir un certificado. El caller persiste estos campos
 * en `tripMetrics`.
 */
export interface ResultadoEmisionCertificado {
  /** URL gs:// del PDF firmado embed. */
  pdfGcsUri: string;
  /** URL gs:// del sidecar `.sig` JSON. */
  sigGcsUri: string;
  /** SHA-256 hex (lowercase) del PDF firmado. */
  pdfSha256: string;
  /** Versión de KMS key usada (1, 2, 3, ...). Para validación. */
  kmsKeyVersion: string;
  /** Timestamp de emisión (cliente, no GCS). */
  issuedAt: Date;
  /** Tamaño del PDF firmado en bytes. */
  pdfBytes: number;
}

/**
 * Contenido del sidecar `.sig` (JSON serializado). Lo que un auditor
 * externo descarga junto con el PDF para verificar offline con OpenSSL.
 */
export interface SidecarFirma {
  trackingCode: string;
  signedAt: string; // ISO 8601
  algorithm: 'RSA_SIGN_PKCS1_4096_SHA256';
  kmsKeyId: string;
  kmsKeyVersion: string;
  pdfSha256: string;
  signatureB64: string;
  /** Cert X.509 PEM que respalda esta firma (incluye public key). */
  certPem: string;
  /**
   * URL pública del endpoint /verify (incluida para que el auditor pueda
   * validar online sin descargar nada).
   */
  verifyUrl: string;
}
