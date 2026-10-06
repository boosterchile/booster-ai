import { ensureRutHasDash, rutSchema } from '@booster-ai/shared-schemas';
import { Copy, Loader2, UserPlus } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api-client.js';

/**
 * Fase 3.5 (onboarding-flow-redesign) — sumar una persona a una empresa que ya
 * existe.
 *
 * El onboarding solo sabe crear empresa + dueño de cero (con el RUT ya
 * registrado devuelve 409), así que la segunda persona de un cliente no tenía
 * camino de producto: se resolvía con INSERT a mano en producción. Caso que lo
 * motivó: el gestor de Transportes Van Oosterwyk.
 *
 * El código de un solo uso se muestra para entregarlo. La persona lo usa en
 * Activar cuenta, junto con su RUT, y elige su clave. El código no es la
 * contraseña. `refreshToken` recarga la lista cuando el panel crea una empresa.
 */

interface EmpresaOption {
  id: string;
  razon_social: string;
  rut: string;
  estado: string;
  es_transportista: boolean;
  es_generador_carga: boolean;
}

interface InvitarResponse {
  ok: boolean;
  user_id: string;
  membership_id: string;
  rol: string;
  estado: string;
  codigo_activacion: string | null;
  expira_en: string | null;
  vinculo?: 'nueva' | 'cuenta_activa' | 'codigo_vigente' | 'provisoria_sin_codigo';
}

const ROLES = [
  { value: 'admin', label: 'Administrador — gestiona la empresa' },
  { value: 'despachador', label: 'Despachador — opera cargas y viajes' },
  { value: 'visualizador', label: 'Visualizador — solo lectura' },
  { value: 'dueno', label: 'Dueño — titular de la empresa' },
] as const;

export function InvitarMiembroEmpresa({
  refreshToken = 0,
  preferEmpresaId,
}: {
  refreshToken?: number;
  preferEmpresaId?: string | undefined;
}) {
  const [empresas, setEmpresas] = useState<EmpresaOption[]>([]);
  const [loadingEmpresas, setLoadingEmpresas] = useState(true);
  const [empresaId, setEmpresaId] = useState('');
  const [fullName, setFullName] = useState('');
  const [rut, setRut] = useState('');
  const [email, setEmail] = useState('');
  const [rol, setRol] = useState<string>('admin');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InvitarResponse | null>(null);
  const [copied, setCopied] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshToken solo invalida la lista
  useEffect(() => {
    let cancelled = false;
    setLoadingEmpresas(true);
    api
      .get<{ empresas: EmpresaOption[] }>('/admin/empresas')
      .then((res) => {
        if (!cancelled) {
          setEmpresas(res.empresas);
          if (preferEmpresaId && res.empresas.some((e) => e.id === preferEmpresaId)) {
            setEmpresaId(preferEmpresaId);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingEmpresas(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken, preferEmpresaId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    const rutNormalizado = ensureRutHasDash(rut);
    if (!rutSchema.safeParse(rutNormalizado).success) {
      setError('RUT inválido (ej: 76.274.900-9)');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post<InvitarResponse>(`/admin/empresas/${empresaId}/miembros`, {
        email,
        full_name: fullName,
        rut: rutNormalizado,
        rol,
      });
      setResult(res);
      setFullName('');
      setRut('');
      setEmail('');
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === 'already_member') {
        setError('Esa persona ya es miembro de la empresa seleccionada.');
      } else if (code === 'email_already_registered') {
        setError('Ese correo ya pertenece a otra persona.');
      } else {
        setError(err instanceof ApiError ? `${err.status}: ${err.message}` : String(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Sin clipboard (http, permiso denegado): el link igual está en pantalla
      // y es seleccionable.
      setCopied(false);
    }
  }

  const canSubmit =
    empresaId !== '' &&
    fullName.trim() !== '' &&
    rut.trim() !== '' &&
    email.trim() !== '' &&
    !submitting;

  return (
    <section className="mt-8 rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <UserPlus className="mt-0.5 h-5 w-5 shrink-0 text-primary-700" aria-hidden />
        <div>
          <h2 className="font-semibold text-neutral-900">Agregar persona a una empresa</h2>
          <p className="mt-1 max-w-2xl text-neutral-600 text-sm">
            Para clientes que ya existen. Deja a la persona pendiente en la empresa y muestra un
            código de un solo uso. Ella lo ingresa en Activar cuenta, junto con su RUT, y elige su
            clave. El código no es su contraseña.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="font-medium text-neutral-700 text-sm">Empresa</span>
          <select
            value={empresaId}
            onChange={(e) => setEmpresaId(e.target.value)}
            disabled={loadingEmpresas}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
          >
            <option value="">{loadingEmpresas ? 'Cargando empresas…' : 'Elige una empresa'}</option>
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.razon_social} · {e.rut}
                {e.estado !== 'activa' ? ` · ${e.estado}` : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-medium text-neutral-700 text-sm">Nombre completo</span>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
            placeholder="Ej: Javier Vicencio"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-medium text-neutral-700 text-sm">RUT</span>
          <input
            type="text"
            value={rut}
            onChange={(e) => setRut(e.target.value)}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
            placeholder="12.345.678-5"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-medium text-neutral-700 text-sm">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
            placeholder="persona@empresa.cl"
          />
        </label>

        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="font-medium text-neutral-700 text-sm">Rol</span>
          <select
            value={rol}
            onChange={(e) => setRol(e.target.value)}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>

        {error && (
          <div
            role="alert"
            className="rounded-md border border-danger-200 bg-danger-50 p-3 text-danger-700 text-sm sm:col-span-2"
          >
            {error}
          </div>
        )}

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Agregando…
              </>
            ) : (
              <>
                <UserPlus className="h-4 w-4" aria-hidden />
                Agregar a la empresa
              </>
            )}
          </button>
        </div>
      </form>

      {result && !result.codigo_activacion && (
        <div className="mt-4 rounded-lg border-2 border-amber-300 bg-amber-50 p-4">
          <div className="font-semibold text-amber-900">
            {result.vinculo === 'cuenta_activa' || result.estado === 'activa'
              ? 'Esta persona ya tiene cuenta'
              : 'Esta persona ya tiene un código vigente'}
          </div>
          <p className="mt-1 text-amber-800 text-sm">
            {result.vinculo === 'cuenta_activa' || result.estado === 'activa'
              ? 'Quedó en la empresa. Entra con su RUT y su clave. No hay código nuevo: su clave no cambia.'
              : 'No se reemplazó. Cuando lo use en Activar cuenta, también quedará en esta empresa.'}
          </p>
        </div>
      )}

      {result?.codigo_activacion && (
        <div className="mt-4 rounded-lg border-2 border-amber-300 bg-amber-50 p-4">
          <div className="font-semibold text-amber-900">
            Código de activación — quedó como {result.rol}, pendiente de activar
          </div>
          <p className="mt-1 text-amber-800 text-sm">
            Entrégaselo por tu canal habitual. En Activar cuenta escribe su RUT, este código y elige
            su clave de 6 dígitos. El código sirve una sola vez y no es su contraseña.
          </p>
          <p className="mt-1 text-amber-700 text-xs">
            Vence el{' '}
            {result.expira_en ? new Date(result.expira_en).toLocaleDateString('es-CL') : '—'}.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <div className="flex-1 rounded-md border border-amber-300 bg-white px-3 py-2 text-center font-mono text-2xl text-neutral-900 tracking-[0.3em]">
              {result.codigo_activacion}
            </div>
            <button
              type="button"
              onClick={() => void handleCopy(result.codigo_activacion ?? '')}
              className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md bg-amber-600 px-3 py-2 font-medium text-white text-xs transition hover:bg-amber-700"
            >
              <Copy className="h-3 w-3" aria-hidden />
              {copied ? 'Copiado ✓' : 'Copiar código'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
