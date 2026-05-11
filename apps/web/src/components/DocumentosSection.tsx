import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle, Clock, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api-client.js';

/**
 * D6 — Sección reutilizable para gestionar documentos de un vehículo o
 * conductor. Se monta en `/app/vehiculos/$id` y `/app/conductores/$id`.
 *
 * No es un wizard: el usuario ve la lista actual + tiene un formulario
 * inline al final para agregar uno nuevo. Borrar es un botón × por fila.
 *
 * Modo demo: `archivo_url` se acepta como URL externa (Drive, Dropbox).
 * Upload directo a GCS con signed URLs queda follow-up.
 */

type EntityType = 'vehiculo' | 'conductor';

const VEHICLE_DOC_OPTIONS = [
  { value: 'revision_tecnica', label: 'Revisión técnica' },
  { value: 'permiso_circulacion', label: 'Permiso de circulación' },
  { value: 'soap', label: 'SOAP' },
  { value: 'padron', label: 'Padrón' },
  { value: 'seguro_carga', label: 'Seguro de carga' },
  { value: 'poliza_responsabilidad', label: 'Póliza responsabilidad civil' },
  { value: 'certificado_emisiones', label: 'Certificado de emisiones' },
  { value: 'otro', label: 'Otro' },
];

const DRIVER_DOC_OPTIONS = [
  { value: 'licencia_conducir', label: 'Licencia de conducir' },
  { value: 'curso_b6', label: 'Curso B6 (cargas peligrosas)' },
  { value: 'certificado_antecedentes', label: 'Certificado de antecedentes' },
  { value: 'examen_psicotecnico', label: 'Examen psicotécnico' },
  { value: 'hoja_vida_conductor', label: 'Hoja de vida del conductor' },
  { value: 'certificado_salud', label: 'Certificado de salud' },
  { value: 'otro', label: 'Otro' },
];

interface DocumentoItem {
  id: string;
  tipo: string;
  archivo_url: string | null;
  fecha_emision: string | null;
  fecha_vencimiento: string | null;
  estado: 'vigente' | 'por_vencer' | 'vencido';
  notas: string | null;
}

interface DocumentosSectionProps {
  entityType: EntityType;
  entityId: string;
  /**
   * `true` si el user puede crear/editar/eliminar. Cuando `false`, sólo
   * se muestra la lista read-only.
   */
  canWrite: boolean;
}

export function DocumentosSection({ entityType, entityId, canWrite }: DocumentosSectionProps) {
  const queryClient = useQueryClient();
  const apiPathBase =
    entityType === 'vehiculo'
      ? `/documentos/vehiculo/${entityId}`
      : `/documentos/conductor/${entityId}`;
  const deletePathBase =
    entityType === 'vehiculo' ? '/documentos/vehiculo-doc' : '/documentos/conductor-doc';
  const options = entityType === 'vehiculo' ? VEHICLE_DOC_OPTIONS : DRIVER_DOC_OPTIONS;
  const defaultTipo = entityType === 'vehiculo' ? 'revision_tecnica' : 'licencia_conducir';

  const labelMap = Object.fromEntries(options.map((o) => [o.value, o.label]));

  const q = useQuery({
    queryKey: ['documentos', entityType, entityId],
    queryFn: async () => {
      const res = await api.get<{ documentos: DocumentoItem[] }>(apiPathBase);
      return res.documentos;
    },
  });

  const [showForm, setShowForm] = useState(false);
  const [tipo, setTipo] = useState<string>(defaultTipo);
  const [archivoUrl, setArchivoUrl] = useState('');
  const [fechaEmision, setFechaEmision] = useState('');
  const [fechaVencimiento, setFechaVencimiento] = useState('');
  const [notas, setNotas] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { tipo };
      if (archivoUrl.trim()) {
        body.archivo_url = archivoUrl.trim();
      }
      if (fechaEmision) {
        body.fecha_emision = fechaEmision;
      }
      if (fechaVencimiento) {
        body.fecha_vencimiento = fechaVencimiento;
      }
      if (notas.trim()) {
        body.notas = notas.trim();
      }
      return await api.post(apiPathBase, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documentos', entityType, entityId] });
      queryClient.invalidateQueries({ queryKey: ['cumplimiento'] });
      setShowForm(false);
      setTipo(defaultTipo);
      setArchivoUrl('');
      setFechaEmision('');
      setFechaVencimiento('');
      setNotas('');
      setFormError(null);
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const deleteM = useMutation({
    mutationFn: async (docId: string) => await api.delete(`${deletePathBase}/${docId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documentos', entityType, entityId] });
      queryClient.invalidateQueries({ queryKey: ['cumplimiento'] });
    },
  });

  return (
    <section className="mt-8 rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-lg text-neutral-900">Documentos legales</h2>
          <p className="mt-1 text-neutral-600 text-sm">
            Carga revisión técnica, permisos, SOAP, licencias y otros documentos. Los vencimientos
            se reflejan en el dashboard de cumplimiento.
          </p>
        </div>
        {canWrite && !showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 rounded-md bg-primary-600 px-3 py-1.5 font-medium text-sm text-white hover:bg-primary-700"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Agregar documento
          </button>
        )}
      </div>

      {q.isLoading && <p className="mt-4 text-neutral-500 text-sm">Cargando…</p>}
      {q.error && <p className="mt-4 text-danger-700 text-sm">Error al cargar documentos.</p>}

      {q.data && q.data.length > 0 && (
        <ul className="mt-4 divide-y divide-neutral-100 border-neutral-200 border-y">
          {q.data.map((d) => (
            <li key={d.id} className="flex items-start justify-between gap-3 py-3">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-neutral-900">{labelMap[d.tipo] ?? d.tipo}</span>
                  <EstadoBadge estado={d.estado} />
                </div>
                <div className="mt-1 text-neutral-600 text-xs">
                  {d.fecha_vencimiento ? (
                    <>
                      Vence: <span className="font-mono">{d.fecha_vencimiento}</span>
                    </>
                  ) : (
                    <span className="text-neutral-400">Sin vencimiento</span>
                  )}
                  {d.fecha_emision && (
                    <>
                      {' · '}Emitido: <span className="font-mono">{d.fecha_emision}</span>
                    </>
                  )}
                </div>
                {d.archivo_url && (
                  <a
                    href={d.archivo_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-primary-600 text-xs hover:underline"
                  >
                    Ver archivo →
                  </a>
                )}
                {d.notas && <div className="mt-1 text-neutral-500 text-xs">{d.notas}</div>}
              </div>
              {canWrite && (
                <button
                  type="button"
                  onClick={() => deleteM.mutate(d.id)}
                  disabled={deleteM.isPending && deleteM.variables === d.id}
                  className="shrink-0 rounded-md border border-danger-300 px-2 py-1 text-danger-700 text-xs hover:bg-danger-50 disabled:opacity-50"
                  aria-label="Eliminar documento"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {q.data && q.data.length === 0 && !showForm && (
        <p className="mt-4 rounded-md border border-neutral-200 border-dashed bg-neutral-50 p-3 text-center text-neutral-600 text-sm">
          Aún no hay documentos cargados.
        </p>
      )}

      {showForm && canWrite && (
        <div className="mt-4 rounded-md border border-primary-100 bg-primary-50/40 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="block font-medium text-neutral-700 text-sm">Tipo</span>
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
              >
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="block font-medium text-neutral-700 text-sm">
                URL del archivo (opcional)
              </span>
              <input
                type="url"
                value={archivoUrl}
                onChange={(e) => setArchivoUrl(e.target.value)}
                placeholder="https://drive.google.com/…"
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
              />
            </label>

            <label className="block">
              <span className="block font-medium text-neutral-700 text-sm">
                Fecha de emisión (opcional)
              </span>
              <input
                type="date"
                value={fechaEmision}
                onChange={(e) => setFechaEmision(e.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
              />
            </label>

            <label className="block">
              <span className="block font-medium text-neutral-700 text-sm">
                Fecha de vencimiento (opcional)
              </span>
              <input
                type="date"
                value={fechaVencimiento}
                onChange={(e) => setFechaVencimiento(e.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="block font-medium text-neutral-700 text-sm">Notas (opcional)</span>
              <input
                type="text"
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                maxLength={500}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
              />
            </label>
          </div>

          {formError && (
            <div className="mt-3 rounded-md border border-danger-200 bg-danger-50 p-2 text-danger-700 text-sm">
              {formError}
            </div>
          )}

          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setFormError(null);
              }}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-neutral-700 text-sm hover:bg-neutral-100"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => createM.mutate()}
              disabled={createM.isPending}
              className="rounded-md bg-primary-600 px-3 py-1.5 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {createM.isPending ? 'Guardando…' : 'Guardar documento'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function EstadoBadge({ estado }: { estado: 'vencido' | 'por_vencer' | 'vigente' }) {
  if (estado === 'vencido') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-danger-50 px-1.5 py-0.5 font-medium text-danger-700 text-xs">
        <AlertTriangle className="h-3 w-3" aria-hidden />
        Vencido
      </span>
    );
  }
  if (estado === 'por_vencer') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700 text-xs">
        <Clock className="h-3 w-3" aria-hidden />
        Por vencer
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-success-50 px-1.5 py-0.5 font-medium text-success-700 text-xs">
      <CheckCircle className="h-3 w-3" aria-hidden />
      Vigente
    </span>
  );
}
