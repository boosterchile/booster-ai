import { rutSchema } from '@booster-ai/shared-schemas';
import { useNavigate } from '@tanstack/react-router';
import { Headphones } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { FormField, inputClass as fieldInputClass } from '../components/FormField.js';
import { signInDriverWithCustomToken, signInWithEmail } from '../hooks/use-auth.js';

interface ActivateResponse {
  custom_token: string;
  synthetic_email: string;
}

interface AlreadyActivatedResponse {
  code: 'already_activated';
  synthetic_email: string;
}

/**
 * /login/conductor — Surface dedicada de login para conductores. El driver
 * ingresa RUT + PIN (en su primer login post-creación por el carrier) o
 * RUT + contraseña (en logins posteriores).
 *
 * El frontend intenta primero `POST /auth/driver-activate` con el valor
 * como PIN. Posibles outcomes:
 *   1. 200: custom token → signInWithCustomToken → /app/conductor/modo.
 *   2. 410 already_activated + synthetic_email: el user ya activó, así que
 *      fallthrough a signInWithEmail con el email sintético + el mismo valor
 *      como password.
 *   3. 401 invalid_credentials: mensaje genérico.
 *   4. 503 not_a_driver: mensaje específico ("este RUT no está habilitado
 *      como conductor").
 *
 * Esto permite que el conductor use UN SOLO formulario sin saber si está
 * activando o logueándose.
 */
export function LoginConductorRoute() {
  const navigate = useNavigate();
  const [rut, setRut] = useState('');
  const [pin, setPin] = useState('');
  const [rutError, setRutError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setRutError(null);
    setSubmitError(null);

    const rutParsed = rutSchema.safeParse(rut);
    if (!rutParsed.success) {
      setRutError(rutParsed.error.issues[0]?.message ?? 'RUT inválido');
      return;
    }
    const cleanRut = rutParsed.data;

    if (!/^\d{6}$/.test(pin) && pin.length < 6) {
      setSubmitError('Ingresa el PIN de activación (6 dígitos) o tu contraseña.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${getApiUrl()}/auth/driver-activate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rut: cleanRut, pin }),
      });

      if (res.ok) {
        const body = (await res.json()) as ActivateResponse;
        await signInDriverWithCustomToken(body.custom_token);
        void navigate({ to: '/app/conductor/modo' });
        return;
      }

      if (res.status === 410) {
        // Ya activado: usar Firebase email/password con el email sintético.
        const body = (await res.json()) as AlreadyActivatedResponse;
        try {
          await signInWithEmail(body.synthetic_email, pin);
          void navigate({ to: '/app/conductor/modo' });
          return;
        } catch (_authErr) {
          // El user ya activó pero ingresó password incorrecto.
          setSubmitError('PIN o contraseña incorrectos.');
          return;
        }
      }

      if (res.status === 503) {
        setSubmitError(
          'Este RUT no está habilitado como conductor. Contacta a tu empresa transportista.',
        );
        return;
      }

      // 400 o 401 → credenciales inválidas (sin distinguir RUT vs PIN).
      setSubmitError('RUT o PIN incorrectos. Verifica con tu empresa transportista.');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Error al conectar con el servidor.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 p-4">
      <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-md bg-primary-50 text-primary-600"
            aria-hidden
          >
            <Headphones className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-bold text-2xl text-neutral-900 tracking-tight">Acceso conductor</h1>
            <p className="text-neutral-600 text-sm">
              Ingresa tu RUT y el PIN que te dio tu empresa.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
          <FormField
            label="RUT"
            required
            hint="Sin puntos, con guión. Ejemplo: 12345678-5"
            error={rutError ?? undefined}
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="text"
                value={rut}
                onChange={(e) => setRut(e.target.value)}
                className={fieldInputClass(!!rutError)}
                placeholder="12345678-5"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
              />
            )}
          />

          <FormField
            label="PIN de activación o contraseña"
            required
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                className={fieldInputClass(false)}
                placeholder="6 dígitos al activar"
                autoComplete="current-password"
              />
            )}
          />

          {submitError && (
            <div className="rounded-md border border-danger-200 bg-danger-50 p-3 text-danger-700 text-sm">
              {submitError}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {submitting ? 'Verificando…' : 'Ingresar'}
          </button>
        </form>

        <div className="mt-4 text-center text-neutral-500 text-xs">
          ¿No eres conductor?{' '}
          <a href="/login" className="text-primary-600 hover:underline">
            Login normal
          </a>
        </div>
      </div>
    </div>
  );
}

/**
 * Resuelve la URL base de la API en runtime. Reutilizamos el cliente
 * fetch directo (no `api.post`) porque el endpoint NO requiere Firebase
 * ID token — el conductor todavía no tiene sesión.
 */
function getApiUrl(): string {
  // VITE_API_URL puede no estar definida en producción si se usa el path
  // relativo via reverse proxy. En ese caso usamos string vacía.
  const apiUrl = import.meta.env.VITE_API_URL;
  return typeof apiUrl === 'string' ? apiUrl : '';
}
