import { Button } from '@booster-ai/ui-components';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { ApiError, api } from '../../lib/api-client.js';
import { useEmpresaScope } from '../../lib/empresa-activa.js';

export function mensajeDe(error: unknown): string {
  if (error instanceof ApiError && error.message.length > 0) {
    return error.message;
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return 'No se pudo completar la acción.';
}

function hoySantiago(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

const CAMPO =
  'mt-1 block w-full rounded-md border border-neutral-300 bg-neutral-0 px-3 py-2 text-sm';

/**
 * Formulario «Programar mantención». Mismos campos y la misma llamada que
 * la pantalla anterior; cambia dónde vive (modal o estado vacío).
 */
export function FormularioMantencion({
  vehiculos,
  onProgramada,
}: {
  vehiculos: ReadonlyArray<{ vehiculo_id: string; patente: string }>;
  onProgramada: () => Promise<void> | void;
}) {
  const scope = useEmpresaScope();
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [titulo, setTitulo] = useState('');
  const programar = useMutation({
    mutationFn: (body: {
      vehiculo_id: string;
      tipo: 'preventiva' | 'correctiva' | 'inspeccion';
      titulo: string;
      programada_para: string;
      kilometraje_objetivo?: number;
    }) => api.post('/booster-fleet/mantenciones', body, scope.init),
    onSuccess: async () => {
      setError(null);
      setTitulo('');
      await onProgramada();
    },
    onError: (err: unknown) => setError(mensajeDe(err)),
  });

  function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const tipo = String(data.get('tipo') ?? 'preventiva');
    const km = String(data.get('kilometraje_objetivo') ?? '');
    if (tipo !== 'preventiva' && tipo !== 'correctiva' && tipo !== 'inspeccion') {
      setError('El tipo de mantención no es válido.');
      return;
    }
    programar.mutate({
      vehiculo_id: String(data.get('vehiculo_id') ?? ''),
      tipo,
      titulo,
      programada_para: String(data.get('programada_para') ?? ''),
      ...(km.length > 0 ? { kilometraje_objetivo: Number(km) } : {}),
    });
  }

  return (
    <form onSubmit={enviar} className="grid gap-3 sm:grid-cols-2">
      <label htmlFor={`${id}-vehiculo`} className="font-medium text-neutral-700 text-sm">
        Vehículo
        <select id={`${id}-vehiculo`} name="vehiculo_id" required className={CAMPO}>
          {vehiculos.map((vehiculo) => (
            <option key={vehiculo.vehiculo_id} value={vehiculo.vehiculo_id}>
              {vehiculo.patente}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={`${id}-tipo`} className="font-medium text-neutral-700 text-sm">
        Tipo
        <select id={`${id}-tipo`} name="tipo" className={CAMPO}>
          <option value="preventiva">Preventiva</option>
          <option value="correctiva">Correctiva</option>
          <option value="inspeccion">Inspección</option>
        </select>
      </label>
      <label
        htmlFor={`${id}-titulo`}
        className="font-medium text-neutral-700 text-sm sm:col-span-2"
      >
        Qué hay que hacer
        <input
          id={`${id}-titulo`}
          name="titulo"
          value={titulo}
          onChange={(event) => setTitulo(event.target.value)}
          required
          minLength={3}
          className={CAMPO}
        />
      </label>
      <label htmlFor={`${id}-fecha`} className="font-medium text-neutral-700 text-sm">
        Fecha
        <input
          id={`${id}-fecha`}
          type="date"
          name="programada_para"
          required
          defaultValue={hoySantiago()}
          className={CAMPO}
        />
      </label>
      <label htmlFor={`${id}-km`} className="font-medium text-neutral-700 text-sm">
        Kilometraje objetivo (opcional)
        <input id={`${id}-km`} name="kilometraje_objetivo" inputMode="numeric" className={CAMPO} />
      </label>
      <div className="sm:col-span-2">
        <Button type="submit" loading={programar.isPending} disabled={vehiculos.length === 0}>
          Guardar mantención
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-danger-700 text-sm sm:col-span-2">
          {error}
        </p>
      )}
    </form>
  );
}
