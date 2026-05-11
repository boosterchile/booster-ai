import { type ProfileUpdateInput, chileanPhoneSchema, rutSchema } from '@booster-ai/shared-schemas';
import { zodResolver } from '@hookform/resolvers/zod';
import { Check, Save } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useProfileMutation } from '../../hooks/use-profile-mutation.js';
import { useScrollToFirstError } from '../../hooks/use-scroll-to-first-error.js';
import { ApiError } from '../../lib/api-client.js';
import { formatRut } from '../../lib/rut.js';
import { FormField, inputClass } from '../FormField.js';

export interface ProfileFormProps {
  /** Datos actuales del usuario, vienen de useMe(). */
  initial: {
    full_name: string;
    phone: string | null;
    whatsapp_e164: string | null;
    rut: string | null;
  };
}

/**
 * Schema del FORM (no del API). El form maneja todos los campos como
 * strings (incluso los opcionales del API que aquí pueden ser '' por
 * default). Para enviar al API, en `onSubmit` se construye el patch
 * parcial usando `dirtyFields` de RHF.
 *
 * Reglas:
 *   - full_name: 1-200 chars (siempre presente).
 *   - phone, whatsapp_e164: Chile-format si no vacíos. Vacío significa
 *     "no enviar al API en el patch", lo cual está controlado por
 *     dirtyFields y un guard en onSubmit.
 *   - rut: igual al anterior, además solo se permite editar cuando
 *     `initial.rut === null` (después es immutable).
 */
const profileFormSchema = z.object({
  full_name: z
    .string()
    .min(1, 'El nombre debe tener entre 1 y 200 caracteres.')
    .max(200, 'El nombre debe tener entre 1 y 200 caracteres.'),
  phone: z
    .string()
    .refine(
      (v) => v === '' || chileanPhoneSchema.safeParse(v).success,
      'Número de teléfono Chile inválido',
    ),
  whatsapp_e164: z
    .string()
    .refine(
      (v) => v === '' || chileanPhoneSchema.safeParse(v).success,
      'Número de teléfono Chile inválido',
    ),
  rut: z.string().refine((v) => v === '' || rutSchema.safeParse(v).success, 'RUT inválido'),
});

type ProfileFormValues = z.infer<typeof profileFormSchema>;

/**
 * Form de edición del perfil del usuario logueado.
 *
 * Implementación con react-hook-form + zodResolver, alineado al
 * patrón establecido en `OnboardingForm`. El form valida cada campo
 * con `mode: 'onBlur'` y, en submit, usa `dirtyFields` de RHF para
 * construir un PATCH que solo incluya los campos efectivamente
 * cambiados (la API rechaza updates "vacíos").
 *
 * El RUT se deshabilita si ya está declarado — la API lo trata como
 * inmutable. Si está null, dejamos que el usuario lo complete una vez.
 */
export function ProfileForm({ initial }: ProfileFormProps) {
  const mutation = useProfileMutation();
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, dirtyFields, isSubmitting, submitCount },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    mode: 'onBlur',
    defaultValues: {
      full_name: initial.full_name,
      phone: initial.phone ?? '',
      whatsapp_e164: initial.whatsapp_e164 ?? '',
      rut: initial.rut ?? '',
    },
  });

  useScrollToFirstError(errors, submitCount);

  async function onSubmit(values: ProfileFormValues) {
    setSavedAt(null);
    const patch: ProfileUpdateInput = {};
    if (dirtyFields.full_name) {
      patch.full_name = values.full_name;
    }
    if (dirtyFields.phone && values.phone !== '') {
      const parsed = chileanPhoneSchema.safeParse(values.phone);
      if (parsed.success) {
        patch.phone = parsed.data;
      }
    }
    if (dirtyFields.whatsapp_e164 && values.whatsapp_e164 !== '') {
      const parsed = chileanPhoneSchema.safeParse(values.whatsapp_e164);
      if (parsed.success) {
        patch.whatsapp_e164 = parsed.data;
      }
    }
    if (dirtyFields.rut && values.rut !== '' && initial.rut === null) {
      const parsed = rutSchema.safeParse(values.rut);
      if (parsed.success) {
        patch.rut = parsed.data;
      }
    }

    if (Object.keys(patch).length === 0) {
      // Nada que enviar (no-op visual, ej. usuario tipeó y revertió).
      setSavedAt(new Date());
      return;
    }

    try {
      await mutation.mutateAsync(patch);
      setSavedAt(new Date());
    } catch {
      // mutation.error tiene el ApiError; el render lo muestra.
    }
  }

  const submissionError = mutation.error ? translateApiError(mutation.error) : null;
  const rutDisabled = initial.rut !== null;

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-4 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
      noValidate
    >
      <div>
        <h2 className="font-semibold text-lg text-neutral-900">Mi perfil</h2>
        <p className="mt-1 text-neutral-600 text-sm">
          Actualiza tus datos personales. El email y la empresa se gestionan por separado.
        </p>
      </div>

      <FormField
        label="Nombre completo"
        required
        error={errors.full_name?.message}
        render={({ id, describedBy }) => (
          <input
            id={id}
            aria-describedby={describedBy}
            {...register('full_name')}
            autoComplete="name"
            className={inputClass(!!errors.full_name)}
          />
        )}
      />
      <FormField
        label="Teléfono móvil"
        hint="Formato +56 9 XXXX XXXX. Lo usamos para notificaciones críticas."
        error={errors.phone?.message}
        render={({ id, describedBy }) => (
          <input
            id={id}
            aria-describedby={describedBy}
            {...register('phone')}
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            placeholder="+56912345678"
            className={inputClass(!!errors.phone)}
          />
        )}
      />
      <FormField
        label="WhatsApp"
        hint="Te enviaremos cada nueva oferta a este WhatsApp. Debe ser un celular chileno (+56 9...)."
        error={errors.whatsapp_e164?.message}
        render={({ id, describedBy }) => (
          <input
            id={id}
            aria-describedby={describedBy}
            {...register('whatsapp_e164')}
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            placeholder="+56912345678"
            className={inputClass(!!errors.whatsapp_e164)}
          />
        )}
      />
      <FormField
        label="RUT"
        hint={
          rutDisabled
            ? 'Tu RUT no se puede modificar. Si necesitas cambiarlo, contacta a soporte.'
            : 'Sin puntos, con guión. Ejemplo: 12345678-5. Una vez declarado no se puede modificar desde aquí.'
        }
        error={errors.rut?.message}
        render={({ id, describedBy }) => (
          <input
            id={id}
            aria-describedby={describedBy}
            {...register('rut')}
            // Cuando está disabled mostramos el RUT formateado con puntos.
            // Cuando está editable dejamos el valor crudo para no pelear con el cursor.
            value={rutDisabled ? formatRut(initial.rut ?? '') : undefined}
            autoComplete="off"
            placeholder="12345678-5"
            inputMode="text"
            disabled={rutDisabled}
            className={`${inputClass(!!errors.rut)} disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-neutral-500`}
          />
        )}
      />

      {submissionError && (
        <output className="block rounded-md border border-danger-500/30 bg-danger-50 p-3 text-danger-700 text-sm">
          {submissionError}
        </output>
      )}

      {savedAt && !mutation.isPending && !submissionError && (
        <output className="flex items-center gap-2 rounded-md border border-success-500/30 bg-success-50 p-3 text-sm text-success-700">
          <Check className="h-4 w-4" aria-hidden />
          Cambios guardados.
        </output>
      )}

      <div className="flex items-center justify-end">
        <button
          type="submit"
          disabled={isSubmitting || mutation.isPending}
          className="flex items-center gap-2 rounded-md bg-primary-500 px-5 py-2.5 font-medium text-sm text-white shadow-xs transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Save className="h-4 w-4" aria-hidden />
          {mutation.isPending ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </form>
  );
}

function translateApiError(err: ApiError): string {
  if (!(err instanceof ApiError)) {
    return 'Error inesperado. Recarga e intenta de nuevo.';
  }
  switch (err.code) {
    case 'rut_immutable':
      return 'No se puede modificar el RUT una vez declarado. Contacta a soporte.';
    case 'user_not_found':
      return 'Tu sesión no está vinculada a una empresa. Vuelve al onboarding.';
    default:
      if (err.status >= 500) {
        return 'Error del servidor. Intenta de nuevo en unos minutos.';
      }
      return err.message || 'No pudimos guardar los cambios.';
  }
}
