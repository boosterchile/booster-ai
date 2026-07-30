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
 * El link de acceso que devuelve el backend se muestra para entregarlo — sin él
 * la persona no puede fijar su contraseña ni verificar su correo, y sin eso no
 * puede aceptar los T&C, que es lo que destraba la facturación de sus viajes.
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
  access_link?: string;
}

const ROLES = [
  { value: 'admin', label: 'Administrador — gestiona la empresa' },
  { value: 'despachador', label: 'Despachador — opera cargas y viajes' },
  { value: 'visualizador', label: 'Visualizador — solo lectura' },
  { value: 'dueno', label: 'Dueño — titular de la empresa' },
] as const;

export function InvitarMiembroEmpresa() {
  const [empresas, setEmpresas] = useState<EmpresaOption[]>([]);
  const [loadingEmpresas, setLoadingEmpresas] = useState(true);
  const [empresaId, setEmpresaId] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [rol, setRol] = useState<string>('admin');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InvitarResponse | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ empresas: EmpresaOption[] }>('/admin/empresas')
      .then((res) => {
        if (!cancelled) {
          setEmpresas(res.empresas);
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
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setSubmitting(true);
    try {
      const res = await api.post<InvitarResponse>(`/admin/empresas/${empresaId}/miembros`, {
        email,
        full_name: fullName,
        rol,
      });
      setResult(res);
      setFullName('');
      setEmail('');
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === 'already_member') {
        setError('Esa persona ya es miembro de la empresa seleccionada.');
      } else if (code === 'firebase_user_already_exists') {
        setError(
          'Ese correo ya tiene cuenta pero no figura en la base. Revisalo antes de reintentar.',
        );
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
    empresaId !== '' && fullName.trim() !== '' && email.trim() !== '' && !submitting;

  return (
    <section className="mt-8 rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <UserPlus className="mt-0.5 h-5 w-5 shrink-0 text-primary-700" aria-hidden />
        <div>
          <h2 className="font-semibold text-neutral-900">Agregar persona a una empresa</h2>
          <p className="mt-1 max-w-2xl text-neutral-600 text-sm">
            Para clientes que ya existen en la plataforma. Crea su cuenta, la deja como miembro con
            el rol elegido y devuelve el enlace con el que la persona define su contraseña.
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
            <option value="">{loadingEmpresas ? 'Cargando empresas…' : 'Elegí una empresa'}</option>
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

      {result && (
        <div className="mt-4 rounded-lg border-2 border-amber-300 bg-amber-50 p-4">
          <div className="font-semibold text-amber-900">
            Listo — la persona quedó como {result.rol} de la empresa
          </div>
          {result.access_link ? (
            <>
              <p className="mt-1 text-amber-800 text-sm">
                Envíale este enlace para que defina su contraseña. Al usarlo queda verificado su
                correo, que es lo que le permite entrar.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <div className="flex-1 overflow-x-auto rounded-md border border-amber-300 bg-white px-3 py-2 font-mono text-neutral-900 text-xs">
                  {result.access_link}
                </div>
                <button
                  type="button"
                  onClick={() => void handleCopy(result.access_link as string)}
                  className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md bg-amber-600 px-3 py-2 font-medium text-white text-xs transition hover:bg-amber-700"
                >
                  <Copy className="h-3 w-3" aria-hidden />
                  {copied ? 'Copiado ✓' : 'Copiar enlace'}
                </button>
              </div>
            </>
          ) : (
            <p className="mt-1 text-amber-800 text-sm">
              No se pudo generar el enlace de acceso. La persona ya es miembro: pedile que use
              “¿olvidaste tu contraseña?” en el login con este correo.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
