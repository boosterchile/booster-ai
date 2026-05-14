import {
  USER_TYPE_HINT_LABEL,
  type UserTypeHint,
  ensureRutHasDash,
  loginRutSchema,
  rutSchema,
} from '@booster-ai/shared-schemas';
import { useNavigate, useSearch } from '@tanstack/react-router';
import {
  ArrowRight,
  Building2,
  KeyRound,
  Loader2,
  Package,
  ShieldCheck,
  Truck,
  Users,
} from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { signInUniversalWithCustomToken } from '../../hooks/use-auth.js';
import { getApiUrl } from '../../lib/api-url.js';

/**
 * ADR-035 — Login universal RUT + clave numérica (Wave 4 PR 2).
 *
 * Surface única para todos los roles. Dos pasos:
 *
 *   1. **Selector tipo usuario**: 5 botones (Generador de carga /
 *      Transporte / Conductor / Stakeholder / Booster). El selector
 *      determina la **vista inicial** post-login, NO el rol — el rol
 *      sigue viniendo de memberships del user.
 *
 *   2. **Form RUT + clave**: con el tipo preseleccionado, el usuario
 *      ingresa su RUT chileno + 6 dígitos. Backend valida con scrypt
 *      timing-safe contra `usuarios.clave_numerica_hash`.
 *
 * Subdominios (transporte.boosterchile.com, conductor.boosterchile.com,
 * etc.) son 301 redirects al canónico con `?tipo=<rol>` que pre-selecciona
 * el botón correspondiente.
 *
 * El tipo "Booster" (platform admin) requiere allowlist server-side
 * adicional. Si un user sin allowlist elige "Booster", el AppRoute lo
 * redirigirá a su surface real post-login.
 *
 * NeedsRotation: si el backend responde 410 (user sin clave seteada),
 * mostramos un mensaje guiando al usuario a usar su método anterior
 * (Google / email+password legacy) para activar su clave. La UI de
 * rotación entra en Wave 4 PR 3.
 */

type UniversalLoginSearch = {
  tipo?: UserTypeHint;
};

interface ActivateResponse {
  custom_token: string;
  synthetic_email: string;
  auth_method: 'rut_clave';
}

interface NeedsRotationResponse {
  error: 'needs_rotation';
  code: 'needs_rotation';
  message: string;
}

type Step = 'selector' | 'form' | 'needs-rotation';

interface UserTypeOption {
  value: UserTypeHint;
  label: string;
  description: string;
  Icon: typeof Truck;
}

const USER_TYPE_OPTIONS: UserTypeOption[] = [
  {
    value: 'carga',
    label: USER_TYPE_HINT_LABEL.carga,
    description: 'Genero cargas y necesito transportistas.',
    Icon: Package,
  },
  {
    value: 'transporte',
    label: USER_TYPE_HINT_LABEL.transporte,
    description: 'Tengo una empresa de transporte de carga.',
    Icon: Truck,
  },
  {
    value: 'conductor',
    label: USER_TYPE_HINT_LABEL.conductor,
    description: 'Soy conductor de un vehículo de carga.',
    Icon: Users,
  },
  {
    value: 'stakeholder',
    label: USER_TYPE_HINT_LABEL.stakeholder,
    description: 'Audito datos agregados (regulador, gremio, ONG).',
    Icon: Building2,
  },
  {
    value: 'booster',
    label: USER_TYPE_HINT_LABEL.booster,
    description: 'Soy parte del equipo Booster.',
    Icon: ShieldCheck,
  },
];

export function LoginUniversal() {
  const navigate = useNavigate();
  // Tanstack Router type-safe — esta route todavía no declara search params;
  // leemos lo que venga manualmente desde la URL como fallback compatible.
  const search = (useSearch({ strict: false }) ?? {}) as UniversalLoginSearch;
  const preselectedTipo = search.tipo;

  const [step, setStep] = useState<Step>(preselectedTipo ? 'form' : 'selector');
  const [tipo, setTipo] = useState<UserTypeHint | null>(preselectedTipo ?? null);
  const [rut, setRut] = useState('');
  const [clave, setClave] = useState('');
  const [rutError, setRutError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Si el query param cambia (e.g. user navega entre subdominios), update tipo.
  useEffect(() => {
    if (preselectedTipo && preselectedTipo !== tipo) {
      setTipo(preselectedTipo);
      setStep('form');
    }
  }, [preselectedTipo, tipo]);

  function handleSelectTipo(t: UserTypeHint) {
    setTipo(t);
    setStep('form');
    setRut('');
    setClave('');
    setRutError(null);
    setSubmitError(null);
  }

  function handleBackToSelector() {
    setStep('selector');
    setTipo(null);
    setRut('');
    setClave('');
    setRutError(null);
    setSubmitError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setRutError(null);
    setSubmitError(null);

    // Pre-procesar: si el user tipeó solo dígitos (móvil bloquea el `-`
    // con inputMode numeric), insertar guión automáticamente antes del
    // dígito verificador. Idempotente — input con guión queda intacto.
    const rutWithDash = ensureRutHasDash(rut);
    const rutParsed = rutSchema.safeParse(rutWithDash);
    if (!rutParsed.success) {
      setRutError(rutParsed.error.issues[0]?.message ?? 'RUT inválido');
      return;
    }
    const cleanRut = rutParsed.data;

    if (!/^\d{6}$/.test(clave)) {
      setSubmitError('La clave debe ser exactamente 6 dígitos.');
      return;
    }

    const bodyParsed = loginRutSchema.safeParse({ rut: cleanRut, clave, tipo: tipo ?? undefined });
    if (!bodyParsed.success) {
      setSubmitError('Datos inválidos. Verifica RUT y clave.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${getApiUrl()}/auth/login-rut`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(bodyParsed.data),
      });

      if (res.ok) {
        const body = (await res.json()) as ActivateResponse;
        await signInUniversalWithCustomToken(body.custom_token);
        void navigate({ to: '/app' });
        return;
      }

      if (res.status === 410) {
        const body = (await res.json()) as NeedsRotationResponse;
        setSubmitError(body.message);
        setStep('needs-rotation');
        return;
      }

      if (res.status === 401) {
        setSubmitError('RUT o clave incorrectos. Verifica e intenta de nuevo.');
        return;
      }

      if (res.status === 400) {
        setSubmitError('Datos inválidos. Verifica RUT y clave.');
        return;
      }

      setSubmitError(`Error inesperado (${res.status}). Intenta de nuevo.`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Error al conectar con el servidor.');
    } finally {
      setSubmitting(false);
    }
  }

  if (step === 'selector') {
    return <SelectorView onSelect={handleSelectTipo} />;
  }

  if (step === 'needs-rotation') {
    return <NeedsRotationView onBack={handleBackToSelector} message={submitError} />;
  }

  return (
    <FormView
      tipo={tipo}
      rut={rut}
      clave={clave}
      rutError={rutError}
      submitError={submitError}
      submitting={submitting}
      onChangeRut={setRut}
      onChangeClave={setClave}
      onSubmit={handleSubmit}
      onBack={handleBackToSelector}
    />
  );
}

// ---------------------------------------------------------------------------
// Selector — 5 botones de tipo de usuario
// ---------------------------------------------------------------------------

function SelectorView({ onSelect }: { onSelect: (t: UserTypeHint) => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 p-4">
      <div
        className="w-full max-w-2xl rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
        data-testid="login-universal-selector"
      >
        <div className="text-center">
          <h1 className="font-bold text-2xl text-neutral-900 tracking-tight">
            Bienvenido a Booster
          </h1>
          <p className="mt-2 text-neutral-600 text-sm">
            ¿Cómo te identificas en Booster? Elige una opción para continuar.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {USER_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onSelect(opt.value)}
              className="flex items-start gap-3 rounded-lg border border-neutral-200 bg-white p-4 text-left transition hover:border-primary-500 hover:bg-primary-50"
              data-testid={`login-tipo-${opt.value}`}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary-100 text-primary-700">
                <opt.Icon className="h-5 w-5" aria-hidden />
              </div>
              <div>
                <div className="font-semibold text-neutral-900">{opt.label}</div>
                <div className="mt-0.5 text-neutral-600 text-xs">{opt.description}</div>
              </div>
            </button>
          ))}
        </div>

        <p className="mt-6 text-center text-neutral-500 text-xs">
          Tu acceso usa RUT + clave numérica. Lo mismo que tu app de banco.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form — RUT + clave (paso 2)
// ---------------------------------------------------------------------------

interface FormViewProps {
  tipo: UserTypeHint | null;
  rut: string;
  clave: string;
  rutError: string | null;
  submitError: string | null;
  submitting: boolean;
  onChangeRut: (v: string) => void;
  onChangeClave: (v: string) => void;
  onSubmit: (e: FormEvent) => void;
  onBack: () => void;
}

function FormView(props: FormViewProps) {
  const label = props.tipo ? USER_TYPE_HINT_LABEL[props.tipo] : 'Ingresar';
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 p-4">
      <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary-50 text-primary-700">
            <KeyRound className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <div className="text-neutral-500 text-xs">Ingresar como</div>
            <h1 className="font-semibold text-neutral-900">{label}</h1>
          </div>
        </div>

        <form
          onSubmit={props.onSubmit}
          noValidate
          className="mt-6 space-y-4"
          data-testid="login-universal-form"
        >
          <label className="flex flex-col gap-1">
            <span className="font-medium text-neutral-700 text-sm">RUT</span>
            <input
              type="text"
              autoComplete="username"
              // inputMode="text" (no "numeric") — el RUT tiene guión y opcionalmente
              // "K" en el dígito verificador. El teclado numérico móvil bloquea
              // el guión y la letra. Si user tipea solo dígitos, ensureRutHasDash
              // lo formatea antes de validar.
              inputMode="text"
              value={props.rut}
              onChange={(e) => props.onChangeRut(e.target.value)}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
              placeholder="12.345.678-9 (también 123456789 funciona)"
              data-testid="login-rut-input"
            />
            {props.rutError && (
              <span className="text-danger-700 text-xs" role="alert">
                {props.rutError}
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-medium text-neutral-700 text-sm">Clave (6 dígitos)</span>
            <input
              type="password"
              autoComplete="current-password"
              inputMode="numeric"
              maxLength={6}
              value={props.clave}
              onChange={(e) => props.onChangeClave(e.target.value.replace(/\D/g, ''))}
              className="rounded-md border border-neutral-300 px-3 py-2 text-center font-mono text-lg tracking-widest focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
              placeholder="••••••"
              data-testid="login-clave-input"
            />
            <span className="text-neutral-500 text-xs">
              Si nunca configuraste tu clave, usa tu método anterior una vez para activarla.
            </span>
          </label>

          {props.submitError && (
            <div
              className="rounded-md border border-danger-200 bg-danger-50 p-2 text-danger-700 text-sm"
              role="alert"
            >
              {props.submitError}
            </div>
          )}

          <button
            type="submit"
            disabled={props.submitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary-600 px-4 py-3 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-50"
            data-testid="login-submit"
          >
            {props.submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Ingresando…
              </>
            ) : (
              <>
                Ingresar
                <ArrowRight className="h-4 w-4" aria-hidden />
              </>
            )}
          </button>

          <button
            type="button"
            onClick={props.onBack}
            className="block w-full text-center text-neutral-500 text-xs hover:text-neutral-700"
            data-testid="login-back-to-selector"
          >
            Cambiar tipo de usuario
          </button>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NeedsRotation — guía al usuario a setear su primera clave (PR 3 wire UI)
// ---------------------------------------------------------------------------

function NeedsRotationView({ onBack, message }: { onBack: () => void; message: string | null }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 p-4">
      <div className="w-full max-w-md rounded-lg border border-amber-200 bg-amber-50 p-6 shadow-sm">
        <h1 className="font-semibold text-amber-900 text-lg">Configura tu clave numérica</h1>
        <p className="mt-2 text-amber-800 text-sm">
          {message ??
            'Tu cuenta todavía no tiene una clave numérica. Necesitamos que la actives una sola vez.'}
        </p>
        <p className="mt-3 text-amber-700 text-sm">
          Inicia sesión con tu método anterior (Google o email + contraseña) y te guiaremos para
          crear tu nueva clave de 6 dígitos. Después podrás usarla siempre.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <a
            href="/login?legacy=1"
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700"
            data-testid="needs-rotation-go-legacy"
          >
            Usar método anterior
          </a>
          <button
            type="button"
            onClick={onBack}
            className="text-center text-neutral-500 text-sm hover:text-neutral-700"
          >
            Cambiar tipo de usuario
          </button>
        </div>
      </div>
    </div>
  );
}
