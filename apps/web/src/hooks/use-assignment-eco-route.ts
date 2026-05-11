import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api-client.js';

/**
 * Hook para fetchear la polyline de la ruta sugerida en una asignación
 * post-accept (Phase 1 PR-H5). Wraps `GET /assignments/:id/eco-route`.
 *
 * **Diseño**:
 *   - `enabled` controla cuando se dispara la query (típicamente cuando
 *     el carrier toca "Ver ruta sugerida" o se monta el bloque del mapa).
 *   - `staleTime: 30min` porque la ruta no cambia durante el viaje (origen
 *     y destino son fijos a nivel trip); evita re-fetch innecesario al
 *     navegar de vuelta a la página.
 *   - El response shape es defensivo: `polyline_encoded` puede ser
 *     `null` con un `status` legible ('no_routes_api_key' |
 *     'routes_api_failed' | 'route_empty') — el cliente decide qué
 *     mostrar (fallback o mapa).
 */

export interface AssignmentEcoRouteResponse {
  polyline_encoded: string | null;
  distance_km: number | null;
  duration_s: number | null;
  status: 'ok' | 'no_routes_api_key' | 'routes_api_failed' | 'route_empty';
}

export function useAssignmentEcoRoute(assignmentId: string, opts: { enabled?: boolean } = {}) {
  return useQuery<AssignmentEcoRouteResponse>({
    queryKey: ['assignment-eco-route', assignmentId],
    queryFn: () => api.get<AssignmentEcoRouteResponse>(`/assignments/${assignmentId}/eco-route`),
    enabled: opts.enabled ?? true,
    staleTime: 30 * 60 * 1000, // 30 min: ruta no cambia durante el viaje
    retry: 1,
  });
}
