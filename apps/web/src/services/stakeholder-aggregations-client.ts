import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api-client.js';

/** D11/ADR-041 — Client del endpoint /stakeholder/zonas/:slug/agregaciones. */

export interface BucketHora {
  hora: number;
  viajes: number | null;
  co2e_kg: number | null;
}
export interface BucketTipoCarga {
  tipo: string;
  viajes: number | null;
  co2e_kg: number | null;
}
export interface BucketCombustible {
  fuel_type: string;
  viajes: number | null;
  co2e_kg: number | null;
}
export interface AgregacionesZona {
  por_hora_del_dia: BucketHora[];
  por_tipo_carga: BucketTipoCarga[];
  por_combustible: BucketCombustible[];
  metodologia: {
    k_anonymity: number;
    ventana_dias: number;
    fuente: string;
    generado_at: string;
  };
}

export interface ZonaCard {
  id: string;
  slug: string;
  nombre: string;
  region: string;
  tipo: string;
  viajes_30d: number | null;
  co2e_total_kg: number | null;
  horario_pico_inicio: number | null;
  horario_pico_fin: number | null;
  insufficient_data: boolean;
}
export interface StakeholderZonasResponse {
  zonas: ZonaCard[];
}

export function useStakeholderZonas() {
  return useQuery<StakeholderZonasResponse>({
    queryKey: ['stakeholder', 'zonas'],
    queryFn: () => api.get<StakeholderZonasResponse>('/stakeholder/zonas'),
    staleTime: 60_000,
  });
}

export function useStakeholderAgregaciones(slug: string | undefined) {
  return useQuery<AgregacionesZona>({
    queryKey: ['stakeholder', 'zonas', slug, 'agregaciones'],
    queryFn: () => api.get<AgregacionesZona>(`/stakeholder/zonas/${slug}/agregaciones?window=30d`),
    enabled: !!slug,
    staleTime: 60_000,
  });
}
