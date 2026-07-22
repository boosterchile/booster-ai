import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Loader2, Route as RouteIcon } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../lib/api-client.js';
import { type LatLng, decodePolyline } from '../../lib/polyline.js';
import { TrazaMapPreview } from '../map/TrazaMapPreview.js';

/**
 * Card del recorrido real de una CARGA (capa 2, versión por-carga).
 *
 * Cuelga del detalle del transportista (`/app/asignaciones/:id`), junto a la
 * ruta eco sugerida. Collapsed por default (el mapa es pesado); expand-on-tap
 * fetches `GET /assignments/:id/traza` → dibuja la traza real (azul) sobre la
 * ruta esperada (verde) + un resumen (real vs esperada, cobertura, CAN).
 *
 * DTO espejado manual del endpoint en apps/api/src/routes/assignments.ts.
 * Scaffold forward-looking: hoy (0 cargas entregadas con telemetría) muestra
 * "aún no hay telemetría", listo para cuando exista.
 */
interface TrazaCargaResponse {
  assignment_id: string;
  plate: string;
  delivered: boolean;
  puntos: Array<{ t: string; lat: number; lng: number }>;
  puntos_total: number;
  puntos_devueltos: number;
  ruta_esperada_polyline: string | null;
  resumen: {
    distancia_real_km: number;
    distancia_esperada_km: number | null;
    duracion_min: number;
    cobertura_pct: number | null;
    litros_consumidos: number | null;
    km_can: number | null;
  };
}

export interface TrazaCargaCardProps {
  assignmentId: string;
}

export function TrazaCargaCard({ assignmentId }: TrazaCargaCardProps) {
  const [expanded, setExpanded] = useState(false);
  const query = useQuery({
    queryKey: ['assignments', assignmentId, 'traza'],
    queryFn: () => api.get<TrazaCargaResponse>(`/assignments/${assignmentId}/traza`),
    enabled: expanded,
  });

  return (
    <section
      aria-label="Recorrido real de la carga"
      className="border-neutral-200 border-b bg-white px-4 py-3"
      data-testid="traza-carga-card"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={expanded}
        data-testid="traza-carga-toggle"
      >
        <span className="flex items-center gap-2 text-neutral-800 text-sm">
          <RouteIcon className="h-4 w-4" aria-hidden />
          <span className="font-semibold">Recorrido de la carga</span>
        </span>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-neutral-500" aria-hidden />
        ) : (
          <ChevronDown className="h-4 w-4 text-neutral-500" aria-hidden />
        )}
      </button>

      {expanded && (
        <div className="mt-3" data-testid="traza-carga-body">
          <TrazaCargaBody query={query} />
        </div>
      )}
    </section>
  );
}

function TrazaCargaBody({ query }: { query: ReturnType<typeof useQuery<TrazaCargaResponse>> }) {
  if (query.isLoading) {
    return (
      <div className="flex items-center gap-2 text-neutral-600 text-xs">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Cargando el recorrido…
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <div className="rounded-md border border-neutral-200 bg-white p-3 text-neutral-600 text-xs">
        No pudimos cargar el recorrido ahora. Intentá de nuevo en unos segundos.
      </div>
    );
  }

  const d = query.data;
  const points: LatLng[] = d.puntos.map((p) => ({ lat: p.lat, lng: p.lng }));
  const expected = d.ruta_esperada_polyline ? decodePolyline(d.ruta_esperada_polyline) : [];
  const r = d.resumen;

  return (
    <div className="space-y-3">
      <TrazaMapPreview points={points} expectedRoute={expected} height={260} />
      <dl
        className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-700"
        data-testid="traza-carga-resumen"
      >
        <Stat label="Distancia real" value={`${r.distancia_real_km.toFixed(1)} km`} />
        <Stat
          label="Esperada"
          value={
            r.distancia_esperada_km != null
              ? `${r.distancia_esperada_km.toFixed(1)} km`
              : 'Sin dato'
          }
        />
        <Stat
          label="Cobertura"
          value={r.cobertura_pct != null ? `${r.cobertura_pct.toFixed(0)} %` : 'Sin dato'}
        />
        <Stat
          label="Combustible"
          value={r.litros_consumidos != null ? `${r.litros_consumidos.toFixed(1)} L` : 'Sin dato'}
        />
        <Stat label="Km CAN" value={r.km_can != null ? `${r.km_can.toFixed(1)} km` : 'Sin dato'} />
      </dl>
      {d.puntos_total === 0 ? (
        <p className="text-[11px] text-neutral-500">
          Aún no hay telemetría registrada para esta carga.
        </p>
      ) : (
        <p className="text-[11px] text-neutral-500">
          {d.puntos_devueltos} de {d.puntos_total} puntos
          {d.puntos_devueltos < d.puntos_total ? ' (traza simplificada)' : ''}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="inline text-neutral-500">{label}: </dt>
      <dd className="inline font-medium">{value}</dd>
    </div>
  );
}
