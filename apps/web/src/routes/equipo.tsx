import { ensureRutHasDash, rutSchema } from '@booster-ai/shared-schemas';
import { Copy, Loader2, UserPlus, Users } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { ApiError, api } from '../lib/api-client.js';

/**
 * `/app/equipo` — la empresa gestiona su propia gente
 * (spec `equipo-de-la-empresa` Fase A).
 *
 * Hasta ahora, sumar a alguien a una empresa existente se resolvía con un
 * INSERT a mano en producción, o desde el panel de Booster — que ponía a la
 * plataforma a administrar el equipo del cliente. Esto lo devuelve a donde
 * corresponde.
 *
 * El alta entrega un **código de un solo uso**, no una contraseña: la persona
 * elige su propia clave al activar. Por eso la pantalla lo dice explícito —
 * quien entrega el código tiene que entender qué está entregando.
 */

interface Miembro {
  membership_id: string;
  user_id: string;
  full_name: string;
  email: string;
  rut: string | null;
  rol: string;
  estado: string;
  invitado_en: string;
}

interface AltaResponse {
  ok: boolean;
  user_id: string;
  membership_id: string;
  rol: string;
  estado: string;
  codigo_activacion: string;
  expira_en: string;
}

const ROLES = [
  { value: 'admin', label: 'Administrador — gestiona la empresa y su equipo' },
  { value: 'despachador', label: 'Despachador — opera cargas y viajes' },
  { value: 'visualizador', label: 'Visualizador — solo lectura' },
  { value: 'dueno', label: 'Dueño — titular de la empresa' },
] as const;

const ROL_LABEL: Record<string, string> = {
  dueno: 'Dueño',
  admin: 'Administrador',
  despachador: 'Despachador',
  visualizador: 'Visualizador',
  conductor: 'Conductor',
};

export function EquipoRoute() {
  return <ProtectedRoute meRequirement="require-onboarded">{() => <EquipoPage />}</ProtectedRoute>;
}

function EquipoPage() {
  const [miembros, setMiembros] = useState<Miembro[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [alta, setAlta] = useState<(AltaResponse & { nombre: string }) | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorLista(null);
    try {
      const res = await api.get<{ miembros: Miembro[] }>('/me/empresa/miembros');
      setMiembros(res.miembros);
    } catch (err) {
      setErrorLista(err instanceof Error ? err.message : String(err));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  function handleAlta(res: AltaResponse, nombre: string) {
    setAlta({ ...res, nombre });
    setMostrarForm(false);
    void cargar();
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Users className="mt-1 h-6 w-6 shrink-0 text-primary-700" aria-hidden />
          <div>
            <h1 className="font-bold text-2xl text-neutral-900 tracking-tight">Equipo</h1>
            <p className="mt-1 max-w-2xl text-neutral-600 text-sm">
              Las personas de tu empresa que usan Booster. Al agregar a alguien recibís un código
              para entregarle; con ese código crea su propia clave de acceso.
            </p>
          </div>
        </div>
        {!mostrarForm && (
          <button
            type="button"
            onClick={() => setMostrarForm(true)}
            className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700"
          >
            <UserPlus className="h-4 w-4" aria-hidden />
            Agregar persona
          </button>
        )}
      </div>

      {alta && <CodigoEntregable alta={alta} onCerrar={() => setAlta(null)} />}

      {mostrarForm && <FormAlta onCreado={handleAlta} onCancelar={() => setMostrarForm(false)} />}

      <section className="mt-8 rounded-lg border border-neutral-200 bg-white">
        {cargando && (
          <div className="flex items-center gap-2 p-5 text-neutral-500 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Cargando equipo…
          </div>
        )}
        {errorLista && (
          <div
            role="alert"
            className="m-4 rounded-md border border-danger-200 bg-danger-50 p-3 text-danger-700 text-sm"
          >
            {errorLista}
          </div>
        )}
        {!cargando && !errorLista && miembros.length === 0 && (
          <p className="p-5 text-neutral-500 text-sm">
            Todavía no agregaste a nadie. Usá “Agregar persona” para sumar a alguien de tu equipo.
          </p>
        )}
        {!cargando && !errorLista && miembros.length > 0 && (
          <ul className="divide-y divide-neutral-100">
            {miembros.map((m) => (
              <li key={m.membership_id} className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <div className="font-medium text-neutral-900">{m.full_name}</div>
                  <div className="text-neutral-500 text-sm">
                    {m.email}
                    {m.rut && <span className="ml-2 font-mono text-xs">{m.rut}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-neutral-600 text-sm">{ROL_LABEL[m.rol] ?? m.rol}</span>
                  {m.estado === 'pendiente_invitacion' ? (
                    <span className="rounded bg-amber-50 px-2 py-0.5 font-medium text-amber-700 text-xs">
                      Pendiente de activar
                    </span>
                  ) : (
                    <span className="rounded bg-success-50 px-2 py-0.5 font-medium text-success-700 text-xs">
                      Activa
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Panel con el código recién emitido. Se muestra una vez, como el de onboarding. */
function CodigoEntregable({
  alta,
  onCerrar,
}: {
  alta: AltaResponse & { nombre: string };
  onCerrar: () => void;
}) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(alta.codigo_activacion);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2500);
    } catch {
      setCopiado(false);
    }
  }

  return (
    <div className="mt-6 rounded-lg border-2 border-amber-300 bg-amber-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-amber-900">
            Código de activación para {alta.nombre}
          </div>
          {/* Que quien lo entrega entienda qué es: un código de un solo uso, no
              una clave. La clave la elige la persona y nadie más la conoce. */}
          <p className="mt-1 text-amber-800 text-sm">
            Entregáselo por tu canal habitual. Le sirve una sola vez para activar su cuenta: al
            usarlo, elegirá su propia clave de 6 dígitos, que solo conocerá ella.
          </p>
          <p className="mt-1 text-amber-700 text-xs">
            Vence el {new Date(alta.expira_en).toLocaleDateString('es-CL')}.
          </p>
        </div>
        <button
          type="button"
          onClick={onCerrar}
          className="cursor-pointer text-amber-700 text-xs underline hover:text-amber-900"
        >
          Ocultar
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="flex-1 rounded-md border border-amber-300 bg-white px-3 py-2 text-center font-mono text-2xl text-neutral-900 tracking-[0.3em]">
          {alta.codigo_activacion}
        </div>
        <button
          type="button"
          onClick={() => void copiar()}
          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-600 px-3 py-2 font-medium text-white text-xs hover:bg-amber-700"
        >
          <Copy className="h-3 w-3" aria-hidden />
          {copiado ? 'Copiado ✓' : 'Copiar código'}
        </button>
      </div>
    </div>
  );
}

function FormAlta({
  onCreado,
  onCancelar,
}: {
  onCreado: (res: AltaResponse, nombre: string) => void;
  onCancelar: () => void;
}) {
  const [fullName, setFullName] = useState('');
  const [rut, setRut] = useState('');
  const [email, setEmail] = useState('');
  const [rol, setRol] = useState<string>('admin');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // Validar el RUT acá y no dejar que rebote como "400: API error 400": quien
    // está cargando a su equipo necesita saber QUÉ está mal, no un número.
    const rutNormalizado = ensureRutHasDash(rut);
    const rutParsed = rutSchema.safeParse(rutNormalizado);
    if (!rutParsed.success) {
      setError(
        rutParsed.error.issues[0]?.message ??
          'El RUT no es válido. Revisá los dígitos y el verificador.',
      );
      return;
    }

    setEnviando(true);
    try {
      const res = await api.post<AltaResponse>('/me/empresa/miembros', {
        full_name: fullName,
        rut: rutParsed.data,
        email,
        rol,
      });
      onCreado(res, fullName);
      setFullName('');
      setRut('');
      setEmail('');
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === 'already_member') {
        setError('Esa persona ya forma parte de tu equipo.');
      } else if (code === 'rol_sin_permiso') {
        setError(
          'No tienes permiso para gestionar el equipo. Pídeselo al dueño o a un administrador.',
        );
      } else {
        setError(err instanceof ApiError ? `${err.status}: ${err.message}` : String(err));
      }
    } finally {
      setEnviando(false);
    }
  }

  const puedeEnviar =
    fullName.trim() !== '' && rut.trim() !== '' && email.trim() !== '' && !enviando;

  return (
    <form
      onSubmit={submit}
      className="mt-6 grid grid-cols-1 gap-3 rounded-lg border border-neutral-200 bg-white p-5 sm:grid-cols-2"
    >
      <label className="flex flex-col gap-1">
        <span className="font-medium text-neutral-700 text-sm">Nombre completo</span>
        <input
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
          placeholder="Ej: Gabriel Barros"
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
        <span className="text-neutral-500 text-xs">
          Es el correo con el que Booster se comunica con esa persona.
        </span>
      </label>

      <label className="flex flex-col gap-1">
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
        <span className="text-neutral-500 text-xs">
          Los conductores se agregan desde la sección Conductores, con su licencia.
        </span>
      </label>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-danger-200 bg-danger-50 p-3 text-danger-700 text-sm sm:col-span-2"
        >
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 sm:col-span-2">
        <button
          type="submit"
          disabled={!puedeEnviar}
          className="inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {enviando ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Agregando…
            </>
          ) : (
            <>
              <UserPlus className="h-4 w-4" aria-hidden />
              Agregar a mi equipo
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onCancelar}
          className="text-neutral-500 text-sm hover:text-neutral-700"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
