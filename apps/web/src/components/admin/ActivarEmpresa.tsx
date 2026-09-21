import { Building2, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api-client.js';

/**
 * Platform-admin: activar / suspender empresas sin SQL.
 *
 * El onboarding deja `pendiente_verificacion`. Matching exige `activa`.
 * Hasta este panel, ops hacía UPDATE a mano en prod.
 */

export interface EmpresaAdminRow {
  id: string;
  razon_social: string;
  rut: string;
  estado: 'pendiente_verificacion' | 'activa' | 'suspendida';
  es_transportista: boolean;
  es_generador_carga: boolean;
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

export function ActivarEmpresa() {
  const [filtro, setFiltro] = useState<EstadoFiltro>('pendiente_verificacion');
  const [empresas, setEmpresas] = useState<EmpresaAdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

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

  useEffect(() => {
    void cargar(filtro);
  }, [cargar, filtro]);

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
              <li
                key={e.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
                data-testid={`empresa-row-${e.id}`}
              >
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
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
