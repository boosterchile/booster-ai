import { signupRequestSchema } from '@booster-ai/shared-schemas';
import { zodResolver } from '@hookform/resolvers/zod';
import { Send } from 'lucide-react';
import { useState } from 'react';
import { type UseFormSetError, useForm } from 'react-hook-form';
import { z } from 'zod';
import { FormField, inputClass } from '../components/FormField.js';
import { ApiError, api } from '../lib/api-client.js';

interface SolicitarAccesoFormValues {
  nombreCompleto: string;
  email: string;
}

const EMPTY_VALUES: SolicitarAccesoFormValues = { nombreCompleto: '', email: '' };

/**
 * Espejo del contrato del backend (`apps/api/src/routes/signup-request.ts`
 * zValidator body): `{ email: z.string().email().max(320), nombreCompleto:
 * z.string().min(1).max(200) }`.
 *
 * Reutiliza los validadores ya declarados en `signupRequestSchema`
 * (`packages/shared-schemas`) vía `.refine()` — single source of truth con
 * el backend, mismo patrón que `ProfileForm` con `chileanPhoneSchema` — en
 * vez de duplicar `.email().max(320)` acá. El schema compartido no trae
 * mensajes en español porque también describe la fila completa de BD para
 * la UI admin; se agregan acá para el copy de error del form.
 */
const solicitarAccesoFormSchema = z.object({
  nombreCompleto: z
    .string()
    .refine(
      (v) => signupRequestSchema.shape.nombreCompleto.safeParse(v).success,
      'Ingresa tu nombre completo (máx. 200 caracteres).',
    ),
  email: z
    .string()
    .refine(
      (v) => signupRequestSchema.shape.email.safeParse(v).success,
      'Ingresa un correo válido.',
    ),
});

type SubmitState = 'idle' | 'success' | 'error';

/**
 * /solicitar-acceso — alta de usuarios gateada por admin (SEC-001 Sprint 2b,
 * ADR-052, hito CORFO).
 *
 * Reemplaza el self-signup directo de Firebase: el visitante pide acceso
 * acá; un admin de plataforma revisa y aprueba/rechaza desde
 * `/app/platform-admin/signup-requests`. POST público (sin sesión Firebase,
 * el `api-client` no inyecta Bearer si no hay usuario logueado) a
 * `POST /api/v1/signup-request`. Backend ya existe — esta página SOLO
 * consume el contrato, no lo modifica.
 *
 * Anti-enumeración (SC-1.2.5): el backend responde `202 {ok:true}` SIEMPRE,
 * sin importar si el email ya existía (shadow) — el copy de éxito es
 * deliberadamente neutro y NUNCA insinúa si el correo ya estaba registrado.
 *
 * No redirige si hay sesión activa (un admin logueado puede querer ver la
 * página) — se mantiene simple, sin leer `useAuth()`.
 */
export function SolicitarAccesoRoute() {
  const [state, setState] = useState<SubmitState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SolicitarAccesoFormValues>({
    resolver: zodResolver(solicitarAccesoFormSchema),
    mode: 'onSubmit',
    defaultValues: EMPTY_VALUES,
  });

  async function onSubmit(values: SolicitarAccesoFormValues) {
    setErrorMessage(null);
    try {
      await api.post('/api/v1/signup-request', values);
      setState('success');
    } catch (err) {
      setState('error');
      // 400/422 → intenta mapear los issues de validación del backend a
      // los campos del form (setError) en vez del banner genérico. Si el
      // payload no trae issues mapeables, cae al banner (ver
      // `mapValidationIssuesToForm`).
      const mappedToFields = mapValidationIssuesToForm(err, setError);
      if (!mappedToFields) {
        setErrorMessage(translateSignupRequestError(err));
      }
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <header className="border-neutral-200 border-b bg-white px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center gap-2">
          <img src="/icons/icon.svg" alt="" aria-hidden className="h-7 w-7" />
          <span className="font-semibold text-lg text-neutral-900">Booster AI</span>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">Solicita acceso</h1>
          <p className="mt-2 text-neutral-600 text-sm">
            Completa tus datos y nuestro equipo revisará tu solicitud.
          </p>

          {state === 'success' ? (
            <output className="mt-6 block rounded-md border border-success-500/30 bg-success-50 p-3 text-sm text-success-700">
              Recibimos tu solicitud. Nuestro equipo la revisará y te contactará al correo indicado.
            </output>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
              {errorMessage && (
                <div
                  role="alert"
                  className="rounded-md border border-danger-500/30 bg-danger-50 p-3 text-danger-700 text-sm"
                >
                  {errorMessage}
                </div>
              )}

              <FormField
                label="Nombre completo"
                required
                error={errors.nombreCompleto?.message}
                render={({ id, describedBy }) => (
                  <input
                    id={id}
                    aria-describedby={describedBy}
                    type="text"
                    autoComplete="name"
                    {...register('nombreCompleto')}
                    className={inputClass(!!errors.nombreCompleto)}
                  />
                )}
              />

              <FormField
                label="Email"
                required
                error={errors.email?.message}
                render={({ id, describedBy }) => (
                  <input
                    id={id}
                    aria-describedby={describedBy}
                    type="email"
                    autoComplete="email"
                    {...register('email')}
                    className={inputClass(!!errors.email)}
                  />
                )}
              />

              <button
                type="submit"
                disabled={isSubmitting}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-primary-500 px-4 py-3 font-medium text-sm text-white shadow-xs transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Send className="h-4 w-4" aria-hidden />
                {isSubmitting ? 'Enviando…' : 'Solicitar acceso'}
              </button>
            </form>
          )}

          <p className="mt-6 text-center text-neutral-600 text-sm">
            <a
              href="/login"
              data-testid="solicitar-acceso-link-login"
              className="font-medium text-primary-600 hover:underline"
            >
              Volver a inicio de sesión
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}

/**
 * Traduce el resultado del POST a un mensaje neutro para el usuario. Usa
 * `ApiError.status`/`.code` — NUNCA `err.message.includes(...)` (CLAUDE.md
 * §requisito 3 de la spec de esta página).
 *
 * Nota de discrepancia de contrato: el brief (y la auditoría que lo generó)
 * cita `422` para body inválido, pero `apps/api/src/routes/signup-request.test.ts`
 * (líneas 122-159) verifica que el comportamiento real es `400` — el route
 * usa `zValidator('json', schema)` sin hook custom, que es el default de
 * `@hono/zod-validator`. Se tratan ambos status como "validación" acá: el
 * form ya espeja el contrato client-side, así que este branch es puramente
 * defensivo (bypass del form o drift futuro del backend hacia 422).
 *
 * Es el **fallback**: `onSubmit` primero intenta `mapValidationIssuesToForm`
 * (error por campo vía `setError`); solo si esa función devuelve `false`
 * (shape no mapeable) se usa este banner genérico para 400/422.
 */
function translateSignupRequestError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) {
      return 'Demasiados intentos, espera unos minutos.';
    }
    if (err.status === 400 || err.status === 422) {
      return 'Revisa los datos ingresados e intenta nuevamente.';
    }
  }
  return 'No pudimos procesar tu solicitud, intenta más tarde.';
}

/**
 * Copy en español por campo para cuando el backend rechaza el body con un
 * issue de zod en ese `path` — nunca se usa el `issue.message` crudo del
 * backend (viene en inglés, ej. "Invalid email", por ser el default de
 * `@hono/zod-validator`/zod sin locale custom).
 */
const FIELD_ERROR_COPY: Record<keyof SolicitarAccesoFormValues, string> = {
  nombreCompleto: 'Ingresa tu nombre completo (máx. 200 caracteres).',
  email: 'Ingresa un correo válido.',
};

/**
 * Shape real (verificado empíricamente contra `apps/api/src/routes/
 * signup-request.ts` — `zValidator('json', schema)` sin hook custom, que
 * es el default de `@hono/zod-validator@0.7.6`):
 *
 *   c.json({ success: false, error: <ZodError> }, 400)
 *
 * `ZodError` serializa (JSON.stringify de sus propiedades propias
 * enumerables) como `{ issues: [{ path, message, code, ... }], name }` —
 * `message` es un getter de prototipo y NO sobrevive el stringify. Solo
 * se valida el subset que se necesita (`path`); el resto del issue
 * (`message`, `code`) se ignora a propósito — ver `FIELD_ERROR_COPY`.
 */
const zValidatorErrorPayloadSchema = z.object({
  success: z.literal(false),
  error: z.object({
    issues: z.array(z.object({ path: z.array(z.union([z.string(), z.number()])) })),
  }),
});

/**
 * Mapea el payload 400/422 del backend a los campos del form vía
 * `setError` de react-hook-form, por `path` del issue de zod.
 *
 * Devuelve `true` si mapeó al menos un issue a un campo conocido del form
 * (`email` | `nombreCompleto`) — en ese caso el caller NO debe mostrar el
 * banner genérico. Devuelve `false` (fallback) cuando:
 *   - `err` no es un `ApiError` 400/422, o
 *   - `err.details` no calza con `zValidatorErrorPayloadSchema` (shape
 *     inesperado / drift del backend), o
 *   - ningún issue trae un `path[0]` que corresponda a un campo del form
 *     (ej. error en un campo desconocido).
 */
function mapValidationIssuesToForm(
  err: unknown,
  setFieldError: UseFormSetError<SolicitarAccesoFormValues>,
): boolean {
  if (!(err instanceof ApiError) || (err.status !== 400 && err.status !== 422)) {
    return false;
  }

  const parsed = zValidatorErrorPayloadSchema.safeParse(err.details);
  if (!parsed.success) {
    return false;
  }

  let mappedAny = false;
  for (const issue of parsed.data.error.issues) {
    const field = issue.path[0];
    if (field === 'email' || field === 'nombreCompleto') {
      setFieldError(field, { type: 'server', message: FIELD_ERROR_COPY[field] });
      mappedAny = true;
    }
  }
  return mappedAny;
}
