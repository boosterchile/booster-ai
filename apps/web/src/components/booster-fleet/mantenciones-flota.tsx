import type { PanelBoosterFleet } from '@booster-ai/shared-schemas';
import { Button, Modal, cn } from '@booster-ai/ui-components';
import { useMutation } from '@tanstack/react-query';
import { Wrench } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../lib/api-client.js';
import { useEmpresaScope } from '../../lib/empresa-activa.js';
import { EmptyState } from '../EmptyState.js';
import { EtiquetaSeveridad, Patente } from './etiqueta-severidad.js';
import { FormularioMantencion, mensajeDe } from './formulario-mantencion.js';
import { ETIQUETA_MANTENCION, TONO_MANTENCION, contar, formatoFecha } from './reglas.js';

type Mantencion = PanelBoosterFleet['mantenciones']['items'][number];

const TIPO: Record<Mantencion['tipo'], string> = {
  preventiva: 'Preventiva',
  correctiva: 'Correctiva',
  inspeccion: 'Inspección',
};

/** Una mantención abierta: la fecha como ancla, el estado y sus dos acciones. */
export function CardMantencion({
  item,
  ocupado,
  onRealizar,
  onCancelar,
}: {
  item: Mantencion;
  ocupado: boolean;
  onRealizar: () => void;
  onCancelar: () => void;
}) {
  const [dia, mes] = (formatoFecha(item.programada_para) ?? item.programada_para).split(' ');
  const vencida = item.estado === 'vencida';
  return (
    <li className="flex gap-3 border-neutral-200 border-t px-4 py-3">
      <div
        className={cn(
          'flex h-11 w-11 flex-none flex-col items-center justify-center rounded-md border',
          vencida
            ? 'border-danger-600 bg-danger-50 text-danger-700'
            : 'border-neutral-200 bg-neutral-50 text-neutral-900',
        )}
      >
        <span className="font-semibold leading-none">{dia}</span>
        <span className="mt-0.5 text-[10px] uppercase leading-none tracking-wider">{mes}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2 text-sm">
          <Patente>{item.patente}</Patente>
          <span className="font-medium text-neutral-900">{item.titulo}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <EtiquetaSeveridad tono={TONO_MANTENCION[item.estado]}>
            {ETIQUETA_MANTENCION[item.estado]}
          </EtiquetaSeveridad>
          <span className="text-neutral-600 text-xs">
            {TIPO[item.tipo]}
            {item.notas ? ` · ${item.notas}` : ''}
          </span>
        </div>
        {item.estado !== 'realizada' ? (
          <div className="mt-2 flex gap-2">
            <Button
              variant="secondary"
              disabled={ocupado}
              onClick={onRealizar}
              aria-label={`Marcar realizada: ${item.titulo}, ${item.patente}`}
            >
              Marcar realizada
            </Button>
            <Button
              variant="ghost"
              disabled={ocupado}
              onClick={onCancelar}
              aria-label={`Cancelar: ${item.titulo}, ${item.patente}`}
            >
              Cancelar
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Mantenciones abiertas y camiones en taller. Sin mantenciones aparece el
 * estado vacío con el formulario a la vista. Cancelar confirma en un modal.
 */
export function MantencionesFlota({
  mantenciones,
  vehiculos,
  onCambio,
}: {
  mantenciones: PanelBoosterFleet['mantenciones'];
  vehiculos: ReadonlyArray<{ vehiculo_id: string; patente: string }>;
  onCambio: () => Promise<void>;
}) {
  const scope = useEmpresaScope();
  const [error, setError] = useState<string | null>(null);
  const [porCancelar, setPorCancelar] = useState<Mantencion | null>(null);
  const cerrar = useMutation({
    mutationFn: async (accion: { id: string; tipo: 'realizar' | 'cancelar' }) => {
      const path = `/booster-fleet/mantenciones/${accion.id}/${accion.tipo}`;
      if (accion.tipo === 'cancelar') {
        return await api.post(path, undefined, scope.init);
      }
      return await api.post(path, {}, scope.init);
    },
    onSuccess: async () => {
      setError(null);
      await onCambio();
    },
    onError: (err: unknown) => setError(mensajeDe(err)),
  });

  return (
    <section
      aria-labelledby="mantenciones-titulo"
      className="overflow-hidden rounded-lg border border-neutral-200 bg-neutral-0"
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <h2
          id="mantenciones-titulo"
          className="flex items-center gap-2 font-semibold text-neutral-900"
        >
          <Wrench className="h-4 w-4" aria-hidden /> Mantenciones
        </h2>
        <p className="text-neutral-600 text-xs">
          {mantenciones.items.length === 0
            ? 'Ninguna abierta'
            : `${contar(mantenciones.vencidas, 'vencida', 'vencidas')} · ${contar(mantenciones.proximas, 'próxima', 'próximas')}`}
        </p>
      </div>
      {mantenciones.en_taller.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-neutral-200 border-t px-4 py-2.5 text-neutral-600 text-sm">
          En taller
          {mantenciones.en_taller.map((vehiculo) => (
            <Patente key={vehiculo.vehiculo_id}>{vehiculo.patente}</Patente>
          ))}
        </div>
      ) : null}
      {mantenciones.truncadas ? (
        <p className="border-neutral-200 border-t bg-warning-50 px-4 py-2 text-sm text-warning-700">
          Hay más mantenciones de las que entran en esta lista.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="border-neutral-200 border-t px-4 py-2 text-danger-700 text-sm">
          {error}
        </p>
      ) : null}
      {mantenciones.items.length === 0 ? (
        <div className="space-y-4 border-neutral-200 border-t p-4">
          <EmptyState
            icon={<Wrench className="h-6 w-6" aria-hidden />}
            title="Taller en silencio."
            description="No hay mantenciones abiertas. Buen momento para dejar agendada la próxima, antes de que algún camión avise solo."
          />
          <FormularioMantencion vehiculos={vehiculos} onProgramada={onCambio} />
        </div>
      ) : (
        <ul>
          {mantenciones.items.map((item) => (
            <CardMantencion
              key={item.id}
              item={item}
              ocupado={cerrar.isPending}
              onRealizar={() => cerrar.mutate({ id: item.id, tipo: 'realizar' })}
              onCancelar={() => setPorCancelar(item)}
            />
          ))}
        </ul>
      )}
      <Modal
        isOpen={porCancelar != null}
        onOpenChange={(abierto) => {
          if (!abierto) {
            setPorCancelar(null);
          }
        }}
        isDismissable={false}
        title="¿Cancelar la mantención?"
      >
        {({ close }) => (
          <>
            <p className="text-neutral-700 text-sm">
              «{porCancelar?.titulo}» de {porCancelar?.patente} sale del panel y no vuelve.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" autoFocus onClick={close}>
                Volver
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  if (porCancelar) {
                    cerrar.mutate({ id: porCancelar.id, tipo: 'cancelar' });
                  }
                  close();
                }}
              >
                Sí, cancelar
              </Button>
            </div>
          </>
        )}
      </Modal>
    </section>
  );
}
