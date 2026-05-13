import { zodResolver } from '@hookform/resolvers/zod';
import type { FirebaseError } from 'firebase/app';
import type { User } from 'firebase/auth';
import { Check, KeyRound, Mail, Plus, Shield, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  getLinkedProviders,
  linkGoogleProvider,
  linkPasswordProvider,
  reauthCurrent,
  unlinkProvider,
  updatePasswordCurrent,
  useAuth,
} from '../../hooks/use-auth.js';
import { passwordPolicySchema } from '../../lib/password.js';
import { FormField, inputClass } from '../FormField.js';

/**
 * Sección "Acceso a tu cuenta" en /perfil. Lista los providers de auth
 * actuales del user y permite:
 *   - Agregar Google si no está linkeado.
 *   - Agregar email+password si no está linkeado (form embebido).
 *   - Quitar un provider (solo si quedaría al menos otro).
 *
 * Por qué esto importa: hoy si te registras con Google solo, no puedes
 * loguearte con email/password — Firebase considera providers separados
 * por el mismo email. Con este UI, el user puede vincular ambos a su
 * propia cuenta única (mismo firebase_uid, mismo row en `usuarios`).
 *
 * Firebase tiene reglas de seguridad: las operaciones sensibles
 * (linkWithCredential, unlink) requieren auth reciente. Si la sesión es
 * vieja, la API devuelve 'auth/requires-recent-login' y mostramos un
 * inline reauth flow.
 */
export function AuthProvidersSection() {
  const { user } = useAuth();
  if (!user) {
    return null;
  }
  return <AuthProvidersBody user={user} />;
}

function AuthProvidersBody({ user }: { user: User }) {
  // Forzamos re-render manual al linkear/unlinkear porque user.providerData
  // muta in-place pero React no detecta el cambio sin un setState.
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);
  const providers = getLinkedProviders(user);
  const hasGoogle = providers.includes('google.com');
  const hasPassword = providers.includes('password');

  return (
    <section className="mt-10">
      <h2 className="font-semibold text-neutral-900 text-xl">Acceso a tu cuenta</h2>
      <p className="mt-1 text-neutral-600 text-sm">
        Maneja cómo inicias sesión. Puedes tener Google y contraseña vinculados a la misma cuenta —
        el dato es el email.
      </p>

      <div className="mt-4 space-y-3" key={version}>
        <ProviderRow
          icon="google"
          title="Google"
          description={hasGoogle ? `Vinculada con ${user.email}` : 'No vinculada'}
          status={hasGoogle ? 'linked' : 'unlinked'}
          canRemove={hasGoogle && providers.length > 1}
          onAdd={async () => {
            await linkGoogleProvider(user);
            await user.reload();
            refresh();
          }}
          onRemove={async () => {
            await unlinkProvider(user, 'google.com');
            await user.reload();
            refresh();
          }}
        />

        {hasPassword ? (
          <>
            <ProviderRow
              icon="password"
              title="Email + contraseña"
              description={`Vinculada con ${user.email}`}
              status="linked"
              canRemove={providers.length > 1}
              onRemove={async () => {
                await unlinkProvider(user, 'password');
                await user.reload();
                refresh();
              }}
            />
            <ChangePasswordForm user={user} />
          </>
        ) : (
          <PasswordLinkForm
            user={user}
            defaultEmail={user.email ?? ''}
            onLinked={() => {
              refresh();
            }}
          />
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Row genérico de provider
// ---------------------------------------------------------------------------

function ProviderRow({
  icon,
  title,
  description,
  status,
  canRemove,
  onAdd,
  onRemove,
}: {
  icon: 'google' | 'password';
  title: string;
  description: string;
  status: 'linked' | 'unlinked';
  canRemove: boolean;
  onAdd?: () => Promise<void>;
  onRemove?: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function safeRun(fn: () => Promise<void>, label: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      const code = (err as FirebaseError).code;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setError(null);
      } else {
        setError(translateAuthError(code) ?? `No pudimos ${label}.`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-neutral-100 text-neutral-600">
            {icon === 'google' ? (
              <Shield className="h-5 w-5" aria-hidden />
            ) : (
              <KeyRound className="h-5 w-5" aria-hidden />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2 font-medium text-neutral-900">
              {title}
              {status === 'linked' && (
                <span className="inline-flex items-center gap-1 rounded-md bg-success-50 px-2 py-0.5 font-medium text-success-700 text-xs">
                  <Check className="h-3 w-3" aria-hidden />
                  Vinculado
                </span>
              )}
            </div>
            <div className="mt-0.5 text-neutral-600 text-sm">{description}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status === 'unlinked' && onAdd && (
            <button
              type="button"
              onClick={() => void safeRun(onAdd, 'vincular')}
              disabled={busy}
              className="flex items-center gap-1 rounded-md bg-primary-600 px-3 py-1.5 font-medium text-sm text-white transition hover:bg-primary-700 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Vincular
            </button>
          )}
          {status === 'linked' && canRemove && onRemove && (
            <button
              type="button"
              onClick={() => void safeRun(onRemove, 'quitar')}
              disabled={busy}
              className="flex items-center gap-1 rounded-md border border-neutral-300 px-3 py-1.5 text-neutral-700 text-sm transition hover:border-danger-300 hover:bg-danger-50 hover:text-danger-700 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              Quitar
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="mt-3 rounded-md border border-danger-200 bg-danger-50 p-2 text-danger-700 text-sm">
          {error}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form para linkear email+password (inline cuando no está linkeado)
// ---------------------------------------------------------------------------

const passwordLinkSchema = z.object({
  email: z.string().email('Email inválido.'),
  password: z.string().min(6, 'Mínimo 6 caracteres.'),
});

type PasswordLinkValues = z.infer<typeof passwordLinkSchema>;

function PasswordLinkForm({
  user,
  defaultEmail,
  onLinked,
}: {
  user: User;
  defaultEmail: string;
  onLinked: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [needsReauth, setNeedsReauth] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
    getValues,
    reset,
  } = useForm<PasswordLinkValues>({
    resolver: zodResolver(passwordLinkSchema),
    mode: 'onBlur',
    defaultValues: { email: defaultEmail, password: '' },
  });

  function closeAndReset() {
    setOpen(false);
    setNeedsReauth(false);
    reset({ email: defaultEmail, password: '' });
  }

  async function onSubmit(values: PasswordLinkValues) {
    try {
      await linkPasswordProvider(user, values.email, values.password);
      await user.reload();
      onLinked();
      closeAndReset();
    } catch (err) {
      const code = (err as FirebaseError).code;
      if (code === 'auth/requires-recent-login') {
        setNeedsReauth(true);
        setError('root', {
          message:
            'Por seguridad necesitamos confirmar tu identidad. Haz click en "Re-autenticar" para continuar.',
        });
      } else {
        setError('root', {
          message: translateAuthError(code) ?? 'No pudimos vincular email + contraseña.',
        });
      }
    }
  }

  async function handleReauth() {
    try {
      await reauthCurrent(user, { type: 'google' });
      setNeedsReauth(false);
      // Reintentar link con los valores actuales del form.
      const { email, password } = getValues();
      await linkPasswordProvider(user, email, password);
      await user.reload();
      onLinked();
      closeAndReset();
    } catch (err) {
      const code = (err as FirebaseError).code;
      setError('root', { message: translateAuthError(code) ?? 'No pudimos re-autenticar.' });
    }
  }

  if (!open) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-neutral-100 text-neutral-600">
              <KeyRound className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <div className="font-medium text-neutral-900">Email + contraseña</div>
              <div className="mt-0.5 text-neutral-600 text-sm">
                Agregá una contraseña para iniciar sesión sin Google.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex items-center gap-1 rounded-md bg-primary-600 px-3 py-1.5 font-medium text-sm text-white transition hover:bg-primary-700"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Agregar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-neutral-100 text-neutral-600">
          <Mail className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <div className="font-medium text-neutral-900">Vincular email + contraseña</div>
          <div className="mt-0.5 text-neutral-600 text-sm">
            Usá tu email actual o cualquier otro tuyo. Mínimo 6 caracteres en la contraseña.
          </div>
        </div>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
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
              disabled={isSubmitting}
              {...register('email')}
              className={`${inputClass(!!errors.email)} disabled:bg-neutral-50`}
            />
          )}
        />
        <FormField
          label="Contraseña nueva"
          required
          hint="Mínimo 6 caracteres."
          error={errors.password?.message}
          render={({ id, describedBy }) => (
            <input
              id={id}
              aria-describedby={describedBy}
              type="password"
              autoComplete="new-password"
              disabled={isSubmitting}
              {...register('password')}
              className={`${inputClass(!!errors.password)} disabled:bg-neutral-50`}
            />
          )}
        />
        {errors.root?.message && (
          <div className="rounded-md border border-danger-200 bg-danger-50 p-2 text-danger-700 text-sm">
            {errors.root.message}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={closeAndReset}
            disabled={isSubmitting}
            className="rounded-md border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700 text-sm transition hover:bg-neutral-100 disabled:opacity-50"
          >
            Cancelar
          </button>
          {needsReauth ? (
            <button
              type="button"
              onClick={() => void handleReauth()}
              disabled={isSubmitting}
              className="rounded-md bg-primary-600 px-3 py-1.5 font-medium text-sm text-white transition hover:bg-primary-700 disabled:opacity-50"
            >
              Re-autenticar y vincular
            </button>
          ) : (
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-primary-600 px-3 py-1.5 font-medium text-sm text-white transition hover:bg-primary-700 disabled:opacity-50"
            >
              {isSubmitting ? 'Vinculando…' : 'Vincular'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form para cambiar la contraseña actual (solo si hasPassword=true)
// ---------------------------------------------------------------------------

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Ingresa tu contraseña actual.'),
    newPassword: passwordPolicySchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'No coincide con la nueva contraseña.',
  });

type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

function ChangePasswordForm({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
    reset,
  } = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    mode: 'onBlur',
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  function closeAndReset() {
    setOpen(false);
    reset({ currentPassword: '', newPassword: '', confirmPassword: '' });
  }

  async function onSubmit(values: ChangePasswordValues) {
    setSavedAt(null);
    if (!user.email) {
      setError('root', { message: 'Tu cuenta no tiene un email asociado.' });
      return;
    }
    try {
      await reauthCurrent(user, {
        type: 'password',
        email: user.email,
        password: values.currentPassword,
      });
      await updatePasswordCurrent(user, values.newPassword);
      setSavedAt(new Date());
      closeAndReset();
    } catch (err) {
      const code = (err as FirebaseError).code;
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setError('currentPassword', { message: 'Contraseña actual incorrecta.' });
      } else if (code === 'auth/weak-password') {
        // Defensivo: la política Booster ya cubre esto, pero por si Firebase
        // valida algo más estricto en el futuro.
        setError('newPassword', { message: 'Contraseña muy débil para Firebase.' });
      } else {
        setError('root', {
          message: translateAuthError(code) ?? 'No pudimos cambiar la contraseña.',
        });
      }
    }
  }

  if (!open) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-neutral-100 text-neutral-600">
              <KeyRound className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <div className="font-medium text-neutral-900">Cambiar contraseña</div>
              <div className="mt-0.5 text-neutral-600 text-sm">
                Vas a necesitar tu contraseña actual para confirmar.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-md border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700 text-sm transition hover:bg-neutral-100"
          >
            Cambiar
          </button>
        </div>
        {savedAt && (
          <div className="mt-3 rounded-md border border-success-200 bg-success-50 p-2 text-sm text-success-700">
            Contraseña actualizada.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-neutral-100 text-neutral-600">
          <KeyRound className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <div className="font-medium text-neutral-900">Cambiar contraseña</div>
          <div className="mt-0.5 text-neutral-600 text-sm">
            Confirma tu contraseña actual y elige una nueva.
          </div>
        </div>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
        <FormField
          label="Contraseña actual"
          required
          error={errors.currentPassword?.message}
          render={({ id, describedBy }) => (
            <input
              id={id}
              aria-describedby={describedBy}
              type="password"
              autoComplete="current-password"
              disabled={isSubmitting}
              {...register('currentPassword')}
              className={`${inputClass(!!errors.currentPassword)} disabled:bg-neutral-50`}
            />
          )}
        />
        <FormField
          label="Nueva contraseña"
          required
          hint="Mínimo 8 caracteres, con mayúscula, minúscula y número."
          error={errors.newPassword?.message}
          render={({ id, describedBy }) => (
            <input
              id={id}
              aria-describedby={describedBy}
              type="password"
              autoComplete="new-password"
              disabled={isSubmitting}
              {...register('newPassword')}
              className={`${inputClass(!!errors.newPassword)} disabled:bg-neutral-50`}
            />
          )}
        />
        <FormField
          label="Confirmar nueva contraseña"
          required
          error={errors.confirmPassword?.message}
          render={({ id, describedBy }) => (
            <input
              id={id}
              aria-describedby={describedBy}
              type="password"
              autoComplete="new-password"
              disabled={isSubmitting}
              {...register('confirmPassword')}
              className={`${inputClass(!!errors.confirmPassword)} disabled:bg-neutral-50`}
            />
          )}
        />
        {errors.root?.message && (
          <div className="rounded-md border border-danger-200 bg-danger-50 p-2 text-danger-700 text-sm">
            {errors.root.message}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={closeAndReset}
            disabled={isSubmitting}
            className="rounded-md border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700 text-sm transition hover:bg-neutral-100 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-primary-600 px-3 py-1.5 font-medium text-sm text-white transition hover:bg-primary-700 disabled:opacity-50"
          >
            {isSubmitting ? 'Cambiando…' : 'Cambiar contraseña'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

function translateAuthError(code: string | undefined): string | null {
  switch (code) {
    case 'auth/credential-already-in-use':
    case 'auth/email-already-in-use':
      return 'Esa cuenta ya pertenece a otro usuario de Booster. Cerrá sesión y entrá con esa cuenta directamente.';
    case 'auth/provider-already-linked':
      return 'Este proveedor ya está vinculado a tu cuenta.';
    case 'auth/weak-password':
      return 'La contraseña es muy débil. Usá al menos 6 caracteres.';
    case 'auth/invalid-email':
      return 'El email no es válido.';
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Email o contraseña incorrectos.';
    case 'auth/popup-blocked':
      return 'El navegador bloqueó el popup. Permite popups para app.boosterchile.com.';
    case 'auth/no-such-provider':
      return 'No puedes quitar este proveedor porque es el único que tienes.';
    case 'auth/network-request-failed':
      return 'Sin conexión a internet. Inténtalo de nuevo.';
    default:
      return null;
  }
}
