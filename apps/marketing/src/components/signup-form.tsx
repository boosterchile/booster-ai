'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  type SignupOutcome,
  type SignupRequestBody,
  postSignupRequest,
  signupRequestBodySchema,
} from '../lib/signup-client.js';
import { signupFeedback } from './signup-feedback.js';

export interface SignupFormProps {
  /**
   * Ejecutor del POST. Default = `postSignupRequest` (fetch real, lee la env).
   * Inyectable para test.
   */
  submitRequest?: (body: SignupRequestBody) => Promise<SignupOutcome>;
}

const INPUT_CLASS = 'mt-1 w-full rounded-lg border border-neutral-500 px-3 py-2 text-sm';

/**
 * Formulario mínimo de solicitud de acceso: solo `email` + `nombreCompleto`
 * (el modelo gateado no captura rol/empresa; eso se define en el onboarding
 * post-aprobación). Valida con el schema DERIVADO del dominio compartido y
 * mapea el resultado del signup-request a estados de UI (T5).
 *
 * NOTA copy (review P1-2): no promete "te contactaremos" — el notifier real
 * aún no está cableado. Encender este form (NEXT_PUBLIC_SIGNUP_ENABLED) exige
 * el readiness del downstream (spec §11), incluyendo el notifier.
 */
export function SignupForm({ submitRequest = postSignupRequest }: SignupFormProps = {}) {
  const [outcome, setOutcome] = useState<SignupOutcome | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupRequestBody>({
    resolver: zodResolver(signupRequestBodySchema),
  });

  const submit = handleSubmit(async (data) => {
    setOutcome(await submitRequest(data));
  });

  const feedback = outcome ? signupFeedback(outcome) : null;

  // Éxito (202): reemplaza el form por la confirmación. El mensaje es idéntico
  // para email nuevo vs existente (anti-enumeration) — no leemos el body.
  if (feedback?.tone === 'success') {
    return (
      <main className="mx-auto max-w-md px-6 py-20">
        <h1 className="font-bold text-2xl text-neutral-900">Solicitud enviada</h1>
        <output className="mt-4 block text-neutral-700">{feedback.message}</output>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-6 py-20">
      <h1 className="font-bold text-2xl text-neutral-900">Solicitar acceso</h1>
      <p className="mt-2 text-neutral-600 text-sm">
        Déjanos tus datos. Revisamos cada solicitud antes de habilitar el acceso.
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
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? 'email-error' : undefined}
            {...register('email')}
            className={INPUT_CLASS}
          />
          {errors.email ? (
            <p id="email-error" role="alert" className="mt-1 text-danger-600 text-sm">
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
            aria-invalid={errors.nombreCompleto ? true : undefined}
            aria-describedby={errors.nombreCompleto ? 'nombre-error' : undefined}
            {...register('nombreCompleto')}
            className={INPUT_CLASS}
          />
          {errors.nombreCompleto ? (
            <p id="nombre-error" role="alert" className="mt-1 text-danger-600 text-sm">
              Ingresa tu nombre completo.
            </p>
          ) : null}
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          aria-busy={isSubmitting}
          className="w-full cursor-pointer rounded-lg bg-primary-600 px-5 py-3 font-semibold text-sm text-white transition hover:bg-primary-700 disabled:opacity-60"
        >
          {isSubmitting ? 'Enviando…' : 'Solicitar acceso'}
        </button>
        {feedback?.tone === 'error' ? (
          <p role="alert" className="text-danger-600 text-sm">
            {feedback.message}
          </p>
        ) : null}
      </form>
    </main>
  );
}
