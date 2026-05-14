import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api-client.js';

/**
 * Hooks TanStack Query para el Observability Dashboard
 * (/app/platform-admin/observability).
 *
 * Convenciones:
 * - staleTime 60s para queries de UI ligero (health, usage).
 * - staleTime 5min para costos (BigQuery ya cachea 5min server-side).
 * - refetchOnWindowFocus: false (heredado del provider global), para
 *   no martillar BigQuery cada vez que el admin cambia de pestaña.
 * - Cada hook tiene un namespace queryKey `['observability', ...]` para
 *   que el QueryClient pueda invalidar el dashboard entero con un
 *   `queryClient.invalidateQueries({ queryKey: ['observability'] })`.
 */

// ---------------- Tipos espejo de los responses de apps/api ----------------

export interface HealthSnapshot {
  overall: 'healthy' | 'degraded' | 'critical' | 'unknown';
  components: Array<{
    name: string;
    level: 'healthy' | 'degraded' | 'critical' | 'unknown';
    message: string;
  }>;
  lastEvaluatedAt: string;
}

export interface CostsOverview {
  costClpMonthToDate: number;
  costClpPreviousMonth: number;
  deltaPercentVsPreviousMonth: number | null;
  lastBillingExportAt: string | null;
}

export interface CostsByServiceItem {
  service: string;
  costClp: number;
  percentOfTotal: number;
}

export interface CostsByProjectItem {
  projectId: string;
  projectName: string | null;
  costClp: number;
  percentOfTotal: number;
}

export interface CostsTrendPoint {
  date: string;
  costClp: number;
}

export interface TopSku {
  service: string;
  sku: string;
  costClp: number;
}

export interface CloudRunMetrics {
  latencyP95Ms: number | null;
  cpuUtilization: number | null;
  ramUtilization: number | null;
  rps: number | null;
}

export interface CloudSqlMetrics {
  cpuUtilization: number | null;
  ramUtilization: number | null;
  diskUtilization: number | null;
  connectionsUsedRatio: number | null;
}

export type TwilioUsageResponse =
  | {
      available: true;
      balance: { balanceUsd: number; balanceClp: number; currency: string };
      usage: Array<{
        category: string;
        description: string;
        usage: number;
        usageUnit: string;
        priceUsd: number;
        priceClp: number;
      }>;
    }
  | { available: false; reason: string };

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

export interface ForecastResponse {
  forecastClpEndOfMonth: number;
  budgetClp: number;
  variancePercent: number;
  dayOfMonth: number;
  daysInMonth: number;
  daysRemaining: number;
  currentRate: {
    clpPerUsd: number;
    observedAt: string;
    source: 'mindicador' | 'cache-fallback' | 'hardcoded';
  };
}

// ---------------- Hooks ----------------

const STALE_HEALTH = 60_000;
const STALE_COSTS = 5 * 60_000;
const STALE_USAGE = 60_000;

export function useObservabilityHealth() {
  return useQuery({
    queryKey: ['observability', 'health'],
    queryFn: () => api.get<HealthSnapshot>('/admin/observability/health'),
    staleTime: STALE_HEALTH,
  });
}

export function useObservabilityCostsOverview() {
  return useQuery({
    queryKey: ['observability', 'costs', 'overview'],
    queryFn: () => api.get<CostsOverview>('/admin/observability/costs/overview'),
    staleTime: STALE_COSTS,
  });
}

export function useObservabilityCostsByService(days = 30) {
  return useQuery({
    queryKey: ['observability', 'costs', 'by-service', days],
    queryFn: () =>
      api.get<{ days: number; items: CostsByServiceItem[] }>(
        `/admin/observability/costs/by-service?days=${days}`,
      ),
    staleTime: STALE_COSTS,
  });
}

export function useObservabilityCostsByProject(days = 30) {
  return useQuery({
    queryKey: ['observability', 'costs', 'by-project', days],
    queryFn: () =>
      api.get<{ days: number; items: CostsByProjectItem[] }>(
        `/admin/observability/costs/by-project?days=${days}`,
      ),
    staleTime: STALE_COSTS,
  });
}

export function useObservabilityCostsTrend(days = 30) {
  return useQuery({
    queryKey: ['observability', 'costs', 'trend', days],
    queryFn: () =>
      api.get<{ days: number; points: CostsTrendPoint[] }>(
        `/admin/observability/costs/trend?days=${days}`,
      ),
    staleTime: STALE_COSTS,
  });
}

export function useObservabilityTopSkus(limit = 10) {
  return useQuery({
    queryKey: ['observability', 'costs', 'top-skus', limit],
    queryFn: () =>
      api.get<{ limit: number; items: TopSku[] }>(
        `/admin/observability/costs/top-skus?limit=${limit}`,
      ),
    staleTime: STALE_COSTS,
  });
}

export function useObservabilityCloudRun() {
  return useQuery({
    queryKey: ['observability', 'usage', 'cloud-run'],
    queryFn: () => api.get<CloudRunMetrics>('/admin/observability/usage/cloud-run'),
    staleTime: STALE_USAGE,
  });
}

export function useObservabilityCloudSql() {
  return useQuery({
    queryKey: ['observability', 'usage', 'cloud-sql'],
    queryFn: () => api.get<CloudSqlMetrics>('/admin/observability/usage/cloud-sql'),
    staleTime: STALE_USAGE,
  });
}

export function useObservabilityTwilio() {
  return useQuery({
    queryKey: ['observability', 'usage', 'twilio'],
    queryFn: () => api.get<TwilioUsageResponse>('/admin/observability/usage/twilio'),
    staleTime: STALE_USAGE,
  });
}

export function useObservabilityWorkspace() {
  return useQuery({
    queryKey: ['observability', 'usage', 'workspace'],
    queryFn: () => api.get<WorkspaceUsageSnapshot>('/admin/observability/usage/workspace'),
    staleTime: STALE_USAGE,
  });
}

export function useObservabilityForecast() {
  return useQuery({
    queryKey: ['observability', 'forecast'],
    queryFn: () => api.get<ForecastResponse>('/admin/observability/forecast'),
    staleTime: STALE_COSTS,
  });
}
