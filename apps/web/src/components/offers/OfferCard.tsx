import { Check, Clock, Leaf, Loader2, MapPin, Package, X } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import {
  type EcoPreviewResponse,
  type OfferPayload,
  useAcceptOfferMutation,
  useEcoPreview,
  useRejectOfferMutation,
} from '../../hooks/use-offers.js';
import { ApiError } from '../../lib/api-client.js';
import { EcoRouteMapPreview } from './EcoRouteMapPreview.js';

const CARGO_LABELS: Record<string, string> = {
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

const REGION_LABELS: Record<string, string> = {
  XV: 'Arica',
  I: 'Tarapacá',
  II: 'Antofagasta',
  III: 'Atacama',
  IV: 'Coquimbo',
  V: 'Valparaíso',
  XIII: 'RM',
  VI: "O'Higgins",
  VII: 'Maule',
  XVI: 'Ñuble',
  VIII: 'Biobío',
  IX: 'Araucanía',
  XIV: 'Los Ríos',
  X: 'Los Lagos',
  XI: 'Aysén',
  XII: 'Magallanes',
};

function formatPriceClp(value: number): string {
  return `$ ${value.toLocaleString('es-CL')}`;
}

function formatDate(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  const date = new Date(iso);
  return date.toLocaleString('es-CL', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Santiago',
  });
}

function timeRemaining(iso: string): { label: string; urgent: boolean } {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) {
    return { label: 'Expirada', urgent: true };
  }
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) {
    return { label: `${minutes} min`, urgent: minutes < 15 };
  }
  const hours = Math.floor(minutes / 60);
  return { label: `${hours} h ${minutes % 60} min`, urgent: false };
}

export interface OfferCardProps {
  offer: OfferPayload;
}

export function OfferCard({ offer }: OfferCardProps) {
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showEcoPreview, setShowEcoPreview] = useState(false);
  const reasonId = useId();
  const acceptMutation = useAcceptOfferMutation();
  const rejectMutation = useRejectOfferMutation();
  // Eco preview lazy — solo se fetcha cuando el carrier hace click. La
  // razón es costo: cada preview gatilla una llamada Routes API
  // ($0.01/req con FUEL_CONSUMPTION). Si lo fetchearamos por cada card
  // del list, 10 cards × 30s polling = 1200 req/h por carrier activo.
  const ecoPreview = useEcoPreview(offer.id, { enabled: showEcoPreview });

  const remaining = timeRemaining(offer.expires_at);
  const cargoLabel = CARGO_LABELS[offer.trip_request.cargo_type] ?? offer.trip_request.cargo_type;
  const originLabel = offer.trip_request.origin_region_code
    ? (REGION_LABELS[offer.trip_request.origin_region_code] ??
      offer.trip_request.origin_region_code)
    : '—';
  const destLabel = offer.trip_request.destination_region_code
    ? (REGION_LABELS[offer.trip_request.destination_region_code] ??
      offer.trip_request.destination_region_code)
    : '—';

  async function handleAccept() {
    setError(null);
    try {
      await acceptMutation.mutateAsync({ offerId: offer.id });
    } catch (err) {
      setError(translate(err));
    }
  }

  async function handleSubmitReject(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await rejectMutation.mutateAsync({
        offerId: offer.id,
        ...(rejectReason.trim() ? { reason: rejectReason.trim() } : {}),
      });
      setShowRejectForm(false);
    } catch (err) {
      setError(translate(err));
    }
  }

  const busy = acceptMutation.isPending || rejectMutation.isPending;

  return (
    <article className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-neutral-500 text-xs">
              {offer.trip_request.tracking_code}
            </span>
            <span
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-xs ${
                remaining.urgent
                  ? 'bg-accent-50 text-accent-700'
                  : 'bg-neutral-100 text-neutral-700'
              }`}
            >
              <Clock className="h-3 w-3" aria-hidden />
              {remaining.label}
            </span>
          </div>
          <h3 className="mt-2 flex items-center gap-2 font-semibold text-lg text-neutral-900">
            <MapPin className="h-4 w-4 text-primary-600" aria-hidden />
            {originLabel} → {destLabel}
          </h3>
        </div>
        <div className="text-right">
          <div className="font-bold text-2xl text-neutral-900">
            {formatPriceClp(offer.proposed_price_clp)}
          </div>
          <div className="text-neutral-500 text-xs">precio acordado</div>
        </div>
      </header>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-3">
        <div>
          <dt className="text-neutral-500 text-xs">Origen</dt>
          <dd className="text-neutral-900">{offer.trip_request.origin_address_raw}</dd>
        </div>
        <div>
          <dt className="text-neutral-500 text-xs">Destino</dt>
          <dd className="text-neutral-900">{offer.trip_request.destination_address_raw}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-neutral-500 text-xs">
            <Package className="h-3 w-3" aria-hidden /> Carga
          </dt>
          <dd className="text-neutral-900">
            {cargoLabel}
            {offer.trip_request.cargo_weight_kg != null && (
              <>
                {' · '}
                {offer.trip_request.cargo_weight_kg.toLocaleString('es-CL')} kg
              </>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-neutral-500 text-xs">Recogida desde</dt>
          <dd className="text-neutral-900">{formatDate(offer.trip_request.pickup_window_start)}</dd>
        </div>
        <div>
          <dt className="text-neutral-500 text-xs">Recogida hasta</dt>
          <dd className="text-neutral-900">{formatDate(offer.trip_request.pickup_window_end)}</dd>
        </div>
      </dl>

      {/* Eco preview — Phase 1 PR-H4. Lazy fetch on user click. */}
      <div className="mt-4">
        {showEcoPreview ? (
          <EcoPreviewBlock query={ecoPreview} />
        ) : (
          <button
            type="button"
            onClick={() => setShowEcoPreview(true)}
            className="flex items-center gap-1.5 text-success-700 text-xs underline-offset-2 transition hover:text-success-700 hover:underline"
          >
            <Leaf className="h-3.5 w-3.5" aria-hidden />
            Ver impacto ambiental estimado
          </button>
        )}
      </div>

      {error && (
        <output className="mt-4 block rounded-md border border-danger-500/30 bg-danger-50 p-3 text-danger-700 text-sm">
          {error}
        </output>
      )}

      {showRejectForm ? (
        <form onSubmit={handleSubmitReject} className="mt-5 space-y-3">
          <div>
            <label htmlFor={reasonId} className="block font-medium text-neutral-700 text-sm">
              Razón del rechazo (opcional)
            </label>
            <textarea
              id={reasonId}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="Sin choferes disponibles, distancia muy lejos, etc."
              className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-neutral-900 text-sm shadow-xs focus:border-primary-500 focus:outline-none"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowRejectForm(false);
                setRejectReason('');
                setError(null);
              }}
              disabled={busy}
              className="rounded-md px-4 py-2 font-medium text-neutral-600 text-sm transition hover:bg-neutral-100"
            >
              Volver
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-danger-500 px-5 py-2 font-medium text-sm text-white shadow-xs transition hover:bg-danger-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {rejectMutation.isPending ? 'Enviando…' : 'Confirmar rechazo'}
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setShowRejectForm(true)}
            disabled={busy}
            className="flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-4 py-2 font-medium text-neutral-700 text-sm transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <X className="h-4 w-4" aria-hidden />
            Rechazar
          </button>
          <button
            type="button"
            onClick={handleAccept}
            disabled={busy}
            className="flex items-center gap-1 rounded-md bg-primary-500 px-5 py-2 font-medium text-sm text-white shadow-xs transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Check className="h-4 w-4" aria-hidden />
            {acceptMutation.isPending ? 'Aceptando…' : 'Aceptar oferta'}
          </button>
        </div>
      )}
    </article>
  );
}

/**
 * Bloque de eco-preview que se renderiza cuando el carrier hizo click
 * en "Ver impacto ambiental". Maneja los tres estados de la query:
 *   - loading: spinner + texto
 *   - error: mensaje genérico (no expone detalle)
 *   - success: distancia, kg CO2e, intensidad + nota del data source
 */
function EcoPreviewBlock(props: {
  query: ReturnType<typeof useEcoPreview>;
}) {
  const { query } = props;
  if (query.isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-success-700/20 bg-success-50/50 p-3 text-success-700 text-xs">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Calculando impacto ambiental con Google Routes…
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-neutral-600 text-xs">
        No pudimos calcular el impacto ambiental ahora. Intenta de nuevo en unos segundos.
      </div>
    );
  }
  const p: EcoPreviewResponse = query.data;
  const sourceLabel =
    p.data_source === 'routes_api'
      ? 'Google Routes API + perfil del vehículo'
      : 'Estimación por región (sin Routes API en este viaje)';
  return (
    <section
      aria-label="Impacto ambiental estimado de la oferta"
      className="rounded-md border border-success-700/20 bg-success-50/40 p-3"
    >
      <header className="flex items-center gap-1.5 text-success-700 text-xs">
        <Leaf className="h-3.5 w-3.5" aria-hidden />
        <span className="font-semibold">Impacto ambiental estimado</span>
      </header>

      {/* Phase 1 PR-H4 — mapa de la ruta sugerida. Solo renderizado
          cuando Routes API devolvió polyline. Cierra el loop "AI sugiere
          la mejor ruta para reducir huella": el carrier ya no ve solo
          números, ve la ruta exacta sobre la que se calculó. */}
      {p.polyline_encoded && (
        <div className="mt-2">
          <EcoRouteMapPreview polylineEncoded={p.polyline_encoded} />
        </div>
      )}
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-neutral-600">Distancia</dt>
          <dd className="font-medium text-neutral-900">{p.distance_km.toFixed(0)} km</dd>
        </div>
        <div>
          <dt className="text-neutral-600">Emisiones (WTW)</dt>
          <dd className="font-semibold text-success-700">
            {p.emisiones_kgco2e_wtw.toFixed(1)} kg CO₂e
          </dd>
        </div>
        <div>
          <dt className="text-neutral-600">Intensidad</dt>
          <dd className="text-neutral-900">{p.intensidad_gco2e_por_tonkm.toFixed(0)} g/t·km</dd>
        </div>
        {p.fuel_liters_estimated != null && (
          <div>
            <dt className="text-neutral-600">Combustible est.</dt>
            <dd className="text-neutral-900">{p.fuel_liters_estimated.toFixed(1)} L</dd>
          </div>
        )}
        {p.duration_s != null && (
          <div>
            <dt className="text-neutral-600">Duración est.</dt>
            <dd className="text-neutral-900">{Math.round(p.duration_s / 60)} min</dd>
          </div>
        )}
      </dl>
      <p className="mt-2 text-[11px] text-neutral-500">
        Cálculo {p.glec_version} · {sourceLabel}
      </p>
    </section>
  );
}

function translate(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'offer_not_found':
        return 'Esta oferta ya no existe.';
      case 'offer_forbidden':
        return 'No tienes permiso para responder a esta oferta.';
      case 'offer_not_pending':
        return 'Esta oferta ya fue respondida o expiró.';
      case 'offer_expired':
        return 'La oferta expiró. Refresca para ver las activas.';
      case 'trip_already_assigned':
        return 'Otro carrier aceptó primero. La oferta ya no está disponible.';
      case 'no_active_empresa':
        return 'Tu sesión no tiene empresa activa.';
      case 'not_a_carrier':
        return 'Tu empresa no opera como carrier.';
      default:
        if (err.status >= 500) {
          return 'Error del servidor. Intenta de nuevo en unos minutos.';
        }
        return err.message || 'No pudimos completar la operación.';
    }
  }
  return 'Error inesperado. Refresca e intenta de nuevo.';
}
