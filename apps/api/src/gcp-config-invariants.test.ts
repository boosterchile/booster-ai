import { describe, expect, it } from 'vitest';
import { checkGcpConfigInvariants } from './gcp-config-invariants.js';

/**
 * Invariantes cross-field de config GCP (audit 2026-06-14 P0-D): tras eliminar
 * los IDs de producción hardcodeados, estos chequeos garantizan que cuando un
 * feature realmente necesita el project/billing, la env var esté presente —
 * en vez de caer silenciosamente a un literal de prod.
 */
describe('checkGcpConfigInvariants', () => {
  it('dev mínimo sin GCP vars: válido (sin errores)', () => {
    expect(
      checkGcpConfigInvariants({
        nodeEnv: 'development',
        observabilityDashboardActivated: false,
      }),
    ).toEqual([]);
  });

  it('producción sin GOOGLE_CLOUD_PROJECT: error', () => {
    const errors = checkGcpConfigInvariants({
      nodeEnv: 'production',
      observabilityDashboardActivated: false,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('GOOGLE_CLOUD_PROJECT');
  });

  it('producción con GOOGLE_CLOUD_PROJECT y dashboard off: válido', () => {
    expect(
      checkGcpConfigInvariants({
        nodeEnv: 'production',
        observabilityDashboardActivated: false,
        googleCloudProject: 'booster-ai-prod',
      }),
    ).toEqual([]);
  });

  it('dashboard activo sin BILLING_EXPORT_TABLE: error', () => {
    const errors = checkGcpConfigInvariants({
      nodeEnv: 'development',
      observabilityDashboardActivated: true,
      googleCloudProject: 'booster-ai-prod',
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('BILLING_EXPORT_TABLE');
  });

  it('dashboard activo sin GOOGLE_CLOUD_PROJECT ni BILLING: dos errores', () => {
    const errors = checkGcpConfigInvariants({
      nodeEnv: 'development',
      observabilityDashboardActivated: true,
    });
    expect(errors).toHaveLength(2);
    expect(errors.some((e) => e.includes('GOOGLE_CLOUD_PROJECT'))).toBe(true);
    expect(errors.some((e) => e.includes('BILLING_EXPORT_TABLE'))).toBe(true);
  });

  it('dashboard activo con ambas vars presentes: válido', () => {
    expect(
      checkGcpConfigInvariants({
        nodeEnv: 'production',
        observabilityDashboardActivated: true,
        googleCloudProject: 'booster-ai-prod',
        billingExportTable: 'proj.dataset.tabla',
      }),
    ).toEqual([]);
  });

  it('trata string vacío como ausente (Cloud Run/Terraform pasan "")', () => {
    const errors = checkGcpConfigInvariants({
      nodeEnv: 'production',
      observabilityDashboardActivated: false,
      googleCloudProject: '',
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('GOOGLE_CLOUD_PROJECT');
  });
});
