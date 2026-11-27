import {
  type CargaCombustible,
  LITROS_CARGA_MAX,
  listaCargasCombustibleSchema,
  respuestaCargaCombustibleSchema,
} from '@booster-ai/shared-schemas';
import { Button } from '@booster-ai/ui-components';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { ApiError, api } from '../lib/api-client.js';
import { FormField, inputClass } from './FormField.js';

/**
 * Registro de cargas de combustible (`.specs/registro-cargas-combustible`,
 * D4 del PO). Con los litros cargados Booster compara lo cargado contra lo que
 * quemó el motor: así se ven las pérdidas chicas que el nivel no alcanza a ver.
 */

const FORMATO_FECHA = new Intl.DateTimeFormat('es-CL', {
  timeZone: 'America/Santiago',
  dateStyle: 'medium',
  timeStyle: 'short',
});
const FORMATO_LITROS = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 });

/** `YYYY-MM-DDTHH:mm` en hora local del navegador, para `datetime-local`. */
function ahoraLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** El valor de `datetime-local` (hora local del navegador) en ISO UTC. */
function localAIso(local: string): string | null {
  const ms = new Date(local).getTime();
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function mensajeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'carga_duplicada') {
      return 'Esa carga ya está registrada.';
    }
    if (err.status === 400) {
      return 'Revisa la fecha y los litros: la fecha no puede estar en el futuro y los litros van de 0,1 a 2.000.';
    }
  }
  return 'No se pudo registrar la carga. Intenta de nuevo.';
}

export function CargasCombustibleSeccion({ vehiculoId }: { vehiculoId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ['vehiculos', vehiculoId, 'cargas-combustible'];
  const [fecha, setFecha] = useState(ahoraLocal);
  const [litros, setLitros] = useState('');
  const [lugar, setLugar] = useState('');
  const [errorForm, setErrorForm] = useState<string | null>(null);
  const [registrada, setRegistrada] = useState(false);
  const [porAnular, setPorAnular] = useState<string | null>(null);

  const cargasQ = useQuery({
    queryKey,
    queryFn: async (): Promise<CargaCombustible[]> => {
      const crudo = await api.get<unknown>(`/vehiculos/${vehiculoId}/cargas-combustible`);
      const leido = listaCargasCombustibleSchema.safeParse(crudo);
      if (!leido.success) {
        throw new Error('La lista de cargas no es válida.');
      }
      return leido.data.cargas;
    },
  });

  const registrarM = useMutation({
    mutationFn: async (body: { cargada_en: string; litros: number; lugar?: string }) => {
      const crudo = await api.post<unknown>(`/vehiculos/${vehiculoId}/cargas-combustible`, body);
      const leido = respuestaCargaCombustibleSchema.safeParse(crudo);
      if (!leido.success) {
        throw new Error('La respuesta del registro no es válida.');
      }
      return leido.data.carga;
    },
    onSuccess: async () => {
      setLitros('');
      setLugar('');
      setRegistrada(true);
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (err) => setErrorForm(mensajeError(err)),
  });

  const anularM = useMutation({
    mutationFn: async (cargaId: string) => {
      await api.delete<unknown>(`/vehiculos/${vehiculoId}/cargas-combustible/${cargaId}`);
    },
    onSuccess: async () => {
      setPorAnular(null);
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setErrorForm(null);
    setRegistrada(false);
    const cargadaEn = localAIso(fecha);
    const numero = Number(litros.replace(',', '.'));
    if (!cargadaEn) {
      setErrorForm('Indica la fecha y hora de la carga.');
      return;
    }
    if (!Number.isFinite(numero) || numero <= 0 || numero > LITROS_CARGA_MAX) {
      setErrorForm('Los litros van de 0,1 a 2.000.');
      return;
    }
    registrarM.mutate({
      cargada_en: cargadaEn,
      litros: numero,
      ...(lugar.trim() ? { lugar: lugar.trim() } : {}),
    });
  }

  return (
    <section
      aria-labelledby="cargas-combustible-titulo"
      className="rounded-lg border border-neutral-200 bg-white px-4 py-4"
    >
      <h2 id="cargas-combustible-titulo" className="font-semibold text-neutral-900 text-xl">
        Cargas de combustible
      </h2>
      <p className="mt-1 text-neutral-600 text-sm">
        Con las cargas registradas, Booster compara lo que se cargó con lo que quemó el motor. Así
        se ven las pérdidas chicas que el sensor de nivel no alcanza a ver.
      </p>

      <form
        onSubmit={onSubmit}
        className="mt-4 grid gap-3 sm:grid-cols-[1fr_8rem_1fr_auto] sm:items-end"
        noValidate
      >
        <FormField
          label="Fecha y hora"
          required
          render={({ id, describedBy, invalid }) => (
            <input
              id={id}
              type="datetime-local"
              className={inputClass(invalid)}
              value={fecha}
              max={ahoraLocal()}
              aria-describedby={describedBy}
              onChange={(e) => setFecha(e.target.value)}
            />
          )}
        />
        <FormField
          label="Litros"
          required
          render={({ id, describedBy, invalid }) => (
            <input
              id={id}
              type="text"
              inputMode="decimal"
              className={inputClass(invalid)}
              value={litros}
              aria-describedby={describedBy}
              onChange={(e) => setLitros(e.target.value)}
            />
          )}
        />
        <FormField
          label="Lugar (opcional)"
          render={({ id, describedBy, invalid }) => (
            <input
              id={id}
              type="text"
              maxLength={200}
              className={inputClass(invalid)}
              value={lugar}
              aria-describedby={describedBy}
              onChange={(e) => setLugar(e.target.value)}
            />
          )}
        />
        <Button type="submit" loading={registrarM.isPending}>
          Registrar carga
        </Button>
      </form>
      {errorForm ? (
        <p role="alert" className="mt-2 text-danger-700 text-sm">
          {errorForm}
        </p>
      ) : null}
      {registrada ? (
        <output className="mt-2 block text-primary-800 text-sm">Carga registrada.</output>
      ) : null}

      <div className="mt-5">
        {cargasQ.isLoading ? <p className="text-neutral-500 text-sm">Cargando cargas…</p> : null}
        {cargasQ.isError ? (
          <p className="text-danger-700 text-sm">No se pudieron leer las cargas registradas.</p>
        ) : null}
        {cargasQ.data && cargasQ.data.length === 0 ? (
          <p className="text-neutral-600 text-sm">Todavía no hay cargas registradas.</p>
        ) : null}
        {cargasQ.data && cargasQ.data.length > 0 ? (
          <ul aria-label="Cargas registradas" className="divide-y divide-neutral-200">
            {cargasQ.data.map((carga) => (
              <li
                key={carga.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm"
              >
                <span className="text-neutral-900">
                  {FORMATO_FECHA.format(new Date(carga.cargada_en))}
                </span>
                <span className="font-medium text-neutral-900">
                  {FORMATO_LITROS.format(carga.litros)} L
                </span>
                <span className="text-neutral-600">{carga.lugar ?? 'Sin lugar'}</span>
                <span className="ml-auto">
                  {porAnular === carga.id ? (
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <span className="text-neutral-800">¿Anular esta carga?</span>
                      <Button
                        variant="danger"
                        size="sm"
                        type="button"
                        loading={anularM.isPending}
                        onClick={() => anularM.mutate(carga.id)}
                      >
                        Sí, anular
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        type="button"
                        onClick={() => setPorAnular(null)}
                      >
                        Cancelar
                      </Button>
                    </span>
                  ) : (
                    <Button
                      variant="link"
                      size="inline"
                      type="button"
                      onClick={() => setPorAnular(carga.id)}
                    >
                      Anular
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {anularM.isError ? (
          <p role="alert" className="mt-2 text-danger-700 text-sm">
            No se pudo anular la carga. Intenta de nuevo.
          </p>
        ) : null}
      </div>
    </section>
  );
}
