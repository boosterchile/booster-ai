import type { Auth } from 'firebase/auth';
import { Loader2, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { firebaseAuth } from '../../lib/firebase.js';
import {
  type EnrollResult,
  enrollPhoneAsSecondFactor,
  listEnrolledSecondFactors,
  unenrollSecondFactor,
} from '../../lib/two-factor.js';

/**
 * Sección "Autenticación de dos factores" en /perfil.
 *
 * Estado (ADR-028 §"Acciones derivadas §6"):
 *  - 2FA es **opcional**, no enforced. Mejora la postura de seguridad
 *    para users que lo activen voluntariamente.
 *  - Pre-requisito de cobro (ADR-027 v2): cuando se active comisión real,
 *    los users con role `dueno` o `admin` deberían tener 2FA enrollment
 *    obligatorio. Esto se enforza en backend en ese momento (no acá).
 */
export function TwoFactorSection({
  initialPhoneE164,
  authOverride,
}: {
  /** Teléfono pre-rellenado del perfil del user (opcional). */
  initialPhoneE164?: string | null;
  /** Override Auth para tests (default: firebaseAuth singleton). */
  authOverride?: Auth;
}) {
  const auth = authOverride ?? firebaseAuth;
  const [enrolledFactors, setEnrolledFactors] = useState<
    Array<{ uid: string; displayName: string | null; factorId: string }>
  >([]);
  const [phone, setPhone] = useState(initialPhoneE164 ?? '');
  const [smsCodePromptVisible, setSmsCodePromptVisible] = useState(false);
  const [smsCode, setSmsCode] = useState('');
  const [smsCodeResolver, setSmsCodeResolver] = useState<((v: string | null) => void) | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [unenrolling, setUnenrolling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setEnrolledFactors(listEnrolledSecondFactors({ auth }));
  }, [auth]);

  function promptSmsCode(): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      setSmsCodeResolver(() => resolve);
      setSmsCode('');
      setSmsCodePromptVisible(true);
    });
  }

  function handleSmsCodeConfirm() {
    if (smsCodeResolver) {
      smsCodeResolver(smsCode || null);
      setSmsCodeResolver(null);
      setSmsCodePromptVisible(false);
    }
  }

  function handleSmsCodeCancel() {
    if (smsCodeResolver) {
      smsCodeResolver(null);
      setSmsCodeResolver(null);
      setSmsCodePromptVisible(false);
    }
  }

  async function handleEnroll() {
    setError(null);
    setSuccess(null);
    if (!/^\+\d{8,15}$/.test(phone)) {
      setError('Teléfono inválido. Formato esperado: +56912345678');
      return;
    }
    setEnrolling(true);
    try {
      const result: EnrollResult = await enrollPhoneAsSecondFactor({
        auth,
        phoneE164: phone,
        recaptchaContainerId: 'recaptcha-container-2fa',
        promptSmsCode,
      });
      if (result.ok) {
        setSuccess('2FA activado correctamente.');
        setEnrolledFactors(listEnrolledSecondFactors({ auth }));
      } else {
        setError(reasonToMessage(result.reason));
      }
    } finally {
      setEnrolling(false);
    }
  }

  async function handleUnenroll(factorUid: string) {
    setError(null);
    setSuccess(null);
    setUnenrolling(factorUid);
    try {
      const result = await unenrollSecondFactor({ auth, factorUid });
      if (result.ok) {
        setSuccess('Factor desactivado.');
        setEnrolledFactors(listEnrolledSecondFactors({ auth }));
      } else {
        setError('No se pudo desactivar el factor. Intenta de nuevo.');
      }
    } finally {
      setUnenrolling(null);
    }
  }

  return (
    <section className="mt-8 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <header className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-neutral-700" aria-hidden />
        <h2 className="font-semibold text-lg text-neutral-900">Autenticación en dos pasos</h2>
      </header>
      <p className="mt-2 text-neutral-600 text-sm">
        Agrega un código por SMS al iniciar sesión. Reduce el riesgo de acceso indebido si tu
        contraseña es expuesta.
      </p>

      {/* Container del reCAPTCHA invisible — Firebase lo monta acá al verifyPhoneNumber */}
      <div id="recaptcha-container-2fa" className="hidden" />

      {enrolledFactors.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {enrolledFactors.map((f) => (
            <li
              key={f.uid}
              className="flex items-center justify-between rounded border border-neutral-200 bg-neutral-50 px-3 py-2"
            >
              <span className="flex items-center gap-2 text-neutral-800 text-sm">
                <Smartphone className="h-4 w-4" aria-hidden />
                {f.displayName ?? 'Teléfono'} ({f.factorId})
              </span>
              <button
                type="button"
                onClick={() => handleUnenroll(f.uid)}
                disabled={unenrolling === f.uid}
                className="inline-flex items-center gap-1 rounded border border-red-300 bg-white px-2 py-1 text-red-700 text-xs transition hover:bg-red-50 disabled:opacity-50"
              >
                {unenrolling === f.uid ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                ) : (
                  <ShieldOff className="h-3 w-3" aria-hidden />
                )}
                Desactivar
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-neutral-500 text-sm italic">
          No tienes 2FA activado. Activa SMS para mayor seguridad.
        </p>
      )}

      <div className="mt-6 border-neutral-200 border-t pt-4">
        <label htmlFor="2fa-phone" className="block font-medium text-neutral-700 text-sm">
          Tu teléfono (formato E.164)
        </label>
        <input
          id="2fa-phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+56912345678"
          className="mt-1 block w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
        />
        <button
          type="button"
          onClick={handleEnroll}
          disabled={enrolling}
          className="mt-3 inline-flex items-center gap-2 rounded bg-amber-600 px-4 py-2 font-medium text-sm text-white transition hover:bg-amber-700 disabled:opacity-50"
        >
          {enrolling ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <ShieldCheck className="h-4 w-4" aria-hidden />
          )}
          Activar 2FA por SMS
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-red-800 text-sm"
        >
          {error}
        </div>
      )}
      {success && (
        <output className="mt-4 block rounded border border-green-300 bg-green-50 p-3 text-green-800 text-sm">
          {success}
        </output>
      )}

      {smsCodePromptVisible && (
        <dialog
          open
          aria-modal="true"
          aria-labelledby="sms-code-prompt-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        >
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-lg">
            <h3 id="sms-code-prompt-title" className="font-semibold text-lg text-neutral-900">
              Código SMS
            </h3>
            <p className="mt-2 text-neutral-600 text-sm">
              Ingresa el código que enviamos a {phone}.
            </p>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              value={smsCode}
              onChange={(e) => setSmsCode(e.target.value)}
              placeholder="123456"
              className="mt-3 block w-full rounded border border-neutral-300 px-3 py-2 text-center text-lg tracking-widest focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={handleSmsCodeCancel}
                className="rounded border border-neutral-300 bg-white px-3 py-2 text-neutral-700 text-sm hover:bg-neutral-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSmsCodeConfirm}
                disabled={!smsCode}
                className="rounded bg-amber-600 px-3 py-2 font-medium text-sm text-white hover:bg-amber-700 disabled:opacity-50"
              >
                Confirmar
              </button>
            </div>
          </div>
        </dialog>
      )}
    </section>
  );
}

function reasonToMessage(reason: string): string {
  switch (reason) {
    case 'no_user':
      return 'Necesitas estar logueado para activar 2FA.';
    case 'phone_invalid':
      return 'Teléfono inválido. Formato esperado: +56912345678';
    case 'sms_cancelled':
      return 'Cancelaste el ingreso del código SMS.';
    case 'sms_invalid':
      return 'El código SMS es incorrecto. Intenta de nuevo.';
    default:
      return 'Ocurrió un error. Intenta más tarde.';
  }
}
