import type { Logger } from '@booster-ai/logger';

/**
 * Cliente del Google Routes API (Phase 1 — eco route suggestion).
 *
 * Endpoint: POST https://routes.googleapis.com/directions/v2:computeRoutes
 * Docs: https://developers.google.com/maps/documentation/routes/compute_route_directions
 *
 * Diseño:
 *   - Función pura (toma `fetch` inyectable para tests).
 *   - Devuelve estructura normalizada que oculta detalles del wire
 *     protocol de Google (microliters → liters, distanceMeters → km).
 *   - Acepta direcciones como strings (Routes API geocodifica internamente).
 *     Cuando agreguemos lat/lng a `viajes`, se podrá pasar coordenadas
 *     directamente sin geocoding extra (más barato).
 *
 * Costo: ~$5 USD por 1000 requests con extras computations habilitados.
 *
 * Restricción de la API key (configurada en GCP Console):
 *   - Por IP del egress de Cloud Run (preferido) o por SA token.
 *   - NUNCA por HTTP referrer (Routes API es server-side).
 */

/** Tipos de combustible aceptados por Routes API. Espejo de
 *  google.routes.v2.VehicleEmissionType. */
export type VehicleEmissionType = 'GASOLINE' | 'ELECTRIC' | 'HYBRID' | 'DIESEL';

/** Una ruta alternativa devuelta por Routes API, normalizada a unidades SI. */
export interface RouteSuggestion {
  /** Distancia total en km. */
  distanceKm: number;
  /** Duración estimada en segundos (con tráfico si TRAFFIC_AWARE). */
  durationS: number;
  /**
   * Combustible estimado en litros. Solo presente si la API computó
   * FUEL_CONSUMPTION (depende de emissionType + región). Null indica
   * que el cálculo no fue posible (ej: ELECTRIC).
   */
  fuelL: number | null;
  /**
   * Polyline encoded (Google's Encoded Polyline format) de la geometría
   * de la ruta. Para mostrar en el mapa cliente.
   */
  polylineEncoded: string;
}

export interface ComputeRoutesParams {
  /** API key con restricción server-side (no HTTP referrer). */
  apiKey: string;
  /** Origen — dirección textual (Routes API la geocodifica). */
  origin: string;
  /** Destino — dirección textual. */
  destination: string;
  /**
   * Tipo de motor del vehículo, para que Routes API estime
   * `fuelConsumptionMicroliters`. Si se omite, no se solicita
   * FUEL_CONSUMPTION extra computation.
   */
  emissionType?: VehicleEmissionType | undefined;
  /**
   * Si true, computa rutas alternativas (hasta 3). Default false.
   * El primer elemento siempre es la "principal" (TRAFFIC_AWARE_OPTIMAL).
   */
  computeAlternatives?: boolean | undefined;
  /** Opcional: fetch inyectable (para tests). Default global fetch. */
  fetchImpl?: typeof fetch | undefined;
  /** Opcional: logger para debug. */
  logger?: Logger | undefined;
}

/**
 * Errores tipados para el caller distinguir tipo de fallo y decidir
 * fallback (ej: si es transient → reintento; si es API key inválida →
 * fallback a estimarDistanciaKm).
 */
export class RoutesApiError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'invalid_request'
      | 'auth_error'
      | 'quota_exceeded'
      | 'network_error'
      | 'unknown',
    public readonly httpStatus: number | null,
  ) {
    super(message);
    this.name = 'RoutesApiError';
  }
}

const ROUTES_API_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

/**
 * Llama al Routes API y devuelve las rutas normalizadas.
 *
 * @throws RoutesApiError si la API rechaza el request (4xx) o falla la red.
 * El caller debe decidir si hacer fallback o propagar.
 */
export async function computeRoutes(params: ComputeRoutesParams): Promise<RouteSuggestion[]> {
  const {
    apiKey,
    origin,
    destination,
    emissionType,
    computeAlternatives = false,
    fetchImpl = fetch,
    logger,
  } = params;

  const body: Record<string, unknown> = {
    origin: { address: origin },
    destination: { address: destination },
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
    computeAlternativeRoutes: computeAlternatives,
  };

  // Solo agregamos vehicleInfo + extraComputations si tenemos emission
  // type — sin esto Routes API no calcula fuelConsumption (cobra menos).
  if (emissionType) {
    body.vehicleInfo = { emissionType };
    body.extraComputations = ['FUEL_CONSUMPTION'];
  }

  // Field mask reducido para minimizar response size (Routes API factura
  // por field-mask; pedir solo lo que usamos).
  const fieldMask = [
    'routes.distanceMeters',
    'routes.duration',
    'routes.polyline.encodedPolyline',
    emissionType ? 'routes.travelAdvisory.fuelConsumptionMicroliters' : null,
  ]
    .filter(Boolean)
    .join(',');

  let response: Response;
  try {
    response = await fetchImpl(ROUTES_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': fieldMask,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    logger?.error({ err, origin, destination }, 'Routes API network error');
    throw new RoutesApiError(
      `Network error calling Routes API: ${err instanceof Error ? err.message : 'unknown'}`,
      'network_error',
      null,
    );
  }

  if (!response.ok) {
    let errBody = '';
    try {
      errBody = await response.text();
    } catch {
      // ignore
    }
    const code = mapHttpStatusToCode(response.status);
    logger?.warn(
      { httpStatus: response.status, code, errBody, origin, destination },
      'Routes API non-2xx response',
    );
    throw new RoutesApiError(
      `Routes API returned ${response.status}: ${errBody.slice(0, 200)}`,
      code,
      response.status,
    );
  }

  // Parse + normalización defensiva. Routes API puede devolver `{}` si
  // no encontró rutas (ej. origen sin grafo de calles).
  const json = (await response.json()) as {
    routes?: Array<{
      distanceMeters?: number;
      duration?: string; // formato "1234s"
      polyline?: { encodedPolyline?: string };
      travelAdvisory?: {
        fuelConsumptionMicroliters?: string; // BigInt serializado
      };
    }>;
  };

  if (!json.routes || json.routes.length === 0) {
    return [];
  }

  return json.routes.map((r): RouteSuggestion => {
    const distanceM = r.distanceMeters ?? 0;
    const durationS = parseDurationS(r.duration);
    const fuelMicroL = r.travelAdvisory?.fuelConsumptionMicroliters;
    return {
      distanceKm: distanceM / 1000,
      durationS,
      fuelL: fuelMicroL != null ? Number(fuelMicroL) / 1_000_000 : null,
      polylineEncoded: r.polyline?.encodedPolyline ?? '',
    };
  });
}

/**
 * Routes API serializa duration como `"1234s"` (Google's Duration
 * format de protobuf). Parseamos a número de segundos.
 */
function parseDurationS(s: string | undefined): number {
  if (!s) {
    return 0;
  }
  const m = s.match(/^(\d+)s$/);
  return m?.[1] ? Number(m[1]) : 0;
}

function mapHttpStatusToCode(status: number): RoutesApiError['code'] {
  if (status === 400) {
    return 'invalid_request';
  }
  if (status === 401 || status === 403) {
    return 'auth_error';
  }
  if (status === 429) {
    return 'quota_exceeded';
  }
  return 'unknown';
}
