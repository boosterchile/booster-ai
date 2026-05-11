import { rutSchema } from '@booster-ai/shared-schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  Clock,
  Copy,
  Pencil,
  Plus,
  ShieldOff,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { FormField, inputClass as fieldInputClass } from '../components/FormField.js';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import type { MeResponse } from '../hooks/use-me.js';
import { useScrollToFirstError } from '../hooks/use-scroll-to-first-error.js';
import { api } from '../lib/api-client.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

type LicenseClass = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'B' | 'C' | 'D' | 'E' | 'F';
type DriverStatus = 'activo' | 'suspendido' | 'en_viaje' | 'fuera_servicio';

const LICENSE_CLASSES: LicenseClass[] = ['A1', 'A2', 'A3', 'A4', 'A5', 'B', 'C', 'D', 'E', 'F'];

const LICENSE_LABELS: Record<LicenseClass, string> = {
  A1: 'A1 — Taxi/colectivo',
  A2: 'A2 — Transporte público',
  A3: 'A3 — Transporte público',
  A4: 'A4 — Camión simple',
  A5: 'A5 — Camión articulado',
  B: 'B — Particular',
  C: 'C — Motocicletas',
  D: 'D — Maquinaria',
  E: 'E — Tracción animal',
  F: 'F — Institucional',
};

const STATUS_LABELS: Record<DriverStatus, string> = {
  activo: 'Activo',
  suspendido: 'Suspendido',
  en_viaje: 'En viaje',
  fuera_servicio: 'Fuera de servicio',
};

const STATUS_COLORS: Record<DriverStatus, string> = {
  activo: 'bg-success-50 text-success-700',
  suspendido: 'bg-amber-50 text-amber-700',
  en_viaje: 'bg-primary-50 text-primary-700',
  fuera_servicio: 'bg-neutral-100 text-neutral-600',
};

interface ConductorUser {
  id: string;
  full_name: string;
  rut: string;
  email: string;
  phone: string | null;
  is_pending: boolean;
}

interface Conductor {
  id: string;
  user_id: string;
  empresa_id: string;
  license_class: LicenseClass;
  license_number: string;
  license_expiry: string; // YYYY-MM-DD
  is_extranjero: boolean;
  status: DriverStatus;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  user: ConductorUser;
}

/**
 * Devuelve el "estado" visible de la licencia respecto a hoy:
 *   - 'expired' si ya pasó
 *   - 'warning' si vence en ≤ 30 días
 *   - 'ok' en cualquier otro caso
 */
function licenseExpiryLevel(expiryYmd: string): 'expired' | 'warning' | 'ok' {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const expiry = new Date(`${expiryYmd}T00:00:00.000Z`);
  const diffDays = Math.floor((expiry.getTime() - today.getTime()) / (24 * 3600 * 1000));
  if (diffDays < 0) {
    return 'expired';
  }
  if (diffDays <= 30) {
    return 'warning';
  }
  return 'ok';
}

// =============================================================================
// /app/conductores — lista
// =============================================================================

export function ConductoresListRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        return <ConductoresListPage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function ConductoresListPage({ me }: { me: MeOnboarded }) {
  const navigate = useNavigate();
  const role = me.active_membership?.role;
  const canWrite = role === 'dueno' || role === 'admin' || role === 'despachador';

  const conductoresQ = useQuery({
    queryKey: ['conductores'],
    queryFn: async () => {
      const res = await api.get<{ conductores: Conductor[] }>('/conductores');
      return res.conductores;
    },
  });

  return (
    <Layout me={me} title="Conductores">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">Conductores</h1>
          <p className="mt-1 text-neutral-600 text-sm">
            Crea y administra los conductores de tu empresa. Cada uno tiene una licencia con su
            clase y vencimiento.
          </p>
        </div>
        {canWrite && (
          <Link
            to="/app/conductores/nuevo"
            className="flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white shadow-xs transition hover:bg-primary-700"
          >
            <UserPlus className="h-4 w-4" aria-hidden />
            Nuevo conductor
          </Link>
        )}
      </div>

      {conductoresQ.isLoading && <p className="mt-6 text-neutral-500">Cargando…</p>}
      {conductoresQ.error && <p className="mt-6 text-danger-700">Error al cargar conductores.</p>}
      {conductoresQ.data && conductoresQ.data.length === 0 && (
        <div className="mt-6 rounded-md border border-neutral-200 border-dashed bg-white p-10 text-center">
          <Users className="mx-auto h-10 w-10 text-neutral-400" aria-hidden />
          <p className="mt-3 font-medium text-neutral-900">Aún no tienes conductores</p>
          <p className="mt-1 text-neutral-600 text-sm">
            Agrega al primer conductor para que pueda recibir asignaciones.
          </p>
          {canWrite && (
            <Link
              to="/app/conductores/nuevo"
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Agregar conductor
            </Link>
          )}
        </div>
      )}

      {conductoresQ.data && conductoresQ.data.length > 0 && (
        <>
          {/* Desktop */}
          <div className="mt-6 hidden overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm md:block">
            <table className="min-w-full divide-y divide-neutral-200">
              <thead className="bg-neutral-50">
                <tr>
                  <Th>Nombre</Th>
                  <Th>RUT</Th>
                  <Th>Licencia</Th>
                  <Th>Vencimiento</Th>
                  <Th>Estado</Th>
                  <Th>{''}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 bg-white">
                {conductoresQ.data.map((c) => {
                  const expLevel = licenseExpiryLevel(c.license_expiry);
                  return (
                    // biome-ignore lint/a11y/useKeyWithClickEvents: row shortcut; link "Ver" en la última columna es el control accesible primario.
                    <tr
                      key={c.id}
                      className="cursor-pointer hover:bg-neutral-50"
                      onClick={() =>
                        void navigate({ to: '/app/conductores/$id', params: { id: c.id } })
                      }
                    >
                      <Td>
                        <div className="font-medium text-neutral-900">{c.user.full_name}</div>
                        {c.user.is_pending && (
                          <div className="mt-0.5 inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700 text-xs">
                            <Clock className="h-3 w-3" aria-hidden />
                            Pendiente login
                          </div>
                        )}
                        {c.is_extranjero && (
                          <div className="mt-0.5 inline-flex items-center gap-1 rounded-md bg-neutral-100 px-1.5 py-0.5 font-medium text-neutral-700 text-xs">
                            Extranjero
                          </div>
                        )}
                      </Td>
                      <Td className="font-mono text-xs">{c.user.rut}</Td>
                      <Td>
                        <div className="font-medium">{c.license_class}</div>
                        <div className="text-neutral-500 text-xs">{c.license_number}</div>
                      </Td>
                      <Td>
                        <ExpirySpan ymd={c.license_expiry} level={expLevel} />
                      </Td>
                      <Td>
                        <span
                          className={`inline-flex rounded-md px-2 py-0.5 font-medium text-xs ${STATUS_COLORS[c.status]}`}
                        >
                          {STATUS_LABELS[c.status]}
                        </span>
                      </Td>
                      <Td>
                        <Link
                          to="/app/conductores/$id"
                          params={{ id: c.id }}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-primary-600 text-sm hover:underline"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                          {canWrite ? 'Editar' : 'Ver'}
                        </Link>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile */}
          <ul className="mt-6 space-y-3 md:hidden">
            {conductoresQ.data.map((c) => {
              const expLevel = licenseExpiryLevel(c.license_expiry);
              return (
                <li
                  key={c.id}
                  className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium text-neutral-900">{c.user.full_name}</div>
                      <div className="text-neutral-500 text-xs">{c.user.rut}</div>
                    </div>
                    <span
                      className={`shrink-0 rounded-md px-2 py-0.5 font-medium text-xs ${STATUS_COLORS[c.status]}`}
                    >
                      {STATUS_LABELS[c.status]}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-neutral-700 text-sm">
                    <span>
                      <span className="font-medium">{c.license_class}</span> · {c.license_number}
                    </span>
                    <ExpirySpan ymd={c.license_expiry} level={expLevel} compact />
                  </div>
                  {(c.user.is_pending || c.is_extranjero) && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {c.user.is_pending && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700 text-xs">
                          <Clock className="h-3 w-3" aria-hidden />
                          Pendiente login
                        </span>
                      )}
                      {c.is_extranjero && (
                        <span className="inline-flex rounded-md bg-neutral-100 px-1.5 py-0.5 font-medium text-neutral-700 text-xs">
                          Extranjero
                        </span>
                      )}
                    </div>
                  )}
                  <div className="mt-4 flex justify-end">
                    <Link
                      to="/app/conductores/$id"
                      params={{ id: c.id }}
                      className="inline-flex items-center gap-1 rounded-md bg-primary-50 px-3 py-1.5 font-medium text-primary-700 text-sm transition hover:bg-primary-100"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                      {canWrite ? 'Editar' : 'Ver detalle'}
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Layout>
  );
}

function ExpirySpan({
  ymd,
  level,
  compact = false,
}: {
  ymd: string;
  level: 'expired' | 'warning' | 'ok';
  compact?: boolean;
}) {
  if (level === 'expired') {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-danger-700 text-sm">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
        Vencida {compact ? '' : `· ${ymd}`}
      </span>
    );
  }
  if (level === 'warning') {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-amber-700 text-sm">
        <Clock className="h-3.5 w-3.5" aria-hidden />
        Por vencer{compact ? '' : ` · ${ymd}`}
      </span>
    );
  }
  return <span className="font-mono text-neutral-700 text-sm">{ymd}</span>;
}

// =============================================================================
// /app/conductores/nuevo
// =============================================================================

interface NewConductorForm {
  rut: string;
  full_name: string;
  email: string;
  phone: string;
  license_class: LicenseClass;
  license_number: string;
  license_expiry: string;
  is_extranjero: boolean;
}

const EMPTY_NEW: NewConductorForm = {
  rut: '',
  full_name: '',
  email: '',
  phone: '',
  license_class: 'A5',
  license_number: '',
  license_expiry: '',
  is_extranjero: false,
};

export function ConductoresNuevoRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        const role = ctx.me.active_membership?.role;
        if (role !== 'dueno' && role !== 'admin' && role !== 'despachador') {
          return (
            <Layout me={ctx.me} title="Nuevo conductor">
              <NoPermission />
            </Layout>
          );
        }
        return <ConductoresNuevoPage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

interface CreateConductorResponse {
  conductor: Conductor;
  // D10 — PIN no se devuelve si el user ya estaba activado (e.g. dueño-conductor
  // que se agrega a sí mismo). En ese caso no hay que mostrar la card de PIN.
  activation_pin?: string;
}

function ConductoresNuevoPage({ me }: { me: MeOnboarded }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  // D10 — Modo "Soy yo el conductor" para flujo dueño-conductor (un user con
  // 2 memberships: dueño + conductor). Pre-fillea form con datos del me y
  // skipea la card de PIN al success (el dueño ya tiene email/password).
  const [selfMode, setSelfMode] = useState(false);
  const [activationResult, setActivationResult] = useState<{
    pin: string;
    driverName: string;
    driverRut: string;
  } | null>(null);

  const createM = useMutation({
    mutationFn: async (input: NewConductorForm) => {
      const body: Record<string, unknown> = {
        rut: input.rut.trim(),
        full_name: input.full_name.trim(),
        license_class: input.license_class,
        license_number: input.license_number.trim(),
        license_expiry: input.license_expiry,
        is_extranjero: input.is_extranjero,
      };
      if (input.email.trim()) {
        body.email = input.email.trim();
      }
      if (input.phone.trim()) {
        body.phone = input.phone.trim();
      }
      return await api.post<CreateConductorResponse>('/conductores', body);
    },
    onSuccess: (res, variables) => {
      queryClient.invalidateQueries({ queryKey: ['conductores'] });
      // D10 — Si el backend no devolvió PIN (user ya activado),
      // navegar directo a la lista. Si devolvió PIN, mostrar la card.
      if (res.activation_pin) {
        setActivationResult({
          pin: res.activation_pin,
          driverName: variables.full_name.trim(),
          driverRut: variables.rut.trim(),
        });
      } else {
        void navigate({ to: '/app/conductores' });
      }
    },
    onError: (err: Error) => {
      if (err.message.includes('user_already_driver')) {
        setError(
          'Ese RUT ya está asociado a un conductor activo. Si dejó la empresa, primero retíralo desde su perfil.',
        );
      } else if (err.message.includes('rut_invalido')) {
        setError('El RUT no es válido (revisa el dígito verificador).');
      } else {
        setError(err.message);
      }
    },
  });

  const {
    register,
    handleSubmit,
    setValue,
    setError: setFieldError,
    formState: { errors, submitCount },
  } = useForm<NewConductorForm>({
    mode: 'onSubmit',
    defaultValues: EMPTY_NEW,
  });

  // D10 — Toggle self mode pre-fillea/limpia los campos de identidad.
  function handleToggleSelfMode(checked: boolean) {
    setSelfMode(checked);
    if (checked) {
      setValue('rut', me.user.rut ?? '', { shouldValidate: false });
      setValue('full_name', me.user.full_name, { shouldValidate: false });
      // email del me.user puede no estar en todos los tipos — usamos any-cast.
      const meEmail = (me.user as { email?: string }).email;
      if (meEmail) {
        setValue('email', meEmail, { shouldValidate: false });
      }
    } else {
      setValue('rut', '');
      setValue('full_name', '');
      setValue('email', '');
    }
  }

  useScrollToFirstError(errors, submitCount);

  function onSubmit(values: NewConductorForm) {
    const rutResult = rutSchema.safeParse(values.rut);
    if (!rutResult.success) {
      const message = rutResult.error.issues[0]?.message ?? 'RUT inválido';
      setFieldError('rut', { type: 'manual', message });
      return;
    }
    setError(null);
    createM.mutate(values);
  }

  if (activationResult) {
    return (
      <Layout me={me} title="Conductor creado">
        <div className="mb-6 flex items-center gap-3">
          <Link to="/app/conductores" className="text-neutral-500 hover:text-neutral-900">
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Link>
          <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">Conductor creado</h1>
        </div>

        <ActivationPinCard
          pin={activationResult.pin}
          driverName={activationResult.driverName}
          driverRut={activationResult.driverRut}
          onContinue={() => {
            setActivationResult(null);
            void navigate({ to: '/app/conductores' });
          }}
        />
      </Layout>
    );
  }

  return (
    <Layout me={me} title="Nuevo conductor">
      <div className="mb-6 flex items-center gap-3">
        <Link to="/app/conductores" className="text-neutral-500 hover:text-neutral-900">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">Nuevo conductor</h1>
      </div>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="space-y-6 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
        noValidate
      >
        {/* D10 — Caso "patrón" Chile: el dueño del camión también lo
            maneja. Toggle pre-fillea datos con el current user y skipea
            la generación de PIN (el dueño ya tiene email/password). */}
        {me.user.rut && (
          <label className="flex items-start gap-3 rounded-md border border-primary-100 bg-primary-50/50 p-3">
            <input
              type="checkbox"
              checked={selfMode}
              onChange={(e) => handleToggleSelfMode(e.target.checked)}
              className="mt-0.5 rounded"
              data-testid="self-mode-toggle"
            />
            <div>
              <div className="font-medium text-neutral-900 text-sm">
                Soy yo el conductor de mi camión
              </div>
              <div className="mt-0.5 text-neutral-600 text-xs">
                Activa esta opción si manejas tu propio vehículo. Usaremos tu RUT y nombre, y podrás
                entrar a "Modo Conductor" directamente con tu email y contraseña actuales (sin PIN
                extra).
              </div>
            </div>
          </label>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            label="RUT"
            required
            error={errors.rut?.message}
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="text"
                {...register('rut', { required: 'Ingresa el RUT del conductor' })}
                className={fieldInputClass(!!errors.rut)}
                placeholder="11.111.111-1"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                readOnly={selfMode}
              />
            )}
          />

          <FormField
            label="Nombre completo"
            required
            error={errors.full_name?.message}
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="text"
                {...register('full_name', { required: 'Ingresa el nombre completo' })}
                className={fieldInputClass(!!errors.full_name)}
                maxLength={200}
              />
            )}
          />

          <FormField
            label="Email (opcional)"
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="email"
                {...register('email')}
                className={fieldInputClass(!!errors.email)}
                placeholder="conductor@ejemplo.cl"
              />
            )}
          />

          <FormField
            label="Teléfono (opcional)"
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="tel"
                {...register('phone')}
                className={fieldInputClass(!!errors.phone)}
                placeholder="+56912345678"
              />
            )}
          />

          <FormField
            label="Clase de licencia"
            required
            render={({ id, describedBy }) => (
              <select
                id={id}
                aria-describedby={describedBy}
                {...register('license_class')}
                className={fieldInputClass(!!errors.license_class)}
              >
                {LICENSE_CLASSES.map((cls) => (
                  <option key={cls} value={cls}>
                    {LICENSE_LABELS[cls]}
                  </option>
                ))}
              </select>
            )}
          />

          <FormField
            label="Número de licencia"
            required
            error={errors.license_number?.message}
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="text"
                {...register('license_number', { required: 'Ingresa el número de licencia' })}
                className={fieldInputClass(!!errors.license_number)}
                maxLength={50}
              />
            )}
          />

          <FormField
            label="Vencimiento de licencia"
            required
            error={errors.license_expiry?.message}
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="date"
                {...register('license_expiry', { required: 'Ingresa la fecha de vencimiento' })}
                className={fieldInputClass(!!errors.license_expiry)}
              />
            )}
          />

          <FormField
            label="Restricciones"
            render={() => (
              <label className="flex items-center gap-2 text-neutral-700 text-sm">
                <input type="checkbox" {...register('is_extranjero')} className="rounded" />
                Conductor extranjero (algunos puertos restringen el ingreso)
              </label>
            )}
          />
        </div>

        {error && (
          <div className="rounded-md border border-danger-200 bg-danger-50 p-3 text-danger-700 text-sm">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Link
            to="/app/conductores"
            className="rounded-md border border-neutral-300 px-4 py-2 font-medium text-neutral-700 text-sm hover:bg-neutral-100"
          >
            Cancelar
          </Link>
          <button
            type="submit"
            disabled={createM.isPending}
            className="rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {createM.isPending ? 'Creando…' : 'Crear conductor'}
          </button>
        </div>
      </form>
    </Layout>
  );
}

// =============================================================================
// /app/conductores/:id — editar / retirar
// =============================================================================

interface EditConductorForm {
  license_class: LicenseClass;
  license_number: string;
  license_expiry: string;
  is_extranjero: boolean;
  status: DriverStatus;
}

export function ConductoresDetalleRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        return <ConductoresDetallePage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function ConductoresDetallePage({ me }: { me: MeOnboarded }) {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const role = me.active_membership?.role;
  const canWrite = role === 'dueno' || role === 'admin' || role === 'despachador';
  const canDelete = role === 'dueno' || role === 'admin';

  const conductorQ = useQuery({
    queryKey: ['conductores', id],
    queryFn: async () => {
      const res = await api.get<{ conductor: Conductor }>(`/conductores/${id}`);
      return res.conductor;
    },
  });

  const updateM = useMutation({
    mutationFn: async (input: EditConductorForm) => {
      return await api.patch<{ conductor: Conductor }>(`/conductores/${id}`, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conductores'] });
      queryClient.invalidateQueries({ queryKey: ['conductores', id] });
      void navigate({ to: '/app/conductores' });
    },
    onError: (err: Error) => setError(err.message),
  });

  const deleteM = useMutation({
    mutationFn: async () => await api.delete<{ ok: boolean }>(`/conductores/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conductores'] });
      void navigate({ to: '/app/conductores' });
    },
    onError: (err: Error) => setError(err.message),
  });

  const { register, handleSubmit, reset } = useForm<EditConductorForm>({
    defaultValues: {
      license_class: 'A5',
      license_number: '',
      license_expiry: '',
      is_extranjero: false,
      status: 'activo',
    },
  });

  // Re-rellenar el form cuando llega data (effect, no en render — evita
  // loops infinitos del setState durante render).
  useEffect(() => {
    if (!conductorQ.data) {
      return;
    }
    reset({
      license_class: conductorQ.data.license_class,
      license_number: conductorQ.data.license_number,
      license_expiry: conductorQ.data.license_expiry,
      is_extranjero: conductorQ.data.is_extranjero,
      status: conductorQ.data.status,
    });
  }, [conductorQ.data, reset]);

  return (
    <Layout me={me} title="Detalle conductor">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/app/conductores" className="text-neutral-500 hover:text-neutral-900">
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Link>
          <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">
            {conductorQ.data?.user.full_name ?? 'Conductor'}
          </h1>
        </div>
        {canDelete && conductorQ.data && conductorQ.data.deleted_at == null && (
          <div className="flex items-center gap-2">
            {confirmDelete ? (
              <>
                <span className="text-neutral-700 text-sm">¿Retirar a este conductor?</span>
                <button
                  type="button"
                  onClick={() => deleteM.mutate()}
                  disabled={deleteM.isPending}
                  className="rounded-md bg-danger-600 px-3 py-1.5 text-sm text-white hover:bg-danger-700 disabled:opacity-50"
                >
                  Sí, retirar
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-neutral-700 text-sm hover:bg-neutral-100"
                >
                  Cancelar
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1 rounded-md border border-danger-300 px-3 py-1.5 text-danger-700 text-sm hover:bg-danger-50"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                Retirar
              </button>
            )}
          </div>
        )}
      </div>

      {conductorQ.isLoading && <p className="text-neutral-500">Cargando…</p>}
      {conductorQ.error && <p className="text-danger-700">Error al cargar el conductor.</p>}

      {conductorQ.data && (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm sm:grid-cols-2">
            <div>
              <span className="text-neutral-500">RUT:</span>{' '}
              <span className="font-mono">{conductorQ.data.user.rut}</span>
            </div>
            <div>
              <span className="text-neutral-500">Email:</span> {conductorQ.data.user.email}
            </div>
            {conductorQ.data.user.phone && (
              <div>
                <span className="text-neutral-500">Teléfono:</span> {conductorQ.data.user.phone}
              </div>
            )}
            {conductorQ.data.user.is_pending && (
              <div className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 font-medium text-amber-700 text-xs sm:col-span-2">
                <Clock className="h-3 w-3" aria-hidden />
                Pendiente de login — aún no ha completado su acceso a Booster.
              </div>
            )}
            {conductorQ.data.deleted_at && (
              <div className="inline-flex items-center gap-1 rounded-md bg-neutral-200 px-2 py-0.5 font-medium text-neutral-700 text-xs sm:col-span-2">
                <ShieldOff className="h-3 w-3" aria-hidden />
                Conductor retirado el {conductorQ.data.deleted_at.slice(0, 10)}
              </div>
            )}
          </div>

          <form
            onSubmit={handleSubmit((v) => {
              setError(null);
              updateM.mutate(v);
            })}
            className="space-y-6 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
            noValidate
          >
            <fieldset disabled={!canWrite || conductorQ.data.deleted_at != null}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  label="Clase de licencia"
                  required
                  render={({ id, describedBy }) => (
                    <select
                      id={id}
                      aria-describedby={describedBy}
                      {...register('license_class')}
                      className={fieldInputClass(false)}
                    >
                      {LICENSE_CLASSES.map((cls) => (
                        <option key={cls} value={cls}>
                          {LICENSE_LABELS[cls]}
                        </option>
                      ))}
                    </select>
                  )}
                />

                <FormField
                  label="Número de licencia"
                  required
                  render={({ id, describedBy }) => (
                    <input
                      id={id}
                      aria-describedby={describedBy}
                      type="text"
                      {...register('license_number', { required: true })}
                      className={fieldInputClass(false)}
                      maxLength={50}
                    />
                  )}
                />

                <FormField
                  label="Vencimiento de licencia"
                  required
                  render={({ id, describedBy }) => (
                    <input
                      id={id}
                      aria-describedby={describedBy}
                      type="date"
                      {...register('license_expiry', { required: true })}
                      className={fieldInputClass(false)}
                    />
                  )}
                />

                <FormField
                  label="Estado"
                  render={({ id, describedBy }) => (
                    <select
                      id={id}
                      aria-describedby={describedBy}
                      {...register('status')}
                      className={fieldInputClass(false)}
                    >
                      {(Object.keys(STATUS_LABELS) as DriverStatus[]).map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  )}
                />

                <FormField
                  label="Restricciones"
                  render={() => (
                    <label className="flex items-center gap-2 text-neutral-700 text-sm">
                      <input type="checkbox" {...register('is_extranjero')} className="rounded" />
                      Conductor extranjero
                    </label>
                  )}
                />
              </div>

              {error && (
                <div className="mt-4 rounded-md border border-danger-200 bg-danger-50 p-3 text-danger-700 text-sm">
                  {error}
                </div>
              )}

              {canWrite && conductorQ.data.deleted_at == null && (
                <div className="mt-6 flex justify-end gap-2">
                  <Link
                    to="/app/conductores"
                    className="rounded-md border border-neutral-300 px-4 py-2 font-medium text-neutral-700 text-sm hover:bg-neutral-100"
                  >
                    Cancelar
                  </Link>
                  <button
                    type="submit"
                    disabled={updateM.isPending}
                    className="rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-50"
                  >
                    {updateM.isPending ? 'Guardando…' : 'Guardar cambios'}
                  </button>
                </div>
              )}
            </fieldset>
          </form>
        </>
      )}
    </Layout>
  );
}

function NoPermission() {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="font-semibold text-neutral-900 text-xl">Sin permisos</h2>
      <p className="mt-2 text-neutral-600 text-sm">
        Solo dueños, administradores y despachadores pueden modificar conductores.
      </p>
      <Link to="/app/conductores" className="mt-4 inline-block text-primary-600 underline">
        Volver a la lista
      </Link>
    </div>
  );
}

/**
 * Card que se muestra UNA SOLA VEZ después de crear un conductor.
 * Contiene el PIN de activación en plaintext. Después de "Continuar" se
 * pierde — la BD solo guarda el hash. Si el PIN se extravía hay que retirar
 * al conductor y crearlo de nuevo.
 */
function ActivationPinCard({
  pin,
  driverName,
  driverRut,
  onContinue,
}: {
  pin: string;
  driverName: string;
  driverRut: string;
  onContinue: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(pin);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Sin clipboard (ej. http en local) — el usuario lo lee y tipea.
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border-2 border-success-300 bg-success-50 p-4">
        <div className="flex items-start gap-3">
          <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-success-700" aria-hidden />
          <div>
            <h2 className="font-semibold text-neutral-900">
              {driverName} fue creado correctamente
            </h2>
            <p className="mt-1 text-neutral-700 text-sm">
              RUT: <span className="font-mono">{driverRut}</span>. Ahora dale al conductor el PIN de
              activación de abajo para que pueda ingresar a Booster con su RUT desde{' '}
              <span className="font-mono">/login/conductor</span>.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="text-neutral-600 text-sm">
          <strong>PIN de activación</strong> (válido 1 sola vez — guárdalo ahora)
        </div>
        <div className="mt-3 flex items-center gap-4">
          <div className="flex-1 rounded-md bg-neutral-900 px-6 py-4 text-center font-bold font-mono text-3xl text-white tracking-[0.5em]">
            {pin}
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-2 rounded-md border border-neutral-300 px-4 py-3 font-medium text-neutral-700 text-sm transition hover:bg-neutral-50"
          >
            <Copy className="h-4 w-4" aria-hidden />
            {copied ? 'Copiado' : 'Copiar'}
          </button>
        </div>
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm">
          <strong>Importante:</strong> este PIN no se vuelve a mostrar. Si el conductor lo pierde
          tendrás que retirarlo y crearlo de nuevo.
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onContinue}
          className="rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700"
        >
          Continuar
        </button>
      </div>
    </div>
  );
}

function Th({ children }: { children: ReactNode }) {
  return (
    <th className="px-4 py-3 text-left font-semibold text-neutral-600 text-xs uppercase tracking-wider">
      {children}
    </th>
  );
}

function Td({ className = '', children }: { className?: string; children: ReactNode }) {
  return <td className={`px-4 py-3 text-neutral-800 text-sm ${className}`}>{children}</td>;
}
