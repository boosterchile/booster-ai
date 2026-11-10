import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { ApiError, api } from '../../lib/api-client.js';

/**
 * «Contacto y notas» en el detalle de la carga del generador (spec
 * editar-anular-cargas §6.2, §9). Destinatario, notas y referencia: se editan
 * sin aceptación del transportista en todo estado no terminal. La transportista
 * y el conductor reciben un aviso cuando cambian.
 */

export interface DatosLibresCarga {
  consignee: { name: string | null; phone_e164: string | null; email: string | null };
  notes: string | null;
  reference: string | null;
}

export function mensajeErrorDatosLibres(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'sin_cambios':
        return 'No cambiaste ningún dato.';
      case 'trip_not_editable':
        return 'Esta carga ya terminó: sus datos no se pueden cambiar.';
      case 'read_only':
      case 'capability_denied':
        return 'Tu rol no puede editar esta carga.';
    }
    if (err.status === 400) {
      return 'Revisa los datos: el teléfono va como +56912345678 y el correo como nombre@empresa.cl.';
    }
  }
  return 'No pudimos guardar los cambios. Inténtalo de nuevo.';
}

export function ContactoYNotasCard({
  tripId,
  datos,
  editable,
}: {
  tripId: string;
  datos: DatosLibresCarga;
  editable: boolean;
}) {
  const [editando, setEditando] = useState(false);
  const [enlaceRenovado, setEnlaceRenovado] = useState(false);
  return (
    <section
      aria-labelledby={`contacto-${tripId}`}
      className="rounded-lg border border-neutral-200 bg-white p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 id={`contacto-${tripId}`} className="font-semibold text-neutral-900 text-sm">
          Contacto y notas
        </h3>
        {editable && !editando && (
          <button
            type="button"
            onClick={() => {
              setEnlaceRenovado(false);
              setEditando(true);
            }}
            className="shrink-0 rounded-md border border-neutral-300 px-3 py-1.5 font-medium text-neutral-800 text-xs"
          >
            Editar
          </button>
        )}
      </div>
      {editando ? (
        <Formulario
          tripId={tripId}
          datos={datos}
          onGuardado={(renovado) => {
            setEnlaceRenovado(renovado);
            setEditando(false);
          }}
          onCancelar={() => setEditando(false)}
        />
      ) : (
        <>
          {enlaceRenovado && (
            <output className="mt-3 block rounded-md bg-neutral-100 px-3 py-2 text-neutral-800 text-sm">
              El enlace de seguimiento cambió. El anterior dejó de funcionar.
            </output>
          )}
          <Resumen datos={datos} />
        </>
      )}
    </section>
  );
}

function Resumen({ datos }: { datos: DatosLibresCarga }) {
  const { consignee, notes, reference } = datos;
  const sinDestinatario = !consignee.name && !consignee.phone_e164 && !consignee.email;
  return (
    <dl className="mt-3 space-y-2 text-sm">
      <div>
        <dt className="text-neutral-500 text-xs">Destinatario</dt>
        <dd className="text-neutral-900">
          {sinDestinatario
            ? 'Sin datos'
            : [consignee.name, consignee.phone_e164, consignee.email].filter(Boolean).join(' · ')}
        </dd>
      </div>
      <div>
        <dt className="text-neutral-500 text-xs">Notas para el transportista</dt>
        <dd className="whitespace-pre-line text-neutral-900">{notes ?? 'Sin notas'}</dd>
      </div>
      <div>
        <dt className="text-neutral-500 text-xs">Referencia</dt>
        <dd className="text-neutral-900">{reference ?? 'Sin referencia'}</dd>
      </div>
    </dl>
  );
}

function Formulario({
  tripId,
  datos,
  onGuardado,
  onCancelar,
}: {
  tripId: string;
  datos: DatosLibresCarga;
  onGuardado: (enlaceRenovado: boolean) => void;
  onCancelar: () => void;
}) {
  const queryClient = useQueryClient();
  const [nombre, setNombre] = useState(datos.consignee.name ?? '');
  const [telefono, setTelefono] = useState(datos.consignee.phone_e164 ?? '');
  const [correo, setCorreo] = useState(datos.consignee.email ?? '');
  const [notas, setNotas] = useState(datos.notes ?? '');
  const [referencia, setReferencia] = useState(datos.reference ?? '');
  const [error, setError] = useState<string | null>(null);

  const guardar = useMutation({
    mutationFn: () => {
      const n = nombre.trim();
      const t = telefono.trim();
      const e = correo.trim();
      const consignee =
        n || t || e
          ? {
              ...(n ? { name: n } : {}),
              ...(t ? { phone_e164: t } : {}),
              ...(e ? { email: e } : {}),
            }
          : null;
      return api.patch<{
        trip_request: { enlace_seguimiento_renovado?: boolean };
      }>(`/trip-requests-v2/${tripId}/datos-libres`, {
        consignee,
        notes: notas,
        reference: referencia,
      });
    },
    onSuccess: (respuesta) => {
      queryClient.invalidateQueries({ queryKey: ['cargas', tripId] });
      onGuardado(respuesta.trip_request.enlace_seguimiento_renovado === true);
    },
    onError: (err) => setError(mensajeErrorDatosLibres(err)),
  });

  function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    guardar.mutate();
  }

  const campo = 'mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2';
  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-3" noValidate>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="font-medium text-neutral-800">Nombre del destinatario</span>
          <input
            type="text"
            maxLength={100}
            value={nombre}
            onChange={(ev) => setNombre(ev.target.value)}
            className={campo}
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-neutral-800">WhatsApp del destinatario</span>
          <input
            type="tel"
            inputMode="tel"
            value={telefono}
            onChange={(ev) => setTelefono(ev.target.value)}
            placeholder="+56912345678"
            className={campo}
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-neutral-800">Correo del destinatario</span>
          <input
            type="email"
            inputMode="email"
            maxLength={254}
            value={correo}
            onChange={(ev) => setCorreo(ev.target.value)}
            placeholder="recepcion@empresa.cl"
            className={campo}
          />
        </label>
      </div>
      <label className="block text-sm">
        <span className="font-medium text-neutral-800">Notas para el transportista</span>
        <textarea
          rows={3}
          maxLength={1000}
          value={notas}
          onChange={(ev) => setNotas(ev.target.value)}
          placeholder="Horario de recepción, andén, a quién preguntar"
          className={campo}
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-neutral-800">Referencia</span>
        <input
          type="text"
          maxLength={100}
          value={referencia}
          onChange={(ev) => setReferencia(ev.target.value)}
          placeholder="Tu número de pedido u orden"
          className={campo}
        />
      </label>
      <p className="text-neutral-500 text-xs">
        Si la carga ya tiene transportista, le avisamos del cambio a su equipo y al conductor.
      </p>
      {error && (
        <p role="alert" className="text-danger-700 text-sm">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={guardar.isPending}
          className="rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-60"
        >
          {guardar.isPending ? 'Guardando…' : 'Guardar'}
        </button>
        <button
          type="button"
          onClick={onCancelar}
          className="rounded-md border border-neutral-300 px-4 py-2 font-medium text-neutral-700 text-sm"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
