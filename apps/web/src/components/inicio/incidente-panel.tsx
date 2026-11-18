import { useState } from 'react';
import {
  INCIDENT_TYPES,
  INCIDENT_TYPE_LABELS,
  type IncidentType,
  useReportarIncidenteMutation,
} from '../../hooks/use-reportar-incidente.js';

function esTipo(valor: string): valor is IncidentType {
  return (INCIDENT_TYPES as readonly string[]).includes(valor);
}

/** El conductor avisa un incidente. No cancela el viaje. */
export function IncidentePanel({
  assignmentId,
  onClose,
}: {
  assignmentId: string;
  onClose: () => void;
}) {
  const [tipo, setTipo] = useState<IncidentType>('demora');
  const reporte = useReportarIncidenteMutation();
  return (
    <form
      data-testid="incidente-panel"
      className="space-y-2 rounded-md border border-neutral-200 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        reporte.mutate({ assignmentId, incidentType: tipo });
      }}
    >
      <label className="block text-neutral-700 text-sm" htmlFor="incidente-tipo">
        Qué pasó
      </label>
      <select
        id="incidente-tipo"
        value={tipo}
        onChange={(event) => {
          if (esTipo(event.target.value)) {
            setTipo(event.target.value);
          }
        }}
        className="w-full rounded-md border border-neutral-300 px-2 py-2 text-sm"
      >
        {INCIDENT_TYPES.map((item) => (
          <option key={item} value={item}>
            {INCIDENT_TYPE_LABELS[item]}
          </option>
        ))}
      </select>
      {reporte.isSuccess ? (
        <p className="text-sm text-success-800">Quedó avisado. El viaje sigue.</p>
      ) : null}
      {reporte.isError ? (
        <p role="alert" className="text-danger-700 text-sm">
          No pudimos avisar el incidente. Revisa tu señal e intenta de nuevo.
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={reporte.isPending}
          className="rounded-md bg-primary-600 px-3 py-2 font-semibold text-sm text-white disabled:opacity-60"
        >
          {reporte.isPending ? 'Avisando…' : 'Avisar'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
        >
          Cerrar
        </button>
      </div>
    </form>
  );
}
