'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { type SignupRequestBody, signupRequestBodySchema } from '../lib/signup-client.js';

export interface SignupFormProps {
  /**
   * Handler de envío válido. T4 deja el form en modo render + validación
   * cliente; T5 pasa el handler real que llama `postSignupRequest` y mapea
   * el resultado a estados de UI.
   */
  onSubmit?: (data: SignupRequestBody) => void | Promise<void>;
}

/**
 * Formulario mínimo de solicitud de acceso: solo `email` + `nombreCompleto`
 * (el modelo gateado no captura rol/empresa; eso se define en el onboarding
 * post-aprobación). Valida con el schema DERIVADO del dominio compartido.
 */
export function SignupForm({ onSubmit }: SignupFormProps = {}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupRequestBody>({
    resolver: zodResolver(signupRequestBodySchema),
  });

  const submit = handleSubmit(async (data) => {
    await onSubmit?.(data);
  });

  return (
    <main className="mx-auto max-w-md px-6 py-20">
      <h1 className="font-bold text-2xl text-neutral-900">Solicitar acceso</h1>
      <p className="mt-2 text-neutral-600 text-sm">
        Déjanos tus datos. Revisamos cada solicitud y te contactamos para activar tu cuenta.
      </p>
      <form className="mt-8 space-y-4" onSubmit={submit} noValidate>
        <div>
          <label htmlFor="email" className="block font-medium text-neutral-900 text-sm">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            {...register('email')}
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
          {errors.email ? (
            <p role="alert" className="mt-1 text-red-600 text-sm">
              Ingresa un email válido.
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor="nombreCompleto" className="block font-medium text-neutral-900 text-sm">
            Nombre completo
          </label>
          <input
            id="nombreCompleto"
            autoComplete="name"
            {...register('nombreCompleto')}
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
          {errors.nombreCompleto ? (
            <p role="alert" className="mt-1 text-red-600 text-sm">
              Ingresa tu nombre completo.
            </p>
          ) : null}
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-lg bg-primary-600 px-5 py-3 font-semibold text-sm text-white transition hover:bg-primary-700 disabled:opacity-60"
        >
          Solicitar acceso
        </button>
      </form>
    </main>
  );
}
