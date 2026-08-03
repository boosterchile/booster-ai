import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRight, Inbox, MapPin, Truck, UserPlus, UserRound } from 'lucide-react';
import { EmptyState } from '../components/EmptyState.js';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import type { MeResponse } from '../hooks/use-me.js';
import { api } from '../lib/api-client.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

interface Servicio {
  id: string;
  status: 'asignado' | 'recogido';
  accepted_at: string | null;
  picked_up_at: string | null;
  agreed_price_clp: number | null;
  /** `null` = nadie va a manejar esta carga todavía. Es el dato central acá. */
  driver: { user_id: string; full_name: string | null } | null;
  vehicle: { id: string; plate: string | null } | null;
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
}

/**
 * `/app/servicios` — las cargas que el transportista aceptó y está corriendo.
 *
 * **Por qué existe.** Aceptar una oferta crea la asignación con
 * `conductor_id = NULL`, y la pantalla que lo setea (`/app/asignaciones/:id`)
 * no estaba en el menú: los únicos dos enlaces de toda la app salían de Cobra
 * Hoy y Liquidaciones, dos pantallas de plata. Resultado medido en producción
 * el 2026-08-03: **0 asignaciones con conductor**, con 1 activa. Sin
 * `conductor_id`, `POST /assignments/:id/driver-position` rechaza el GPS y el
 * dashboard del conductor muestra vacío aunque haya activado bien su cuenta.
 *
 * Por eso el trabajo principal de esta pantalla no es listar: es que un
 * servicio **sin conductor se vea como un problema** y tenga la acción al lado.
 */
export function ServiciosRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        return <ServiciosPage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function ServiciosPage({ me }: { me: MeOnboarded }) {
  const empresa = me.active_membership?.empresa;
  const isCarrier = empresa?.is_transportista ?? false;

  const serviciosQ = useQuery({
    queryKey: ['assignments', 'empresa'],
    enabled: isCarrier,
    // El despachador deja esta pestaña abierta mientras opera; 30 s es el
    // mismo ritmo que /app/ofertas.
    refetchInterval: 30_000,
    queryFn: async () => (await api.get<{ assignments: Servicio[] }>('/assignments')).assignments,
  });

  const servicios = serviciosQ.data ?? [];
  const sinConductor = servicios.filter((s) => !s.driver).length;

  return (
    <Layout me={me} title="Servicios">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-bold text-2xl text-neutral-900 tracking-tight sm:text-3xl">
            Servicios en curso
          </h1>
          <p className="mt-1 text-neutral-600 text-sm">
            Las cargas que aceptaste y todavía no se entregan.
          </p>
        </div>
      </div>

      {!isCarrier && (
        <output className="mt-6 block rounded-md border border-warning-500/30 bg-warning-50 p-4 text-sm text-warning-700">
          Tu empresa <strong>{empresa?.legal_name}</strong> no opera como transportista, así que no
          tiene servicios asignados.
        </output>
      )}

      {isCarrier && sinConductor > 0 && (
        // Resumen arriba: si el despachador entra y tiene 3 cargas sin
        // conductor, tiene que verlo sin scrollear.
        <output
          data-testid="resumen-sin-conductor"
          className="mt-6 block rounded-lg border border-warning-500/40 bg-warning-50 p-4 text-sm text-warning-800"
        >
          <strong>
            {sinConductor === 1
              ? 'Hay 1 servicio sin conductor asignado.'
              : `Hay ${sinConductor} servicios sin conductor asignado.`}
          </strong>{' '}
          Mientras no le asignes uno, el conductor no ve la carga en su teléfono y no podemos seguir
          el viaje por GPS.
        </output>
      )}

      {isCarrier && serviciosQ.isLoading && (
        <div className="mt-10 text-center text-neutral-500 text-sm">Cargando servicios…</div>
      )}

      {isCarrier && serviciosQ.isError && (
        <div
          role="alert"
          className="mt-6 rounded-md border border-danger-500/30 bg-danger-50 p-4 text-danger-700 text-sm"
        >
          No pudimos cargar tus servicios. Intenta de nuevo en unos segundos.
        </div>
      )}

      {isCarrier && !serviciosQ.isLoading && !serviciosQ.isError && servicios.length === 0 && (
        <div className="mt-10">
          <EmptyState
            icon={<Inbox className="h-10 w-10" aria-hidden />}
            title="No tienes servicios en curso"
            description="Cuando aceptes una oferta, la carga aparece acá para que le asignes conductor y vehículo."
            action={
              <Link
                to="/app/ofertas"
                className="inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700"
              >
                Ver ofertas activas
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            }
          />
        </div>
      )}

      {isCarrier && servicios.length > 0 && (
        <ul className="mt-6 space-y-4">
          {servicios.map((s) => (
            <ServicioCard key={s.id} servicio={s} />
          ))}
        </ul>
      )}
    </Layout>
  );
}

function ServicioCard({ servicio: s }: { servicio: Servicio }) {
  const precio =
    s.agreed_price_clp != null ? `$${s.agreed_price_clp.toLocaleString('es-CL')}` : null;

  return (
    <li className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono font-medium text-neutral-900 text-sm">
          {s.trip.tracking_code}
        </span>
        <div className="flex items-center gap-2">
          {s.vehicle?.plate && (
            <span className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-0.5 font-medium text-neutral-700 text-xs">
              <Truck className="h-3 w-3" aria-hidden />
              {s.vehicle.plate}
            </span>
          )}
          <span className="rounded-md bg-neutral-100 px-2 py-0.5 font-medium text-neutral-700 text-xs">
            {s.status === 'recogido' ? 'En ruta' : 'Por recoger'}
          </span>
        </div>
      </div>

      <div className="mt-3 space-y-1 text-sm">
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-success-700" aria-hidden />
          <span className="text-neutral-900">{s.trip.origin.address_raw}</span>
        </div>
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-danger-700" aria-hidden />
          <span className="text-neutral-900">{s.trip.destination.address_raw}</span>
        </div>
      </div>

      {precio && <p className="mt-2 text-neutral-600 text-sm">Acordado: {precio}</p>}

      <div className="mt-4 border-neutral-100 border-t pt-3">
        {s.driver ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-neutral-700 text-sm">
              <UserRound className="h-4 w-4 text-neutral-500" aria-hidden />
              {s.driver.full_name ?? 'Conductor asignado'}
            </span>
            <Link
              to="/app/asignaciones/$id"
              params={{ id: s.id }}
              className="inline-flex items-center gap-1 font-medium text-primary-700 text-sm hover:underline"
            >
              Ver servicio
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span
              data-testid={`sin-conductor-${s.id}`}
              className="inline-flex items-center gap-2 font-medium text-sm text-warning-800"
            >
              <UserPlus className="h-4 w-4" aria-hidden />
              Sin conductor asignado
            </span>
            <Link
              to="/app/asignaciones/$id"
              params={{ id: s.id }}
              data-testid={`asignar-conductor-${s.id}`}
              className="inline-flex items-center gap-2 rounded-md bg-primary-600 px-3 py-2 font-medium text-sm text-white hover:bg-primary-700"
            >
              Asignar conductor
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        )}
      </div>
    </li>
  );
}
