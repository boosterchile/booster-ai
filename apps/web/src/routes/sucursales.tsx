import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { ArrowLeft, Building2, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { FormField, inputClass as fieldInputClass } from '../components/FormField.js';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import type { MeResponse } from '../hooks/use-me.js';
import { api } from '../lib/api-client.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

type RegionCode =
  | 'I'
  | 'II'
  | 'III'
  | 'IV'
  | 'V'
  | 'VI'
  | 'VII'
  | 'VIII'
  | 'IX'
  | 'X'
  | 'XI'
  | 'XII'
  | 'XIII'
  | 'XIV'
  | 'XV'
  | 'XVI';

const REGION_OPTIONS: { code: RegionCode; label: string }[] = [
  { code: 'XV', label: 'XV — Arica y Parinacota' },
  { code: 'I', label: 'I — Tarapacá' },
  { code: 'II', label: 'II — Antofagasta' },
  { code: 'III', label: 'III — Atacama' },
  { code: 'IV', label: 'IV — Coquimbo' },
  { code: 'V', label: 'V — Valparaíso' },
  { code: 'XIII', label: 'XIII — Metropolitana' },
  { code: 'VI', label: "VI — O'Higgins" },
  { code: 'VII', label: 'VII — Maule' },
  { code: 'XVI', label: 'XVI — Ñuble' },
  { code: 'VIII', label: 'VIII — Biobío' },
  { code: 'IX', label: 'IX — Araucanía' },
  { code: 'XIV', label: 'XIV — Los Ríos' },
  { code: 'X', label: 'X — Los Lagos' },
  { code: 'XI', label: 'XI — Aysén' },
  { code: 'XII', label: 'XII — Magallanes' },
];

interface Sucursal {
  id: string;
  empresa_id: string;
  nombre: string;
  address_street: string;
  address_city: string;
  address_region: RegionCode;
  latitude: number | null;
  longitude: number | null;
  operating_hours: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface SucursalFormValues {
  nombre: string;
  address_street: string;
  address_city: string;
  address_region: RegionCode;
  latitude: string; // string en el form, se castea al body
  longitude: string;
  operating_hours: string;
  is_active?: boolean;
}

const EMPTY_FORM: SucursalFormValues = {
  nombre: '',
  address_street: '',
  address_city: '',
  address_region: 'XIII',
  latitude: '',
  longitude: '',
  operating_hours: '',
};

function formToBody(v: SucursalFormValues): Record<string, unknown> {
  const body: Record<string, unknown> = {
    nombre: v.nombre.trim(),
    address_street: v.address_street.trim(),
    address_city: v.address_city.trim(),
    address_region: v.address_region,
  };
  if (v.latitude.trim()) {
    body.latitude = Number.parseFloat(v.latitude);
  }
  if (v.longitude.trim()) {
    body.longitude = Number.parseFloat(v.longitude);
  }
  if (v.operating_hours.trim()) {
    body.operating_hours = v.operating_hours.trim();
  }
  if (v.is_active !== undefined) {
    body.is_active = v.is_active;
  }
  return body;
}

function sucursalToForm(s: Sucursal): SucursalFormValues {
  return {
    nombre: s.nombre,
    address_street: s.address_street,
    address_city: s.address_city,
    address_region: s.address_region,
    latitude: s.latitude != null ? String(s.latitude) : '',
    longitude: s.longitude != null ? String(s.longitude) : '',
    operating_hours: s.operating_hours ?? '',
    is_active: s.is_active,
  };
}

// =============================================================================
// /app/sucursales — lista
// =============================================================================

export function SucursalesListRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        return <SucursalesListPage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function SucursalesListPage({ me }: { me: MeOnboarded }) {
  const role = me.active_membership?.role;
  const canWrite = role === 'dueno' || role === 'admin' || role === 'despachador';

  const q = useQuery({
    queryKey: ['sucursales'],
    queryFn: async () => {
      const res = await api.get<{ sucursales: Sucursal[] }>('/sucursales');
      return res.sucursales;
    },
  });

  return (
    <Layout me={me} title="Sucursales">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">Sucursales</h1>
          <p className="mt-1 text-neutral-600 text-sm">
            Puntos físicos de origen y destino de tu empresa (bodegas, plantas, centros de
            distribución). Una oferta puede asociarse opcionalmente a una sucursal.
          </p>
        </div>
        {canWrite && (
          <Link
            to="/app/sucursales/nueva"
            className="flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white shadow-xs transition hover:bg-primary-700"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Nueva sucursal
          </Link>
        )}
      </div>

      {q.isLoading && <p className="mt-6 text-neutral-500">Cargando…</p>}
      {q.error && <p className="mt-6 text-danger-700">Error al cargar sucursales.</p>}
      {q.data && q.data.length === 0 && (
        <div className="mt-6 rounded-md border border-neutral-200 border-dashed bg-white p-10 text-center">
          <Building2 className="mx-auto h-10 w-10 text-neutral-400" aria-hidden />
          <p className="mt-3 font-medium text-neutral-900">Aún no tienes sucursales</p>
          <p className="mt-1 text-neutral-600 text-sm">
            Agrega tu primera sucursal para empezar a crear ofertas asociadas a un punto físico.
          </p>
          {canWrite && (
            <Link
              to="/app/sucursales/nueva"
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Agregar sucursal
            </Link>
          )}
        </div>
      )}

      {q.data && q.data.length > 0 && (
        <ul className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
          {q.data.map((s) => {
            const hasCoords = s.latitude != null && s.longitude != null;
            return (
              <li
                key={s.id}
                className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm transition hover:border-primary-300"
              >
                {/* navigate sólo desde el link explícito de "Editar" para no
                    pelear con biome a11y. */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-neutral-900">{s.nombre}</div>
                    <div className="mt-0.5 text-neutral-600 text-sm">
                      {s.address_street}, {s.address_city} ({s.address_region})
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span
                      className={`shrink-0 rounded-md px-2 py-0.5 font-medium text-xs ${
                        s.is_active
                          ? 'bg-success-50 text-success-700'
                          : 'bg-neutral-100 text-neutral-600'
                      }`}
                    >
                      {s.is_active ? 'Activa' : 'Inactiva'}
                    </span>
                    {!hasCoords && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700 text-xs">
                        <MapPin className="h-3 w-3" aria-hidden />
                        Sin coords
                      </span>
                    )}
                  </div>
                </div>
                {s.operating_hours && (
                  <div className="mt-2 text-neutral-500 text-xs">Horario: {s.operating_hours}</div>
                )}
                <div className="mt-3 flex justify-end">
                  <Link
                    to="/app/sucursales/$id"
                    params={{ id: s.id }}
                    onClick={(e) => e.stopPropagation()}
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
      )}
    </Layout>
  );
}

// =============================================================================
// /app/sucursales/nueva
// =============================================================================

export function SucursalesNuevaRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        const role = ctx.me.active_membership?.role;
        if (role !== 'dueno' && role !== 'admin' && role !== 'despachador') {
          return (
            <Layout me={ctx.me} title="Nueva sucursal">
              <NoPermission />
            </Layout>
          );
        }
        return <SucursalesNuevaPage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function SucursalesNuevaPage({ me }: { me: MeOnboarded }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: async (values: SucursalFormValues) => {
      return await api.post<{ sucursal: Sucursal }>('/sucursales', formToBody(values));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sucursales'] });
      void navigate({ to: '/app/sucursales' });
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <Layout me={me} title="Nueva sucursal">
      <div className="mb-6 flex items-center gap-3">
        <Link to="/app/sucursales" className="text-neutral-500 hover:text-neutral-900">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">Nueva sucursal</h1>
      </div>
      <SucursalForm
        mode="create"
        onSubmit={(v) => {
          setError(null);
          createM.mutate(v);
        }}
        submitting={createM.isPending}
        error={error}
      />
    </Layout>
  );
}

// =============================================================================
// /app/sucursales/:id
// =============================================================================

export function SucursalesDetalleRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        return <SucursalesDetallePage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function SucursalesDetallePage({ me }: { me: MeOnboarded }) {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const role = me.active_membership?.role;
  const canWrite = role === 'dueno' || role === 'admin' || role === 'despachador';
  const canDelete = role === 'dueno' || role === 'admin';

  const q = useQuery({
    queryKey: ['sucursales', id],
    queryFn: async () => {
      const res = await api.get<{ sucursal: Sucursal }>(`/sucursales/${id}`);
      return res.sucursal;
    },
  });

  const updateM = useMutation({
    mutationFn: async (values: SucursalFormValues) => {
      return await api.patch<{ sucursal: Sucursal }>(`/sucursales/${id}`, formToBody(values));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sucursales'] });
      queryClient.invalidateQueries({ queryKey: ['sucursales', id] });
      void navigate({ to: '/app/sucursales' });
    },
    onError: (err: Error) => setError(err.message),
  });

  const deleteM = useMutation({
    mutationFn: async () => await api.delete<{ ok: boolean }>(`/sucursales/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sucursales'] });
      void navigate({ to: '/app/sucursales' });
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <Layout me={me} title="Detalle sucursal">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/app/sucursales" className="text-neutral-500 hover:text-neutral-900">
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Link>
          <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">
            {q.data?.nombre ?? 'Sucursal'}
          </h1>
        </div>
        {canDelete && q.data && q.data.deleted_at == null && (
          <div className="flex items-center gap-2">
            {confirmDelete ? (
              <>
                <span className="text-neutral-700 text-sm">¿Retirar esta sucursal?</span>
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

      {q.isLoading && <p className="text-neutral-500">Cargando…</p>}
      {q.error && <p className="text-danger-700">Error al cargar la sucursal.</p>}

      {q.data && (
        <SucursalForm
          mode="edit"
          initial={sucursalToForm(q.data)}
          onSubmit={(v) => {
            setError(null);
            updateM.mutate(v);
          }}
          submitting={updateM.isPending}
          error={error}
          disabled={!canWrite}
        />
      )}
    </Layout>
  );
}

// =============================================================================
// SucursalForm reusable
// =============================================================================

function SucursalForm({
  mode,
  initial,
  onSubmit,
  submitting,
  error,
  disabled,
}: {
  mode: 'create' | 'edit';
  initial?: SucursalFormValues;
  onSubmit: (values: SucursalFormValues) => void;
  submitting: boolean;
  error: string | null;
  disabled?: boolean;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<SucursalFormValues>({
    defaultValues: initial ?? EMPTY_FORM,
  });

  useEffect(() => {
    if (initial) {
      reset(initial);
    }
  }, [initial, reset]);

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-6 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
      noValidate
    >
      <fieldset disabled={disabled}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            label="Nombre"
            required
            error={errors.nombre?.message}
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="text"
                {...register('nombre', { required: 'Ingresa el nombre' })}
                className={fieldInputClass(!!errors.nombre)}
                maxLength={100}
                placeholder="Bodega Maipú"
              />
            )}
          />

          <FormField
            label="Región"
            required
            render={({ id, describedBy }) => (
              <select
                id={id}
                aria-describedby={describedBy}
                {...register('address_region')}
                className={fieldInputClass(false)}
              >
                {REGION_OPTIONS.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
              </select>
            )}
          />

          <FormField
            label="Dirección"
            required
            error={errors.address_street?.message}
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="text"
                {...register('address_street', { required: 'Ingresa la dirección' })}
                className={fieldInputClass(!!errors.address_street)}
                maxLength={200}
              />
            )}
          />

          <FormField
            label="Ciudad / Comuna"
            required
            error={errors.address_city?.message}
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="text"
                {...register('address_city', { required: 'Ingresa la ciudad' })}
                className={fieldInputClass(!!errors.address_city)}
                maxLength={100}
              />
            )}
          />

          <FormField
            label="Latitud (opcional)"
            hint="Coordenada decimal — completa al usar la sucursal en una oferta"
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="number"
                step="0.0000001"
                min={-90}
                max={90}
                {...register('latitude')}
                className={fieldInputClass(false)}
                placeholder="-33.5111"
              />
            )}
          />

          <FormField
            label="Longitud (opcional)"
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="number"
                step="0.0000001"
                min={-180}
                max={180}
                {...register('longitude')}
                className={fieldInputClass(false)}
                placeholder="-70.7575"
              />
            )}
          />

          <FormField
            label="Horario de operación (opcional)"
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="text"
                {...register('operating_hours')}
                className={fieldInputClass(false)}
                placeholder="L-V 8-18, S 9-14"
                maxLength={200}
              />
            )}
          />

          {mode === 'edit' && (
            <FormField
              label="Estado"
              render={() => (
                <label className="mt-2 flex items-center gap-2 text-neutral-700 text-sm">
                  <input type="checkbox" {...register('is_active')} className="rounded" />
                  Activa (visible para crear ofertas)
                </label>
              )}
            />
          )}
        </div>

        {error && (
          <div className="mt-4 rounded-md border border-danger-200 bg-danger-50 p-3 text-danger-700 text-sm">
            {error}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Link
            to="/app/sucursales"
            className="rounded-md border border-neutral-300 px-4 py-2 font-medium text-neutral-700 text-sm hover:bg-neutral-100"
          >
            Cancelar
          </Link>
          {!disabled && (
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {submitting ? 'Guardando…' : mode === 'create' ? 'Crear sucursal' : 'Guardar cambios'}
            </button>
          )}
        </div>
      </fieldset>
    </form>
  );
}

function NoPermission() {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="font-semibold text-neutral-900 text-xl">Sin permisos</h2>
      <p className="mt-2 text-neutral-600 text-sm">
        Solo dueños, administradores y despachadores pueden modificar sucursales.
      </p>
      <Link to="/app/sucursales" className="mt-4 inline-block text-primary-600 underline">
        Volver a la lista
      </Link>
    </div>
  );
}
