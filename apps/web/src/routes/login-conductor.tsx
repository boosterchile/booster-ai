import { ensureRutHasDash, rutSchema } from '@booster-ai/shared-schemas';
import { Link, useNavigate } from '@tanstack/react-router';
import { Headphones } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { FormField, inputClass as fieldInputClass } from '../components/FormField.js';
import { signInDriverWithCustomToken } from '../hooks/use-auth.js';
import { getApiUrl } from '../lib/api-url.js';

interface ActivateResponse {
  custom_token: string;
  synthetic_email: string;
}

/**
 * `/login/conductor` — el conductor activa su cuenta.
 *
 * Su empresa lo dio de alta y le entregó un PIN de 6 dígitos. Acá lo canjea y,
 * en el mismo acto, **elige su clave numérica**: de ahí en adelante entra por
 * el login principal con RUT + esa clave (ADR-035).
 *
 * **Qué cambió (auditoría 2026-08-01).** Esta pantalla asumía el contrato
 * viejo: el PIN quedaba como contraseña de Firebase y un conductor ya activado
 * se autenticaba acá con `signInWithEmail(synthetic_email, pin)`. La Fase B
 * (#641) eliminó esa contraseña —el PIN es de un solo uso y la empresa lo
 * conoce, así que no puede ser credencial— y además dejó de pisar el email, de
 * modo que ese `synthetic_email` pasó a ser el correo REAL de la persona. El
 * fallback quedó mandando el email real del conductor junto al PIN de su jefe,
 * y fallaba siempre.
 *
 * Ahora, un conductor ya activado (410) **no se autentica acá**: se lo manda al
 * login principal, que es donde vive su credencial.
 *
 * Pública por diseño: quien entra todavía no tiene sesión — la está creando.
 */
export function LoginConductorRoute() {
  const navigate = useNavigate();
  // El conductor puede llegar desde `/login` con su RUT ya tecleado (rebota
  // ahí con `needs_activation`). Se valida antes de precargar: la URL es input
  // externo y no puede sembrar cualquier cosa en el formulario.
  const [rut, setRut] = useState(() => {
    if (typeof window === 'undefined') {
      return '';
    }
    const crudo = new URLSearchParams(window.location.search).get('rut');
    if (!crudo) {
      return '';
    }
    const parsed = rutSchema.safeParse(ensureRutHasDash(crudo.replace(/\./g, '').trim()));
    return parsed.success ? parsed.data : '';
  });
  const [pin, setPin] = useState('');
  const [clave, setClave] = useState('');
  const [repetir, setRepetir] = useState('');
  const [rutError, setRutError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [yaActivada, setYaActivada] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setRutError(null);
    setSubmitError(null);
    setYaActivada(false);

    // Pre-procesar: si el conductor tipeó solo dígitos (el teclado numérico
    // del celular bloquea `-`), insertar el guión antes del verificador.
    const rutParsed = rutSchema.safeParse(ensureRutHasDash(rut));
    if (!rutParsed.success) {
      setRutError(rutParsed.error.issues[0]?.message ?? 'RUT inválido');
      return;
    }

    if (!/^\d{6}$/.test(pin)) {
      setSubmitError('El PIN es de 6 dígitos. Es el que te dio tu empresa.');
      return;
    }
    if (!/^\d{6}$/.test(clave)) {
      setSubmitError('Tu clave debe ser de 6 dígitos.');
      return;
    }
    // La confirmación se valida acá y no viaja: un tipeo lo dejaría afuera de
    // su propia cuenta.
    if (clave !== repetir) {
      setSubmitError('Las claves no coinciden. Revísalas e intenta de nuevo.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${getApiUrl()}/auth/driver-activate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rut: rutParsed.data, pin, clave_numerica: clave }),
      });

      if (res.status === 200) {
        const body = (await res.json()) as ActivateResponse;
        await signInDriverWithCustomToken(body.custom_token);
        void navigate({ to: '/app/conductor' });
        return;
      }

      if (res.status === 410) {
        // Ya activado: su credencial es RUT + clave numérica, y eso se usa en
        // el login principal. Acá no hay nada que hacer.
        setYaActivada(true);
        setSubmitError('Tu cuenta ya está activada. Entra con tu RUT y tu clave numérica.');
        return;
      }

      if (res.status === 503) {
        setSubmitError('Este RUT no está habilitado como conductor. Consulta con tu empresa.');
        return;
      }

      // 401 y cualquier otro: el backend colapsa rut-inexistente y
      // pin-incorrecto en una sola respuesta para no revelar qué RUTs existen.
      // La UI no inventa un diagnóstico que el backend evita dar.
      setSubmitError('Revisa tu RUT y el PIN. Si no lo tienes, pídeselo a tu empresa.');
    } catch {
      setSubmitError('No pudimos conectar. Revisa tu señal e intenta de nuevo.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-4">
      <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-md bg-primary-50 text-primary-600"
            aria-hidden
          >
            <Headphones className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-bold text-2xl text-neutral-900 tracking-tight">Activa tu cuenta</h1>
            <p className="text-neutral-600 text-sm">
              Usa el PIN que te dio tu empresa y crea tu clave.
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
                autoComplete="username"
                inputMode="text"
              />
            )}
          />

          <FormField
            label="PIN de activación"
            required
            hint="Los 6 dígitos que te entregó tu empresa. Sirve una sola vez."
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="text"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                className={`${fieldInputClass(false)} text-center font-mono text-lg tracking-[0.3em]`}
                placeholder="000000"
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
              />
            )}
          />

          <div className="rounded-lg border border-primary-200 bg-primary-50/50 p-4">
            <p className="font-medium text-neutral-900 text-sm">Crea tu clave</p>
            <p className="mt-1 text-neutral-600 text-sm">
              6 dígitos, como la de tu banco. Solo la sabes tú: ni tu empresa ni Booster pueden
              verla. La usarás junto a tu RUT cada vez que entres.
            </p>
            <div className="mt-3 space-y-4">
              <FormField
                label="Clave numérica"
                required
                render={({ id, describedBy }) => (
                  <input
                    id={id}
                    aria-describedby={describedBy}
                    type="password"
                    value={clave}
                    onChange={(e) => setClave(e.target.value)}
                    className={fieldInputClass(false)}
                    placeholder="••••••"
                    inputMode="numeric"
                    maxLength={6}
                    autoComplete="new-password"
                  />
                )}
              />
              <FormField
                label="Repite tu clave"
                required
                render={({ id, describedBy }) => (
                  <input
                    id={id}
                    aria-describedby={describedBy}
                    type="password"
                    value={repetir}
                    onChange={(e) => setRepetir(e.target.value)}
                    className={fieldInputClass(false)}
                    placeholder="••••••"
                    inputMode="numeric"
                    maxLength={6}
                    autoComplete="new-password"
                  />
                )}
              />
            </div>
          </div>

          {submitError && (
            // role=alert + aria-live: el conductor puede estar usando lector de
            // pantalla, y sin esto el error le resulta invisible.
            <div
              role="alert"
              aria-live="assertive"
              className="rounded-md border border-danger-200 bg-danger-50 p-3 text-danger-700 text-sm"
            >
              {submitError}
              {yaActivada && (
                <Link
                  to="/login"
                  data-testid="ir-al-login"
                  className="mt-2 block font-medium text-danger-800 underline"
                >
                  Ir a iniciar sesión
                </Link>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-primary-600 px-4 py-3 font-medium text-base text-white transition hover:bg-primary-700 disabled:opacity-50"
          >
            {submitting ? 'Activando…' : 'Activar mi cuenta'}
          </button>
        </form>
      </div>
    </main>
  );
}
