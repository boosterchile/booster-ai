import { ensureRutHasDash, rutSchema } from '@booster-ai/shared-schemas';
import { useNavigate } from '@tanstack/react-router';
import { signInWithCustomToken } from 'firebase/auth';
import { KeyRound, Loader2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api } from '../lib/api-client.js';
import { firebaseAuth } from '../lib/firebase.js';

/**
 * `/activar` — la persona que su empresa dio de alta crea SU clave.
 *
 * Llega con un código de un solo uso que le entregó su empresa. Al terminar
 * queda con una credencial que nadie más conoce: ni Booster, ni quien la dio
 * de alta. Esa es la diferencia con el flujo de conductores actual, donde el
 * PIN que genera el admin queda como contraseña permanente.
 *
 * Pública por diseño: quien entra acá todavía no tiene sesión — la está
 * creando.
 */

interface ActivarResponse {
  ok: boolean;
  activated: boolean;
  custom_token?: string;
}

export function ActivarRoute() {
  const navigate = useNavigate();
  const [rut, setRut] = useState('');
  const [codigo, setCodigo] = useState('');
  const [clave, setClave] = useState('');
  const [repetir, setRepetir] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activadaSinSesion, setActivadaSinSesion] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // La confirmación se valida acá y no viaja al backend: un tipeo dejaría a
    // la persona sin poder entrar a su propia cuenta.
    if (clave !== repetir) {
      setError('Las claves no coinciden. Revísalas e intenta de nuevo.');
      return;
    }

    const rutNormalizado = ensureRutHasDash(rut);
    const parsed = rutSchema.safeParse(rutNormalizado);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'RUT inválido');
      return;
    }

    setEnviando(true);
    try {
      const res = await api.post<ActivarResponse>('/auth/activar', {
        rut: parsed.data,
        codigo,
        clave_numerica: clave,
      });

      if (res.custom_token) {
        await signInWithCustomToken(firebaseAuth, res.custom_token);
        void navigate({ to: '/app' });
        return;
      }
      // Activó pero no llegó la sesión: la cuenta YA es suya, entra por el
      // login normal con la clave que acaba de crear.
      setActivadaSinSesion(true);
    } catch {
      // El backend colapsa a propósito rut-inexistente / código-incorrecto /
      // cuenta-ya-activada / código-vencido en una sola respuesta, para no
      // revelar qué RUTs existen. La UI no inventa un diagnóstico que el
      // backend evita dar.
      setError(
        'No pudimos activar la cuenta. Revisa tu RUT y el código; si venció, pedile a tu empresa que te genere uno nuevo.',
      );
    } finally {
      setEnviando(false);
    }
  }

  if (activadaSinSesion) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 p-4">
        <div className="w-full max-w-md rounded-lg border border-success-200 bg-white p-6 text-center shadow-sm">
          <h1 className="font-semibold text-lg text-neutral-900">Tu cuenta quedó activa</h1>
          <p className="mt-2 text-neutral-600 text-sm">
            Ya puedes entrar con tu RUT y la clave que acabas de crear.
          </p>
          <a
            href="/login"
            className="mt-4 inline-flex items-center justify-center rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700"
          >
            Ir a iniciar sesión
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
      >
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary-700" aria-hidden />
          <h1 className="font-semibold text-lg text-neutral-900">Activa tu cuenta</h1>
        </div>
        <p className="mt-2 text-neutral-600 text-sm">
          Tu empresa te dio de alta en Booster y te entregó un código. Úsalo una vez para crear tu
          clave: de ahí en adelante entrás con tu RUT y esa clave.
        </p>

        <div className="mt-5 space-y-4">
          <label className="flex flex-col gap-1">
            <span className="font-medium text-neutral-700 text-sm">RUT</span>
            <input
              type="text"
              value={rut}
              onChange={(e) => setRut(e.target.value)}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
              placeholder="12.345.678-5"
              autoComplete="username"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-medium text-neutral-700 text-sm">Código de activación</span>
            <input
              type="text"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              inputMode="numeric"
              maxLength={6}
              className="rounded-md border border-neutral-300 px-3 py-2 text-center font-mono text-lg tracking-[0.3em] focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
              placeholder="000000"
            />
            <span className="text-neutral-500 text-xs">Los 6 dígitos que te dio tu empresa.</span>
          </label>

          <div className="rounded-lg border border-primary-200 bg-primary-50/50 p-4">
            <p className="font-medium text-neutral-900 text-sm">Crea tu clave</p>
            <p className="mt-1 text-neutral-600 text-xs">
              6 dígitos, como la de tu banco. Solo la conocés vos: ni Booster ni tu empresa pueden
              verla.
            </p>
            <div className="mt-3 space-y-4">
              <label className="flex flex-col gap-1">
                <span className="font-medium text-neutral-700 text-sm">Clave numérica</span>
                <input
                  type="password"
                  value={clave}
                  onChange={(e) => setClave(e.target.value)}
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="new-password"
                  className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
                  placeholder="••••••"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-medium text-neutral-700 text-sm">Repite tu clave</span>
                <input
                  type="password"
                  value={repetir}
                  onChange={(e) => setRepetir(e.target.value)}
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="new-password"
                  className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
                  placeholder="••••••"
                />
              </label>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-md border border-danger-200 bg-danger-50 p-3 text-danger-700 text-sm"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={enviando}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {enviando ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Activando…
              </>
            ) : (
              'Activar mi cuenta'
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
