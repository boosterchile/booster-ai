import { panelBoosterFleetSchema } from '@booster-ai/shared-schemas';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeResponse } from '../../hooks/use-me.js';
import { api } from '../../lib/api-client.js';
import { useEmpresaScope } from '../../lib/empresa-activa.js';

export type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

/** Booster Fleet es del dueño o del admin de un transportista. */
export function puedeVerBoosterFleet(me: MeOnboarded): boolean {
  const membresia = me.active_membership;
  return (
    membresia?.empresa?.is_transportista === true &&
    (membresia.role === 'dueno' || membresia.role === 'admin')
  );
}

/**
 * El panel de Booster Fleet, validado contra su esquema. El overview y el
 * detalle del vehículo comparten la misma consulta y la misma caché.
 */
export function usePanelBoosterFleet() {
  const scope = useEmpresaScope();
  const cliente = useQueryClient();
  const consulta = useQuery({
    queryKey: scope.key('booster-fleet'),
    retry: false,
    queryFn: async () => {
      const crudo = await api.get<unknown>('/booster-fleet', scope.init);
      const parsed = panelBoosterFleetSchema.safeParse(crudo);
      if (!parsed.success) {
        throw new Error('La respuesta de Booster Fleet no tiene la forma esperada.');
      }
      return parsed.data;
    },
  });
  const invalidar = () => cliente.invalidateQueries({ queryKey: scope.key('booster-fleet') });
  return { consulta, invalidar };
}
