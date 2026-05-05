import { tripRequestCreateInputSchema } from '@booster-ai/shared-schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  Clock,
  Download,
  MapPin,
  Navigation,
  Package,
  Plus,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useForm } from 'react-hook-form';
import { FormField, inputClass as fieldInputClass } from '../components/FormField.js';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { RelativeTime } from '../components/RelativeTime.js';
import { VehicleMap } from '../components/map/VehicleMap.js';
import type { MeResponse } from '../hooks/use-me.js';
import { useScrollToFirstError } from '../hooks/use-scroll-to-first-error.js';
import { api } from '../lib/api-client.js';
import {
  CertDisabledError,
  CertNotIssuedError,
  descargarCertificadoDeViaje,
} from '../lib/cert-download.js';

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
  /** ISO string si el certificado de carbono ya fue emitido, sino null. */
  certificate_issued_at: string | null;
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
  /**
   * Última posición GPS del vehículo asignado (si tiene Teltonika y ya
   * reportó al menos un packet). Null si el vehículo no tiene Teltonika
   * o todavía no se recibió ningún punto.
   */
  ubicacion_actual: {
    timestamp_device: string;
    latitude: number | null;
    longitude: number | null;
    speed_kmh: number | null;
    angle_deg: number | null;
  } | null;
}

interface TripMetrics {
  distance_km_estimated: string | null;
  distance_km_actual: string | null;
  carbon_emissions_kgco2e_estimated: string | null;
  carbon_emissions_kgco2e_actual: string | null;
  precision_method: string | null;
  glec_version: string | null;
  certificate_pdf_url: string | null;
  certificate_sha256: string | null;
  certificate_kms_key_version: string | null;
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

      {tripsQ.data &&
        (() => {
          // Split por estado: lo que sigue activo (shipper espera/seguimiento) vs
          // historial (terminado, cancelado, sin match). Sin esto, el listado
          // mezcla cargas vivas con basura vieja y se vuelve ruidoso a las
          // pocas semanas de uso.
          const ACTIVE_STATUSES = new Set<TripStatus>([
            'borrador',
            'esperando_match',
            'emparejando',
            'ofertas_enviadas',
            'asignado',
            'en_proceso',
          ]);
          const activas = tripsQ.data.filter((t) => ACTIVE_STATUSES.has(t.status));
          const historial = tripsQ.data.filter((t) => !ACTIVE_STATUSES.has(t.status));

          return (
            <>
              <section className="mt-6">
                <h2 className="font-semibold text-lg text-neutral-900">Cargas activas</h2>
                <p className="mt-1 text-neutral-500 text-xs">
                  En búsqueda de transportista, asignadas o en ruta.
                </p>
                {activas.length === 0 ? (
                  <div className="mt-3 rounded-md border border-neutral-200 border-dashed bg-white p-10 text-center">
                    <Package className="mx-auto h-10 w-10 text-neutral-400" aria-hidden />
                    <p className="mt-3 font-medium text-neutral-900">No tienes cargas activas</p>
                    <p className="mt-1 text-neutral-600 text-sm">
                      Crea una carga para que el sistema te conecte con transportistas disponibles.
                    </p>
                    <Link
                      to="/app/cargas/nueva"
                      className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white"
                    >
                      <Plus className="h-4 w-4" aria-hidden />
                      Crear carga
                    </Link>
                  </div>
                ) : (
                  <CargasTable trips={activas} />
                )}
              </section>

              {historial.length > 0 && (
                <section className="mt-10">
                  <h2 className="font-semibold text-lg text-neutral-900">Historial</h2>
                  <p className="mt-1 text-neutral-500 text-xs">
                    Cargas entregadas, canceladas o sin asignación.
                  </p>
                  <div className="mt-3">
                    <CargasTable trips={historial} showCertificateColumn />
                  </div>
                </section>
              )}
            </>
          );
        })()}
    </Layout>
  );
}

function CargasTable({
  trips,
  showCertificateColumn = false,
}: { trips: TripSummary[]; showCertificateColumn?: boolean }) {
  return (
    <>
      {/* Desktop (md+): tabla densa. Oculta en mobile porque las 6 columnas
          no entran a 375px y hacen overflow horizontal (BUG-006). */}
      <div className="hidden overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm md:block">
        <table className="min-w-full divide-y divide-neutral-200">
          <thead className="bg-neutral-50">
            <tr>
              <Th>Código</Th>
              <Th>Origen → Destino</Th>
              <Th>Carga</Th>
              <Th>Pickup</Th>
              <Th>Estado</Th>
              {showCertificateColumn && <Th>Certificado</Th>}
              <Th>{''}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 bg-white">
            {trips.map((t) => (
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
                      {t.cargo_weight_kg ? `${t.cargo_weight_kg.toLocaleString('es-CL')} kg` : '—'}
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
                {showCertificateColumn && (
                  <Td>
                    {t.certificate_issued_at ? (
                      <DescargarCertificadoButton tripId={t.id} compact />
                    ) : t.status === 'entregado' ? (
                      <span className="text-amber-700 text-xs">Generando…</span>
                    ) : (
                      <span className="text-neutral-400 text-xs">—</span>
                    )}
                  </Td>
                )}
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

      {/* Mobile (<md): cards apiladas. Mismo dato, layout vertical para
          eliminar overflow horizontal y aprovechar el ancho del viewport.
          NO envolvemos el card entero en <Link> porque el botón
          "Descargar certificado" anidado generaría doble click handler. */}
      <ul className="space-y-3 md:hidden">
        {trips.map((t) => (
          <li key={t.id} className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <span className="font-mono font-semibold text-neutral-900 text-sm">
                {t.tracking_code}
              </span>
              <span
                className={`shrink-0 rounded-md px-2 py-0.5 font-medium text-xs ${STATUS_COLORS[t.status]}`}
              >
                {STATUS_LABELS[t.status]}
              </span>
            </div>
            <div className="mt-3 space-y-1 text-sm">
              <p className="text-neutral-800">{t.origin_address_raw}</p>
              <p className="text-neutral-500 text-xs">{regionLabel(t.origin_region_code)}</p>
              <p className="mt-1 text-neutral-800">→ {t.destination_address_raw}</p>
              <p className="text-neutral-500 text-xs">{regionLabel(t.destination_region_code)}</p>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-neutral-500 text-xs">
              <span>{CARGO_TYPE_LABELS[t.cargo_type]}</span>
              {t.cargo_weight_kg != null && (
                <>
                  <span aria-hidden>·</span>
                  <span>{t.cargo_weight_kg.toLocaleString('es-CL')} kg</span>
                </>
              )}
              {t.cargo_volume_m3 != null && (
                <>
                  <span aria-hidden>·</span>
                  <span>{t.cargo_volume_m3} m³</span>
                </>
              )}
              <span aria-hidden>·</span>
              <span>{formatDateTime(t.pickup_window_start)}</span>
            </div>
            <div className="mt-4 flex items-center justify-between gap-2">
              {showCertificateColumn && t.certificate_issued_at ? (
                <DescargarCertificadoButton tripId={t.id} compact />
              ) : showCertificateColumn && !t.certificate_issued_at && t.status === 'entregado' ? (
                <span className="text-amber-700 text-xs">Certificado generándose…</span>
              ) : (
                <span />
              )}
              <Link
                to="/app/cargas/$id"
                params={{ id: t.id }}
                className="inline-flex items-center gap-1 rounded-md bg-primary-50 px-3 py-1.5 font-medium text-primary-700 text-sm transition hover:bg-primary-100"
              >
                Ver detalle
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Botón para descargar el PDF del certificado. Pide la signed URL al api
 * y la abre en una pestaña nueva.
 *
 * Variante `compact`: ícono + texto chico para usar en celdas de tabla.
 * Variante normal: botón con borde para usar en cards de detalle.
 */
function DescargarCertificadoButton({
  tripId,
  compact = false,
}: { tripId: string; compact?: boolean }) {
  const downloadM = useMutation({
    mutationFn: descargarCertificadoDeViaje,
    onError: (err) => {
      if (err instanceof CertNotIssuedError) {
        window.alert(
          'El certificado todavía está generándose. Espera unos segundos y reinténtalo.',
        );
      } else if (err instanceof CertDisabledError) {
        window.alert('Los certificados están deshabilitados en este entorno.');
      } else {
        window.alert('No se pudo descargar el certificado. Inténtalo en un momento.');
      }
    },
  });

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => downloadM.mutate(tripId)}
        disabled={downloadM.isPending}
        className="inline-flex items-center gap-1 text-primary-600 text-xs hover:underline disabled:opacity-60"
      >
        <Download className="h-3.5 w-3.5" aria-hidden />
        {downloadM.isPending ? 'Abriendo…' : 'Descargar'}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => downloadM.mutate(tripId)}
      disabled={downloadM.isPending}
      className="inline-flex items-center gap-2 rounded-md border border-primary-200 bg-primary-50 px-3 py-1.5 font-medium text-primary-700 text-sm transition hover:bg-primary-100 disabled:opacity-60"
    >
      <Download className="h-4 w-4" aria-hidden />
      {downloadM.isPending ? 'Abriendo…' : 'Descargar certificado de huella de carbono'}
    </button>
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
      // ISO 8601 UTC vía Date (asume hora local del browser). Si el campo
      // está vacío, `new Date('').toISOString()` lanza — el caller debe
      // chequear antes de invocar este helper o catchear.
      start_at: v.pickup_start_local ? new Date(v.pickup_start_local).toISOString() : '',
      end_at: v.pickup_end_local ? new Date(v.pickup_end_local).toISOString() : '',
    },
    proposed_price_clp: v.proposed_price_clp.trim()
      ? Number.parseInt(v.proposed_price_clp, 10)
      : null,
  };
}

/**
 * Mapeo entre el path de error que devuelve Zod y el `name` del field en el
 * form. El schema usa estructura anidada (`origin.address_raw`) pero el form
 * usa nombres planos (`origin_address_raw`) para simplificar el state.
 */
const SCHEMA_PATH_TO_FIELD: Record<string, keyof TripFormValues> = {
  'origin.address_raw': 'origin_address_raw',
  'origin.region_code': 'origin_region_code',
  'destination.address_raw': 'destination_address_raw',
  'destination.region_code': 'destination_region_code',
  'cargo.cargo_type': 'cargo_type',
  'cargo.weight_kg': 'cargo_weight_kg',
  'cargo.volume_m3': 'cargo_volume_m3',
  'cargo.description': 'cargo_description',
  'pickup_window.start_at': 'pickup_start_local',
  'pickup_window.end_at': 'pickup_end_local',
  proposed_price_clp: 'proposed_price_clp',
};

type TripFieldErrors = Partial<Record<keyof TripFormValues, string>>;

/**
 * Valida el form contra el schema canónico y devuelve errores mapeados al
 * `name` plano del form. Devuelve `null` si todo OK.
 *
 * Esto es defensa en profundidad: el servidor también valida el mismo
 * schema. Pero la validación cliente da feedback inmediato y evita
 * disparar el matching engine con datos basura.
 */
function validateTripForm(v: TripFormValues): TripFieldErrors | null {
  // Si las fechas locales están vacías, marcamos error explícito antes de
  // intentar parsearlas (un `new Date('')` da Invalid Date).
  const earlyErrors: TripFieldErrors = {};
  if (!v.pickup_start_local) {
    earlyErrors.pickup_start_local = 'Selecciona una fecha y hora';
  }
  if (!v.pickup_end_local) {
    earlyErrors.pickup_end_local = 'Selecciona una fecha y hora';
  }
  if (Object.keys(earlyErrors).length > 0) {
    return earlyErrors;
  }

  const body = tripFormToBody(v);
  const result = tripRequestCreateInputSchema.safeParse(body);
  if (result.success) {
    return null;
  }

  const errors: TripFieldErrors = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join('.');
    const field = SCHEMA_PATH_TO_FIELD[path];
    if (field && !errors[field]) {
      errors[field] = issue.message;
    }
  }
  return errors;
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
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, submitCount },
  } = useForm<TripFormValues>({
    mode: 'onSubmit',
    defaultValues: EMPTY_FORM,
  });

  useScrollToFirstError(errors, submitCount);

  /**
   * Validación pre-submit: usa el helper canónico `validateTripForm` que
   * convierte el form a body API y valida contra `tripRequestCreateInputSchema`.
   * Si hay errores, los inyecta a RHF vía `setError` para que cada FormField
   * muestre el mensaje. No se usa zodResolver porque la validación canónica
   * trabaja sobre la estructura ANIDADA del API y necesitaríamos un mapping
   * complejo en superRefine — el helper actual ya hace ese mapping.
   */
  function submit(values: TripFormValues) {
    const fieldErrors = validateTripForm(values);
    if (fieldErrors) {
      for (const [field, message] of Object.entries(fieldErrors)) {
        if (message) {
          setError(field as keyof TripFormValues, { type: 'manual', message });
        }
      }
      return;
    }
    onSubmit(values);
  }

  return (
    <form
      onSubmit={handleSubmit(submit)}
      className="space-y-8 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
      noValidate
    >
      <section>
        <h2 className="font-semibold text-lg text-neutral-900">Origen</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            label="Dirección de recogida"
            required
            error={errors.origin_address_raw?.message}
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="text"
                {...register('origin_address_raw')}
                className={fieldInputClass(!!errors.origin_address_raw)}
                placeholder="Av. Apoquindo 5550, Las Condes"
                maxLength={500}
              />
            )}
          />
          <FormField
            label="Región"
            required
            error={errors.origin_region_code?.message}
            render={({ id, describedBy }) => (
              <select
                id={id}
                aria-describedby={describedBy}
                {...register('origin_region_code')}
                className={fieldInputClass(!!errors.origin_region_code)}
              >
                <option value="">— Seleccionar —</option>
                {REGION_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {REGION_LABELS[r]}
                  </option>
                ))}
              </select>
            )}
          />
        </div>
      </section>

      <section>
        <h2 className="font-semibold text-lg text-neutral-900">Destino</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            label="Dirección de entrega"
            required
            error={errors.destination_address_raw?.message}
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="text"
                {...register('destination_address_raw')}
                className={fieldInputClass(!!errors.destination_address_raw)}
                placeholder="Concepción centro"
                maxLength={500}
              />
            )}
          />
          <FormField
            label="Región"
            required
            error={errors.destination_region_code?.message}
            render={({ id, describedBy }) => (
              <select
                id={id}
                aria-describedby={describedBy}
                {...register('destination_region_code')}
                className={fieldInputClass(!!errors.destination_region_code)}
              >
                <option value="">— Seleccionar —</option>
                {REGION_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {REGION_LABELS[r]}
                  </option>
                ))}
              </select>
            )}
          />
        </div>
      </section>

      <section>
        <h2 className="font-semibold text-lg text-neutral-900">Carga</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            label="Tipo de carga"
            required
            error={errors.cargo_type?.message}
            render={({ id, describedBy }) => (
              <select
                id={id}
                aria-describedby={describedBy}
                {...register('cargo_type')}
                className={fieldInputClass(!!errors.cargo_type)}
              >
                {(Object.keys(CARGO_TYPE_LABELS) as CargoType[]).map((t) => (
                  <option key={t} value={t}>
                    {CARGO_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            )}
          />
          <FormField
            label="Peso (kg)"
            required
            error={errors.cargo_weight_kg?.message}
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="number"
                min={1}
                max={100_000}
                {...register('cargo_weight_kg')}
                className={fieldInputClass(!!errors.cargo_weight_kg)}
              />
            )}
          />
          <FormField
            label="Volumen (m³)"
            error={errors.cargo_volume_m3?.message}
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="number"
                min={1}
                max={200}
                {...register('cargo_volume_m3')}
                className={fieldInputClass(!!errors.cargo_volume_m3)}
              />
            )}
          />
          <div className="sm:col-span-2">
            <FormField
              label="Descripción"
              error={errors.cargo_description?.message}
              render={({ id, describedBy }) => (
                <textarea
                  id={id}
                  aria-describedby={describedBy}
                  rows={2}
                  {...register('cargo_description')}
                  className={fieldInputClass(!!errors.cargo_description)}
                  maxLength={1000}
                  placeholder="Detalles relevantes para el transportista (opcional)"
                />
              )}
            />
          </div>
        </div>
      </section>

      <section>
        <h2 className="font-semibold text-lg text-neutral-900">Ventana de pickup</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            label="Desde"
            required
            error={errors.pickup_start_local?.message}
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="datetime-local"
                {...register('pickup_start_local')}
                className={fieldInputClass(!!errors.pickup_start_local)}
              />
            )}
          />
          <FormField
            label="Hasta"
            required
            error={errors.pickup_end_local?.message}
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="datetime-local"
                {...register('pickup_end_local')}
                className={fieldInputClass(!!errors.pickup_end_local)}
              />
            )}
          />
        </div>
      </section>

      <section>
        <h2 className="font-semibold text-lg text-neutral-900">Precio</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            label="Precio sugerido (CLP)"
            error={errors.proposed_price_clp?.message}
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="number"
                min={0}
                {...register('proposed_price_clp')}
                className={fieldInputClass(!!errors.proposed_price_clp)}
                placeholder="Déjalo vacío si quieres que el sistema sugiera un precio"
              />
            )}
          />
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
            Acción irreversible. El sistema deja de buscar transportistas y la carga queda en estado
            "Cancelado".
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
          {/* HERO: ubicación del vehículo si hay assignment con Teltonika.
              Aparece arriba de todo para que el shipper vea inmediatamente
              dónde va su carga sin scrollear. */}
          {tripQ.data.assignment?.vehicle_plate && (
            <DataCard title="Ubicación del vehículo">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div className="text-neutral-600 text-sm">
                  <p>
                    Reportado por el dispositivo:{' '}
                    <RelativeTime
                      date={tripQ.data.assignment.ubicacion_actual?.timestamp_device ?? null}
                      fallback="sin posición todavía"
                    />
                  </p>
                  <p className="mt-0.5 text-neutral-400 text-xs">
                    Esta vista se refresca cada 30 segundos. La frecuencia de reporte del
                    dispositivo depende del vehículo.
                  </p>
                </div>
                <Link
                  to="/app/cargas/$id/track"
                  params={{ id: trip.id }}
                  className="flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white shadow-sm transition hover:bg-primary-700"
                >
                  <Navigation className="h-4 w-4" aria-hidden />
                  Ver en vivo
                </Link>
              </div>
              <VehicleMap
                plate={tripQ.data.assignment.vehicle_plate}
                latitude={tripQ.data.assignment.ubicacion_actual?.latitude ?? null}
                longitude={tripQ.data.assignment.ubicacion_actual?.longitude ?? null}
                speedKmh={tripQ.data.assignment.ubicacion_actual?.speed_kmh ?? null}
                timestampDevice={tripQ.data.assignment.ubicacion_actual?.timestamp_device ?? null}
                height={480}
              />
            </DataCard>
          )}

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

              {/* Mapa movido arriba como hero — ver bloque inicial del detail. */}
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
                {tripQ.data.metrics.certificate_issued_at && (
                  <div className="sm:col-span-2">
                    <DescargarCertificadoButton tripId={tripQ.data.trip_request.id} />
                    {tripQ.data.metrics.certificate_sha256 && (
                      <p className="mt-2 break-all font-mono text-neutral-400 text-xs">
                        SHA-256: {tripQ.data.metrics.certificate_sha256}
                      </p>
                    )}
                  </div>
                )}
                {!tripQ.data.metrics.certificate_issued_at &&
                  tripQ.data.trip_request.status === 'entregado' && (
                    <div className="rounded-md bg-amber-50 px-3 py-2 text-amber-900 text-xs sm:col-span-2">
                      Generando certificado de huella de carbono. Recargá en unos segundos.
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
// Componentes auxiliares (Field, Th, Td, DataCard, DataRow)
// El Layout vive en components/Layout.tsx (BUG-003) — antes estaba duplicado
// inline acá y en vehiculos.tsx.
// =============================================================================

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
