import { Leaf } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  useResponderSugerenciaRuta,
  useSugerenciaRutaActiva,
} from '../../hooks/use-sugerencia-ruta.js';
import { hrefNavegacionAlternativa } from '../../lib/eco-routing.js';
import type { LatLng } from '../../lib/polyline.js';

/**
 * Sugerencia de eco-routing durante el viaje (T10-23, ADR-012 Capa 1). El
 * conductor responde Aceptar / Seguir mi ruta y la respuesta queda registrada
 * (métrica de adopción). Si acepta, el enlace abre Maps por la alternativa.
 */
export function SugerenciaRutaCard({
  assignmentId,
  destinoDireccion,
  destinoCoords,
  respuestaDesdeNotificacion,
}: {
  assignmentId: string;
  destinoDireccion: string;
  destinoCoords: LatLng | null;
  /** Respuesta elegida en la acción de la notificación (`?respuesta=`). */
  respuestaDesdeNotificacion?: { sugerenciaId: string; respuesta: 'aceptada' | 'rechazada' } | null;
}) {
  const { data } = useSugerenciaRutaActiva(assignmentId, { enabled: true });
  const responder = useResponderSugerenciaRuta(assignmentId);
  const [estado, setEstado] = useState<'pendiente' | 'aceptada' | 'rechazada'>('pendiente');
  const [error, setError] = useState(false);
  const autoRespondida = useRef(false);
  const sugerencia = data?.sugerencia ?? null;

  async function registrar(sugerenciaId: string, respuesta: 'aceptada' | 'rechazada') {
    setError(false);
    try {
      await responder.mutateAsync({ sugerenciaId, respuesta });
      setEstado(respuesta);
    } catch {
      setError(true);
    }
  }

  // Auto-respuesta una sola vez (ref). `registrar` cierra sobre mutateAsync,
  // estable en react-query; agregarlo re-dispararía el efecto en cada render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: se ejecuta solo al llegar la respuesta de la notificación
  useEffect(() => {
    if (respuestaDesdeNotificacion && !autoRespondida.current) {
      autoRespondida.current = true;
      void registrar(respuestaDesdeNotificacion.sugerenciaId, respuestaDesdeNotificacion.respuesta);
    }
  }, [respuestaDesdeNotificacion]);

  if (estado === 'rechazada' || (!sugerencia && estado === 'pendiente')) {
    return null;
  }
  const polyline = sugerencia?.polyline_alternativa ?? '';

  return (
    <section
      role="alert"
      className="mt-3 rounded-md border border-success-300 bg-success-50 p-3 text-sm"
      data-testid={`sugerencia-ruta-${assignmentId}`}
    >
      <div className="flex items-center gap-2 font-medium text-success-800">
        <Leaf className="h-4 w-4" aria-hidden />
        Congestión en tu ruta
      </div>
      {sugerencia && <p className="mt-1 text-neutral-800">{sugerencia.texto}</p>}
      {estado === 'aceptada' ? (
        <a
          className="mt-3 flex w-full items-center justify-center rounded-md bg-success-700 px-4 py-3 font-medium text-base text-white"
          href={hrefNavegacionAlternativa(polyline, destinoCoords, destinoDireccion)}
          target="_blank"
          rel="noreferrer"
        >
          Navegar por la ruta alternativa
        </a>
      ) : (
        sugerencia && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              aria-label="Aceptar ruta alternativa"
              disabled={responder.isPending}
              onClick={() => void registrar(sugerencia.id, 'aceptada')}
              className="rounded-md bg-success-700 px-3 py-3 font-medium text-base text-white disabled:opacity-60"
            >
              Aceptar
            </button>
            <button
              type="button"
              disabled={responder.isPending}
              onClick={() => void registrar(sugerencia.id, 'rechazada')}
              className="rounded-md border border-neutral-300 bg-white px-3 py-3 font-medium text-base text-neutral-800 disabled:opacity-60"
            >
              Seguir mi ruta
            </button>
          </div>
        )
      )}
      {error && (
        <p className="mt-2 text-danger-700">No pudimos guardar tu respuesta. Intenta de nuevo.</p>
      )}
    </section>
  );
}
