import type { Logger } from '@booster-ai/logger';
import { describe, expect, it, vi } from 'vitest';
import { buildObservabilityServices } from '../../../src/services/observability/factory.js';

/**
 * Tests del `buildObservabilityServices` factory. Verifica que:
 * - Servicios siempre construidos: cache + fx + costs + monitoring +
 *   forecast + health + workspace.
 * - `twilioUsageService` es null si faltan creds (graceful degradation).
 * - `workspace adapter` no se monta si falta domain/impersonate/reader-sa
 *   (graceful degradation log info, no crash).
 *
 * No mockeamos los servicios concretos — confiamos que cada uno tiene
 * sus tests aislados. Este factory test sólo verifica el cableado.
 */

const fakeLogger: Logger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  child: () => fakeLogger,
} as unknown as Logger;

const baseConfig = {
  redisHost: 'localhost',
  redisPort: 6379,
  redisTls: false,
  billingExportTable: 'p.d.t',
  gcpProjectId: 'p',
  workspaceDomain: '',
  workspaceImpersonateEmail: '',
  workspaceReaderSaEmail: '',
  workspacePriceMap: { starter: 6, standard: 12, plus: 18, enterprise: 30 },
  monthlyBudgetUsd: 1000,
  observabilityDashboardActivated: true,
};

describe('buildObservabilityServices', () => {
  it('construye todos los servicios core + monthlyBudgetUsd + featureFlag', () => {
    const services = buildObservabilityServices(baseConfig, fakeLogger);
    expect(services.cache).toBeDefined();
    expect(services.fxRateService).toBeDefined();
    expect(services.costsService).toBeDefined();
    expect(services.monitoringService).toBeDefined();
    expect(services.workspaceService).toBeDefined();
    expect(services.forecastService).toBeDefined();
    expect(services.healthChecksService).toBeDefined();
    expect(services.monthlyBudgetUsd).toBe(1000);
    expect(services.featureFlag).toBe(true);
    // Cleanup: cerrar Redis connection lazy
    services.cache.close().catch(() => {
      /* noop */
    });
  });

  it('twilioUsageService=null cuando faltan credentials', () => {
    const services = buildObservabilityServices(baseConfig, fakeLogger);
    expect(services.twilioUsageService).toBeNull();
    services.cache.close().catch(() => {
      /* noop */
    });
  });

  it('twilioUsageService=instancia cuando las 2 creds están seteadas', () => {
    const services = buildObservabilityServices(
      { ...baseConfig, twilioAccountSid: 'ACtest', twilioAuthToken: 'auth-token-secret' },
      fakeLogger,
    );
    expect(services.twilioUsageService).not.toBeNull();
    services.cache.close().catch(() => {
      /* noop */
    });
  });

  it('twilioUsageService=null si solo 1 de las 2 creds está seteada', () => {
    const services = buildObservabilityServices(
      { ...baseConfig, twilioAccountSid: 'ACtest' }, // auth-token missing
      fakeLogger,
    );
    expect(services.twilioUsageService).toBeNull();
    services.cache.close().catch(() => {
      /* noop */
    });
  });

  it('workspace adapter null cuando domain vacío → loggea info graceful', () => {
    const services = buildObservabilityServices(baseConfig, fakeLogger);
    // El servicio se construye, pero el adapter interno no — verificable
    // indirectamente porque el log info se emite con el reason.
    expect(services.workspaceService).toBeDefined();
    expect(fakeLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ hasDomain: false }),
      expect.stringContaining('workspace admin SDK config incompleta'),
    );
    services.cache.close().catch(() => {
      /* noop */
    });
  });

  it('workspace adapter null si reader SA email está vacío (aunque domain + impersonate sí)', () => {
    const services = buildObservabilityServices(
      {
        ...baseConfig,
        workspaceDomain: 'boosterchile.com',
        workspaceImpersonateEmail: 'admin@boosterchile.com',
        workspaceReaderSaEmail: '', // missing
      },
      fakeLogger,
    );
    expect(services.workspaceService).toBeDefined();
    expect(fakeLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ hasReaderSa: false }),
      expect.stringContaining('workspace admin SDK config incompleta'),
    );
    services.cache.close().catch(() => {
      /* noop */
    });
  });

  it('workspace adapter construido cuando los 3 fields están presentes', () => {
    const services = buildObservabilityServices(
      {
        ...baseConfig,
        workspaceDomain: 'boosterchile.com',
        workspaceImpersonateEmail: 'admin@boosterchile.com',
        workspaceReaderSaEmail: 'reader@booster-ai.iam.gserviceaccount.com',
      },
      fakeLogger,
    );
    expect(services.workspaceService).toBeDefined();
    services.cache.close().catch(() => {
      /* noop */
    });
  });

  it('featureFlag=false se propaga desde config', () => {
    const services = buildObservabilityServices(
      { ...baseConfig, observabilityDashboardActivated: false },
      fakeLogger,
    );
    expect(services.featureFlag).toBe(false);
    services.cache.close().catch(() => {
      /* noop */
    });
  });
});
