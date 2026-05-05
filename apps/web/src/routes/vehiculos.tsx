import {
  chileanPlateSchema,
  formatPlateForDisplay,
  normalizePlate,
} from '@booster-ai/shared-schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import {
  ArrowLeft,
  ExternalLink,
  MapPin,
  Navigation,
  Pencil,
  Plus,
  Trash2,
  Truck,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { VehicleMap } from '../components/map/VehicleMap.js';
import type { MeResponse } from '../hooks/use-me.js';
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
                    <Td className="font-mono font-semibold text-neutral-900">
                      {formatPlateForDisplay(v.plate)}
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
                      <Link
                        to="/app/vehiculos/$id"
                        params={{ id: v.id }}
                        className="inline-flex items-center gap-1 text-primary-600 text-sm hover:underline"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                        {canWrite ? 'Editar' : 'Ver'}
                      </Link>
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
                  <span className="font-mono font-semibold text-neutral-900">
                    {formatPlateForDisplay(v.plate)}
                  </span>
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
                <div className="mt-4 flex justify-end">
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
        <div className="flex items-center gap-3">
          <Link to="/app/vehiculos" className="text-neutral-500 hover:text-neutral-900">
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Link>
          <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">
            {vehicleQ.data?.plate ? formatPlateForDisplay(vehicleQ.data.plate) : 'Vehículo'}
          </h1>
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
          {/* Banner Teltonika + CTA "Ver en vivo" */}
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

          {/* HERO: ubicación actual del vehículo (prioritario, no secundario) */}
          {vehicleQ.data.teltonika_imei && (
            <UbicacionSection
              vehicleId={vehicleQ.data.id}
              plate={vehicleQ.data.plate}
              height={480}
              hero
            />
          )}

          {/* Edición del vehículo (después del mapa, no antes) */}
          <div className="mt-8">
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

          {/* Histórico de telemetría — al final */}
          {vehicleQ.data.teltonika_imei && <TelemetriaSection vehicleId={vehicleQ.data.id} />}
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
  const [values, setValues] = useState<VehicleFormValues>(initial ?? EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof VehicleFormValues, string>>>(
    {},
  );

  function update<K extends keyof VehicleFormValues>(key: K, val: VehicleFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: val }));
    // Limpia el error del field al editarlo — feedback positivo sin
    // re-validar todo el form en cada keystroke.
    setFieldErrors((prev) => {
      if (!prev[key]) {
        return prev;
      }
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // Validación cliente: la patente es la única regla compleja. Capacidad,
    // tipo, etc. quedan cubiertos por los attributes HTML5 (`required`,
    // `min`, `max`). Si el servidor encuentra otros issues vía Zod, los
    // muestra el mutation handler de la mutación (`error` prop).
    const plateResult = chileanPlateSchema.safeParse(values.plate);
    if (!plateResult.success) {
      const message = plateResult.error.issues[0]?.message ?? 'Patente inválida';
      setFieldErrors({ plate: message });
      return;
    }
    setFieldErrors({});
    onSubmit(values);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-6 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
    >
      <fieldset disabled={disabled} className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Patente *" htmlFor="plate" error={fieldErrors.plate}>
            <input
              id="plate"
              type="text"
              required
              value={values.plate}
              onChange={(e) => update('plate', e.target.value)}
              className={inputClass}
              placeholder="BC·DF·12 o BCDF12"
              maxLength={12}
              aria-invalid={fieldErrors.plate ? true : undefined}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
          </Field>

          <Field label="Tipo de vehículo *" htmlFor="vehicle_type">
            <select
              id="vehicle_type"
              required
              value={values.vehicle_type}
              onChange={(e) => update('vehicle_type', e.target.value as VehicleType)}
              className={inputClass}
            >
              {(Object.keys(VEHICLE_TYPE_LABELS) as VehicleType[]).map((t) => (
                <option key={t} value={t}>
                  {VEHICLE_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Capacidad (kg) *" htmlFor="capacity_kg">
            <input
              id="capacity_kg"
              type="number"
              min={1}
              max={100_000}
              required
              value={values.capacity_kg}
              onChange={(e) => update('capacity_kg', e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="Capacidad (m³)" htmlFor="capacity_m3">
            <input
              id="capacity_m3"
              type="number"
              min={1}
              max={500}
              value={values.capacity_m3}
              onChange={(e) => update('capacity_m3', e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="Año" htmlFor="year">
            <input
              id="year"
              type="number"
              min={1980}
              max={2100}
              value={values.year}
              onChange={(e) => update('year', e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="Combustible" htmlFor="fuel_type">
            <select
              id="fuel_type"
              value={values.fuel_type}
              onChange={(e) => update('fuel_type', e.target.value as '' | FuelType)}
              className={inputClass}
            >
              <option value="">— Sin especificar —</option>
              {(Object.keys(FUEL_TYPE_LABELS) as FuelType[]).map((f) => (
                <option key={f} value={f}>
                  {FUEL_TYPE_LABELS[f]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Marca" htmlFor="brand">
            <input
              id="brand"
              type="text"
              value={values.brand}
              onChange={(e) => update('brand', e.target.value)}
              className={inputClass}
              maxLength={50}
            />
          </Field>

          <Field label="Modelo" htmlFor="model">
            <input
              id="model"
              type="text"
              value={values.model}
              onChange={(e) => update('model', e.target.value)}
              className={inputClass}
              maxLength={100}
            />
          </Field>
        </div>

        <details className="rounded-md border border-neutral-200 p-3">
          <summary className="cursor-pointer font-medium text-neutral-700 text-sm">
            Datos avanzados (huella de carbono)
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Peso vacío (kg)" htmlFor="curb_weight_kg">
              <input
                id="curb_weight_kg"
                type="number"
                min={1}
                max={50_000}
                value={values.curb_weight_kg}
                onChange={(e) => update('curb_weight_kg', e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Consumo base (L / 100 km)" htmlFor="consumption_l_per_100km_baseline">
              <input
                id="consumption_l_per_100km_baseline"
                type="number"
                step="0.01"
                min={0.1}
                max={99.99}
                value={values.consumption_l_per_100km_baseline}
                onChange={(e) => update('consumption_l_per_100km_baseline', e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
        </details>

        {mode === 'edit' && values.vehicle_status && (
          <Field label="Estado" htmlFor="vehicle_status">
            <select
              id="vehicle_status"
              value={values.vehicle_status}
              onChange={(e) => update('vehicle_status', e.target.value as VehicleStatus)}
              className={inputClass}
            >
              {(Object.keys(STATUS_LABELS) as VehicleStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
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

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  children: ReactNode;
}) {
  const errorId = error ? `${htmlFor}-error` : undefined;
  return (
    <div>
      <label htmlFor={htmlFor} className="block font-medium text-neutral-700 text-sm">
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-danger-600 text-sm">
          {error}
        </p>
      )}
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

// =============================================================================
// Ubicación en mapa — sección dentro de /app/vehiculos/:id
// =============================================================================

interface UbicacionResponse {
  vehicle_id: string;
  plate: string;
  teltonika_imei: string | null;
  ubicacion: {
    timestamp_device: string;
    latitude: number | null;
    longitude: number | null;
    altitude_m: number | null;
    angle_deg: number | null;
    satellites: number | null;
    speed_kmh: number | null;
    priority: number;
  };
}

function UbicacionSection({
  vehicleId,
  plate,
  height = 320,
  hero = false,
}: {
  vehicleId: string;
  plate: string;
  height?: number;
  hero?: boolean;
}) {
  const ubicacionQ = useQuery({
    queryKey: ['vehiculos', vehicleId, 'ubicacion'],
    queryFn: async () => {
      try {
        return await api.get<UbicacionResponse>(`/vehiculos/${vehicleId}/ubicacion`);
      } catch {
        // 404 si no hay puntos aún — devolvemos null y el componente
        // muestra el placeholder amigable.
        return null;
      }
    },
    refetchInterval: 30_000,
  });

  return (
    <section className={hero ? 'mt-2' : 'mt-10'}>
      {!hero && (
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-neutral-900 text-xl">Ubicación actual</h2>
            <p className="text-neutral-600 text-sm">
              Última posición GPS recibida del Teltonika. Polling cada 30s.
            </p>
          </div>
        </div>
      )}
      <div className={hero ? '' : 'mt-4'}>
        <VehicleMap
          plate={plate}
          latitude={ubicacionQ.data?.ubicacion.latitude ?? null}
          longitude={ubicacionQ.data?.ubicacion.longitude ?? null}
          speedKmh={ubicacionQ.data?.ubicacion.speed_kmh ?? null}
          timestampDevice={ubicacionQ.data?.ubicacion.timestamp_device ?? null}
          height={height}
        />
      </div>
    </section>
  );
}

// =============================================================================
// Telemetría reciente — sección dentro de /app/vehiculos/:id
// =============================================================================

interface TelemetryPoint {
  id: string;
  imei: string;
  timestamp_device: string;
  timestamp_received_at: string;
  priority: number;
  longitude: string | null;
  latitude: string | null;
  altitude_m: number | null;
  angle_deg: number | null;
  satellites: number | null;
  speed_kmh: number | null;
  event_io_id: number | null;
}

function TelemetriaSection({ vehicleId }: { vehicleId: string }) {
  const telemetriaQ = useQuery({
    queryKey: ['vehiculos', vehicleId, 'telemetria'],
    queryFn: async () => {
      const res = await api.get<{
        plate: string;
        teltonika_imei: string | null;
        count: number;
        points: TelemetryPoint[];
      }>(`/vehiculos/${vehicleId}/telemetria?limit=50`);
      return res;
    },
    refetchInterval: 30_000,
  });

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-neutral-900 text-xl">Telemetría reciente</h2>
          <p className="text-neutral-600 text-sm">
            Últimos 50 puntos GPS recibidos del Teltonika asociado. Polling cada 30s.
          </p>
        </div>
        {telemetriaQ.data && (
          <span className="rounded-md bg-neutral-100 px-2 py-1 font-medium text-neutral-700 text-xs">
            {telemetriaQ.data.count} puntos
          </span>
        )}
      </div>

      {telemetriaQ.isLoading && <p className="mt-4 text-neutral-500">Cargando…</p>}
      {telemetriaQ.error && <p className="mt-4 text-danger-700">Error al cargar telemetría.</p>}
      {telemetriaQ.data && telemetriaQ.data.points.length === 0 && (
        <div className="mt-4 rounded-md border border-neutral-200 border-dashed bg-white p-6 text-center text-neutral-600 text-sm">
          Aún no se han recibido puntos GPS de este dispositivo. Si recién lo asociaste, los
          primeros packets pueden tardar unos segundos en aparecer.
        </div>
      )}
      {telemetriaQ.data && telemetriaQ.data.points.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-neutral-200">
            <thead className="bg-neutral-50">
              <tr>
                <Th>Hora device</Th>
                <Th>Posición</Th>
                <Th>Velocidad</Th>
                <Th>Altitud</Th>
                <Th>Sat</Th>
                <Th>Prioridad</Th>
                <Th>{''}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 bg-white">
              {telemetriaQ.data.points.map((p) => (
                <tr key={p.id} className="hover:bg-neutral-50">
                  <Td className="font-mono text-xs">
                    {new Date(p.timestamp_device).toLocaleString('es-CL')}
                  </Td>
                  <Td className="font-mono text-xs">
                    {p.latitude && p.longitude
                      ? `${Number.parseFloat(p.latitude).toFixed(5)}, ${Number.parseFloat(p.longitude).toFixed(5)}`
                      : '—'}
                  </Td>
                  <Td>{p.speed_kmh != null ? `${p.speed_kmh} km/h` : '—'}</Td>
                  <Td>{p.altitude_m != null ? `${p.altitude_m} m` : '—'}</Td>
                  <Td>{p.satellites ?? '—'}</Td>
                  <Td>
                    <span
                      className={`inline-flex rounded-md px-2 py-0.5 font-medium text-xs ${
                        p.priority === 2
                          ? 'bg-danger-50 text-danger-700'
                          : p.priority === 1
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-neutral-100 text-neutral-600'
                      }`}
                    >
                      {p.priority === 2 ? 'Pánico' : p.priority === 1 ? 'Alta' : 'Baja'}
                    </span>
                  </Td>
                  <Td>
                    {p.latitude && p.longitude && (
                      <a
                        href={`https://www.google.com/maps?q=${p.latitude},${p.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary-600 text-xs hover:underline"
                      >
                        <MapPin className="h-3.5 w-3.5" aria-hidden />
                        Ver
                        <ExternalLink className="h-3 w-3" aria-hidden />
                      </a>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const inputClass =
  'block w-full rounded-md border border-neutral-300 px-3 py-2 text-neutral-900 text-sm shadow-xs focus:border-primary-500 focus:outline-none';
