import {
  ETIQUETA_TIPO_SOLICITUD_BOOSTER,
  FUENTES_COMBUSTIBLE_CAN,
  type FuenteCombustibleCan,
  type SolicitudBoosterAbierta,
  listaSolicitudesBoosterSchema,
} from '@booster-ai/shared-schemas';
import { Button } from '@booster-ai/ui-components';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { PlatformAdminFrame } from '../components/admin/PlatformAdminFrame.js';
import { ApiError, api } from '../lib/api-client.js';

/**
 * `.specs/frente2-cierre` §3.4 (D3 del PO): las solicitudes «Pedir a Booster»
 * abiertas de todas las empresas y «Marcar resuelta». Lee
 * `GET /admin/plataforma/solicitudes`.
 */
export function PlatformAdminSolicitudesRoute() {
  return (
    <ProtectedRoute meRequirement="skip">
      {() => (
        <PlatformAdminFrame volver={{ to: '/app/platform-admin', label: 'Volver' }}>
          <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">
            Solicitudes a Booster
          </h1>
          <p className="mt-2 max-w-2xl text-neutral-600 text-sm">
            Lo que las empresas piden con «Pedir a Booster», la más antigua primero. En una fuente
            de combustible, elige la fuente CAN que configuraste: al marcarla resuelta queda
            guardada en el camión.
          </p>
          <SolicitudesBooster />
        </PlatformAdminFrame>
      )}
    </ProtectedRoute>
  );
}

const CLAVE = ['admin', 'plataforma', 'solicitudes'] as const;

const FECHA = new Intl.DateTimeFormat('es-CL', {
  timeZone: 'America/Santiago',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function formatoFecha(iso: string): string {
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime()) ? iso : FECHA.format(fecha);
}

function SolicitudesBooster() {
  const queryClient = useQueryClient();
  const [aviso, setAviso] = useState<string | null>(null);

  const listaQ = useQuery({
    queryKey: CLAVE,
    queryFn: async () => {
      const crudo = await api.get<unknown>('/admin/plataforma/solicitudes');
      const leido = listaSolicitudesBoosterSchema.safeParse(crudo);
      if (!leido.success) {
        throw new Error('La respuesta de las solicitudes no es válida.');
      }
      return leido.data.solicitudes;
    },
  });

  const resolver = useMutation({
    // `.specs/frente2-cierre` D3: la fuente CAN que se configuró se guarda en
    // el camión al resolver; el dueño ya no la edita.
    mutationFn: async (v: { id: string; fuente: FuenteCombustibleCan | null }) =>
      api.post<unknown>(
        `/admin/plataforma/solicitudes/${v.id}/resolver`,
        v.fuente ? { fuente_combustible_can: v.fuente } : {},
      ),
    onSuccess: () => {
      setAviso(null);
    },
    onError: (err: Error) => {
      setAviso(
        err instanceof ApiError && err.code === 'solicitud_ya_resuelta'
          ? 'Otra persona de Booster ya la resolvió.'
          : `No se pudo marcar resuelta: ${err.message}`,
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: CLAVE }),
  });

  if (listaQ.isLoading) {
    return (
      <p className="mt-6 flex items-center gap-2 text-neutral-600 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cargando las solicitudes…
      </p>
    );
  }
  if (listaQ.error) {
    return (
      <p role="alert" className="mt-6 rounded-md bg-danger-50 p-3 text-danger-700 text-sm">
        No se pudieron leer las solicitudes: {listaQ.error.message}
      </p>
    );
  }
  const solicitudes = listaQ.data ?? [];

  return (
    <div className="mt-6">
      {aviso ? (
        <output className="mb-3 block rounded-md bg-neutral-100 p-3 text-neutral-800 text-sm">
          {aviso}
        </output>
      ) : null}
      {solicitudes.length === 0 ? (
        <p className="rounded-lg border border-neutral-300 border-dashed p-6 text-center text-neutral-600 text-sm">
          No hay solicitudes abiertas.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="bg-neutral-50 text-neutral-600 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2 font-medium">Empresa</th>
                <th className="px-3 py-2 font-medium">Patente</th>
                <th className="px-3 py-2 font-medium">Pide</th>
                <th className="px-3 py-2 font-medium">Pedida</th>
                <th className="px-3 py-2 font-medium">
                  <span className="sr-only">Acción</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {solicitudes.map((s) => (
                <FilaSolicitud
                  key={s.id}
                  solicitud={s}
                  resolviendo={resolver.isPending && resolver.variables?.id === s.id}
                  onResolver={(fuente) => resolver.mutate({ id: s.id, fuente })}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilaSolicitud({
  solicitud,
  resolviendo,
  onResolver,
}: {
  solicitud: SolicitudBoosterAbierta;
  resolviendo: boolean;
  onResolver: (fuente: FuenteCombustibleCan | null) => void;
}) {
  const pideFuente =
    solicitud.tipo === 'configurar_fuente_combustible' && solicitud.vehiculo !== null;
  const [fuente, setFuente] = useState<FuenteCombustibleCan | ''>('');
  return (
    <tr data-testid="solicitud-booster">
      <td className="px-3 py-2 text-neutral-800">{solicitud.empresa.nombre}</td>
      <td className="px-3 py-2 font-mono text-neutral-900">
        {solicitud.vehiculo ? (
          solicitud.vehiculo.patente
        ) : (
          <span className="font-sans text-neutral-500">Sin vehículo</span>
        )}
      </td>
      <td className="px-3 py-2 text-neutral-800">
        {ETIQUETA_TIPO_SOLICITUD_BOOSTER[solicitud.tipo]}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-neutral-600">
        {formatoFecha(solicitud.creada_en)}
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {pideFuente ? (
            <label className="flex items-center gap-1 text-neutral-700 text-xs">
              Fuente CAN
              <select
                value={fuente}
                onChange={(e) => setFuente(e.target.value as FuenteCombustibleCan | '')}
                className="rounded-md border border-neutral-300 px-2 py-1 text-xs"
                data-testid="solicitud-fuente-can"
              >
                <option value="">Sin cambiarla</option>
                {FUENTES_COMBUSTIBLE_CAN.map((f) => (
                  <option key={f} value={f}>
                    {f === 'sin_sensor' ? 'Sin sensor' : `IO ${f}`}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            loading={resolviendo}
            onClick={() => onResolver(fuente === '' ? null : fuente)}
          >
            Marcar resuelta
          </Button>
        </div>
      </td>
    </tr>
  );
}
