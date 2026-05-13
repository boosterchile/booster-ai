/**
 * Compute ETA for public tracking using Routes API on-demand (Phase 5 PR-L2c).
 *
 * **Upgrade sobre PR-L2b**: el ETA al centroide regional con
 * `haversine × 1.3` tiene error potencial ±20-30% (centroide es la
 * capital regional, no el destino exacto; factor 1.3 es aproximación
 * burda de la sinuosidad de carreteras chilenas). Este PR llama al
 * **Routes API** para obtener la distancia por carretera real al
 * destino real, manteniendo la velocidad promedio del vehículo
 * (avgSpeedKmh, medida en los últimos 15min) como el factor de tiempo
 * — porque Routes API asume velocidades genéricas que no reflejan el
 * comportamiento actual del transportista.
 *
 * **Fórmula**:
 *   `etaMins = (roadDistKm_routes_api / avgSpeedKmh) × 60`
 *
 * vs PR-L2b:
 *   `etaMins = (haversine(current → centroid) × 1.3 / avgSpeedKmh) × 60`
 *
 * Donde solo cambia el numerador: distancia real (Routes API) vs
 * proxy (haversine × factor).
 *
 * **Caching**: Routes API factura ~$5 USD por 1000 requests. La página
 * pública de tracking puede pollear cada 30s × N consignees abiertos en
 * un viaje. Sin cache, un viaje de 4h con 5 consignees abiertos generaría
 * 4×60×5/0.5 = 2,400 calls. Cacheamos por (tripId, currentLat~0.01°,
 * currentLng~0.01°) con TTL 5min — el vehículo se mueve ~1.1km por 0.01°
 * en Chile, así que la cache invalida naturalmente al avanzar.
 *
 * **Fallback**: si la API key no está configurada, o la llamada falla,
 * o el destinationAddress está vacío → devolvemos el ETA del fallback
 * (centroide regional, PR-L2b). Nunca rompe la respuesta del tracking.
 *
 * **NO cambia la API pública**: el campo `eta_minutes` del response sigue
 * siendo `number | null`. La precisión mejorada es transparente al cliente.
 */

import type { Logger } from '@booster-ai/logger';
import { RoutesApiError, computeRoutes } from './routes-api.js';

/**
 * Entrada a `computeRouteEta`. Recibe el ETA fallback ya calculado por
 * `computeEtaMinutes` (centroide regional). Si Routes API falla o no
 * está disponible, devolvemos ese fallback sin tocarlo.
 */
export interface ComputeRouteEtaInput {
  /** Logger para warns en fallback. */
  logger: Logger;
  /** ID del trip — usado para cache key. */
  tripId: string;
  /** Lat actual del vehículo (de telemetría reciente). null = no posicionado. */
  currentLat: number | null;
  /** Lng actual del vehículo. null = no posicionado. */
  currentLng: number | null;
  /** Dirección textual del destino (Routes API la geocodifica). */
  destinationAddress: string;
  /** Velocidad promedio últimos 15min en km/h. null = parado/sin pings. */
  avgSpeedKmh: number | null;
  /** ETA en minutos del fallback (PR-L2b centroide). Devolvemos esto si Routes API no aplica. */
  fallbackEtaMinutes: number | null;
  /**
   * GCP project ID para X-Goog-User-Project en Routes API (ADR-038).
   * Si undefined/empty, usamos fallback directo sin llamar a Routes API.
   */
  routesProjectId: string | undefined;
  /** Inyectable para tests. Default: import dinámico de fetch global. */
  fetchImpl?: typeof fetch | undefined;
  /** Inyectable para tests. Default: in-memory module singleton. */
  cacheStore?: RouteEtaCacheStore | undefined;
  /** Override Date.now() en tests. Default: Date.now. */
  nowMs?: number | undefined;
}

export interface ComputeRouteEtaResult {
  /** ETA en minutos, o null si no se pudo estimar (mismo contrato que PR-L2b). */
  etaMinutes: number | null;
  /**
   * Fuente del cálculo:
   *   - `'routes_api'`: éxito con Routes API
   *   - `'routes_api_cached'`: éxito con cache de Routes API
   *   - `'centroide'`: fallback PR-L2b (Routes API no aplicable o falló)
   *   - `'unavailable'`: fallback también fue null (no hay ETA posible)
   *
   * No se expone en la respuesta pública — es para logging/observabilidad.
   */
  source: 'routes_api' | 'routes_api_cached' | 'centroide' | 'unavailable';
}

interface CachedEntry {
  /** Distancia por carretera en km, normalizada de Routes API. */
  distanceKm: number;
  /** Timestamp del fetch original — para TTL. */
  fetchedAt: number;
}

export interface RouteEtaCacheStore {
  get(key: string): CachedEntry | undefined;
  set(key: string, entry: CachedEntry): void;
  /** Borra entradas expiradas. Llamado periódicamente. */
  prune(nowMs: number): void;
}

/**
 * TTL de cache: 5min. Suficientemente largo para evitar hammering en
 * polling normal, suficientemente corto para que si el conductor toma
 * un detour la próxima refresh lo recoja (la cache key ya invalida al
 * cruzar grid de 0.01°, así que 5min es safety net).
 */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Resolución del grid de cache. 0.01° ≈ 1.1km en Chile (latitud ~33°).
 * Dos pings dentro del mismo grid square hits la misma cache entry —
 * razonable porque la distancia al destino cambia <1km entre ellos.
 */
const CACHE_GRID_DECIMALS = 2;

/**
 * Implementación default in-memory. Sufficient para single-process
 * Cloud Run. Si escalamos a múltiples instancias, swap por Redis con
 * la misma interface — el cache es soft (miss → re-fetch, no error).
 */
class InMemoryRouteEtaCache implements RouteEtaCacheStore {
  private readonly store = new Map<string, CachedEntry>();

  get(key: string): CachedEntry | undefined {
    return this.store.get(key);
  }

  set(key: string, entry: CachedEntry): void {
    this.store.set(key, entry);
  }

  prune(nowMs: number): void {
    for (const [key, entry] of this.store) {
      if (nowMs - entry.fetchedAt > CACHE_TTL_MS) {
        this.store.delete(key);
      }
    }
  }
}

/**
 * Singleton del cache para el módulo. Tests pueden pasar uno propio vía
 * `opts.cacheStore` para isolation.
 */
const defaultCache = new InMemoryRouteEtaCache();

/** Solo expuesto para tests — permite limpiar el singleton entre tests. */
export function _resetDefaultCache(): void {
  defaultCache.prune(Number.MAX_SAFE_INTEGER);
}

function buildCacheKey(tripId: string, lat: number, lng: number): string {
  const gridLat = lat.toFixed(CACHE_GRID_DECIMALS);
  const gridLng = lng.toFixed(CACHE_GRID_DECIMALS);
  return `${tripId}:${gridLat}:${gridLng}`;
}

/**
 * Calcula ETA usando Routes API si está disponible, con fallback a la
 * estimación de centroide regional (PR-L2b).
 */
export async function computeRouteEta(input: ComputeRouteEtaInput): Promise<ComputeRouteEtaResult> {
  const {
    logger,
    tripId,
    currentLat,
    currentLng,
    destinationAddress,
    avgSpeedKmh,
    fallbackEtaMinutes,
    routesProjectId,
    fetchImpl,
    cacheStore = defaultCache,
    nowMs = Date.now(),
  } = input;

  // Early returns: si nos faltan inputs críticos, devolvemos el fallback
  // sin tocar Routes API. Esto incluye los casos donde el fallback
  // también es null (NO_ETA_STATUSES, sin posición, etc.).
  if (!routesProjectId) {
    return { etaMinutes: fallbackEtaMinutes, source: pickFallbackSource(fallbackEtaMinutes) };
  }
  if (currentLat === null || currentLng === null) {
    return { etaMinutes: fallbackEtaMinutes, source: pickFallbackSource(fallbackEtaMinutes) };
  }
  if (avgSpeedKmh === null || avgSpeedKmh <= 0) {
    return { etaMinutes: fallbackEtaMinutes, source: pickFallbackSource(fallbackEtaMinutes) };
  }
  if (!destinationAddress || destinationAddress.trim().length === 0) {
    return { etaMinutes: fallbackEtaMinutes, source: pickFallbackSource(fallbackEtaMinutes) };
  }

  // Cache lookup. El grid de 0.01° garantiza que el vehículo debe haberse
  // movido ≥1km para invalidar (suficiente para que la distancia al
  // destino sea materially distinta).
  const cacheKey = buildCacheKey(tripId, currentLat, currentLng);
  const cached = cacheStore.get(cacheKey);
  if (cached && nowMs - cached.fetchedAt <= CACHE_TTL_MS) {
    const etaMinutes = computeEtaFromDistance(cached.distanceKm, avgSpeedKmh);
    return { etaMinutes, source: 'routes_api_cached' };
  }

  // Cache miss o stale → fetch fresh.
  try {
    // computeRoutes acepta string origin/destination (geocoded). Para
    // mejor precisión pasamos lat,lng como string en origin — Routes API
    // lo interpreta como punto exacto sin geocoding.
    const origin = `${currentLat},${currentLng}`;
    const routes = await computeRoutes({
      projectId: routesProjectId,
      origin,
      destination: destinationAddress,
      computeAlternatives: false,
      ...(fetchImpl ? { fetchImpl } : {}),
      logger,
    });

    const top = routes[0];
    if (!top || top.distanceKm <= 0) {
      logger.warn(
        { tripId, currentLat, currentLng, destinationAddress },
        'Routes API returned no usable route — falling back to centroid ETA',
      );
      return { etaMinutes: fallbackEtaMinutes, source: pickFallbackSource(fallbackEtaMinutes) };
    }

    cacheStore.set(cacheKey, { distanceKm: top.distanceKm, fetchedAt: nowMs });

    const etaMinutes = computeEtaFromDistance(top.distanceKm, avgSpeedKmh);
    return { etaMinutes, source: 'routes_api' };
  } catch (err) {
    // Cualquier error de la API: log y fallback. No throw — la respuesta
    // del tracking nunca debe romperse por un upstream que falla.
    if (err instanceof RoutesApiError) {
      logger.warn(
        { tripId, code: err.code, httpStatus: err.httpStatus, msg: err.message },
        'Routes API error — falling back to centroid ETA',
      );
    } else {
      logger.error(
        { err, tripId },
        'Unexpected error computing route ETA — falling back to centroid ETA',
      );
    }
    return { etaMinutes: fallbackEtaMinutes, source: pickFallbackSource(fallbackEtaMinutes) };
  }
}

function computeEtaFromDistance(distanceKm: number, avgSpeedKmh: number): number {
  const etaHours = distanceKm / avgSpeedKmh;
  const etaMins = etaHours * 60;
  // Si el ETA computado es <1 min, redondeamos a 1 — UX consistente con PR-L2b.
  return Math.max(1, Math.round(etaMins));
}

function pickFallbackSource(fallbackEtaMinutes: number | null): 'centroide' | 'unavailable' {
  return fallbackEtaMinutes === null ? 'unavailable' : 'centroide';
}
