import {
  type EmpresaOnboardingInput,
  empresaOnboardingInputSchema,
} from '@booster-ai/shared-schemas';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight, Building2, Check, Layers, Truck, User } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { Controller, FormProvider, useForm } from 'react-hook-form';
import { useOnboardingMutation } from '../../hooks/use-onboarding-mutation.js';
import type { ApiError } from '../../lib/api-client.js';

type Step = 1 | 2 | 3 | 4;

const STEPS: ReadonlyArray<{
  step: Step;
  title: string;
  shortTitle: string;
  Icon: typeof User;
}> = [
  { step: 1, title: 'Tus datos', shortTitle: 'Tú', Icon: User },
  { step: 2, title: 'Tu empresa', shortTitle: 'Empresa', Icon: Building2 },
  { step: 3, title: 'Tipo de operación', shortTitle: 'Operación', Icon: Truck },
  { step: 4, title: 'Plan', shortTitle: 'Plan', Icon: Layers },
];

/**
 * Defaults razonables. El email del paso 2 lo prefilleamos con el de
 * Firebase pasado por props (es lo que el user usó para loguearse).
 */
function buildDefaults(opts: {
  firebaseEmail: string;
  firebaseName: string | undefined;
}): EmpresaOnboardingInput {
  return {
    user: {
      full_name: opts.firebaseName ?? '',
      phone: '+569' as unknown as EmpresaOnboardingInput['user']['phone'],
    },
    empresa: {
      legal_name: '',
      rut: '' as unknown as EmpresaOnboardingInput['empresa']['rut'],
      contact_email: opts.firebaseEmail,
      contact_phone: '+569' as unknown as EmpresaOnboardingInput['empresa']['contact_phone'],
      address: {
        street: '',
        commune: '',
        city: '',
        region: 'XIII',
        country: 'CL',
      },
      is_shipper: false,
      is_carrier: false,
    },
    plan_slug: 'free',
  };
}

const REGIONS_CHILE: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'XV', name: 'XV — Arica y Parinacota' },
  { code: 'I', name: 'I — Tarapacá' },
  { code: 'II', name: 'II — Antofagasta' },
  { code: 'III', name: 'III — Atacama' },
  { code: 'IV', name: 'IV — Coquimbo' },
  { code: 'V', name: 'V — Valparaíso' },
  { code: 'XIII', name: 'XIII — Metropolitana' },
  { code: 'VI', name: "VI — O'Higgins" },
  { code: 'VII', name: 'VII — Maule' },
  { code: 'XVI', name: 'XVI — Ñuble' },
  { code: 'VIII', name: 'VIII — Biobío' },
  { code: 'IX', name: 'IX — La Araucanía' },
  { code: 'XIV', name: 'XIV — Los Ríos' },
  { code: 'X', name: 'X — Los Lagos' },
  { code: 'XI', name: 'XI — Aysén' },
  { code: 'XII', name: 'XII — Magallanes' },
];

const PLANS: ReadonlyArray<{
  slug: 'free' | 'standard' | 'pro' | 'enterprise';
  name: string;
  priceLabel: string;
  description: string;
  features: ReadonlyArray<string>;
  recommended?: boolean;
}> = [
  {
    slug: 'free',
    name: 'Free',
    priceLabel: 'Gratis',
    description: 'Para arrancar. Hasta 5 cargas activas y 3 vehículos.',
    features: ['5 cargas activas', '3 vehículos', 'Soporte por email'],
  },
  {
    slug: 'standard',
    name: 'Standard',
    priceLabel: '$ 49.000 / mes',
    description: 'Operación regular con flota mediana.',
    features: [
      '50 cargas activas',
      '20 vehículos',
      'Auto Carta de Porte + DTE',
      'Soporte prioritario',
    ],
    recommended: true,
  },
  {
    slug: 'pro',
    name: 'Pro',
    priceLabel: '$ 149.000 / mes',
    description: 'Flotas grandes o múltiples cargas diarias.',
    features: ['Cargas ilimitadas', '100 vehículos', 'API + analytics avanzado', 'Account manager'],
  },
];

export interface OnboardingFormProps {
  firebaseEmail: string;
  firebaseName: string | undefined;
}

export function OnboardingForm({ firebaseEmail, firebaseName }: OnboardingFormProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const mutation = useOnboardingMutation();

  const methods = useForm<EmpresaOnboardingInput>({
    resolver: zodResolver(empresaOnboardingInputSchema),
    mode: 'onBlur',
    defaultValues: buildDefaults({ firebaseEmail, firebaseName }),
  });

  const {
    handleSubmit,
    register,
    formState: { errors },
    trigger,
    control,
    watch,
  } = methods;

  /**
   * Valida solo los campos del paso actual antes de avanzar. Trigger es
   * la API de react-hook-form para validar paths puntuales sin submit.
   */
  async function nextStep() {
    const fieldsToValidate: ReadonlyArray<Parameters<typeof trigger>[0]> = (() => {
      switch (step) {
        case 1:
          return [['user.full_name', 'user.phone', 'user.rut']];
        case 2:
          return [
            [
              'empresa.legal_name',
              'empresa.rut',
              'empresa.contact_email',
              'empresa.contact_phone',
              'empresa.address.street',
              'empresa.address.commune',
              'empresa.address.city',
              'empresa.address.region',
            ],
          ];
        case 3:
          return [['empresa.is_shipper', 'empresa.is_carrier']];
        default:
          return [];
      }
    })();

    const ok = fieldsToValidate.length === 0 ? true : await trigger(fieldsToValidate[0]);
    if (ok && step < 4) {
      setStep(((step as number) + 1) as Step);
    }
  }

  function prevStep() {
    if (step > 1) {
      setStep(((step as number) - 1) as Step);
    }
  }

  async function onSubmit(values: EmpresaOnboardingInput) {
    try {
      await mutation.mutateAsync(values);
      void navigate({ to: '/app' });
    } catch {
      // mutation.error ya tiene el ApiError; el render lo muestra abajo.
    }
  }

  const submissionError = mutation.error ? translateApiError(mutation.error) : null;

  return (
    <FormProvider {...methods}>
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="w-full max-w-2xl rounded-lg border border-neutral-200 bg-white p-8 shadow-sm"
        noValidate
      >
        <ProgressIndicator step={step} />

        {step === 1 && (
          <section className="mt-8 space-y-4">
            <h2 className="font-semibold text-neutral-900 text-xl">Tus datos</h2>
            <p className="text-neutral-600 text-sm">
              Vamos a usarlos para personalizar tu experiencia y verificar tu identidad si hace
              falta.
            </p>
            <Field
              label="Nombre completo"
              error={errors.user?.full_name?.message}
              render={(id) => (
                <input
                  id={id}
                  {...register('user.full_name')}
                  autoComplete="name"
                  className={inputClass(!!errors.user?.full_name)}
                />
              )}
            />
            <Field
              label="Teléfono móvil"
              hint="Formato +56 9 XXXX XXXX. Lo usaremos para notificaciones críticas."
              error={errors.user?.phone?.message}
              render={(id) => (
                <input
                  id={id}
                  {...register('user.phone')}
                  autoComplete="tel"
                  inputMode="tel"
                  placeholder="+56912345678"
                  className={inputClass(!!errors.user?.phone)}
                />
              )}
            />
            <Field
              label="RUT (opcional)"
              hint="Tu RUT personal. No lo usamos para facturar — la facturación va al RUT empresa."
              error={errors.user?.rut?.message}
              render={(id) => (
                <input
                  id={id}
                  {...register('user.rut')}
                  autoComplete="off"
                  placeholder="12.345.678-9"
                  className={inputClass(!!errors.user?.rut)}
                />
              )}
            />
          </section>
        )}

        {step === 2 && (
          <section className="mt-8 space-y-4">
            <h2 className="font-semibold text-neutral-900 text-xl">Tu empresa</h2>
            <p className="text-neutral-600 text-sm">
              Datos legales de la empresa. Vamos a validar el RUT antes de habilitarte para operar
              cargas reales.
            </p>
            <Field
              label="Razón social"
              error={errors.empresa?.legal_name?.message}
              render={(id) => (
                <input
                  id={id}
                  {...register('empresa.legal_name')}
                  autoComplete="organization"
                  className={inputClass(!!errors.empresa?.legal_name)}
                />
              )}
            />
            <Field
              label="RUT empresa"
              error={errors.empresa?.rut?.message}
              render={(id) => (
                <input
                  id={id}
                  {...register('empresa.rut')}
                  autoComplete="off"
                  placeholder="76.123.456-0"
                  className={inputClass(!!errors.empresa?.rut)}
                />
              )}
            />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field
                label="Email de contacto"
                error={errors.empresa?.contact_email?.message}
                render={(id) => (
                  <input
                    id={id}
                    {...register('empresa.contact_email')}
                    type="email"
                    autoComplete="email"
                    className={inputClass(!!errors.empresa?.contact_email)}
                  />
                )}
              />
              <Field
                label="Teléfono de contacto"
                error={errors.empresa?.contact_phone?.message}
                render={(id) => (
                  <input
                    id={id}
                    {...register('empresa.contact_phone')}
                    inputMode="tel"
                    placeholder="+56912345678"
                    className={inputClass(!!errors.empresa?.contact_phone)}
                  />
                )}
              />
            </div>
            <Field
              label="Dirección"
              hint="Calle y número. Ej: Av. Apoquindo 5550"
              error={errors.empresa?.address?.street?.message}
              render={(id) => (
                <input
                  id={id}
                  {...register('empresa.address.street')}
                  autoComplete="street-address"
                  className={inputClass(!!errors.empresa?.address?.street)}
                />
              )}
            />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field
                label="Comuna"
                error={errors.empresa?.address?.commune?.message}
                render={(id) => (
                  <input
                    id={id}
                    {...register('empresa.address.commune')}
                    autoComplete="address-level3"
                    className={inputClass(!!errors.empresa?.address?.commune)}
                  />
                )}
              />
              <Field
                label="Ciudad"
                error={errors.empresa?.address?.city?.message}
                render={(id) => (
                  <input
                    id={id}
                    {...register('empresa.address.city')}
                    autoComplete="address-level2"
                    className={inputClass(!!errors.empresa?.address?.city)}
                  />
                )}
              />
              <Field
                label="Región"
                error={errors.empresa?.address?.region?.message}
                render={(id) => (
                  <select
                    id={id}
                    {...register('empresa.address.region')}
                    className={inputClass(!!errors.empresa?.address?.region)}
                  >
                    {REGIONS_CHILE.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                )}
              />
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="mt-8 space-y-4">
            <h2 className="font-semibold text-neutral-900 text-xl">¿Cómo opera tu empresa?</h2>
            <p className="text-neutral-600 text-sm">
              Podés ser shipper (publicás cargas), carrier (transportás cargas) o ambos. Activá los
              que apliquen.
            </p>
            <Controller
              control={control}
              name="empresa.is_shipper"
              render={({ field }) => (
                <OperationToggle
                  title="Shipper — genero carga"
                  description="Mi empresa publica cargas para que carriers las muevan. Típico de retail, distribución, manufactura, agro."
                  checked={field.value}
                  onChange={field.onChange}
                />
              )}
            />
            <Controller
              control={control}
              name="empresa.is_carrier"
              render={({ field }) => (
                <OperationToggle
                  title="Carrier — transporto carga"
                  description="Mi empresa tiene flota propia (camiones, conductores) y mueve cargas. Empresa de transporte, courier, dueño-operador."
                  checked={field.value}
                  onChange={field.onChange}
                />
              )}
            />
            {errors.empresa?.is_shipper && (
              <p className="text-danger-700 text-sm">{errors.empresa.is_shipper.message}</p>
            )}
          </section>
        )}

        {step === 4 && (
          <section className="mt-8 space-y-4">
            <h2 className="font-semibold text-neutral-900 text-xl">Plan</h2>
            <p className="text-neutral-600 text-sm">
              Empezá con Free y subí cuando lo necesites. Sin tarjeta de crédito para Free.
            </p>
            <Controller
              control={control}
              name="plan_slug"
              render={({ field }) => (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {PLANS.map((p) => (
                    <PlanCard
                      key={p.slug}
                      plan={p}
                      selected={field.value === p.slug}
                      onSelect={() => field.onChange(p.slug)}
                    />
                  ))}
                </div>
              )}
            />
            <p className="mt-2 text-neutral-500 text-xs">
              Para Enterprise, contactá a{' '}
              <a
                href="mailto:ventas@boosterchile.com"
                className="font-medium text-primary-600 underline"
              >
                ventas@boosterchile.com
              </a>
              .
            </p>
            <SummaryReview values={watch()} />
          </section>
        )}

        {submissionError && (
          <div
            role="alert"
            className="mt-6 rounded-md border border-danger-500/30 bg-danger-50 p-3 text-danger-700 text-sm"
          >
            {submissionError}
          </div>
        )}

        <div className="mt-8 flex items-center justify-between">
          <button
            type="button"
            onClick={prevStep}
            disabled={step === 1 || mutation.isPending}
            className="flex items-center gap-1 rounded-md px-3 py-2 text-neutral-700 text-sm transition hover:bg-neutral-100 disabled:invisible"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Atrás
          </button>
          {step < 4 ? (
            <button
              type="button"
              onClick={nextStep}
              className="flex items-center gap-2 rounded-md bg-primary-500 px-5 py-2.5 font-medium text-sm text-white shadow-xs transition hover:bg-primary-600"
            >
              Siguiente
              <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
          ) : (
            <button
              type="submit"
              disabled={mutation.isPending}
              className="flex items-center gap-2 rounded-md bg-primary-500 px-5 py-2.5 font-medium text-sm text-white shadow-xs transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {mutation.isPending ? 'Creando empresa…' : 'Crear empresa'}
              {!mutation.isPending && <Check className="h-4 w-4" aria-hidden />}
            </button>
          )}
        </div>
      </form>
    </FormProvider>
  );
}

function ProgressIndicator({ step }: { step: Step }) {
  return (
    <div className="flex items-center justify-between gap-2">
      {STEPS.map((s, idx) => {
        const isActive = s.step === step;
        const isDone = s.step < step;
        return (
          <div key={s.step} className="flex flex-1 items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full font-medium text-xs ${
                isDone
                  ? 'bg-primary-500 text-white'
                  : isActive
                    ? 'bg-primary-100 text-primary-700 ring-2 ring-primary-500'
                    : 'bg-neutral-100 text-neutral-500'
              }`}
              aria-current={isActive ? 'step' : undefined}
            >
              {isDone ? <Check className="h-4 w-4" aria-hidden /> : s.step}
            </div>
            <span
              className={`hidden font-medium text-sm md:inline ${
                isActive ? 'text-neutral-900' : 'text-neutral-500'
              }`}
            >
              {s.shortTitle}
            </span>
            {idx < STEPS.length - 1 && (
              <div
                className={`h-px flex-1 ${isDone ? 'bg-primary-500' : 'bg-neutral-200'}`}
                aria-hidden
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Field(props: {
  label: string;
  hint?: string;
  error?: string | undefined;
  /** Render prop: recibe el id auto-generado para asociar label↔input. */
  render: (inputId: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block font-medium text-neutral-700 text-sm">
        {props.label}
      </label>
      <div className="mt-1">{props.render(id)}</div>
      {props.hint && !props.error && <p className="mt-1 text-neutral-500 text-xs">{props.hint}</p>}
      {props.error && (
        <p className="mt-1 text-danger-700 text-xs" role="alert">
          {props.error}
        </p>
      )}
    </div>
  );
}

function inputClass(hasError: boolean) {
  return `block w-full rounded-md border px-3 py-2 text-neutral-900 text-sm shadow-xs focus:outline-none ${
    hasError
      ? 'border-danger-500 focus:border-danger-500'
      : 'border-neutral-300 focus:border-primary-500'
  }`;
}

function OperationToggle(props: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => props.onChange(!props.checked)}
      className={`w-full rounded-lg border p-4 text-left transition ${
        props.checked
          ? 'border-primary-500 bg-primary-50/50 ring-2 ring-primary-500/20'
          : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50'
      }`}
      aria-pressed={props.checked}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded ${
            props.checked
              ? 'border-2 border-primary-500 bg-primary-500'
              : 'border-2 border-neutral-300 bg-white'
          }`}
          aria-hidden
        >
          {props.checked && <Check className="h-3 w-3 text-white" />}
        </div>
        <div>
          <div className="font-medium text-neutral-900 text-sm">{props.title}</div>
          <div className="mt-1 text-neutral-600 text-sm">{props.description}</div>
        </div>
      </div>
    </button>
  );
}

function PlanCard(props: {
  plan: (typeof PLANS)[number];
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onSelect}
      className={`relative rounded-lg border p-4 text-left transition ${
        props.selected
          ? 'border-primary-500 bg-primary-50/30 ring-2 ring-primary-500/30'
          : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50'
      }`}
      aria-pressed={props.selected}
    >
      {props.plan.recommended && (
        <span className="-top-2 absolute right-3 rounded-full bg-accent-500 px-2 py-0.5 font-medium text-white text-xs">
          Recomendado
        </span>
      )}
      <div className="font-semibold text-lg text-neutral-900">{props.plan.name}</div>
      <div className="mt-1 font-medium text-primary-700 text-sm">{props.plan.priceLabel}</div>
      <p className="mt-2 text-neutral-600 text-sm">{props.plan.description}</p>
      <ul className="mt-3 space-y-1.5">
        {props.plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-neutral-700 text-sm">
            <Check className="mt-0.5 h-4 w-4 flex-none text-primary-600" aria-hidden />
            {f}
          </li>
        ))}
      </ul>
    </button>
  );
}

function SummaryReview({ values }: { values: EmpresaOnboardingInput }) {
  return (
    <div className="mt-4 rounded-md border border-neutral-200 bg-neutral-50 p-4">
      <h3 className="font-medium text-neutral-900 text-sm">Resumen</h3>
      <dl className="mt-2 grid grid-cols-1 gap-y-1.5 text-sm md:grid-cols-2">
        <div>
          <dt className="text-neutral-500">Empresa</dt>
          <dd className="text-neutral-900">{values.empresa.legal_name}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">RUT</dt>
          <dd className="text-neutral-900">{values.empresa.rut}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Operación</dt>
          <dd className="text-neutral-900">
            {[values.empresa.is_shipper && 'Shipper', values.empresa.is_carrier && 'Carrier']
              .filter(Boolean)
              .join(' + ') || 'Ninguna'}
          </dd>
        </div>
        <div>
          <dt className="text-neutral-500">Plan</dt>
          <dd className="text-neutral-900 capitalize">{values.plan_slug}</dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * Mapea ApiError.code a mensajes de UI en español.
 */
function translateApiError(err: ApiError): string {
  switch (err.code) {
    case 'user_already_registered':
      return 'Ya tenés una empresa registrada con este email. Iniciá sesión y elegí tu empresa activa.';
    case 'email_in_use':
      return 'Este email ya está registrado en Booster con otra cuenta. Probá con otro email o recuperá tu acceso desde login.';
    case 'rut_already_registered':
      return 'Este RUT empresa ya está registrado. Si trabajás en esta empresa, pediles a sus admins que te inviten.';
    case 'invalid_plan':
      return 'El plan seleccionado no está disponible. Probá con otro.';
    case 'firebase_email_missing':
      return 'Tu sesión no tiene email asociado. Volvé a iniciar sesión con email y contraseña o con Google.';
    default:
      if (err.status >= 500) {
        return 'Hubo un error en nuestro lado. Probá de nuevo en unos minutos o contactá soporte@boosterchile.com.';
      }
      return err.message || 'No pudimos completar el registro. Probá de nuevo.';
  }
}
