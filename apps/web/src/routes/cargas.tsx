import { tripRequestCreateInputSchema } from '@booster-ai/shared-schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { APIProvider } from '@vis.gl/react-google-maps';
import {
  ArrowLeft,
  ArrowRight,
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
import {
  CambioPendienteGenerador,
  type CambioPendienteGeneradorDatos,
} from '../components/cambios/CambioPendienteGenerador.js';
import { SolicitarCambioForm } from '../components/cambios/SolicitarCambioForm.js';
import { UltimaSolicitudCambio } from '../components/cambios/UltimaSolicitudCambio.js';
import { BajaCarga, EstadoBajaCarga, type ModoBaja } from '../components/cargas/BajaCarga.js';
import {
  ContactoYNotasCard,
  type DatosLibresCarga,
} from '../components/cargas/ContactoYNotasCard.js';
import { RecepcionYPagoCard } from '../components/comercial/RecepcionYPagoCard.js';
import {
  DesgloseGenerador,
  type DesgloseGeneradorDto,
  type ModalidadCarga,
  SeccionComercial,
} from '../components/comercial/SeccionComercial.js';
import { type LugarDetallado, SelectorLugar } from '../components/lugar/SelectorLugar.js';
import { VehicleMap } from '../components/map/VehicleMap.js';
import { PublicTrackingShare } from '../components/public-tracking-share.js';
import type { MeResponse } from '../hooks/use-me.js';
import { useScrollToFirstError } from '../hooks/use-scroll-to-first-error.js';
import { ApiError, api } from '../lib/api-client.js';
import { flagsDe } from '../lib/capacidades.js';
import {
  CertDisabledError,
  CertNotIssuedError,
  descargarCertificadoDeViaje,
} from '../lib/cert-download.js';
import { useEmpresaScope } from '../lib/empresa-activa.js';
import { env } from '../lib/env.js';
import {
  CARGO_TYPE_LABELS,
  type CargoType,
  type RegionCode,
  etiquetaEvento,
  regionLabel,
} from '../lib/etiquetas-carga.js';
import { publicTrackingShareUrl } from '../lib/live-tracking.js';
import { logger } from '../lib/logger.js';

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
  /** ADR-079 §1 — desglose congelado al publicar (solo con modelo v3). */
  comercial?: DesgloseGeneradorDto | null;
  origin_comuna_code: string | null;
  destination_comuna_code: string | null;
  cargo_description: string | null;
  updated_at: string;
  /** editar-anular-cargas — datos libres y acciones permitidas (el API los deriva del estado). */
  consignee?: DatosLibresCarga['consignee'];
  notes?: string | null;
  reference?: string | null;
  /** §9: cuántas transportistas evalúan la carga (solo en ofertas_enviadas). */
  ofertas_pendientes?: number;
  acciones_permitidas?: {
    editar?: boolean;
    editar_datos_libres: boolean;
    solicitar_cambio?: boolean;
    retirar_cambio?: boolean;
    anular?: boolean;
    cancelar?: boolean;
  };
  /** editar-anular-cargas §6.8: la propuesta del generador que espera respuesta. */
  cambio_pendiente?: CambioPendienteGeneradorDatos | null;
  modalidad_carga?: string;
  /** Carga anulada antes del match: quién y cuándo (editar-anular-cargas §8.8). */
  anulacion?: { en: string; por_nombre: string | null; razon: string | null } | null;
  /** Servicio cancelado después del match. */
  cancelacion?: { en: string; razon: string | null } | null;
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
  /** Solo con el viaje en asignado o en_proceso (§12-P11). */
  conductor_telefono_e164?: string;
  /** UUID del seguimiento público. Ausente en respuestas anteriores a este campo. */
  public_tracking_token?: string | null;
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
  route_data_source: string | null;
  coverage_pct: string | null;
  certification_level: string | null;
  /** ADR-077 §4 — línea de método derivada por el API; se muestra tal cual. */
  linea_metodo: string | null;
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
  const isShipper = me.active_membership?.empresa?.is_generador_carga ?? false;
  const puedePublicar = flagsDe(me).publicarCarga;

  const scope = useEmpresaScope();
  const tripsQ = useQuery({
    queryKey: scope.key('cargas'),
    queryFn: async () => {
      const res = await api.get<{ trip_requests: TripSummary[] }>('/trip-requests-v2', scope.init);
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
        {puedePublicar && (
          <Link
            to="/app/cargas/nueva"
            className="flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white shadow-xs transition hover:bg-primary-700"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Nueva carga
          </Link>
        )}
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
                    {puedePublicar && (
                      <Link
                        to="/app/cargas/nueva"
                        className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white"
                      >
                        <Plus className="h-4 w-4" aria-hidden />
                        Crear carga
                      </Link>
                    )}
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
        const isShipper = ctx.me.active_membership?.empresa?.is_generador_carga ?? false;
        if (!isShipper || !flagsDe(ctx.me).publicarCarga) {
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

export function CargasEditarRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        const isShipper = ctx.me.active_membership?.empresa?.is_generador_carga ?? false;
        if (!isShipper || !flagsDe(ctx.me).editarCarga) {
          return (
            <Layout me={ctx.me} title="Editar carga">
              <NoShipperPermission />
            </Layout>
          );
        }
        return <CargaEditarPage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

/** El 409 de una carga que ya no se edita así se explica sin culpar al usuario (§9). */
export function mensajeErrorEdicion(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'trip_not_editable':
        return 'La carga cambió mientras editabas (ya tiene transportista). Recargamos sus datos.';
      case 'trip_busy':
        return 'Estamos buscando transportista en este momento. Inténtalo en unos segundos.';
      case 'contrato_programado_no_habilitado':
        return 'Tu empresa no tiene contrato programado habilitado.';
    }
  }
  return err instanceof Error ? err.message : 'No pudimos guardar la carga.';
}

function CargaEditarPage({ me }: { me: MeOnboarded }) {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [porConfirmar, setPorConfirmar] = useState<TripFormValues | null>(null);
  const tripQ = useQuery({
    queryKey: ['cargas', id],
    queryFn: async () => await api.get<TripDetailResponse>(`/trip-requests-v2/${id}`),
  });
  const trip = tripQ.data?.trip_request;

  const guardar = useMutation({
    mutationFn: async (values: TripFormValues) =>
      await api.put(`/trip-requests-v2/${id}`, tripFormToBody(values)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cargas'] });
      void navigate({ to: '/app/cargas/$id', params: { id } });
    },
    onError: (err) => {
      setPorConfirmar(null);
      setError(mensajeErrorEdicion(err));
      if (err instanceof ApiError && err.code === 'trip_not_editable') {
        queryClient.invalidateQueries({ queryKey: ['cargas', id] });
      }
    },
  });

  const inicial = trip ? formDesdeDetalle(trip) : null;
  return (
    <Layout me={me} title="Editar carga">
      <div className="mb-6 flex items-center gap-3">
        <Link
          to="/app/cargas/$id"
          params={{ id }}
          className="text-neutral-500 hover:text-neutral-900"
          aria-label="Volver al detalle"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">
          Editar {trip?.tracking_code ?? 'carga'}
        </h1>
      </div>
      {tripQ.isLoading && <p className="text-neutral-500">Cargando…</p>}
      {trip && !trip.acciones_permitidas?.editar && (
        <p className="mb-4 text-neutral-700 text-sm">
          Esta carga ya no se edita directamente. Si ya tiene transportista, propón el cambio desde
          su detalle.
        </p>
      )}
      {porConfirmar && trip && (
        <div
          role="alertdialog"
          aria-label="Confirmar cambios"
          className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm"
        >
          <p className="text-amber-900">
            Hay {trip.ofertas_pendientes ?? 0} transportistas evaluando esta carga. Si cambias estos
            datos, sus ofertas se anulan y buscaremos transportista de nuevo. Si no hay candidatos,
            la carga quedará sin transportista.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => guardar.mutate(porConfirmar)}
              disabled={guardar.isPending}
              className="rounded-md bg-amber-600 px-3 py-1.5 font-medium text-white disabled:opacity-60"
            >
              Sí, guardar cambios
            </button>
            <button
              type="button"
              onClick={() => setPorConfirmar(null)}
              className="rounded-md border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700"
            >
              Volver
            </button>
          </div>
        </div>
      )}
      {inicial && trip?.acciones_permitidas?.editar && (
        <TripForm
          initialValues={inicial}
          submitLabel="Guardar cambios"
          onSubmit={(values) => {
            setError(null);
            if (trip.status === 'ofertas_enviadas' && cambiaAlgoMaterial(inicial, values)) {
              setPorConfirmar(values);
              return;
            }
            guardar.mutate(values);
          }}
          submitting={guardar.isPending}
          error={error}
        />
      )}
      {error && !trip?.acciones_permitidas?.editar && (
        <p role="alert" className="text-danger-700 text-sm">
          {error}
        </p>
      )}
    </Layout>
  );
}

interface TripFormValues {
  origin_address_raw: string;
  origin_region_code: RegionCode | '';
  origin_comuna_code: string;
  origin_latitude: number | null;
  origin_longitude: number | null;
  destination_address_raw: string;
  destination_region_code: RegionCode | '';
  destination_comuna_code: string;
  destination_latitude: number | null;
  destination_longitude: number | null;
  cargo_type: CargoType;
  cargo_weight_kg: string;
  cargo_volume_m3: string;
  cargo_description: string;
  /** editar-anular-cargas §12-P4 — notas y referencia opcionales al crear. */
  notes: string;
  reference: string;
  pickup_start_local: string;
  pickup_end_local: string;
  proposed_price_clp: string;
  /** ADR-079 §2 — spot por defecto; programada con contrato habilitado. */
  modalidad_carga: ModalidadCarga;
  /**
   * Phase 5 PR-L3c — Datos opcionales del destinatario. Si el shipper
   * los llena, el WhatsApp tracking link va DIRECTO al consignee al
   * asignar (vs forwarding manual). Privacy-first: opt-in.
   */
  consignee_name: string;
  consignee_phone_e164: string;
  /** seguimiento-por-correo — el link también le llega por correo. */
  consignee_email: string;
}

const EMPTY_FORM: TripFormValues = {
  origin_address_raw: '',
  origin_region_code: '',
  origin_comuna_code: '',
  origin_latitude: null,
  origin_longitude: null,
  destination_address_raw: '',
  destination_region_code: '',
  destination_comuna_code: '',
  destination_latitude: null,
  destination_longitude: null,
  cargo_type: 'carga_seca',
  cargo_weight_kg: '',
  cargo_volume_m3: '',
  cargo_description: '',
  notes: '',
  reference: '',
  pickup_start_local: '',
  pickup_end_local: '',
  proposed_price_clp: '',
  modalidad_carga: 'spot',
  consignee_name: '',
  consignee_phone_e164: '',
  consignee_email: '',
};

/** Precio del form como entero CLP, o null si está vacío o no es válido. */
function precioDesdeTexto(texto: string): number | null {
  const t = texto.trim();
  if (!t) {
    return null;
  }
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function aIsoLocal(valor: string): string {
  if (!valor) {
    return '';
  }
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? '' : fecha.toISOString();
}

/** ISO → valor de un `<input type="datetime-local">` en la hora del navegador. */
function isoALocal(iso: string | null): string {
  if (!iso) {
    return '';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}T${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

/**
 * La carga publicada como valores del formulario (editar-anular-cargas §9). El
 * detalle no trae coordenadas: el API conserva las del viaje si la dirección
 * no cambia.
 */
export function formDesdeDetalle(t: TripDetail): TripFormValues {
  return {
    ...EMPTY_FORM,
    origin_address_raw: t.origin_address_raw,
    origin_region_code: t.origin_region_code ?? '',
    origin_comuna_code: t.origin_comuna_code ?? '',
    destination_address_raw: t.destination_address_raw,
    destination_region_code: t.destination_region_code ?? '',
    destination_comuna_code: t.destination_comuna_code ?? '',
    cargo_type: t.cargo_type,
    cargo_weight_kg: t.cargo_weight_kg?.toString() ?? '',
    cargo_volume_m3: t.cargo_volume_m3?.toString() ?? '',
    cargo_description: t.cargo_description ?? '',
    notes: t.notes ?? '',
    reference: t.reference ?? '',
    pickup_start_local: isoALocal(t.pickup_window_start),
    pickup_end_local: isoALocal(t.pickup_window_end),
    proposed_price_clp: t.proposed_price_clp?.toString() ?? '',
    modalidad_carga: t.modalidad_carga === 'programada' ? 'programada' : 'spot',
    consignee_name: t.consignee?.name ?? '',
    consignee_phone_e164: t.consignee?.phone_e164 ?? '',
    consignee_email: t.consignee?.email ?? '',
  };
}

const CAMPOS_MATERIALES_FORM: readonly (keyof TripFormValues)[] = [
  'origin_address_raw',
  'origin_region_code',
  'origin_comuna_code',
  'destination_address_raw',
  'destination_region_code',
  'destination_comuna_code',
  'cargo_type',
  'cargo_weight_kg',
  'cargo_volume_m3',
  'cargo_description',
  'pickup_start_local',
  'pickup_end_local',
  'proposed_price_clp',
  'modalidad_carga',
];

/** Cambió algo que no es un dato libre: con ofertas vivas, las anula (§7). */
export function cambiaAlgoMaterial(antes: TripFormValues, despues: TripFormValues): boolean {
  return CAMPOS_MATERIALES_FORM.some((c) => String(antes[c] ?? '') !== String(despues[c] ?? ''));
}

function puntoEnBody(
  latitude: number | null,
  longitude: number | null,
): { latitude: number; longitude: number } | Record<string, never> {
  if (latitude === null || longitude === null) {
    return {};
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return {};
  }
  return { latitude, longitude };
}

function tripFormToBody(v: TripFormValues): Record<string, unknown> {
  return {
    origin: {
      address_raw: v.origin_address_raw.trim(),
      region_code: v.origin_region_code,
      ...(v.origin_comuna_code ? { comuna_code: v.origin_comuna_code } : {}),
      ...puntoEnBody(v.origin_latitude, v.origin_longitude),
    },
    destination: {
      address_raw: v.destination_address_raw.trim(),
      region_code: v.destination_region_code,
      ...(v.destination_comuna_code ? { comuna_code: v.destination_comuna_code } : {}),
      ...puntoEnBody(v.destination_latitude, v.destination_longitude),
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
      start_at: aIsoLocal(v.pickup_start_local),
      end_at: aIsoLocal(v.pickup_end_local),
    },
    proposed_price_clp: v.proposed_price_clp.trim()
      ? Number.parseInt(v.proposed_price_clp, 10)
      : null,
    modalidad_carga: v.modalidad_carga,
    // Phase 5 PR-L3c — consignee opt-in. Solo incluir el bloque si el
    // shipper llenó al menos un campo; si ambos vacíos, no enviamos
    // `consignee` (el zod schema lo permite optional).
    ...(v.consignee_name.trim() || v.consignee_phone_e164.trim() || v.consignee_email.trim()
      ? {
          consignee: {
            ...(v.consignee_name.trim() ? { name: v.consignee_name.trim() } : {}),
            ...(v.consignee_phone_e164.trim() ? { phone_e164: v.consignee_phone_e164.trim() } : {}),
            ...(v.consignee_email.trim() ? { email: v.consignee_email.trim() } : {}),
          },
        }
      : {}),
    ...(v.notes.trim() ? { notes: v.notes.trim() } : {}),
    ...(v.reference.trim() ? { reference: v.reference.trim() } : {}),
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
  'origin.latitude': 'origin_address_raw',
  'origin.longitude': 'origin_address_raw',
  'destination.address_raw': 'destination_address_raw',
  'destination.region_code': 'destination_region_code',
  'destination.latitude': 'destination_address_raw',
  'destination.longitude': 'destination_address_raw',
  'cargo.cargo_type': 'cargo_type',
  'cargo.weight_kg': 'cargo_weight_kg',
  'cargo.volume_m3': 'cargo_volume_m3',
  'cargo.description': 'cargo_description',
  notes: 'notes',
  reference: 'reference',
  'pickup_window.start_at': 'pickup_start_local',
  'pickup_window.end_at': 'pickup_end_local',
  proposed_price_clp: 'proposed_price_clp',
  'consignee.name': 'consignee_name',
  'consignee.phone_e164': 'consignee_phone_e164',
  'consignee.email': 'consignee_email',
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
  // Las fechas vacías se marcan en español antes del schema. El schema igual
  // corre: si no, un error de dirección o región quedaba escondido detrás
  // de la ventana de pickup (el formulario cortaba en el primer return).
  const errors: TripFieldErrors = {};
  if (!v.pickup_start_local) {
    errors.pickup_start_local = 'Selecciona una fecha y hora';
  }
  if (!v.pickup_end_local) {
    errors.pickup_end_local = 'Selecciona una fecha y hora';
  }

  const result = tripRequestCreateInputSchema.safeParse(tripFormToBody(v));
  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.join('.');
      const field = SCHEMA_PATH_TO_FIELD[path];
      if (field && !errors[field]) {
        errors[field] = issue.message;
      }
    }
  }
  return Object.keys(errors).length > 0 ? errors : null;
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
        <Link
          to="/app/cargas"
          className="text-neutral-500 hover:text-neutral-900"
          aria-label="Volver a mis cargas"
        >
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
  initialValues = EMPTY_FORM,
  submitLabel,
}: {
  onSubmit: (v: TripFormValues) => void;
  submitting: boolean;
  error: string | null;
  /** editar-anular-cargas §9: la edición reutiliza el formulario precargado. */
  initialValues?: TripFormValues;
  submitLabel?: string;
}) {
  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    watch,
    setValue,
    formState: { errors, submitCount },
  } = useForm<TripFormValues>({
    mode: 'onSubmit',
    defaultValues: initialValues,
  });

  useScrollToFirstError(errors, submitCount);
  const [mapasCaidos, setMapasCaidos] = useState(false);
  const mapasDisponibles = Boolean(env.VITE_GOOGLE_MAPS_API_KEY) && !mapasCaidos;
  const valores = watch();

  function aplicarOrigen(lugar: LugarDetallado) {
    setValue('origin_address_raw', lugar.direccion, { shouldDirty: true });
    if (lugar.region) {
      setValue('origin_region_code', lugar.region, { shouldDirty: true });
    }
    if (lugar.comunaCode) {
      setValue('origin_comuna_code', lugar.comunaCode, { shouldDirty: true });
    }
    setValue('origin_latitude', lugar.latitude, { shouldDirty: true });
    setValue('origin_longitude', lugar.longitude, { shouldDirty: true });
  }

  function aplicarDestino(lugar: LugarDetallado) {
    setValue('destination_address_raw', lugar.direccion, { shouldDirty: true });
    if (lugar.region) {
      setValue('destination_region_code', lugar.region, { shouldDirty: true });
    }
    if (lugar.comunaCode) {
      setValue('destination_comuna_code', lugar.comunaCode, { shouldDirty: true });
    }
    setValue('destination_latitude', lugar.latitude, { shouldDirty: true });
    setValue('destination_longitude', lugar.longitude, { shouldDirty: true });
  }

  async function resolverEnlace(texto: string) {
    try {
      return await api.post<{ latitude: number; longitude: number }>(
        '/trip-requests-v2/resolver-enlace',
        { texto },
      );
    } catch (err) {
      logger.warn({ err }, 'no se pudo resolver el link de mapa');
      return null;
    }
  }

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

  const formulario = (
    <form
      onSubmit={(event) => {
        // setError deja el error en el store. handleSubmit no llama al
        // callback si ese error sigue ahí, aunque el campo ya esté corregido.
        clearErrors();
        void handleSubmit(submit)(event);
      }}
      className="space-y-8 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
      noValidate
    >
      <section>
        <h2 className="font-semibold text-lg text-neutral-900">Origen</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SelectorLugar
            etiquetaDireccion="Dirección de recogida"
            placeholderDireccion="Av. Apoquindo 5550, Las Condes"
            direccion={valores.origin_address_raw}
            region={valores.origin_region_code}
            comunaCode={valores.origin_comuna_code}
            latitude={valores.origin_latitude}
            longitude={valores.origin_longitude}
            errorDireccion={errors.origin_address_raw?.message}
            errorRegion={errors.origin_region_code?.message}
            nombreDireccion="origin_address_raw"
            nombreRegion="origin_region_code"
            nombreComuna="origin_comuna_code"
            mapasDisponibles={mapasDisponibles}
            onDireccion={(value) => setValue('origin_address_raw', value, { shouldDirty: true })}
            onRegion={(value) => setValue('origin_region_code', value, { shouldDirty: true })}
            onComuna={(code) => setValue('origin_comuna_code', code, { shouldDirty: true })}
            onCoordenadas={(latitude, longitude) => {
              setValue('origin_latitude', latitude, { shouldDirty: true });
              setValue('origin_longitude', longitude, { shouldDirty: true });
            }}
            onLugar={aplicarOrigen}
            resolverEnlace={resolverEnlace}
          />
        </div>
      </section>

      <section>
        <h2 className="font-semibold text-lg text-neutral-900">Destino</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SelectorLugar
            etiquetaDireccion="Dirección de entrega"
            placeholderDireccion="Concepción centro"
            direccion={valores.destination_address_raw}
            region={valores.destination_region_code}
            comunaCode={valores.destination_comuna_code}
            latitude={valores.destination_latitude}
            longitude={valores.destination_longitude}
            errorDireccion={errors.destination_address_raw?.message}
            errorRegion={errors.destination_region_code?.message}
            nombreDireccion="destination_address_raw"
            nombreRegion="destination_region_code"
            nombreComuna="destination_comuna_code"
            mapasDisponibles={mapasDisponibles}
            onDireccion={(value) =>
              setValue('destination_address_raw', value, { shouldDirty: true })
            }
            onRegion={(value) => setValue('destination_region_code', value, { shouldDirty: true })}
            onComuna={(code) => setValue('destination_comuna_code', code, { shouldDirty: true })}
            onCoordenadas={(latitude, longitude) => {
              setValue('destination_latitude', latitude, { shouldDirty: true });
              setValue('destination_longitude', longitude, { shouldDirty: true });
            }}
            onLugar={aplicarDestino}
            resolverEnlace={resolverEnlace}
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
          <div className="sm:col-span-2">
            <FormField
              label="Notas para el transportista"
              error={errors.notes?.message}
              render={({ id, describedBy }) => (
                <textarea
                  id={id}
                  aria-describedby={describedBy}
                  rows={2}
                  {...register('notes')}
                  className={fieldInputClass(!!errors.notes)}
                  maxLength={1000}
                  placeholder="Horario de recepción, andén, a quién preguntar (opcional)"
                />
              )}
            />
          </div>
          <FormField
            label="Referencia"
            error={errors.reference?.message}
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="text"
                maxLength={100}
                {...register('reference')}
                className={fieldInputClass(!!errors.reference)}
                placeholder="Tu número de pedido u orden (opcional)"
              />
            )}
          />
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

      {/* ADR-079 §1 — costo del servicio para el generador (solo modelo v3). */}
      <SeccionComercial
        precioClp={precioDesdeTexto(watch('proposed_price_clp'))}
        modalidad={watch('modalidad_carga')}
        onModalidad={(m) => setValue('modalidad_carga', m)}
      />

      {/* Phase 5 PR-L3c — sección consignee opcional. */}
      <section>
        <h2 className="font-semibold text-lg text-neutral-900">Destinatario (opcional)</h2>
        <p className="mt-1 text-neutral-600 text-sm">
          Si llenas estos datos, el destinatario recibirá el link de seguimiento por WhatsApp o por
          correo al asignar el viaje. Tú también lo recibes, y se lo puedes reenviar.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            label="Nombre del destinatario"
            error={errors.consignee_name?.message}
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="text"
                maxLength={100}
                {...register('consignee_name')}
                className={fieldInputClass(!!errors.consignee_name)}
                placeholder="Ej. María Pérez"
              />
            )}
          />
          <FormField
            label="WhatsApp del destinatario"
            error={errors.consignee_phone_e164?.message}
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="tel"
                inputMode="tel"
                {...register('consignee_phone_e164')}
                className={fieldInputClass(!!errors.consignee_phone_e164)}
                placeholder="+56912345678"
              />
            )}
          />
          <FormField
            label="Correo del destinatario"
            error={errors.consignee_email?.message}
            render={({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="email"
                inputMode="email"
                autoComplete="email"
                maxLength={254}
                {...register('consignee_email')}
                className={fieldInputClass(!!errors.consignee_email)}
                placeholder="recepcion@empresa.cl"
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
          {submitting ? 'Guardando…' : (submitLabel ?? 'Crear carga')}
        </button>
      </div>
    </form>
  );

  if (!env.VITE_GOOGLE_MAPS_API_KEY || mapasCaidos) {
    return formulario;
  }

  return (
    <APIProvider
      apiKey={env.VITE_GOOGLE_MAPS_API_KEY}
      language="es"
      region="CL"
      onError={() => {
        logger.warn('google maps no cargó en nueva carga');
        setMapasCaidos(true);
      }}
    >
      {formulario}
    </APIProvider>
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
  const [solicitandoCambio, setSolicitandoCambio] = useState(false);
  const tripQ = useQuery({
    queryKey: ['cargas', id],
    queryFn: async () => {
      return await api.get<TripDetailResponse>(`/trip-requests-v2/${id}`);
    },
    refetchInterval: 30_000,
  });

  const trip = tripQ.data?.trip_request;
  // Anular o cancelar: lo decide el API con los guards; la capacidad del rol
  // se cruza acá (editar-anular-cargas §9).
  const puedeDarDeBaja = flagsDe(me).cancelarCarga;
  const modoBaja: ModoBaja | null = puedeDarDeBaja
    ? trip?.acciones_permitidas?.anular
      ? 'anular'
      : trip?.acciones_permitidas?.cancelar
        ? 'cancelar'
        : null
    : null;
  const shareUrl = publicTrackingShareUrl(
    tripQ.data?.assignment?.public_tracking_token,
    trip?.status,
    window.location.origin,
  );

  return (
    <Layout me={me} title="Detalle carga">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/app/cargas"
            className="text-neutral-500 hover:text-neutral-900"
            aria-label="Volver a mis cargas"
          >
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
      </div>

      {tripQ.isLoading && <p className="text-neutral-500">Cargando…</p>}
      {tripQ.error && <p className="text-danger-700">Error al cargar la carga.</p>}

      {trip?.acciones_permitidas?.editar && flagsDe(me).editarCarga && (
        <div className="mb-4">
          <Link
            to="/app/cargas/$id/editar"
            params={{ id: trip.id }}
            className="inline-flex rounded-md border border-primary-300 px-3 py-1.5 font-medium text-primary-700 text-sm hover:bg-primary-50"
          >
            Editar carga
          </Link>
        </div>
      )}

      {modoBaja && trip && (
        <div className="mb-6">
          <BajaCarga
            tripId={trip.id}
            modo={modoBaja}
            telefonoConductor={tripQ.data?.assignment?.conductor_telefono_e164 ?? null}
          />
        </div>
      )}

      {trip && (trip.anulacion || trip.cancelacion) && (
        <div className="mb-6">
          <EstadoBajaCarga anulacion={trip.anulacion} cancelacion={trip.cancelacion} />
        </div>
      )}

      {/* editar-anular-cargas §9: después del match, los cambios se proponen. */}
      {trip?.cambio_pendiente && (
        <div className="mb-6">
          <CambioPendienteGenerador
            tripId={trip.id}
            cambio={trip.cambio_pendiente}
            puedeRetirar={
              Boolean(trip.acciones_permitidas?.retirar_cambio) && flagsDe(me).editarCarga
            }
          />
        </div>
      )}
      {/* §9: sin pendiente, el resultado y el motivo de la última ya resuelta. */}
      {trip && !trip.cambio_pendiente && tripQ.data?.assignment && (
        <div className="mb-6">
          <UltimaSolicitudCambio tripId={trip.id} />
        </div>
      )}
      {trip &&
        !trip.cambio_pendiente &&
        trip.acciones_permitidas?.solicitar_cambio &&
        flagsDe(me).editarCarga && (
          <div className="mb-6">
            {solicitandoCambio ? (
              <SolicitarCambioForm
                tripId={trip.id}
                actual={{
                  origin_address_raw: trip.origin_address_raw,
                  origin_region_code: trip.origin_region_code,
                  origin_comuna_code: trip.origin_comuna_code,
                  destination_address_raw: trip.destination_address_raw,
                  destination_region_code: trip.destination_region_code,
                  destination_comuna_code: trip.destination_comuna_code,
                  cargo_type: trip.cargo_type,
                  cargo_weight_kg: trip.cargo_weight_kg,
                  cargo_volume_m3: trip.cargo_volume_m3,
                  cargo_description: trip.cargo_description,
                  pickup_window_start: trip.pickup_window_start,
                  pickup_window_end: trip.pickup_window_end,
                  proposed_price_clp: trip.proposed_price_clp,
                  modalidad_carga: trip.modalidad_carga ?? 'spot',
                }}
                onListo={() => setSolicitandoCambio(false)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setSolicitandoCambio(true)}
                className="rounded-md border border-primary-300 px-3 py-1.5 font-medium text-primary-700 text-sm hover:bg-primary-50"
              >
                Solicitar cambio
              </button>
            )}
          </div>
        )}
      {trip?.status === 'en_proceso' && (
        <p className="mb-6 text-neutral-600 text-sm">
          La carga ya fue recogida. Para cambios, llama al conductor o reporta un incidente.
        </p>
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

          {/* ADR-080: confirmación de recepción del generador y, bajo mandato
              de cobro, el estado del pago. */}
          <RecepcionYPagoCard tripId={trip.id} status={trip.status} />

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

          {trip.consignee && (
            <ContactoYNotasCard
              tripId={trip.id}
              datos={{
                consignee: trip.consignee,
                notes: trip.notes ?? null,
                reference: trip.reference ?? null,
              }}
              editable={
                Boolean(trip.acciones_permitidas?.editar_datos_libres) && flagsDe(me).publicarCarga
              }
            />
          )}

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
            {trip.comercial && (
              <div className="mt-3">
                <DesgloseGenerador desglose={trip.comercial} />
              </div>
            )}
          </DataCard>

          {tripQ.data.assignment && (
            <DataCard title="Asignación">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <DataRow label="Transportista">
                  {tripQ.data.assignment.empresa_legal_name ?? '—'}
                </DataRow>
                <DataRow label="Vehículo">
                  {tripQ.data.assignment.vehicle_plate ?? 'Vehículo por asignar'}
                </DataRow>
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
              {shareUrl && (
                <div className="mt-4">
                  <PublicTrackingShare url={shareUrl} />
                </div>
              )}

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
                <div className="sm:col-span-2">
                  <DataRow label="Método de cálculo">
                    {tripQ.data.metrics.linea_metodo ?? '—'}
                  </DataRow>
                </div>
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
                      Generando certificado de huella de carbono. Recarga en unos segundos.
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
                          {etiquetaEvento(ev.event_type)}
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
