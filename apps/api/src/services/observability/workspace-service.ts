import type { Logger } from '@booster-ai/logger';
import type { ObservabilityCache } from './cache.js';
import type { FxRateService } from './fx-rate-service.js';

/**
 * Cliente Google Workspace Admin SDK + Enterprise License Manager para
 * el Observability Dashboard.
 *
 * Pre-condición operacional: la SA `observability-workspace-reader` está
 * registrada con Domain-Wide Delegation en admin.google.com con los
 * scopes apropiados. Si la SA no está configurada, este servicio retorna
 * `available=false` y la UI muestra el estado graceful (NO crashea).
 *
 * Pricing NO viene del API — Workspace API no expone precios. Se
 * configuran por env var (GOOGLE_WORKSPACE_PRICE_PER_SEAT_USD_*) por
 * SKU. Si la mezcla cambia, el PO actualiza la env var via terraform.
 *
 * Cache 1h TTL — number of seats cambia raras veces y la cuota del
 * Admin SDK es 2400 qpm por user, generosa pero no infinita.
 */

const CACHE_TTL_SECONDS = 3600;

export interface WorkspacePriceMap {
  starter: number;
  standard: number;
  plus: number;
  enterprise: number;
}

export interface WorkspaceServiceOpts {
  cache: ObservabilityCache;
  fxRateService: FxRateService;
  logger: Logger;
  /** Dominio del Workspace, e.g. boosterchile.com. Vacío = service unavailable. */
  domain: string;
  priceMap: WorkspacePriceMap;
  /**
   * Inyectable para tests. Tipo "min surface" del Admin SDK + Licensing
   * que solo expone los métodos que usamos.
   */
  adminClient?: WorkspaceAdminClient;
}

export interface WorkspaceAdminClient {
  listUsers(domain: string): Promise<{ activeUsers: number; suspendedUsers: number }>;
  listLicenseAssignments(domain: string): Promise<Array<{ skuId: string }>>;
}

export interface WorkspaceUsageSnapshot {
  available: boolean;
  reason?: string;
  totalSeats: number;
  activeSeats: number;
  suspendedSeats: number;
  seatsBySku: Record<string, number>;
  monthlyCostUsd: number;
  monthlyCostClp: number;
}

const SKU_TO_PRICE_KEY: Record<string, keyof WorkspacePriceMap> = {
  '1010020027': 'starter', // Business Starter
  '1010020028': 'standard', // Business Standard
  '1010020025': 'plus', // Business Plus
  '1010060001': 'enterprise', // Enterprise Standard
  '1010060003': 'enterprise', // Enterprise Plus
};

export class WorkspaceService {
  private readonly cache: ObservabilityCache;
  private readonly fxRateService: FxRateService;
  private readonly logger: Logger;
  private readonly domain: string;
  private readonly priceMap: WorkspacePriceMap;
  private readonly adminClient: WorkspaceAdminClient | null;

  constructor(opts: WorkspaceServiceOpts) {
    this.cache = opts.cache;
    this.fxRateService = opts.fxRateService;
    this.logger = opts.logger;
    this.domain = opts.domain;
    this.priceMap = opts.priceMap;
    this.adminClient = opts.adminClient ?? null;
  }

  async getUsageSnapshot(): Promise<WorkspaceUsageSnapshot> {
    return this.cache.getOrFetch('workspace:snapshot', CACHE_TTL_SECONDS, async () => {
      if (!this.domain) {
        return this.unavailable('GOOGLE_WORKSPACE_DOMAIN not configured');
      }
      if (!this.adminClient) {
        return this.unavailable('workspace admin client not initialized (DWD pending)');
      }

      try {
        const [users, licenses] = await Promise.all([
          this.adminClient.listUsers(this.domain),
          this.adminClient.listLicenseAssignments(this.domain).catch((err) => {
            this.logger.warn(
              { err: err instanceof Error ? err.message : String(err) },
              'workspace: licensing API failed, fallback to user count',
            );
            return [] as Array<{ skuId: string }>;
          }),
        ]);

        const seatsBySku: Record<string, number> = {};
        let totalMonthlyCostUsd = 0;

        for (const lic of licenses) {
          seatsBySku[lic.skuId] = (seatsBySku[lic.skuId] ?? 0) + 1;
          const priceKey = SKU_TO_PRICE_KEY[lic.skuId];
          totalMonthlyCostUsd += priceKey ? this.priceMap[priceKey] : this.priceMap.standard;
        }

        // Si licensing falló, usamos user count × standard price como fallback
        if (licenses.length === 0 && users.activeUsers > 0) {
          totalMonthlyCostUsd = users.activeUsers * this.priceMap.standard;
        }

        const monthlyCostClp = Math.round(await this.fxRateService.usdToClp(totalMonthlyCostUsd));

        return {
          available: true,
          totalSeats: users.activeUsers + users.suspendedUsers,
          activeSeats: users.activeUsers,
          suspendedSeats: users.suspendedUsers,
          seatsBySku,
          monthlyCostUsd: Math.round(totalMonthlyCostUsd * 100) / 100,
          monthlyCostClp,
        };
      } catch (err) {
        this.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'workspace: admin SDK call failed',
        );
        return this.unavailable(
          err instanceof Error ? err.message : 'unknown error calling admin SDK',
        );
      }
    });
  }

  private unavailable(reason: string): WorkspaceUsageSnapshot {
    return {
      available: false,
      reason,
      totalSeats: 0,
      activeSeats: 0,
      suspendedSeats: 0,
      seatsBySku: {},
      monthlyCostUsd: 0,
      monthlyCostClp: 0,
    };
  }
}
