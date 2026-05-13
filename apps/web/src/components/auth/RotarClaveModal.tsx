import { KeyRound, Loader2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { humanizeRotarClaveError, useRotarClave } from '../../hooks/use-rotar-clave.js';

/**
 * ADR-035 Wave 4 PR 3 — Modal forzado que aparece post-login legacy cuando
 * el usuario todavía no setea su clave numérica universal (`has_clave_numerica = false`).
 *
 * Lo monta el `ProtectedRoute` (o cualquier wrapper post-login) cuando
 * detecta el flag. Bloquea el resto de la UI hasta que el usuario crea
 * la clave — esto es intencional para que la migración 30d sea
 * completable sin que el usuario "salte" el modal.
 *
 * Mobile-first:
 *   - Inputs numéricos con `inputMode="numeric"` para teclado mobile.
 *   - 2 inputs (nueva + confirmación) para evitar typos al crear.
 *
 * Trust boundary: este componente solo aparece cuando el usuario ya
 * está autenticado por Firebase (email/password legacy o Google). El
 * backend valida el firebase id token antes de aceptar el setseo.
 */

interface RotarClaveModalProps {
  /**
   * Texto que explica al usuario por qué aparece este modal. Permite
   * customizar si lo invocamos desde distintos contextos (primer login
   * post-Wave 4 vs rotación voluntaria desde perfil).
   */
  message?: string;
  /**
   * Callback opcional invocado tras setear exitosamente la clave.
   * Útil para que el wrapper haga navigation o cierre el modal.
   */
  onSuccess?: () => void;
}

export function RotarClaveModal({ message, onSuccess }: RotarClaveModalProps) {
  const rotarClave = useRotarClave();
  const [clave, setClave] = useState('');
  const [claveConfirm, setClaveConfirm] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);

    if (!/^\d{6}$/.test(clave)) {
      setLocalError('La clave debe ser exactamente 6 dígitos numéricos.');
      return;
    }
    if (clave !== claveConfirm) {
      setLocalError('Las dos claves no coinciden. Vuelve a escribir.');
      return;
    }

    try {
      await rotarClave.mutateAsync({ clave_anterior: null, clave_nueva: clave });
      onSuccess?.();
    } catch (err) {
      setLocalError(humanizeRotarClaveError(err));
    }
  }

  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: el elemento HTML <dialog> requiere showModal() imperativo que no encaja con React + el focus trap del browser tiene quirks cross-browser; usamos div con role="dialog" + aria-modal — patrón canónico de Radix/Headless UI.
      role="dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/60 p-4"
      aria-modal="true"
      aria-labelledby="rotar-clave-title"
      data-testid="rotar-clave-modal"
    >
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-700">
            <KeyRound className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h2 id="rotar-clave-title" className="font-semibold text-lg text-neutral-900">
              Crea tu clave numérica
            </h2>
            <p className="mt-1 text-neutral-600 text-sm">
              {message ??
                'Para que puedas ingresar a Booster con tu RUT en cualquier dispositivo, necesitas crear una clave de 6 dígitos. La usarás siempre desde ahora.'}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-3">
          <label className="flex flex-col gap-1">
            <span className="font-medium text-neutral-700 text-sm">Nueva clave (6 dígitos)</span>
            <input
              type="password"
              autoComplete="new-password"
              inputMode="numeric"
              maxLength={6}
              value={clave}
              onChange={(e) => setClave(e.target.value.replace(/\D/g, ''))}
              className="rounded-md border border-neutral-300 px-3 py-2 text-center font-mono text-lg tracking-widest focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
              placeholder="••••••"
              data-testid="rotar-clave-input"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-medium text-neutral-700 text-sm">Confirma la clave</span>
            <input
              type="password"
              autoComplete="new-password"
              inputMode="numeric"
              maxLength={6}
              value={claveConfirm}
              onChange={(e) => setClaveConfirm(e.target.value.replace(/\D/g, ''))}
              className="rounded-md border border-neutral-300 px-3 py-2 text-center font-mono text-lg tracking-widest focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
              placeholder="••••••"
              data-testid="rotar-clave-confirm-input"
            />
          </label>

          {localError && (
            <div
              role="alert"
              className="rounded-md border border-danger-200 bg-danger-50 p-2 text-danger-700 text-sm"
            >
              {localError}
            </div>
          )}

          <button
            type="submit"
            disabled={rotarClave.isPending}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary-600 px-4 py-3 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-50"
            data-testid="rotar-clave-submit"
          >
            {rotarClave.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Guardando…
              </>
            ) : (
              'Crear clave y continuar'
            )}
          </button>

          <p className="text-center text-neutral-500 text-xs">
            Anota tu clave en un lugar seguro. Si la olvidas, podrás recuperarla por WhatsApp.
          </p>
        </form>
      </div>
    </div>
  );
}
