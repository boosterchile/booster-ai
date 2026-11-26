import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../../lib/api-client.js';
import { useEmpresaScope } from '../../lib/empresa-activa.js';
import { campoPorPresentacion, porPresentacionSchema } from '../../lib/presentacion-huella.js';
import { mesEnCurso } from '../inicio/cuando.js';
import { TotalHuella } from './CifraHuella.js';

/**
 * Huella del mes de la empresa transportista (`.specs/frente2-cierre` §3.1):
 * la misma en el Inicio del servicio completo y en el de Booster Fleet. Lee
 * `GET /assignments/huella-mes`, separada por presentación de ADR-091.
 */
const respuestaSchema = z.object({
  resumen: z.object({ certificados: z.number(), por_presentacion: porPresentacionSchema }),
});

export type DatosHuellaDelMes = z.infer<typeof respuestaSchema>;

export interface EstadoHuellaDelMes {
  isError: boolean;
  data: DatosHuellaDelMes | undefined;
}

/** La consulta, aparte de la vista: el Inicio del transportista es una vista pura. */
export function useHuellaDelMes(): EstadoHuellaDelMes {
  const scope = useEmpresaScope();
  return useQuery({
    queryKey: scope.key('assignments', 'huella-mes'),
    queryFn: async () =>
      respuestaSchema.parse(await api.get<unknown>('/assignments/huella-mes', scope.init)),
  });
}

/** Lee la huella del mes y la muestra (Booster Fleet). */
export function HuellaDelMes({ ahora = new Date() }: { ahora?: Date }) {
  return <HuellaDelMesVista estado={useHuellaDelMes()} ahora={ahora} />;
}

export function HuellaDelMesVista({
  estado: q,
  ahora = new Date(),
}: {
  estado: EstadoHuellaDelMes;
  ahora?: Date;
}) {
  return (
    <section
      aria-labelledby="huella-mes-titulo"
      data-testid="huella-mes"
      className="rounded-lg border border-neutral-200 bg-white p-4"
    >
      <h2 id="huella-mes-titulo" className="font-medium text-neutral-500 text-xs">
        Huella {mesEnCurso(ahora)}
      </h2>
      {q.isError ? (
        <p role="alert" className="mt-2 text-danger-700 text-sm">
          No se pudo leer la huella del mes.
        </p>
      ) : q.data ? (
        <>
          <TotalHuella
            porPresentacion={campoPorPresentacion(q.data.resumen.por_presentacion, 'kgco2e')}
            vacio="Sin viajes certificados este mes"
            className="mt-2 font-semibold text-base text-neutral-900"
            data-testid="huella-mes-total"
          />
          {q.data.resumen.certificados > 0 ? (
            <p className="mt-1 text-neutral-600 text-xs">
              {q.data.resumen.certificados === 1
                ? '1 viaje certificado'
                : `${q.data.resumen.certificados} viajes certificados`}
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-neutral-500 text-sm">Cargando…</p>
      )}
    </section>
  );
}
