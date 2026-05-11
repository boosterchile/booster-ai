import { chileanPlateSchema, normalizePlate } from '@booster-ai/shared-schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { ArrowLeft, Navigation, Pencil, Plus, Trash2, Truck } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useForm } from 'react-hook-form';
import { ChileanPlate } from '../components/ChileanPlate.js';
import { DocumentosSection } from '../components/DocumentosSection.js';
import { FormField, inputClass as fieldInputClass } from '../components/FormField.js';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import type { MeResponse } from '../hooks/use-me.js';
import { useScrollToFirstError } from '../hooks/use-scroll-to-first-error.js';
import { api } from '../lib/api-client.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

type VehicleType =
  | 'camioneta'
  | 'furgon_pequeno'
  | 'furgon_mediano'
  | 'camion_pequeno'
  | 'camion_mediano'
  | 'camion_pesado'
  | 'semi_remolque'
  | 'refrigerado'
  | 'tanque';

type FuelType =
  | 'diesel'
  | 'gasolina'
  | 'gas_glp'
  | 'gas_gnc'
  | 'electrico'
  | 'hibrido_diesel'
  | 'hibrido_gasolina'
  | 'hidrogeno';

type VehicleStatus = 'activo' | 'mantenimiento' | 'retirado';

interface Vehicle {
  id: string;
  plate: string;
  type: VehicleType;
  capacity_kg: number;
  capacity_m3: number | null;
  year: number | null;
  brand: string | null;
  model: string | null;
  fuel_type: FuelType | null;
  curb_weight_kg: number | null;
  consumption_l_per_100km_baseline: string | null;
  teltonika_imei: string | null;
  status: VehicleStatus;
  created_at: string;
  updated_at: string;
}

const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  camioneta: 'Camioneta',
  furgon_pequeno: 'Furgón pequeño',
  furgon_mediano: 'Furgón mediano',
  camion_pequeno: 'Camión pequeño',
  camion_mediano: 'Camión mediano',
  camion_pesado: 'Camión pesado',
  semi_remolque: 'Semi-remolque',
  refrigerado: 'Refrigerado',
  tanque: 'Tanque',
};

const FUEL_TYPE_LABELS: Record<FuelType, string> = {
  diesel: 'Diésel',
  gasolina: 'Gasolina',
  gas_glp: 'GLP',
  gas_gnc: 'GNC',
  electrico: 'Eléctrico',
  hibrido_diesel: 'Híbrido diésel',
  hibrido_gasolina: 'Híbrido gasolina',
  hidrogeno: 'Hidrógeno',
};

const STATUS_LABELS: Record<VehicleStatus, string> = {
  activo: 'Activo',
  mantenimiento: 'Mantenimiento',
  retirado: 'Retirado',
};

const STATUS_COLORS: Record<VehicleStatus, string> = {
  activo: 'bg-success-50 text-success-700',
  mantenimiento: 'bg-amber-50 text-amber-700',
  retirado: 'bg-neutral-100 text-neutral-600',
};

// =============================================================================
// /app/vehiculos — lista
// =============================================================================

export function VehiculosListRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        return <VehiculosListPage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function VehiculosListPage({ me }: { me: MeOnboarded }) {
  const navigate = useNavigate();
  const role = me.active_membership?.role;
  const canWrite = role === 'dueno' || role === 'admin' || role === 'despachador';

  const vehiclesQ = useQuery({
    queryKey: ['vehiculos'],
    queryFn: async () => {
      const res = await api.get<{ vehicles: Vehicle[] }>('/vehiculos');
      return res.vehicles;
    },
  });

  return (
    <Layout me={me} title="Vehículos">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">Vehículos</h1>
          <p className="mt-1 text-neutral-600 text-sm">
            Gestiona la flota de tu empresa: capacidad, combustible, asociación a Teltonika.
          </p>
        </div>
        {canWrite && (
          <Link
            to="/app/vehiculos/nuevo"
            className="flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white shadow-xs transition hover:bg-primary-700"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Nuevo vehículo
          </Link>
        )}
      </div>

      {vehiclesQ.isLoading && <p className="mt-6 text-neutral-500">Cargando…</p>}
      {vehiclesQ.error && <p className="mt-6 text-danger-700">Error al cargar vehículos.</p>}
      {vehiclesQ.data && vehiclesQ.data.length === 0 && (
        <div className="mt-6 rounded-md border border-neutral-200 border-dashed bg-white p-10 text-center">
          <Truck className="mx-auto h-10 w-10 text-neutral-400" aria-hidden />
          <p className="mt-3 font-medium text-neutral-900">Aún no tienes vehículos</p>
          <p className="mt-1 text-neutral-600 text-sm">
            Agrega tu primer vehículo para asociar dispositivos Teltonika y recibir ofertas
            adecuadas.
          </p>
          {canWrite && (
            <Link
              to="/app/vehiculos/nuevo"
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Agregar vehículo
            </Link>
          )}
        </div>
      )}

      {vehiclesQ.data && vehiclesQ.data.length > 0 && (
        <>
          {/* Desktop (md+): tabla densa con 8 columnas. Oculta en mobile
              porque hace overflow horizontal a 375px (BUG-006). */}
          <div className="mt-6 hidden overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm md:block">
            <table className="min-w-full divide-y divide-neutral-200">
              <thead className="bg-neutral-50">
                <tr>
                  <Th>Patente</Th>
                  <Th>Tipo</Th>
                  <Th>Capacidad</Th>
                  <Th>Marca / Modelo</Th>
                  <Th>Combustible</Th>
                  <Th>IMEI</Th>
                  <Th>Estado</Th>
                  <Th>{''}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 bg-white">
                {vehiclesQ.data.map((v) => (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: row es shortcut visual; el link "Ver" en la última columna es el control accesible primario.
                  <tr
                    key={v.id}
                    className="cursor-pointer hover:bg-neutral-50"
                    onClick={() =>
                      void navigate({ to: '/app/vehiculos/$id', params: { id: v.id } })
                    }
                  >
                    <Td>
                      <ChileanPlate plate={v.plate} size="sm" />
                    </Td>
                    <Td>{VEHICLE_TYPE_LABELS[v.type]}</Td>
                    <Td>
                      {v.capacity_kg.toLocaleString('es-CL')} kg
                      {v.capacity_m3 ? ` · ${v.capacity_m3} m³` : ''}
                    </Td>
                    <Td>
                      {v.brand || v.model
                        ? `${v.brand ?? ''}${v.brand && v.model ? ' ' : ''}${v.model ?? ''}`
                        : '—'}
                    </Td>
                    <Td>{v.fuel_type ? FUEL_TYPE_LABELS[v.fuel_type] : '—'}</Td>
                    <Td className="font-mono text-xs">{v.teltonika_imei ?? '—'}</Td>
                    <Td>
                      <span
                        className={`inline-flex rounded-md px-2 py-0.5 font-medium text-xs ${STATUS_COLORS[v.status]}`}
                      >
                        {STATUS_LABELS[v.status]}
                      </span>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-3">
                        <Link
                          to="/app/vehiculos/$id/live"
                          params={{ id: v.id }}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-neutral-600 text-sm hover:text-primary-700 hover:underline"
                          aria-label={`Ver ubicación en vivo de ${v.plate}`}
                        >
                          <Navigation className="h-3.5 w-3.5" aria-hidden />
                          Ubicación
                        </Link>
                        <Link
                          to="/app/vehiculos/$id"
                          params={{ id: v.id }}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-primary-600 text-sm hover:underline"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                          {canWrite ? 'Editar' : 'Ver'}
                        </Link>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile (<md): cards apiladas con la misma data. */}
          <ul className="mt-6 space-y-3 md:hidden">
            {vehiclesQ.data.map((v) => (
              <li
                key={v.id}
                className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <ChileanPlate plate={v.plate} size="md" />
                  <span
                    className={`shrink-0 rounded-md px-2 py-0.5 font-medium text-xs ${STATUS_COLORS[v.status]}`}
                  >
                    {STATUS_LABELS[v.status]}
                  </span>
                </div>
                <div className="mt-2 text-neutral-700 text-sm">
                  {VEHICLE_TYPE_LABELS[v.type]}
                  {v.brand || v.model
                    ? ` · ${v.brand ?? ''}${v.brand && v.model ? ' ' : ''}${v.model ?? ''}`
                    : ''}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-neutral-500 text-xs">
                  <span>
                    {v.capacity_kg.toLocaleString('es-CL')} kg
                    {v.capacity_m3 ? ` · ${v.capacity_m3} m³` : ''}
                  </span>
                  {v.fuel_type && (
                    <>
                      <span aria-hidden>·</span>
                      <span>{FUEL_TYPE_LABELS[v.fuel_type]}</span>
                    </>
                  )}
                  {v.teltonika_imei && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="font-mono">IMEI {v.teltonika_imei}</span>
                    </>
                  )}
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <Link
                    to="/app/vehiculos/$id/live"
                    params={{ id: v.id }}
                    className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700 text-sm transition hover:bg-neutral-50"
                  >
                    <Navigation className="h-3.5 w-3.5" aria-hidden />
                    Ubicación
                  </Link>
                  <Link
                    to="/app/vehiculos/$id"
                    params={{ id: v.id }}
                    className="inline-flex items-center gap-1 rounded-md bg-primary-50 px-3 py-1.5 font-medium text-primary-700 text-sm transition hover:bg-primary-100"
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                    {canWrite ? 'Editar' : 'Ver detalle'}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Layout>
  );
}

// =============================================================================
// /app/vehiculos/nuevo — crear
// =============================================================================

export function VehiculosNuevoRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        const role = ctx.me.active_membership?.role;
        if (role !== 'dueno' && role !== 'admin' && role !== 'despachador') {
          return (
            <Layout me={ctx.me} title="Nuevo vehículo">
              <NoPermission />
            </Layout>
          );
        }
        return <VehiculoNuevoPage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function VehiculoNuevoPage({ me }: { me: MeOnboarded }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: async (input: VehicleFormValues) => {
      return await api.post<{ vehicle: Vehicle }>('/vehiculos', vehicleFormToBody(input));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehiculos'] });
      void navigate({ to: '/app/vehiculos' });
    },
    onError: (err: Error) => {
      const msg = err.message.includes('plate_duplicate')
        ? 'Ya existe un vehículo con esa patente.'
        : err.message;
      setError(msg);
    },
  });

  return (
    <Layout me={me} title="Nuevo vehículo">
      <div className="mb-6 flex items-center gap-3">
        <Link to="/app/vehiculos" className="text-neutral-500 hover:text-neutral-900">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">Nuevo vehículo</h1>
      </div>

      <VehicleForm
        mode="create"
        onSubmit={(values) => {
          setError(null);
          createM.mutate(values);
        }}
        submitting={createM.isPending}
        submitLabel="Crear vehículo"
        error={error}
      />
    </Layout>
  );
}

// =============================================================================
// /app/vehiculos/:id — editar / eliminar
// =============================================================================

export function VehiculosDetalleRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        return <VehiculoDetallePage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function VehiculoDetallePage({ me }: { me: MeOnboarded }) {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const role = me.active_membership?.role;
  const canWrite = role === 'dueno' || role === 'admin' || role === 'despachador';
  const canDelete = role === 'dueno' || role === 'admin';

  const vehicleQ = useQuery({
    queryKey: ['vehiculos', id],
    queryFn: async () => {
      const res = await api.get<{ vehicle: Vehicle }>(`/vehiculos/${id}`);
      return res.vehicle;
    },
  });

  const updateM = useMutation({
    mutationFn: async (input: VehicleFormValues) => {
      return await api.patch<{ vehicle: Vehicle }>(`/vehiculos/${id}`, vehicleFormToBody(input));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehiculos'] });
      queryClient.invalidateQueries({ queryKey: ['vehiculos', id] });
      void navigate({ to: '/app/vehiculos' });
    },
    onError: (err: Error) => {
      const msg = err.message.includes('plate_duplicate')
        ? 'Ya existe un vehículo con esa patente.'
        : err.message;
      setError(msg);
    },
  });

  const deleteM = useMutation({
    mutationFn: async () => {
      return await api.delete<{ vehicle: Vehicle }>(`/vehiculos/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehiculos'] });
      void navigate({ to: '/app/vehiculos' });
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <Layout me={me} title="Detalle vehículo">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <Link to="/app/vehiculos" className="text-neutral-500 hover:text-neutral-900">
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Link>
          {vehicleQ.data?.plate ? (
            <ChileanPlate plate={vehicleQ.data.plate} size="lg" />
          ) : (
            <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">Vehículo</h1>
          )}
        </div>
        {canDelete && vehicleQ.data && vehicleQ.data.status !== 'retirado' && (
          <div className="flex items-center gap-2">
            {confirmDelete ? (
              <>
                <span className="text-neutral-700 text-sm">¿Retirar este vehículo?</span>
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

      {vehicleQ.isLoading && <p className="text-neutral-500">Cargando…</p>}
      {vehicleQ.error && <p className="text-danger-700">Error al cargar el vehículo.</p>}

      {vehicleQ.data && (
        <>
          {/* D3 — La ubicación en vivo y el histórico de telemetría se
              movieron a /app/flota y /app/vehiculos/:id/live. Esta página
              ahora es pure-edit. Para no perder el afordance rápido al
              tracking dejamos un link discreto al inicio cuando hay
              Teltonika asociado. */}
          {vehicleQ.data.teltonika_imei && (
            <div className="mb-4 flex items-center justify-between gap-4 rounded-md border border-primary-100 bg-primary-50 p-3">
              <div className="text-primary-900 text-sm">
                <strong>Teltonika asociado:</strong>{' '}
                <span className="font-mono">{vehicleQ.data.teltonika_imei}</span>
              </div>
              <Link
                to="/app/vehiculos/$id/live"
                params={{ id: vehicleQ.data.id }}
                className="flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white shadow-sm transition hover:bg-primary-700"
              >
                <Navigation className="h-4 w-4" aria-hidden />
                Ver en vivo
              </Link>
            </div>
          )}

          <div>
            <h2 className="font-semibold text-neutral-900 text-xl">Datos del vehículo</h2>
            <p className="mt-1 text-neutral-600 text-sm">
              Capacidad, combustible, asociación a Teltonika.
            </p>
            <div className="mt-4">
              <VehicleForm
                mode="edit"
                initial={vehicleToFormValues(vehicleQ.data)}
                onSubmit={(values) => {
                  setError(null);
                  updateM.mutate(values);
                }}
                submitting={updateM.isPending}
                submitLabel="Guardar cambios"
                error={error}
                disabled={!canWrite}
              />
            </div>
          </div>

          {/* D6 — Documentos del vehículo (revisión técnica, SOAP, etc.). */}
          <DocumentosSection
            entityType="vehiculo"
            entityId={vehicleQ.data.id}
            canWrite={canWrite}
          />
        </>
      )}
    </Layout>
  );
}

// =============================================================================
// VehicleForm compartido (create + edit)
// =============================================================================

interface VehicleFormValues {
  plate: string;
  vehicle_type: VehicleType;
  capacity_kg: string;
  capacity_m3: string;
  year: string;
  brand: string;
  model: string;
  fuel_type: '' | FuelType;
  curb_weight_kg: string;
  consumption_l_per_100km_baseline: string;
  vehicle_status?: VehicleStatus;
}

const EMPTY_FORM: VehicleFormValues = {
  plate: '',
  vehicle_type: 'camion_pequeno',
  capacity_kg: '',
  capacity_m3: '',
  year: '',
  brand: '',
  model: '',
  fuel_type: '',
  curb_weight_kg: '',
  consumption_l_per_100km_baseline: '',
};

function vehicleToFormValues(v: Vehicle): VehicleFormValues {
  return {
    plate: v.plate,
    vehicle_type: v.type,
    capacity_kg: String(v.capacity_kg),
    capacity_m3: v.capacity_m3 != null ? String(v.capacity_m3) : '',
    year: v.year != null ? String(v.year) : '',
    brand: v.brand ?? '',
    model: v.model ?? '',
    fuel_type: v.fuel_type ?? '',
    curb_weight_kg: v.curb_weight_kg != null ? String(v.curb_weight_kg) : '',
    consumption_l_per_100km_baseline: v.consumption_l_per_100km_baseline ?? '',
    vehicle_status: v.status,
  };
}

function vehicleFormToBody(v: VehicleFormValues): Record<string, unknown> {
  // El servidor también normaliza vía chileanPlateSchema, pero normalizar
  // del lado del cliente nos da consistencia visual: si el usuario ingresa
  // "bcdf12", el body que viaja es "BCDF12".
  const body: Record<string, unknown> = {
    plate: normalizePlate(v.plate),
    vehicle_type: v.vehicle_type,
    capacity_kg: Number.parseInt(v.capacity_kg, 10),
  };
  if (v.capacity_m3.trim()) {
    body.capacity_m3 = Number.parseInt(v.capacity_m3, 10);
  }
  if (v.year.trim()) {
    body.year = Number.parseInt(v.year, 10);
  }
  if (v.brand.trim()) {
    body.brand = v.brand.trim();
  }
  if (v.model.trim()) {
    body.model = v.model.trim();
  }
  if (v.fuel_type) {
    body.fuel_type = v.fuel_type;
  }
  if (v.curb_weight_kg.trim()) {
    body.curb_weight_kg = Number.parseInt(v.curb_weight_kg, 10);
  }
  if (v.consumption_l_per_100km_baseline.trim()) {
    body.consumption_l_per_100km_baseline = Number.parseFloat(v.consumption_l_per_100km_baseline);
  }
  if (v.vehicle_status) {
    body.vehicle_status = v.vehicle_status;
  }
  return body;
}

function VehicleForm({
  mode,
  initial,
  onSubmit,
  submitting,
  submitLabel,
  error,
  disabled,
}: {
  mode: 'create' | 'edit';
  initial?: VehicleFormValues;
  onSubmit: (values: VehicleFormValues) => void;
  submitting: boolean;
  submitLabel: string;
  error: string | null;
  disabled?: boolean;
}) {
  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, submitCount },
  } = useForm<VehicleFormValues>({
    mode: 'onSubmit',
    defaultValues: initial ?? EMPTY_FORM,
  });

  useScrollToFirstError(errors, submitCount);

  const vehicleStatus = watch('vehicle_status');

  /**
   * Validación cliente: la patente es la única regla compleja.
   * Capacidad, tipo, etc. quedan cubiertos por los attributes HTML5
   * (`required`, `min`, `max`). Si el servidor encuentra otros issues
   * vía Zod, los muestra el mutation handler de la mutación (`error` prop).
   */
  function submit(values: VehicleFormValues) {
    const plateResult = chileanPlateSchema.safeParse(values.plate);
    if (!plateResult.success) {
      const message = plateResult.error.issues[0]?.message ?? 'Patente inválida';
      setError('plate', { type: 'manual', message });
      return;
    }
    onSubmit(values);
  }

  return (
    <form
      onSubmit={handleSubmit(submit)}
      className="space-y-6 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
      noValidate
    >
      <fieldset disabled={disabled} className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            label="Patente"
            required
            error={errors.plate?.message}
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="text"
                {...register('plate')}
                className={fieldInputClass(!!errors.plate)}
                placeholder="BC·DF·12 o BCDF12"
                maxLength={12}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />
            )}
          />

          <FormField
            label="Tipo de vehículo"
            required
            render={({ id, describedBy }) => (
              <select
                id={id}
                aria-describedby={describedBy}
                {...register('vehicle_type')}
                className={fieldInputClass(!!errors.vehicle_type)}
              >
                {(Object.keys(VEHICLE_TYPE_LABELS) as VehicleType[]).map((t) => (
                  <option key={t} value={t}>
                    {VEHICLE_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            )}
          />

          <FormField
            label="Capacidad (kg)"
            required
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="number"
                min={1}
                max={100_000}
                {...register('capacity_kg')}
                className={fieldInputClass(!!errors.capacity_kg)}
              />
            )}
          />

          <FormField
            label="Capacidad (m³)"
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="number"
                min={1}
                max={500}
                {...register('capacity_m3')}
                className={fieldInputClass(!!errors.capacity_m3)}
              />
            )}
          />

          <FormField
            label="Año"
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="number"
                min={1980}
                max={2100}
                {...register('year')}
                className={fieldInputClass(!!errors.year)}
              />
            )}
          />

          <FormField
            label="Combustible"
            render={({ id, describedBy }) => (
              <select
                id={id}
                aria-describedby={describedBy}
                {...register('fuel_type')}
                className={fieldInputClass(!!errors.fuel_type)}
              >
                <option value="">— Sin especificar —</option>
                {(Object.keys(FUEL_TYPE_LABELS) as FuelType[]).map((f) => (
                  <option key={f} value={f}>
                    {FUEL_TYPE_LABELS[f]}
                  </option>
                ))}
              </select>
            )}
          />

          <FormField
            label="Marca"
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="text"
                {...register('brand')}
                className={fieldInputClass(!!errors.brand)}
                maxLength={50}
              />
            )}
          />

          <FormField
            label="Modelo"
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="text"
                {...register('model')}
                className={fieldInputClass(!!errors.model)}
                maxLength={100}
              />
            )}
          />
        </div>

        <details className="rounded-md border border-neutral-200 p-3">
          <summary className="cursor-pointer font-medium text-neutral-700 text-sm">
            Datos avanzados (huella de carbono)
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              label="Peso vacío (kg)"
              render={({ id, describedBy }) => (
                <input
                  id={id}
                  aria-describedby={describedBy}
                  type="number"
                  min={1}
                  max={50_000}
                  {...register('curb_weight_kg')}
                  className={fieldInputClass(!!errors.curb_weight_kg)}
                />
              )}
            />
            <FormField
              label="Consumo base (L / 100 km)"
              render={({ id, describedBy }) => (
                <input
                  id={id}
                  aria-describedby={describedBy}
                  type="number"
                  step="0.01"
                  min={0.1}
                  max={99.99}
                  {...register('consumption_l_per_100km_baseline')}
                  className={fieldInputClass(!!errors.consumption_l_per_100km_baseline)}
                />
              )}
            />
          </div>
        </details>

        {mode === 'edit' && vehicleStatus && (
          <FormField
            label="Estado"
            render={({ id, describedBy }) => (
              <select
                id={id}
                aria-describedby={describedBy}
                {...register('vehicle_status')}
                className={fieldInputClass(!!errors.vehicle_status)}
              >
                {(Object.keys(STATUS_LABELS) as VehicleStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            )}
          />
        )}

        {error && (
          <div className="rounded-md border border-danger-200 bg-danger-50 p-3 text-danger-700 text-sm">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Link
            to="/app/vehiculos"
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
              {submitting ? 'Guardando…' : submitLabel}
            </button>
          )}
        </div>
      </fieldset>
    </form>
  );
}

// =============================================================================
// Layout vive en components/Layout.tsx (BUG-003) — antes estaba duplicado
// inline acá y en cargas.tsx.
// =============================================================================

function NoPermission() {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="font-semibold text-neutral-900 text-xl">Sin permisos</h2>
      <p className="mt-2 text-neutral-600 text-sm">
        Solo dueños, administradores y despachadores pueden modificar vehículos.
      </p>
      <Link to="/app/vehiculos" className="mt-4 inline-block text-primary-600 underline">
        Volver a la lista
      </Link>
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

// D3 — Las antiguas secciones UbicacionSection y TelemetriaSection vivían acá
// y mostraban el mapa hero + el histórico de telemetría dentro del form de
// edición del vehículo. Esto rompía el principio "una página, una intención":
// editar vs trackear. Se movieron a /app/flota (mapa multi-vehículo) y al
// modo Uber /app/vehiculos/:id/live (single-vehicle full-screen). Esta página
// quedó pure-edit.
