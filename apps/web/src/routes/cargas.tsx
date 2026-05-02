import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  CheckCircle2,
  Clock,
  LogOut,
  MapPin,
  Package,
  Plus,
  Settings,
  User as UserIcon,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { signOutUser } from '../hooks/use-auth.js';
import type { MeResponse } from '../hooks/use-me.js';
import { api } from '../lib/api-client.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

// =============================================================================
// Tipos compartidos con el backend
// =============================================================================

type TripStatus =
  | 'borrador'
  | 'esperando_match'
  | 'emparejando'
  | 'ofertas_enviadas'
  | 'asignado'
  | 'en_proceso'
  | 'entregado'
  | 'cancelado'
  | 'expirado';

type CargoType =
  | 'carga_seca'
  | 'perecible'
  | 'refrigerada'
  | 'congelada'
  | 'fragil'
  | 'peligrosa'
  | 'liquida'
  | 'construccion'
  | 'agricola'
  | 'ganado'
  | 'otra';

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

interface TripSummary {
  id: string;
  tracking_code: string;
  status: TripStatus;
  origin_address_raw: string;
  origin_region_code: RegionCode | null;
  destination_address_raw: string;
  destination_region_code: RegionCode | null;
  cargo_type: CargoType;
  cargo_weight_kg: number | null;
  cargo_volume_m3: number | null;
  pickup_window_start: string | null;
  pickup_window_end: string | null;
  proposed_price_clp: number | null;
  created_at: string;
}

interface TripDetail extends TripSummary {
  origin_comuna_code: string | null;
  destination_comuna_code: string | null;
  cargo_description: string | null;
  updated_at: string;
}

interface TripEvent {
  id: string;
  event_type: string;
  source: string;
  payload: Record<string, unknown>;
  recorded_at: string;
}

interface TripAssignment {
  id: string;
  status: string;
  agreed_price_clp: number;
  accepted_at: string;
  picked_up_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  empresa_id: string | null;
  empresa_legal_name: string | null;
  vehicle_id: string | null;
  vehicle_plate: string | null;
  vehicle_type: string | null;
  driver_user_id: string | null;
  driver_name: string | null;
}

interface TripMetrics {
  distance_km_estimated: string | null;
  distance_km_actual: string | null;
  carbon_emissions_kgco2e_estimated: string | null;
  carbon_emissions_kgco2e_actual: string | null;
  precision_method: string | null;
  glec_version: string | null;
  certificate_pdf_url: string | null;
  certificate_issued_at: string | null;
}

interface TripDetailResponse {
  trip_request: TripDetail;
  events: TripEvent[];
  assignment: TripAssignment | null;
  metrics: TripMetrics | null;
}

// =============================================================================
// Labels y colors
// =============================================================================

const STATUS_LABELS: Record<TripStatus, string> = {
  borrador: 'Borrador',
  esperando_match: 'Buscando transportista',
  emparejando: 'Emparejando',
  ofertas_enviadas: 'Ofertas enviadas',
  asignado: 'Asignado',
  en_proceso: 'En proceso',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
  expirado: 'Sin match',
};

const STATUS_COLORS: Record<TripStatus, string> = {
  borrador: 'bg-neutral-100 text-neutral-600',
  esperando_match: 'bg-amber-50 text-amber-700',
  emparejando: 'bg-amber-50 text-amber-700',
  ofertas_enviadas: 'bg-primary-50 text-primary-700',
  asignado: 'bg-primary-50 text-primary-700',
  en_proceso: 'bg-primary-50 text-primary-700',
  entregado: 'bg-success-50 text-success-700',
  cancelado: 'bg-neutral-100 text-neutral-600',
  expirado: 'bg-neutral-100 text-neutral-600',
};

const CANCELLABLE_STATUSES: TripStatus[] = [
  'borrador',
  'esperando_match',
  'emparejando',
  'ofertas_enviadas',
];

const CARGO_TYPE_LABELS: Record<CargoType, string> = {
  carga_seca: 'Carga seca',
  perecible: 'Perecible',
  refrigerada: 'Refrigerada',
  congelada: 'Congelada',
  fragil: 'Frágil',
  peligrosa: 'Peligrosa',
  liquida: 'Líquida',
  construccion: 'Construcción',
  agricola: 'Agrícola',
  ganado: 'Ganado',
  otra: 'Otra',
};

const REGION_LABELS: Record<RegionCode, string> = {
  XV: 'XV — Arica y Parinacota',
  I: 'I — Tarapacá',
  II: 'II — Antofagasta',
  III: 'III — Atacama',
  IV: 'IV — Coquimbo',
  V: 'V — Valparaíso',
  XIII: 'XIII — Metropolitana',
  VI: 'VI — O’Higgins',
  VII: 'VII — Maule',
  XVI: 'XVI — Ñuble',
  VIII: 'VIII — Biobío',
  IX: 'IX — Araucanía',
  XIV: 'XIV — Los Ríos',
  X: 'X — Los Lagos',
  XI: 'XI — Aysén',
  XII: 'XII — Magallanes',
};

// Orden geográfico Norte → Sur para el select.
const REGION_OPTIONS: RegionCode[] = [
  'XV',
  'I',
  'II',
  'III',
  'IV',
  'V',
  'XIII',
  'VI',
  'VII',
  'XVI',
  'VIII',
  'IX',
  'XIV',
  'X',
  'XI',
  'XII',
];

function regionLabel(code: RegionCode | null | undefined): string {
  if (!code) {
    return '—';
  }
  return REGION_LABELS[code] ?? code;
}

function formatCLP(amount: number | null): string {
  if (amount == null) {
    return '—';
  }
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDateTime(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  return new Date(iso).toLocaleString('es-CL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// =============================================================================
// /app/cargas — lista
// =============================================================================

export function CargasListRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        return <CargasListPage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function CargasListPage({ me }: { me: MeOnboarded }) {
  const isShipper = me.active_membership?.empresa.is_generador_carga ?? false;

  const tripsQ = useQuery({
    queryKey: ['cargas'],
    queryFn: async () => {
      const res = await api.get<{ trip_requests: TripSummary[] }>('/trip-requests-v2');
      return res.trip_requests;
    },
    enabled: isShipper,
  });

  if (!isShipper) {
    return (
      <Layout me={me} title="Cargas">
        <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-neutral-900 text-xl">Sin permisos</h2>
          <p className="mt-2 text-neutral-600 text-sm">
            Esta sección es solo para empresas que operan como generador de carga.
          </p>
          <Link to="/app" className="mt-4 inline-block text-primary-600 underline">
            Volver al inicio
          </Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout me={me} title="Cargas">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">Mis cargas</h1>
          <p className="mt-1 text-neutral-600 text-sm">
            Crea cargas, sigue el estado del matching y recibe certificados de huella de carbono.
          </p>
        </div>
        <Link
          to="/app/cargas/nueva"
          className="flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white shadow-xs transition hover:bg-primary-700"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Nueva carga
        </Link>
      </div>

      {tripsQ.isLoading && <p className="mt-6 text-neutral-500">Cargando…</p>}
      {tripsQ.error && <p className="mt-6 text-danger-700">Error al cargar cargas.</p>}

      {tripsQ.data && tripsQ.data.length === 0 && (
        <div className="mt-6 rounded-md border border-neutral-200 border-dashed bg-white p-10 text-center">
          <Package className="mx-auto h-10 w-10 text-neutral-400" aria-hidden />
          <p className="mt-3 font-medium text-neutral-900">Aún no tienes cargas</p>
          <p className="mt-1 text-neutral-600 text-sm">
            Crea tu primera carga para que el matching engine te conecte con transportistas
            disponibles.
          </p>
          <Link
            to="/app/cargas/nueva"
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Crear carga
          </Link>
        </div>
      )}

      {tripsQ.data && tripsQ.data.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-neutral-200">
            <thead className="bg-neutral-50">
              <tr>
                <Th>Código</Th>
                <Th>Origen → Destino</Th>
                <Th>Carga</Th>
                <Th>Pickup</Th>
                <Th>Estado</Th>
                <Th>{''}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 bg-white">
              {tripsQ.data.map((t) => (
                <tr key={t.id} className="hover:bg-neutral-50">
                  <Td className="font-mono font-semibold text-neutral-900">{t.tracking_code}</Td>
                  <Td>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm">{t.origin_address_raw}</span>
                      <span className="text-neutral-500 text-xs">
                        {regionLabel(t.origin_region_code)}
                      </span>
                      <span className="mt-1 text-sm">→ {t.destination_address_raw}</span>
                      <span className="text-neutral-500 text-xs">
                        {regionLabel(t.destination_region_code)}
                      </span>
                    </div>
                  </Td>
                  <Td>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm">{CARGO_TYPE_LABELS[t.cargo_type]}</span>
                      <span className="text-neutral-500 text-xs">
                        {t.cargo_weight_kg
                          ? `${t.cargo_weight_kg.toLocaleString('es-CL')} kg`
                          : '—'}
                        {t.cargo_volume_m3 ? ` · ${t.cargo_volume_m3} m³` : ''}
                      </span>
                    </div>
                  </Td>
                  <Td>
                    <span className="text-xs">{formatDateTime(t.pickup_window_start)}</span>
                  </Td>
                  <Td>
                    <span
                      className={`inline-flex rounded-md px-2 py-0.5 font-medium text-xs ${STATUS_COLORS[t.status]}`}
                    >
                      {STATUS_LABELS[t.status]}
                    </span>
                  </Td>
                  <Td>
                    <Link
                      to="/app/cargas/$id"
                      params={{ id: t.id }}
                      className="inline-flex items-center gap-1 text-primary-600 text-sm hover:underline"
                    >
                      Ver
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
}

// =============================================================================
// /app/cargas/nueva — crear
// =============================================================================

export function CargasNuevoRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        const isShipper = ctx.me.active_membership?.empresa.is_generador_carga ?? false;
        if (!isShipper) {
          return (
            <Layout me={ctx.me} title="Nueva carga">
              <NoShipperPermission />
            </Layout>
          );
        }
        return <CargaNuevaPage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

interface TripFormValues {
  origin_address_raw: string;
  origin_region_code: RegionCode | '';
  destination_address_raw: string;
  destination_region_code: RegionCode | '';
  cargo_type: CargoType;
  cargo_weight_kg: string;
  cargo_volume_m3: string;
  cargo_description: string;
  pickup_start_local: string;
  pickup_end_local: string;
  proposed_price_clp: string;
}

const EMPTY_FORM: TripFormValues = {
  origin_address_raw: '',
  origin_region_code: '',
  destination_address_raw: '',
  destination_region_code: '',
  cargo_type: 'carga_seca',
  cargo_weight_kg: '',
  cargo_volume_m3: '',
  cargo_description: '',
  pickup_start_local: '',
  pickup_end_local: '',
  proposed_price_clp: '',
};

function tripFormToBody(v: TripFormValues): Record<string, unknown> {
  return {
    origin: {
      address_raw: v.origin_address_raw.trim(),
      region_code: v.origin_region_code,
    },
    destination: {
      address_raw: v.destination_address_raw.trim(),
      region_code: v.destination_region_code,
    },
    cargo: {
      cargo_type: v.cargo_type,
      weight_kg: Number.parseInt(v.cargo_weight_kg, 10),
      ...(v.cargo_volume_m3.trim() ? { volume_m3: Number.parseInt(v.cargo_volume_m3, 10) } : {}),
      ...(v.cargo_description.trim() ? { description: v.cargo_description.trim() } : {}),
    },
    pickup_window: {
      // datetime-local devuelve "YYYY-MM-DDTHH:MM" sin TZ. Lo convertimos a
      // ISO 8601 UTC vía Date (asume hora local del browser).
      start_at: new Date(v.pickup_start_local).toISOString(),
      end_at: new Date(v.pickup_end_local).toISOString(),
    },
    proposed_price_clp: v.proposed_price_clp.trim()
      ? Number.parseInt(v.proposed_price_clp, 10)
      : null,
  };
}

function CargaNuevaPage({ me }: { me: MeOnboarded }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: async (input: TripFormValues) => {
      return await api.post<{ trip_request: { id: string } }>(
        '/trip-requests-v2',
        tripFormToBody(input),
      );
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['cargas'] });
      void navigate({ to: '/app/cargas/$id', params: { id: res.trip_request.id } });
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <Layout me={me} title="Nueva carga">
      <div className="mb-6 flex items-center gap-3">
        <Link to="/app/cargas" className="text-neutral-500 hover:text-neutral-900">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">Nueva carga</h1>
      </div>

      <TripForm
        onSubmit={(values) => {
          setError(null);
          createM.mutate(values);
        }}
        submitting={createM.isPending}
        error={error}
      />
    </Layout>
  );
}

function TripForm({
  onSubmit,
  submitting,
  error,
}: {
  onSubmit: (v: TripFormValues) => void;
  submitting: boolean;
  error: string | null;
}) {
  const [values, setValues] = useState<TripFormValues>(EMPTY_FORM);

  function update<K extends keyof TripFormValues>(key: K, val: TripFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: val }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit(values);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-8 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
    >
      <section>
        <h2 className="font-semibold text-lg text-neutral-900">Origen</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Dirección de recogida *" htmlFor="origin_address_raw">
            <input
              id="origin_address_raw"
              type="text"
              required
              value={values.origin_address_raw}
              onChange={(e) => update('origin_address_raw', e.target.value)}
              className={inputClass}
              placeholder="Av. Apoquindo 5550, Las Condes"
              maxLength={500}
            />
          </Field>
          <Field label="Región *" htmlFor="origin_region_code">
            <select
              id="origin_region_code"
              required
              value={values.origin_region_code}
              onChange={(e) => update('origin_region_code', e.target.value as RegionCode | '')}
              className={inputClass}
            >
              <option value="">— Seleccionar —</option>
              {REGION_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {REGION_LABELS[r]}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      <section>
        <h2 className="font-semibold text-lg text-neutral-900">Destino</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Dirección de entrega *" htmlFor="destination_address_raw">
            <input
              id="destination_address_raw"
              type="text"
              required
              value={values.destination_address_raw}
              onChange={(e) => update('destination_address_raw', e.target.value)}
              className={inputClass}
              placeholder="Concepción centro"
              maxLength={500}
            />
          </Field>
          <Field label="Región *" htmlFor="destination_region_code">
            <select
              id="destination_region_code"
              required
              value={values.destination_region_code}
              onChange={(e) => update('destination_region_code', e.target.value as RegionCode | '')}
              className={inputClass}
            >
              <option value="">— Seleccionar —</option>
              {REGION_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {REGION_LABELS[r]}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      <section>
        <h2 className="font-semibold text-lg text-neutral-900">Carga</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Tipo de carga *" htmlFor="cargo_type">
            <select
              id="cargo_type"
              required
              value={values.cargo_type}
              onChange={(e) => update('cargo_type', e.target.value as CargoType)}
              className={inputClass}
            >
              {(Object.keys(CARGO_TYPE_LABELS) as CargoType[]).map((t) => (
                <option key={t} value={t}>
                  {CARGO_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Peso (kg) *" htmlFor="cargo_weight_kg">
            <input
              id="cargo_weight_kg"
              type="number"
              min={1}
              max={100_000}
              required
              value={values.cargo_weight_kg}
              onChange={(e) => update('cargo_weight_kg', e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Volumen (m³)" htmlFor="cargo_volume_m3">
            <input
              id="cargo_volume_m3"
              type="number"
              min={1}
              max={200}
              value={values.cargo_volume_m3}
              onChange={(e) => update('cargo_volume_m3', e.target.value)}
              className={inputClass}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Descripción" htmlFor="cargo_description">
              <textarea
                id="cargo_description"
                rows={2}
                value={values.cargo_description}
                onChange={(e) => update('cargo_description', e.target.value)}
                className={inputClass}
                maxLength={1000}
                placeholder="Detalles relevantes para el transportista (opcional)"
              />
            </Field>
          </div>
        </div>
      </section>

      <section>
        <h2 className="font-semibold text-lg text-neutral-900">Ventana de pickup</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Desde *" htmlFor="pickup_start_local">
            <input
              id="pickup_start_local"
              type="datetime-local"
              required
              value={values.pickup_start_local}
              onChange={(e) => update('pickup_start_local', e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Hasta *" htmlFor="pickup_end_local">
            <input
              id="pickup_end_local"
              type="datetime-local"
              required
              value={values.pickup_end_local}
              onChange={(e) => update('pickup_end_local', e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
      </section>

      <section>
        <h2 className="font-semibold text-lg text-neutral-900">Precio</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Precio sugerido (CLP)" htmlFor="proposed_price_clp">
            <input
              id="proposed_price_clp"
              type="number"
              min={0}
              value={values.proposed_price_clp}
              onChange={(e) => update('proposed_price_clp', e.target.value)}
              className={inputClass}
              placeholder="Dejar vacío si querés que pricing-engine sugiera"
            />
          </Field>
        </div>
      </section>

      {error && (
        <div className="rounded-md border border-danger-200 bg-danger-50 p-3 text-danger-700 text-sm">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Link
          to="/app/cargas"
          className="rounded-md border border-neutral-300 px-4 py-2 font-medium text-neutral-700 text-sm hover:bg-neutral-100"
        >
          Cancelar
        </Link>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {submitting ? 'Creando…' : 'Crear carga'}
        </button>
      </div>
    </form>
  );
}

// =============================================================================
// /app/cargas/:id — detalle + cancel
// =============================================================================

export function CargasDetalleRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        return <CargaDetallePage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function CargaDetallePage({ me }: { me: MeOnboarded }) {
  const { id } = useParams({ strict: false }) as { id: string };
  const queryClient = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const tripQ = useQuery({
    queryKey: ['cargas', id],
    queryFn: async () => {
      return await api.get<TripDetailResponse>(`/trip-requests-v2/${id}`);
    },
    refetchInterval: 30_000,
  });

  const cancelM = useMutation({
    mutationFn: async () => {
      return await api.patch<{ trip_request: { status: string } }>(
        `/trip-requests-v2/${id}/cancelar`,
        cancelReason.trim() ? { reason: cancelReason.trim() } : {},
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cargas'] });
      queryClient.invalidateQueries({ queryKey: ['cargas', id] });
      setConfirmCancel(false);
      setCancelReason('');
    },
    onError: (err: Error) => setError(err.message),
  });

  const trip = tripQ.data?.trip_request;
  const canCancel = trip ? CANCELLABLE_STATUSES.includes(trip.status) : false;

  return (
    <Layout me={me} title="Detalle carga">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/app/cargas" className="text-neutral-500 hover:text-neutral-900">
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Link>
          <div>
            <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">
              {trip?.tracking_code ?? 'Carga'}
            </h1>
            {trip && (
              <span
                className={`mt-1 inline-flex rounded-md px-2 py-0.5 font-medium text-xs ${STATUS_COLORS[trip.status]}`}
              >
                {STATUS_LABELS[trip.status]}
              </span>
            )}
          </div>
        </div>
        {canCancel && trip && (
          <div className="flex items-center gap-2">
            {confirmCancel ? null : (
              <button
                type="button"
                onClick={() => setConfirmCancel(true)}
                className="flex items-center gap-1 rounded-md border border-danger-300 px-3 py-1.5 text-danger-700 text-sm hover:bg-danger-50"
              >
                <Ban className="h-4 w-4" aria-hidden />
                Cancelar carga
              </button>
            )}
          </div>
        )}
      </div>

      {tripQ.isLoading && <p className="text-neutral-500">Cargando…</p>}
      {tripQ.error && <p className="text-danger-700">Error al cargar la carga.</p>}

      {confirmCancel && trip && (
        <div className="mb-6 rounded-lg border border-danger-200 bg-danger-50 p-4">
          <h3 className="font-semibold text-danger-900 text-sm">¿Cancelar esta carga?</h3>
          <p className="mt-1 text-danger-800 text-sm">
            Acción irreversible. El matching engine deja de buscar transportistas y la carga queda
            en estado "Cancelado".
          </p>
          <div className="mt-3">
            <label htmlFor="cancel_reason" className="block font-medium text-danger-900 text-sm">
              Motivo (opcional)
            </label>
            <input
              id="cancel_reason"
              type="text"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              className={`${inputClass} mt-1`}
              placeholder="Ej: cambio de planes, dirección incorrecta…"
              maxLength={500}
            />
          </div>
          {error && <p className="mt-2 text-danger-700 text-sm">{error}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirmCancel(false);
                setCancelReason('');
                setError(null);
              }}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-neutral-700 text-sm hover:bg-neutral-100"
            >
              Volver
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                cancelM.mutate();
              }}
              disabled={cancelM.isPending}
              className="rounded-md bg-danger-600 px-3 py-1.5 text-sm text-white hover:bg-danger-700 disabled:opacity-50"
            >
              {cancelM.isPending ? 'Cancelando…' : 'Sí, cancelar carga'}
            </button>
          </div>
        </div>
      )}

      {tripQ.data && trip && (
        <div className="space-y-6">
          <DataCard title="Origen y destino">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <DataRow icon={<MapPin className="h-4 w-4" aria-hidden />} label="Origen">
                <div className="text-sm">{trip.origin_address_raw}</div>
                <div className="text-neutral-500 text-xs">
                  {regionLabel(trip.origin_region_code)}
                </div>
              </DataRow>
              <DataRow icon={<MapPin className="h-4 w-4" aria-hidden />} label="Destino">
                <div className="text-sm">{trip.destination_address_raw}</div>
                <div className="text-neutral-500 text-xs">
                  {regionLabel(trip.destination_region_code)}
                </div>
              </DataRow>
            </div>
          </DataCard>

          <DataCard title="Carga">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <DataRow icon={<Package className="h-4 w-4" aria-hidden />} label="Tipo">
                {CARGO_TYPE_LABELS[trip.cargo_type]}
              </DataRow>
              <DataRow icon={<Package className="h-4 w-4" aria-hidden />} label="Peso">
                {trip.cargo_weight_kg ? `${trip.cargo_weight_kg.toLocaleString('es-CL')} kg` : '—'}
              </DataRow>
              <DataRow icon={<Package className="h-4 w-4" aria-hidden />} label="Volumen">
                {trip.cargo_volume_m3 ? `${trip.cargo_volume_m3} m³` : '—'}
              </DataRow>
              {trip.cargo_description && (
                <div className="sm:col-span-3">
                  <p className="font-medium text-neutral-700 text-xs uppercase tracking-wider">
                    Descripción
                  </p>
                  <p className="mt-1 text-neutral-800 text-sm">{trip.cargo_description}</p>
                </div>
              )}
            </div>
          </DataCard>

          <DataCard title="Ventana de pickup">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <DataRow icon={<Clock className="h-4 w-4" aria-hidden />} label="Desde">
                {formatDateTime(trip.pickup_window_start)}
              </DataRow>
              <DataRow icon={<Clock className="h-4 w-4" aria-hidden />} label="Hasta">
                {formatDateTime(trip.pickup_window_end)}
              </DataRow>
            </div>
          </DataCard>

          <DataCard title="Precio">
            <DataRow label="Precio sugerido">
              {trip.proposed_price_clp != null ? formatCLP(trip.proposed_price_clp) : 'Sin sugerir'}
            </DataRow>
          </DataCard>

          {tripQ.data.assignment && (
            <DataCard title="Asignación">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <DataRow label="Transportista">
                  {tripQ.data.assignment.empresa_legal_name ?? '—'}
                </DataRow>
                <DataRow label="Vehículo">{tripQ.data.assignment.vehicle_plate ?? '—'}</DataRow>
                <DataRow label="Precio acordado">
                  {formatCLP(tripQ.data.assignment.agreed_price_clp)}
                </DataRow>
                <DataRow label="Aceptado">
                  {formatDateTime(tripQ.data.assignment.accepted_at)}
                </DataRow>
                {tripQ.data.assignment.driver_name && (
                  <DataRow label="Conductor">{tripQ.data.assignment.driver_name}</DataRow>
                )}
              </div>
            </DataCard>
          )}

          {tripQ.data.metrics && (
            <DataCard title="Métricas ESG">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <DataRow label="Distancia estimada">
                  {tripQ.data.metrics.distance_km_estimated
                    ? `${tripQ.data.metrics.distance_km_estimated} km`
                    : '—'}
                </DataRow>
                <DataRow label="Distancia real">
                  {tripQ.data.metrics.distance_km_actual
                    ? `${tripQ.data.metrics.distance_km_actual} km`
                    : '—'}
                </DataRow>
                <DataRow label="Emisiones estimadas">
                  {tripQ.data.metrics.carbon_emissions_kgco2e_estimated
                    ? `${tripQ.data.metrics.carbon_emissions_kgco2e_estimated} kg CO₂e`
                    : '—'}
                </DataRow>
                <DataRow label="Emisiones reales">
                  {tripQ.data.metrics.carbon_emissions_kgco2e_actual
                    ? `${tripQ.data.metrics.carbon_emissions_kgco2e_actual} kg CO₂e`
                    : '—'}
                </DataRow>
                {tripQ.data.metrics.certificate_pdf_url && (
                  <div className="sm:col-span-2">
                    <a
                      href={tripQ.data.metrics.certificate_pdf_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary-600 text-sm hover:underline"
                    >
                      <CheckCircle2 className="h-4 w-4" aria-hidden />
                      Ver certificado PDF
                    </a>
                  </div>
                )}
              </div>
            </DataCard>
          )}

          {tripQ.data.events.length > 0 && (
            <DataCard title="Eventos">
              <ul className="space-y-3">
                {tripQ.data.events.map((ev) => (
                  <li key={ev.id} className="flex items-start gap-3">
                    <div className="mt-1 h-2 w-2 rounded-full bg-primary-500" aria-hidden />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-neutral-900 text-sm">
                          {ev.event_type.replace(/_/g, ' ')}
                        </span>
                        <span className="text-neutral-500 text-xs">
                          {formatDateTime(ev.recorded_at)}
                        </span>
                      </div>
                      <span className="text-neutral-500 text-xs">Origen: {ev.source}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </DataCard>
          )}
        </div>
      )}
    </Layout>
  );
}

// =============================================================================
// Componentes auxiliares (Layout, Field, Th, Td, DataCard, DataRow)
// =============================================================================

function Layout({
  me,
  title: _title,
  children,
}: {
  me: MeOnboarded;
  title: string;
  children: ReactNode;
}) {
  const activeEmpresa = me.active_membership?.empresa;
  async function handleSignOut() {
    await signOutUser();
  }
  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <header className="border-neutral-200 border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <Link to="/app" className="flex items-center gap-3">
              <div className="h-6 w-6 rounded-md bg-primary-500" aria-hidden />
              <span className="font-semibold text-lg text-neutral-900">Booster AI</span>
            </Link>
            {activeEmpresa && (
              <span className="ml-3 rounded-md bg-neutral-100 px-2 py-1 font-medium text-neutral-700 text-xs">
                {activeEmpresa.legal_name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/app/perfil"
              className="flex items-center gap-2 rounded-md px-2 py-1 text-neutral-700 text-sm transition hover:bg-neutral-100"
            >
              <UserIcon className="h-4 w-4" aria-hidden />
              <span>{me.user.full_name}</span>
              <Settings className="h-3.5 w-3.5 text-neutral-400" aria-hidden />
            </Link>
            <button
              type="button"
              onClick={handleSignOut}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-neutral-600 text-sm transition hover:bg-neutral-100"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              Salir
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-6 py-10">{children}</div>
      </main>
    </div>
  );
}

function NoShipperPermission() {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="font-semibold text-neutral-900 text-xl">Sin permisos</h2>
      <p className="mt-2 text-neutral-600 text-sm">
        Solo empresas que operan como generador de carga pueden crear y ver cargas.
      </p>
      <Link to="/app" className="mt-4 inline-block text-primary-600 underline">
        Volver al inicio
      </Link>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block font-medium text-neutral-700 text-sm">
        {label}
      </label>
      <div className="mt-1">{children}</div>
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

function DataCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="font-semibold text-base text-neutral-900">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function DataRow({
  icon,
  label,
  children,
}: {
  icon?: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 font-medium text-neutral-700 text-xs uppercase tracking-wider">
        {icon && <span className="text-neutral-400">{icon}</span>}
        {label}
      </div>
      <div className="mt-1 text-neutral-800 text-sm">{children}</div>
    </div>
  );
}

const inputClass =
  'block w-full rounded-md border border-neutral-300 px-3 py-2 text-neutral-900 text-sm shadow-xs focus:border-primary-500 focus:outline-none';
