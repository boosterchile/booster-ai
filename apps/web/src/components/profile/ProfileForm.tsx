import { type ProfileUpdateInput, chileanPhoneSchema, rutSchema } from '@booster-ai/shared-schemas';
import { Check, Save } from 'lucide-react';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { useProfileMutation } from '../../hooks/use-profile-mutation.js';
import { ApiError } from '../../lib/api-client.js';
import { formatRut } from '../../lib/rut.js';

export interface ProfileFormProps {
  /** Datos actuales del usuario, vienen de useMe(). */
  initial: {
    full_name: string;
    phone: string | null;
    whatsapp_e164: string | null;
    rut: string | null;
  };
}

interface FieldErrors {
  full_name?: string;
  phone?: string;
  whatsapp_e164?: string;
  rut?: string;
}

/**
 * Form de edición del perfil del usuario logueado.
 *
 * Validación manual (no zodResolver) porque los campos del schema son
 * opcionales y el form los maneja como strings; un resolver compartido
 * se complica con defaults vacíos. Cada campo se valida con su primitivo
 * de @booster-ai/shared-schemas (chileanPhoneSchema, rutSchema) y el
 * envío al api solo incluye los efectivamente cambiados.
 *
 * El RUT se deshabilita si ya está declarado — la API lo trata como
 * inmutable. Si está null, dejamos que el usuario lo complete una vez.
 */
export function ProfileForm({ initial }: ProfileFormProps) {
  const mutation = useProfileMutation();
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const [fullName, setFullName] = useState(initial.full_name);
  const [phone, setPhone] = useState(initial.phone ?? '');
  const [whatsappE164, setWhatsappE164] = useState(initial.whatsapp_e164 ?? '');
  const [rut, setRut] = useState(initial.rut ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});

  const isDirty =
    fullName !== initial.full_name ||
    phone !== (initial.phone ?? '') ||
    whatsappE164 !== (initial.whatsapp_e164 ?? '') ||
    rut !== (initial.rut ?? '');

  function validateAndBuildPatch(): { patch: ProfileUpdateInput; errors: FieldErrors } {
    const next: FieldErrors = {};
    const patch: ProfileUpdateInput = {};

    if (fullName !== initial.full_name) {
      if (fullName.length < 1 || fullName.length > 200) {
        next.full_name = 'El nombre debe tener entre 1 y 200 caracteres.';
      } else {
        patch.full_name = fullName;
      }
    }

    if (phone !== (initial.phone ?? '')) {
      if (phone === '') {
        next.phone = 'El teléfono no puede quedar vacío.';
      } else {
        const parsed = chileanPhoneSchema.safeParse(phone);
        if (parsed.success) {
          patch.phone = parsed.data;
        } else {
          next.phone = parsed.error.issues[0]?.message ?? 'Formato inválido';
        }
      }
    }

    if (whatsappE164 !== (initial.whatsapp_e164 ?? '')) {
      if (whatsappE164 === '') {
        next.whatsapp_e164 = 'El WhatsApp no puede quedar vacío.';
      } else {
        const parsed = chileanPhoneSchema.safeParse(whatsappE164);
        if (parsed.success) {
          patch.whatsapp_e164 = parsed.data;
        } else {
          next.whatsapp_e164 = parsed.error.issues[0]?.message ?? 'Formato inválido';
        }
      }
    }

    if (rut !== (initial.rut ?? '') && initial.rut === null && rut !== '') {
      const parsed = rutSchema.safeParse(rut);
      if (parsed.success) {
        patch.rut = parsed.data;
      } else {
        next.rut = parsed.error.issues[0]?.message ?? 'RUT inválido';
      }
    }

    return { patch, errors: next };
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSavedAt(null);
    const { patch, errors: validationErrors } = validateAndBuildPatch();
    setErrors(validationErrors);

    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    if (Object.keys(patch).length === 0) {
      // Nada que enviar (no-op visual).
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

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
      noValidate
    >
      <div>
        <h2 className="font-semibold text-lg text-neutral-900">Mi perfil</h2>
        <p className="mt-1 text-neutral-600 text-sm">
          Actualiza tus datos personales. El email y la empresa se gestionan por separado.
        </p>
      </div>

      <Field
        label="Nombre completo"
        error={errors.full_name}
        render={(id) => (
          <input
            id={id}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
            className={inputClass(!!errors.full_name)}
          />
        )}
      />
      <Field
        label="Teléfono móvil"
        hint="Formato +56 9 XXXX XXXX. Lo usamos para notificaciones críticas."
        error={errors.phone}
        render={(id) => (
          <input
            id={id}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            placeholder="+56912345678"
            className={inputClass(!!errors.phone)}
          />
        )}
      />
      <Field
        label="WhatsApp"
        hint="Te enviaremos cada nueva oferta a este WhatsApp. Debe ser un celular chileno (+56 9...)."
        error={errors.whatsapp_e164}
        render={(id) => (
          <input
            id={id}
            value={whatsappE164}
            onChange={(e) => setWhatsappE164(e.target.value)}
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            placeholder="+56912345678"
            className={inputClass(!!errors.whatsapp_e164)}
          />
        )}
      />
      <Field
        label="RUT"
        hint={
          initial.rut === null
            ? 'Tu RUT personal. Una vez declarado no se puede modificar desde aquí.'
            : 'Tu RUT no se puede modificar. Si necesitas cambiarlo, contacta a soporte.'
        }
        error={errors.rut}
        render={(id) => (
          <input
            id={id}
            value={initial.rut !== null ? formatRut(rut) : rut}
            onChange={(e) => setRut(e.target.value)}
            autoComplete="off"
            placeholder="12.345.678-9"
            disabled={initial.rut !== null}
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
          disabled={mutation.isPending || !isDirty}
          className="flex items-center gap-2 rounded-md bg-primary-500 px-5 py-2.5 font-medium text-sm text-white shadow-xs transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Save className="h-4 w-4" aria-hidden />
          {mutation.isPending ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </form>
  );
}

function Field(props: {
  label: string;
  hint?: string;
  error?: string | undefined;
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
