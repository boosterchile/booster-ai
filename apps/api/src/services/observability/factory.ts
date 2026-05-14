import type { Logger } from '@booster-ai/logger';
import { ObservabilityCache } from './cache.js';
import { CostsService } from './costs-service.js';
import { ForecastService } from './forecast-service.js';
import { FxRateService } from './fx-rate-service.js';
import { HealthChecksService } from './health-checks-service.js';
import { MonitoringService } from './monitoring-service.js';
import { TwilioUsageService } from './twilio-usage-service.js';
import { createWorkspaceAdminClientGoogleapis } from './workspace-admin-client-googleapis.js';
import { WorkspaceService } from './workspace-service.js';

/**
 * Factory que construye TODOS los servicios del Observability Dashboard
 * a partir de la config + logger. Centraliza el cableado para que
 * `server.ts` solo importe esta factory.
 *
 * Construcción es lazy donde sea posible:
 * - Redis: `lazyConnect: true` — no conecta hasta primer get/set.
 * - GoogleAuth: descubre credentials en primer getAccessToken().
 * - Twilio: omite el service si credentials faltan (return null).
 * - Workspace adapter: omite si DWD setup pendiente; el servicio
 *   reporta `available: false` graceful.
 */

export interface ObservabilityFactoryConfig {
  redisHost: string;
  redisPort: number;
  redisPassword?: string;
  redisTls: boolean;
  billingExportTable: string;
  gcpProjectId: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  workspaceDomain: string;
  workspaceImpersonateEmail: string;
  /** Contenido JSON crudo del SA key. Vacío = adapter no se carga. */
  workspaceCredentialsJson: string;
  workspacePriceMap: {
    starter: number;
    standard: number;
    plus: number;
    enterprise: number;
  };
  monthlyBudgetUsd: number;
  observabilityDashboardActivated: boolean;
}

export interface ObservabilityServices {
  cache: ObservabilityCache;
  fxRateService: FxRateService;
  costsService: CostsService;
  monitoringService: MonitoringService;
  twilioUsageService: TwilioUsageService | null;
  workspaceService: WorkspaceService;
  forecastService: ForecastService;
  healthChecksService: HealthChecksService;
  monthlyBudgetUsd: number;
  featureFlag: boolean;
}

export function buildObservabilityServices(
  config: ObservabilityFactoryConfig,
  logger: Logger,
): ObservabilityServices {
  const cache = new ObservabilityCache({
    host: config.redisHost,
    port: config.redisPort,
    password: config.redisPassword,
    tls: config.redisTls,
    logger,
  });

  const fxRateService = new FxRateService({ cache, logger });

  const costsService = new CostsService({
    cache,
    fxRateService,
    logger,
    billingExportTable: config.billingExportTable,
    queryProjectId: config.gcpProjectId,
  });

  const monitoringService = new MonitoringService({
    cache,
    logger,
    projectId: config.gcpProjectId,
  });

  const twilioUsageService =
    config.twilioAccountSid && config.twilioAuthToken
      ? new TwilioUsageService({
          cache,
          fxRateService,
          logger,
          accountSid: config.twilioAccountSid,
          authToken: config.twilioAuthToken,
        })
      : null;

  const workspaceAdminClient = tryLoadWorkspaceAdmin(config, logger);
  const workspaceService = new WorkspaceService({
    cache,
    fxRateService,
    logger,
    domain: config.workspaceDomain,
    priceMap: config.workspacePriceMap,
    ...(workspaceAdminClient ? { adminClient: workspaceAdminClient } : {}),
  });

  const forecastService = new ForecastService();

  const healthChecksService = new HealthChecksService({
    cache,
    monitoringService,
    logger,
  });

  return {
    cache,
    fxRateService,
    costsService,
    monitoringService,
    twilioUsageService,
    workspaceService,
    forecastService,
    healthChecksService,
    monthlyBudgetUsd: config.monthlyBudgetUsd,
    featureFlag: config.observabilityDashboardActivated,
  };
}

function tryLoadWorkspaceAdmin(
  config: ObservabilityFactoryConfig,
  logger: Logger,
): ReturnType<typeof createWorkspaceAdminClientGoogleapis> | null {
  const trimmedJson = config.workspaceCredentialsJson.trim();
  if (
    !config.workspaceDomain ||
    !config.workspaceImpersonateEmail ||
    !trimmedJson ||
    trimmedJson.startsWith('ROTATE_ME_')
  ) {
    logger.info(
      {
        hasDomain: !!config.workspaceDomain,
        hasImpersonate: !!config.workspaceImpersonateEmail,
        hasCredsJson: !!trimmedJson && !trimmedJson.startsWith('ROTATE_ME_'),
      },
      'observability: workspace admin SDK config incompleta — graceful degradation',
    );
    return null;
  }

  try {
    const key = JSON.parse(trimmedJson) as { client_email: string; private_key: string };
    if (!key.client_email || !key.private_key) {
      logger.warn('observability: workspace credentials missing client_email/private_key');
      return null;
    }
    return createWorkspaceAdminClientGoogleapis({
      serviceAccountKey: key,
      impersonateEmail: config.workspaceImpersonateEmail,
      logger,
    });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'observability: failed to parse workspace credentials JSON — graceful degradation',
    );
    return null;
  }
}
