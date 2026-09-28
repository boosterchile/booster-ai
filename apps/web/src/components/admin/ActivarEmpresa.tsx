import { Building2, Copy, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api-client.js';

/**
 * Platform-admin: activar / suspender empresas sin SQL.
 *
 * El onboarding deja `pendiente_verificacion`. Matching exige `activa`.
 * Hasta este panel, ops hacía UPDATE a mano en prod.
 */

export interface MiembroPendienteAdmin {
  user_id: string;
  membership_id: string;
  nombre: string;
  rut: string;
  email: string;
  rol: string;
  invitado_en: string;
  expira_en: string;
}

export interface EmpresaAdminRow {
  id: string;
  razon_social: string;
  rut: string;
  estado: 'pendiente_verificacion' | 'activa' | 'suspendida';
  es_transportista: boolean;
  es_generador_carga: boolean;
  miembros_pendientes: MiembroPendienteAdmin[];
  dueno_pendiente: MiembroPendienteAdmin | null;
}

interface CodigoReemitido {
  codigo_activacion: string;
  expira_en: string;
  rut: string;
}

const ROL_LABEL: Record<string, string> = {
  dueno: 'Dueño',
  admin: 'Administrador',
  despachador: 'Despachador',
  conductor: 'Conductor',
  visualizador: 'Visualizador',
  stakeholder_sostenibilidad: 'Stakeholder de sostenibilidad',
};

function fechaCorta(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) {
    return iso;
  }
  return fecha.toLocaleDateString('es-CL');
}

type EstadoFiltro = EmpresaAdminRow['estado'] | '';

const FILTROS: ReadonlyArray<{ value: EstadoFiltro; label: string }> = [
  { value: 'pendiente_verificacion', label: 'Pendientes' },
  { value: 'activa', label: 'Activas' },
  { value: 'suspendida', label: 'Suspendidas' },
  { value: '', label: 'Todas' },
];

const ESTADO_LABEL: Record<EmpresaAdminRow['estado'], string> = {
  pendiente_verificacion: 'Pendiente de verificación',
  activa: 'Activa',
  suspendida: 'Suspendida',
};

export function ActivarEmpresa({ refreshToken = 0 }: { refreshToken?: number }) {
  const [filtro, setFiltro] = useState<EstadoFiltro>('pendiente_verificacion');
  const [empresas, setEmpresas] = useState<EmpresaAdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [reemitirId, setReemitirId] = useState<string | null>(null);
  const [codigos, setCodigos] = useState<Record<string, CodigoReemitido>>({});
  const [reemitirError, setReemitirError] = useState<{
    membershipId: string;
    message: string;
  } | null>(null);
  const [copiadoId, setCopiadoId] = useState<string | null>(null);

  const cargar = useCallback(async (estado: EstadoFiltro) => {
    setLoading(true);
    setError(null);
    try {
      const qs = estado === '' ? '' : `?estado=${encodeURIComponent(estado)}`;
      const res = await api.get<{ empresas: EmpresaAdminRow[] }>(`/admin/empresas${qs}`);
      setEmpresas(res.empresas);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshToken solo invalida la lista
  useEffect(() => {
    void cargar(filtro);
  }, [cargar, filtro, refreshToken]);

  async function reemitirCodigo(empresaId: string, miembro: MiembroPendienteAdmin) {
    setReemitirId(miembro.membership_id);
    setReemitirError(null);
    try {
      const res = await api.post<CodigoReemitido & { membership_id: string }>(
        `/admin/empresas/${empresaId}/miembros/${miembro.membership_id}/codigo`,
      );
      setCodigos((prev) => ({
        ...prev,
        [miembro.membership_id]: {
          codigo_activacion: res.codigo_activacion,
          expira_en: res.expira_en,
          rut: miembro.rut,
        },
      }));
    } catch (err) {
      const message =
        err instanceof ApiError && err.code === 'already_activated'
          ? 'Esa persona ya activó su cuenta.'
          : err instanceof ApiError && err.code === 'membership_not_found'
            ? 'No encontramos esa invitación en esta empresa.'
            : err instanceof ApiError
              ? `${err.status}: ${err.message}`
              : err instanceof Error
                ? err.message
                : String(err);
      setReemitirError({ membershipId: miembro.membership_id, message });
    } finally {
      setReemitirId(null);
    }
  }

  async function copiarCodigo(membershipId: string, codigo: string) {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiadoId(membershipId);
      window.setTimeout(() => setCopiadoId(null), 2500);
    } catch {
      // Sin clipboard (http, permiso denegado): el código igual está en pantalla.
      setCopiadoId(null);
    }
  }

  async function cambiarEstado(id: string, estado: EmpresaAdminRow['estado']) {
    setPendingId(id);
    setError(null);
    try {
      await api.patch(`/admin/empresas/${id}`, { estado });
      await cargar(filtro);
    } catch (err) {
      const msg =
        err instanceof ApiError ? `${err.status}: ${err.message}` : (err as Error).message;
      setError(msg);
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="mt-8 rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-primary-700" aria-hidden />
        <div>
          <h2 className="font-semibold text-neutral-900">Empresas</h2>
          <p className="mt-1 max-w-2xl text-neutral-600 text-sm">
            Activá una empresa pendiente para que entre al matching. Mientras esté en verificación,
            no le llegan ofertas aunque tenga zonas y flota.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Filtro de estado">
        {FILTROS.map((f) => (
          <button
            key={f.value || 'todas'}
            type="button"
            role="tab"
            aria-selected={filtro === f.value}
            onClick={() => setFiltro(f.value)}
            className={`rounded-md px-3 py-1.5 font-medium text-sm ${
              filtro === f.value
                ? 'bg-primary-600 text-white'
                : 'border border-neutral-200 bg-neutral-50 text-neutral-700 hover:bg-neutral-100'
            }`}
            data-testid={`empresa-filtro-${f.value || 'todas'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {loading && (
          <div className="inline-flex items-center gap-2 text-neutral-500 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Cargando empresas…
          </div>
        )}
        {error && (
          <div
            className="rounded-md border border-danger-200 bg-danger-50 p-3 text-danger-700 text-sm"
            data-testid="empresa-estado-error"
          >
            {error}
          </div>
        )}
        {!loading && !error && empresas.length === 0 && (
          <p className="text-neutral-500 text-sm" data-testid="empresa-estado-empty">
            No hay empresas en este filtro.
          </p>
        )}
        {!loading && empresas.length > 0 && (
          <ul className="divide-y divide-neutral-100">
            {empresas.map((e) => (
              <li key={e.id} className="py-3" data-testid={`empresa-row-${e.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-neutral-900">{e.razon_social}</div>
                    <div className="text-neutral-500 text-xs">
                      <span className="font-mono">{e.rut}</span>
                      {' · '}
                      {ESTADO_LABEL[e.estado]}
                      {e.es_transportista ? ' · transportista' : ''}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {e.estado !== 'activa' && (
                      <button
                        type="button"
                        disabled={pendingId === e.id}
                        onClick={() => void cambiarEstado(e.id, 'activa')}
                        className="rounded-md bg-primary-600 px-3 py-1.5 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-50"
                        data-testid={`empresa-activar-${e.id}`}
                      >
                        {pendingId === e.id ? 'Activando…' : 'Activar'}
                      </button>
                    )}
                    {e.estado !== 'suspendida' && (
                      <button
                        type="button"
                        disabled={pendingId === e.id}
                        onClick={() => void cambiarEstado(e.id, 'suspendida')}
                        className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 font-medium text-neutral-700 text-sm hover:bg-neutral-50 disabled:opacity-50"
                        data-testid={`empresa-suspender-${e.id}`}
                      >
                        {pendingId === e.id ? 'Suspendiendo…' : 'Suspender'}
                      </button>
                    )}
                  </div>
                </div>
                {e.miembros_pendientes.length > 0 && (
                  <ul className="mt-3 space-y-3">
                    {e.miembros_pendientes.map((m) => {
                      const codigo = codigos[m.membership_id];
                      return (
                        <li
                          key={m.membership_id}
                          className="rounded-md border border-neutral-200 bg-neutral-50 p-3"
                          data-testid={`pendiente-${m.membership_id}`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0 text-sm">
                              <div className="font-medium text-neutral-900">{m.nombre}</div>
                              <div className="text-neutral-600 text-xs">
                                <span className="font-mono">{m.rut}</span>
                                {' · '}
                                {m.email}
                                {' · '}
                                {ROL_LABEL[m.rol] ?? m.rol}
                                {' · Vence el '}
                                {fechaCorta(m.expira_en)}
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={reemitirId === m.membership_id}
                              onClick={() => void reemitirCodigo(e.id, m)}
                              className="rounded-md border border-amber-400 bg-amber-50 px-3 py-1.5 font-medium text-amber-950 text-sm hover:bg-amber-100 disabled:opacity-50"
                              data-testid={`reemitir-codigo-${m.membership_id}`}
                            >
                              {reemitirId === m.membership_id
                                ? 'Generando…'
                                : 'Generar código nuevo'}
                            </button>
                          </div>
                          {reemitirError?.membershipId === m.membership_id && (
                            <p role="alert" className="mt-2 text-danger-700 text-sm">
                              {reemitirError.message}
                            </p>
                          )}
                          {codigo && (
                            <div className="mt-3 rounded-lg border-2 border-amber-300 bg-amber-50 p-4">
                              <div className="font-semibold text-amber-900">
                                Código de activación nuevo
                              </div>
                              <p className="mt-1 text-amber-800 text-sm">
                                Este código es nuevo. El anterior deja de servir y no se vuelve a
                                mostrar.
                              </p>
                              <p className="mt-1 text-amber-800 text-sm">
                                Entrá a /activar, escribí el RUT {codigo.rut}, este código y elegí
                                tu clave.
                              </p>
                              <p className="mt-1 text-amber-700 text-xs">
                                Vence el {fechaCorta(codigo.expira_en)}.
                              </p>
                              <div className="mt-3 flex items-center gap-2">
                                <div className="flex-1 rounded-md border border-amber-300 bg-white px-3 py-2 text-center font-mono text-2xl text-neutral-900 tracking-[0.3em]">
                                  {codigo.codigo_activacion}
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void copiarCodigo(m.membership_id, codigo.codigo_activacion)
                                  }
                                  className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md bg-amber-600 px-3 py-2 font-medium text-white text-xs transition hover:bg-amber-700"
                                >
                                  <Copy className="h-3 w-3" aria-hidden />
                                  {copiadoId === m.membership_id ? 'Copiado ✓' : 'Copiar código'}
                                </button>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
