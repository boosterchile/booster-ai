/**
 * Invariantes cross-field de la configuración GCP (audit 2026-06-14 P0-D).
 *
 * Contexto: `apps/api/src/config.ts` tenía hardcodeados el project ID y el
 * billing account ID de producción como defaults Zod / fallbacks. Eso era
 * information disclosure y, peor, hacía que un entorno mal configurado cayera
 * silenciosamente a recursos de PRODUCCIÓN.
 *
 * Tras eliminar esos literales, estas invariantes garantizan que la env var
 * esté presente exactamente cuando un feature la necesita, fallando rápido en
 * el startup (parseEnv) en vez de apuntar a prod por accidente:
 *   - `GOOGLE_CLOUD_PROJECT` obligatorio en producción.
 *   - `GOOGLE_CLOUD_PROJECT` + `BILLING_EXPORT_TABLE` obligatorios cuando el
 *     dashboard de observabilidad está activo (los consulta para costos GCP).
 *
 * Función pura (testeable sin tocar process.env). `config.ts` la invoca desde
 * un `superRefine` y mapea cada mensaje a un issue de Zod.
 */
export interface GcpConfigInvariantInput {
  nodeEnv: string;
  observabilityDashboardActivated: boolean;
  googleCloudProject?: string | undefined;
  billingExportTable?: string | undefined;
}

/** String presente y no vacío (Cloud Run/Terraform a veces pasan ""). */
function isSet(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Devuelve la lista de violaciones de invariantes (vacía si la config es
 * válida). No lanza — el caller decide cómo reportar.
 */
export function checkGcpConfigInvariants(input: GcpConfigInvariantInput): string[] {
  const errors: string[] = [];
  const hasProject = isSet(input.googleCloudProject);

  if (input.nodeEnv === 'production' && !hasProject) {
    errors.push(
      'GOOGLE_CLOUD_PROJECT es obligatorio en producción (sin fallback a un proyecto hardcodeado)',
    );
  }

  if (input.observabilityDashboardActivated) {
    if (!hasProject) {
      errors.push(
        'GOOGLE_CLOUD_PROJECT es obligatorio cuando OBSERVABILITY_DASHBOARD_ACTIVATED=true',
      );
    }
    if (!isSet(input.billingExportTable)) {
      errors.push(
        'BILLING_EXPORT_TABLE es obligatorio cuando OBSERVABILITY_DASHBOARD_ACTIVATED=true',
      );
    }
  }

  return errors;
}
