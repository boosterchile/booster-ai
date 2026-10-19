import { useQuery } from '@tanstack/react-query';
import {
  fetchAsignaciones,
  fetchCumplimiento,
  fetchOfertasPendientes,
} from '../lib/consultas-transportista.js';
import { useEmpresaScope } from '../lib/empresa-activa.js';

export interface BadgeNav {
  n: number;
  tono: 'warning' | 'danger';
}

function badge(n: number | undefined, tono: BadgeNav['tono']): BadgeNav | null {
  if (n == null || n <= 0) {
    return null;
  }
  return { n, tono };
}

/**
 * Conteos de Ofertas, Servicios y Cumplimiento para el sidebar.
 * Reusa las claves y la forma de caché de esas pantallas. Sin endpoint nuevo.
 */
export function useBadgesTransporte(enabled: boolean): {
  ofertas: BadgeNav | null;
  servicios: BadgeNav | null;
  cumplimiento: BadgeNav | null;
} {
  const scope = useEmpresaScope();

  const ofertasQ = useQuery({
    queryKey: scope.key('offers', 'mine', 'pendiente'),
    queryFn: () => fetchOfertasPendientes(scope.init),
    select: (data) => data.offers.length,
    enabled,
    retry: false,
    staleTime: 15_000,
    refetchInterval: enabled ? 30_000 : false,
  });

  const serviciosQ = useQuery({
    queryKey: scope.key('assignments', 'empresa'),
    queryFn: () => fetchAsignaciones(scope.init),
    select: (filas) => filas.filter((fila) => fila.driver == null).length,
    enabled,
    retry: false,
    refetchInterval: enabled ? 30_000 : false,
  });

  const cumplimientoQ = useQuery({
    queryKey: scope.key('cumplimiento'),
    queryFn: () => fetchCumplimiento(scope.init),
    select: (data) => data.resumen.vencidos,
    enabled,
    retry: false,
  });

  return {
    ofertas: badge(ofertasQ.data, 'warning'),
    servicios: badge(serviciosQ.data, 'danger'),
    cumplimiento: badge(cumplimientoQ.data, 'danger'),
  };
}
