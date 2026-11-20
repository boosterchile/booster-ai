import { type PanelBoosterFleet, panelBoosterFleetSchema } from '@booster-ai/shared-schemas';
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
 * Qué pasa con la lectura de combustible que se está mostrando:
 * `en_curso` si no está al día y se está pidiendo una nueva, `fallo` si esa
 * petición no resultó. Null cuando lo que se muestra está al día.
 */
export type ActualizacionCombustible = 'en_curso' | 'fallo' | null;

function validar(crudo: unknown): PanelBoosterFleet {
  const parsed = panelBoosterFleetSchema.safeParse(crudo);
  if (!parsed.success) {
    throw new Error('La respuesta de Booster Fleet no tiene la forma esperada.');
  }
  return parsed.data;
}

/**
 * El panel de Booster Fleet, validado contra su esquema. El overview y el
 * detalle del vehículo comparten la misma consulta y la misma caché.
 *
 * Leer el combustible de la semana toma varios segundos, así que el panel se
 * pide aceptando la última lectura guardada
 * (`.specs/booster-fleet-lectura-sin-espera`). Si esa lectura no está al
 * día, se muestra igual y se pide una nueva, que la reemplaza al llegar.
 */
export function usePanelBoosterFleet() {
  const scope = useEmpresaScope();
  const cliente = useQueryClient();
  const clave = scope.key('booster-fleet');
  const consulta = useQuery({
    queryKey: clave,
    retry: false,
    queryFn: async () =>
      validar(await api.get<unknown>('/booster-fleet?combustible=guardada', scope.init)),
  });
  const pideNueva = consulta.data?.combustible.al_dia === false;
  const nueva = useQuery({
    queryKey: scope.key('booster-fleet', 'al-dia'),
    enabled: pideNueva,
    retry: false,
    // Cada vez que hace falta se pide de nuevo: no se reutiliza una anterior.
    gcTime: 0,
    queryFn: async () => {
      const panel = validar(await api.get<unknown>('/booster-fleet', scope.init));
      cliente.setQueryData(clave, panel);
      return panel;
    },
  });
  let actualizacion: ActualizacionCombustible = null;
  if (pideNueva) {
    actualizacion = nueva.isError ? 'fallo' : 'en_curso';
  }
  const invalidar = () => cliente.invalidateQueries({ queryKey: clave });
  return { consulta, invalidar, actualizacion };
}
