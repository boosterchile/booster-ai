import {
  type SolicitudBooster,
  type TipoSolicitudBooster,
  respuestaPedirABoosterSchema,
} from '@booster-ai/shared-schemas';
import { Button, cn } from '@booster-ai/ui-components';
import { useMutation } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { api } from '../lib/api-client.js';

/**
 * «Pedir a Booster» (`.specs/frente2-cierre` §3.4, decisión D3 del PO): crea
 * una solicitud que el personal de Booster ve en su panel. El API devuelve la
 * misma si ya había una abierta, así que en los dos casos se muestra
 * «Pedido a Booster».
 */
export function PedirABooster({
  vehiculoId,
  tipo,
  className,
}: {
  vehiculoId: string;
  tipo: TipoSolicitudBooster;
  className?: string;
}) {
  const pedir = useMutation({
    mutationFn: async (): Promise<SolicitudBooster> => {
      const crudo = await api.post<unknown>(`/vehiculos/${vehiculoId}/pedir-booster`, { tipo });
      const leido = respuestaPedirABoosterSchema.safeParse(crudo);
      if (!leido.success) {
        throw new Error('La respuesta de la solicitud no es válida.');
      }
      return leido.data.solicitud;
    },
  });

  if (pedir.isSuccess) {
    return (
      <output className={cn('inline-flex items-center gap-1 text-neutral-700 text-sm', className)}>
        <Check className="h-4 w-4 text-primary-700" aria-hidden />
        Pedido a Booster
      </output>
    );
  }
  return (
    <span className={cn('inline-flex flex-col gap-1', className)}>
      <Button
        variant="link"
        size="inline"
        type="button"
        className="whitespace-nowrap text-sm"
        loading={pedir.isPending}
        onClick={() => pedir.mutate()}
      >
        Pedir a Booster
      </Button>
      {pedir.isError ? (
        <span className="text-danger-700 text-xs">
          No se pudo pedir a Booster. Intenta de nuevo.
        </span>
      ) : null}
    </span>
  );
}
