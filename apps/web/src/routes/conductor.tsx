import { Link } from '@tanstack/react-router';
import {
  AlertTriangle,
  ArrowRight,
  Inbox,
  MapPin,
  Navigation,
  Settings,
  Square,
  Truck,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { useDriverPositionReporter } from '../hooks/use-driver-position-reporter.js';
import type { MeResponse } from '../hooks/use-me.js';
import { ApiError, api } from '../lib/api-client.js';
import {
  type PermissionStatus,
  queryDriverPermissions,
} from '../services/driver-mode-permissions.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

/**
 * /app/conductor — Dashboard operacional del conductor.
 *
 * Es la **superficie principal** del conductor logueado. NO tiene
 * configuración de permisos ni preferencias aquí: eso vive en
 * /app/conductor/configuracion. Aquí el conductor ve solo lo que
 * importa cuando está por manejar:
 *
 *   1. **Aviso sticky de seguridad** — recordatorio preventivo de no
 *      usar WhatsApp manejando. Visible siempre, no escondido en
 *      configuración. Booster lo avisa antes de que sea un problema.
 *
 *   2. **Próximo servicio asignado** — el viaje que tienes que ejecutar
 *      ahora (origen → destino, carga, ventana de recogida, vehículo).
 *      Botón grande "Iniciar reporte GPS" si el vehículo no tiene
 *      Teltonika.
 *
 *   3. **Acceso a configuración** — icono de engranaje en la esquina,
 *      lleva a /app/conductor/configuracion. Solo se entra ahí si
 *      necesitas cambiar permisos del navegador o el audio coaching.
 *
 * Si no hay servicios asignados aún, mostramos un empty state amable:
 * "Cuando tu empresa te asigne un viaje, aparecerá aquí."
 *
 * Diseño mobile-first: el conductor está en su celular, no en
 * escritorio. Cards grandes, tipografía clara, sin barras laterales.
 *
 * **Lenguaje**: "servicio" para referirse al viaje asignado (el
 * conductor no negocia ofertas — la transacción comercial es entre
 * la empresa de transporte y el generador de carga). Español neutro
 * latinoamericano: "tu/tienes/aquí" (no "vos/tenés/acá").
 */

interface DriverAssignment {
  id: string;
  status: string;
  trip: {
    id: string;
    tracking_code: string;
    status: string;
    origin: { address_raw: string; region_code: string | null };
    destination: { address_raw: string; region_code: string | null };
    cargo_type: string;
    cargo_weight_kg: number | null;
    pickup_window_start: string | null;
    pickup_window_end: string | null;
  };
  carrier_empresa: { id: string; legal_name: string | null };
  vehicle: { id: string; plate: string | null } | null;
}

export function ConductorDashboardRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        return <ConductorDashboardPage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function ConductorDashboardPage({ me }: { me: MeOnboarded }) {
  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <ConductorHeader fullName={me.user.full_name} />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-4 sm:px-6 sm:py-6">
        <WhatsAppSafetyBanner />
        <AssignmentsSection />
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header del conductor — su propia identidad visual, sin Layout del carrier.
// ---------------------------------------------------------------------------

function ConductorHeader({ fullName }: { fullName: string }) {
  return (
    <header className="border-neutral-200 border-b bg-white">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-4 py-3 sm:px-6">
        <div className="min-w-0 flex-1">
          <div className="text-neutral-500 text-xs">Conductor</div>
          <div className="truncate font-semibold text-neutral-900">{fullName}</div>
        </div>
        <Link
          to="/app/conductor/configuracion"
          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-neutral-600 transition hover:bg-neutral-100"
          aria-label="Configuración del Modo Conductor"
          data-testid="link-configuracion-conductor"
        >
          <Settings className="h-5 w-5" aria-hidden />
        </Link>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Banner sticky de seguridad — preventivo, no oculto en configuración.
// ---------------------------------------------------------------------------

function WhatsAppSafetyBanner() {
  return (
    <div
      className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm"
      role="alert"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <div>
          <div className="font-medium">No uses WhatsApp manejando</div>
          <p className="mt-1 text-amber-800 text-xs leading-snug">
            Booster te avisa por audio cuando hay algo importante. Si necesitas coordinar con tu
            carga o destino, hazlo solo con el vehículo detenido.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sección de servicios asignados (carga + GPS reporter inline).
// ---------------------------------------------------------------------------

function AssignmentsSection() {
  const [assignments, setAssignments] = useState<DriverAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [geoPermission, setGeoPermission] = useState<PermissionStatus>('unknown');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<{ assignments: DriverAssignment[] }>('/me/assignments')
      .then((res) => {
        if (cancelled) {
          return;
        }
        setAssignments(res.assignments);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        const msg =
          err instanceof ApiError
            ? err.status === 404
              ? 'No encontramos tu cuenta. Vuelve a iniciar sesión.'
              : `Error ${err.status}: ${err.message}`
            : (err as Error).message;
        setError(msg);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    queryDriverPermissions()
      .then((p) => {
        if (!cancelled) {
          setGeoPermission(p.geo);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <section className="mt-6">
        <div className="rounded-lg border border-neutral-200 bg-white p-6 text-center text-neutral-500 text-sm">
          Cargando tus servicios…
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="mt-6">
        <div className="rounded-lg border border-danger-200 bg-danger-50 p-4 text-danger-700 text-sm">
          {error}
        </div>
      </section>
    );
  }

  if (assignments.length === 0) {
    return (
      <section className="mt-6">
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center">
          <Inbox className="mx-auto h-12 w-12 text-neutral-300" aria-hidden />
          <h2 className="mt-3 font-semibold text-base text-neutral-900">
            No tienes servicios asignados
          </h2>
          <p className="mt-2 text-neutral-600 text-sm">
            Cuando tu empresa de transporte te asigne un viaje, lo verás aquí. Mientras tanto,
            puedes revisar tu configuración tocando el ícono de engranaje arriba.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-6 space-y-4">
      <h2 className="font-semibold text-base text-neutral-900">
        {assignments.length === 1 ? 'Tu próximo servicio' : 'Tus servicios asignados'}
      </h2>
      {assignments.map((a) => (
        <AssignmentCard key={a.id} assignment={a} geoPermission={geoPermission} />
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Card de un servicio asignado, con GPS reporter inline.
// ---------------------------------------------------------------------------

function AssignmentCard({
  assignment,
  geoPermission,
}: {
  assignment: DriverAssignment;
  geoPermission: PermissionStatus;
}) {
  const reporter = useDriverPositionReporter();
  const canStart = geoPermission === 'granted' && !reporter.isWatching;
  const a = assignment;

  return (
    <article
      className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm"
      data-testid={`assignment-card-${a.id}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="font-mono text-neutral-500 text-xs">{a.trip.tracking_code}</div>
        {a.vehicle?.plate && (
          <div className="rounded-md bg-neutral-100 px-2 py-0.5 font-medium text-neutral-700 text-xs">
            <Truck className="mr-1 inline h-3 w-3" aria-hidden />
            {a.vehicle.plate}
          </div>
        )}
      </div>

      <div className="mt-3 space-y-2 text-sm">
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-success-700" aria-hidden />
          <div>
            <div className="text-neutral-500 text-xs">Origen</div>
            <div className="text-neutral-900">{a.trip.origin.address_raw}</div>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-danger-700" aria-hidden />
          <div>
            <div className="text-neutral-500 text-xs">Destino</div>
            <div className="text-neutral-900">{a.trip.destination.address_raw}</div>
          </div>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-neutral-500">Tipo de carga</dt>
          <dd className="font-medium text-neutral-900">{a.trip.cargo_type.replace('_', ' ')}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Peso</dt>
          <dd className="font-medium text-neutral-900">
            {a.trip.cargo_weight_kg
              ? `${a.trip.cargo_weight_kg.toLocaleString('es-CL')} kg`
              : 'No declarado'}
          </dd>
        </div>
        {a.trip.pickup_window_start && (
          <div className="col-span-2">
            <dt className="text-neutral-500">Ventana de recogida</dt>
            <dd className="font-medium text-neutral-900">
              {formatPickupWindow(a.trip.pickup_window_start, a.trip.pickup_window_end)}
            </dd>
          </div>
        )}
      </dl>

      {/* GPS reporter: si el vehículo no tiene Teltonika, el conductor
          puede reportar posición desde el teléfono. Si tiene Teltonika,
          esto es complementario. */}
      <div className="mt-4 border-neutral-200 border-t pt-4">
        <div className="flex items-center gap-2 text-neutral-700 text-xs uppercase tracking-wide">
          <Navigation className="h-3 w-3" aria-hidden />
          Reporte GPS
        </div>
        {geoPermission !== 'granted' && (
          <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900 text-xs">
            Para activar el reporte GPS, primero habilita el permiso de ubicación. Toca el ícono de
            engranaje arriba para configurarlo.
          </div>
        )}
        {reporter.isWatching ? (
          <div className="mt-3 space-y-2">
            <div className="rounded-md bg-success-50 px-3 py-2 text-success-700 text-sm">
              Reportando posición en vivo · {reporter.pointsSent} puntos enviados
            </div>
            <button
              type="button"
              onClick={() => reporter.stop()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-danger-600 px-4 py-3 font-medium text-sm text-white hover:bg-danger-700"
              data-testid="gps-stop"
            >
              <Square className="h-4 w-4" aria-hidden />
              Detener reporte
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => reporter.start(a.id)}
            disabled={!canStart}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary-600 px-4 py-3 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-50"
            data-testid="gps-start"
          >
            <Navigation className="h-4 w-4" aria-hidden />
            Iniciar reporte GPS
          </button>
        )}
        {reporter.lastError && (
          <div className="mt-2 rounded-md border border-danger-200 bg-danger-50 p-2 text-danger-700 text-xs">
            {reporter.lastError}
          </div>
        )}
      </div>

      {/* Link al detalle del servicio (asignación) si quiere chat con
          el carrier o reportar incidente. */}
      <Link
        to="/app/asignaciones/$id"
        params={{ id: a.id }}
        className="mt-3 inline-flex items-center gap-1 text-primary-700 text-sm hover:underline"
      >
        Ver detalle del servicio
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPickupWindow(startIso: string, endIso: string | null): string {
  try {
    const start = new Date(startIso);
    const end = endIso ? new Date(endIso) : null;
    const fmt = new Intl.DateTimeFormat('es-CL', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
    if (!end) {
      return fmt.format(start);
    }
    return `${fmt.format(start)} → ${fmt.format(end)}`;
  } catch {
    return startIso;
  }
}
