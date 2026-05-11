import { ChevronDown, ChevronUp, Leaf, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useAssignmentEcoRoute } from '../../hooks/use-assignment-eco-route.js';
import { EcoRouteMapPreview } from '../offers/EcoRouteMapPreview.js';

/**
 * Card de la ruta eco sugerida durante el viaje (Phase 1 PR-H5).
 *
 * Cierra el loop carrier→driver: el carrier ya veía el mapa antes de
 * aceptar (EcoRouteMapPreview en OfferCard); ahora el driver también
 * la ve durante el viaje en `/app/asignaciones/:id`.
 *
 * **UX**:
 *   - Collapsed por default (no agrega ruido a la surface activa que
 *     ya tiene confirmar-entrega + incidente + chat).
 *   - Expand-on-tap fetches la polyline (lazy — no Routes API call
 *     hasta que el driver pida verla).
 *   - Si la API devuelve `polyline_encoded: null`, mostramos un
 *     mensaje legible — la card sigue rendereada con su microcopy
 *     para que el carrier sepa POR QUÉ no hay mapa.
 *
 * **Por qué un card y no inline**: el carrier ya tiene un montón de
 * surface arriba (confirmar-entrega, incidente, behavior score post-
 * entrega, cobra-hoy si entregado). Embedded el mapa siempre visible
 * agrega un componente pesado (Google Maps SDK) a CADA visita de la
 * página. El expand-on-tap mantiene la carga inicial liviana.
 */

export interface AssignmentEcoRouteCardProps {
  assignmentId: string;
}

export function AssignmentEcoRouteCard({ assignmentId }: AssignmentEcoRouteCardProps) {
  const [expanded, setExpanded] = useState(false);
  const query = useAssignmentEcoRoute(assignmentId, { enabled: expanded });

  return (
    <section
      aria-label="Ruta eco-eficiente sugerida"
      className="border-success-700/15 border-b bg-success-50/30 px-4 py-3"
      data-testid="assignment-eco-route-card"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={expanded}
        data-testid="assignment-eco-route-toggle"
      >
        <span className="flex items-center gap-2 text-success-800 text-sm">
          <Leaf className="h-4 w-4" aria-hidden />
          <span className="font-semibold">Ruta eco-eficiente sugerida</span>
        </span>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-success-700" aria-hidden />
        ) : (
          <ChevronDown className="h-4 w-4 text-success-700" aria-hidden />
        )}
      </button>

      {expanded && (
        <div className="mt-3" data-testid="assignment-eco-route-body">
          <EcoRouteBody query={query} />
        </div>
      )}
    </section>
  );
}

function EcoRouteBody({ query }: { query: ReturnType<typeof useAssignmentEcoRoute> }) {
  if (query.isLoading) {
    return (
      <div className="flex items-center gap-2 text-success-700 text-xs">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Calculando ruta sugerida con Google Routes…
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <div className="rounded-md border border-neutral-200 bg-white p-3 text-neutral-600 text-xs">
        No pudimos cargar la ruta sugerida ahora. Intenta abrirla de nuevo en unos segundos.
      </div>
    );
  }
  const d = query.data;
  if (!d.polyline_encoded) {
    return (
      <div className="rounded-md border border-neutral-200 bg-white p-3 text-neutral-600 text-xs">
        {explainStatus(d.status)}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <EcoRouteMapPreview polylineEncoded={d.polyline_encoded} height={220} />
      <p className="text-[11px] text-neutral-600">
        Esta es la ruta sobre la que calculamos el preview de huella de carbono que viste antes de
        aceptar. Si te desvías, el cálculo final se hace con los datos reales de tu vehículo al
        cerrar el viaje.
      </p>
      {(d.distance_km != null || d.duration_s != null) && (
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-700">
          {d.distance_km != null && (
            <div>
              <dt className="inline text-neutral-500">Distancia: </dt>
              <dd className="inline font-medium">{d.distance_km.toFixed(0)} km</dd>
            </div>
          )}
          {d.duration_s != null && (
            <div>
              <dt className="inline text-neutral-500">Duración est.: </dt>
              <dd className="inline font-medium">{Math.round(d.duration_s / 60)} min</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}

function explainStatus(
  status: 'ok' | 'no_routes_api_key' | 'routes_api_failed' | 'route_empty',
): string {
  switch (status) {
    case 'ok':
      // No debería llegar acá (polyline_encoded != null cuando ok), pero
      // sirve para exhaustiveness — TypeScript chequea.
      return 'Ruta disponible.';
    case 'no_routes_api_key':
      return 'El mapa de la ruta sugerida no está disponible en este entorno.';
    case 'routes_api_failed':
      return 'Hubo un error transitorio al traer la ruta. Intenta de nuevo en unos segundos.';
    case 'route_empty':
      return 'No pudimos resolver una ruta entre el origen y el destino — verifica las direcciones.';
  }
}
