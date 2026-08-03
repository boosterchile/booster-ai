import { Link } from '@tanstack/react-router';
import {
  AlertTriangle,
  CheckCircle2,
  Inbox,
  MapPin,
  Mic,
  Navigation,
  PackageCheck,
  RefreshCw,
  Settings,
  Square,
  Truck,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { useDriverPositionReporter } from '../hooks/use-driver-position-reporter.js';
import { useFeatureFlags } from '../hooks/use-feature-flags.js';
import type { MeResponse } from '../hooks/use-me.js';
import { ApiError, api } from '../lib/api-client.js';
import {
  type PermissionStatus,
  queryDriverPermissions,
} from '../services/driver-mode-permissions.js';
import { isWakeWordEnabled } from '../services/wake-word-preference.js';

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
        <WakeWordActiveBanner />
        <AssignmentsSection />
      </main>
    </div>
  );
}

/**
 * ADR-036 — Banner sticky cuando el conductor activó "Oye Booster" + el
 * feature flag global está ON. Le da al conductor feedback visible
 * verificable de que el mic está escuchando la wake-word (privacy
 * transparente: si no ve el banner, el mic no está activo).
 *
 * Cuando el banner está visible, el listener Porcupine corre solo cuando
 * el vehículo está detenido. La integración real con el controller entra
 * en Wave 5 PR 2 — esta UI solo refleja la preferencia del usuario.
 */
function WakeWordActiveBanner() {
  const { flags } = useFeatureFlags();
  const [enabled, setEnabled] = useState(() => isWakeWordEnabled());

  // Re-evaluar cada vez que el dashboard se monta (e.g. tras volver
  // desde /configuracion donde el conductor pudo haber tocado el toggle).
  useEffect(() => {
    setEnabled(isWakeWordEnabled());
  }, []);

  if (!flags.wake_word_voice_activated || !enabled) {
    return null;
  }

  return (
    <output
      className="mt-3 flex items-center gap-2 rounded-md border border-primary-200 bg-primary-50 p-2 text-primary-900 text-xs"
      data-testid="wake-word-active-banner"
    >
      {/* Sin `animate-pulse` y sin "Escuchando": el controller es un stub
          declarado (`services/wake-word.ts`) que NO toca el micrófono. Afirmar
          que la app escucha sería una mentira sobre la privacidad del
          conductor — de las peores que puede decir una interfaz. Cuando PR 2
          integre Porcupine, este texto vuelve a ser cierto. */}
      <Mic className="h-4 w-4 shrink-0" aria-hidden />
      <span>
        Activaste “Oye Booster”. Todavía lo estamos preparando: por ahora el micrófono no se usa. Te
        avisaremos cuando esté disponible.
      </span>
    </output>
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
    // `role="note"`, no `role="alert"`: esto es una advertencia permanente, no
    // algo que acaba de pasar. Con `alert` el lector de pantalla lo anunciaba
    // en cada montaje y entrenaba al conductor a ignorar las alertas reales
    // —justo las que sí importan cuando va manejando—.
    <div
      className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm"
      role="note"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <div>
          <div className="font-medium">No uses WhatsApp manejando</div>
          <p className="mt-1 text-amber-800 text-sm leading-snug">
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

  // El fetch vive en un callback para poder repetirlo: el conductor recibe
  // servicios mientras tiene la pantalla abierta, y antes no había forma de
  // verlos sin saber recargar la app.
  const cargarServicios = useCallback(async () => {
    setError(null);
    try {
      const res = await api.get<{ assignments: DriverAssignment[] }>('/me/assignments');
      setAssignments(res.assignments);
    } catch (err) {
      // Mensajes en lenguaje del conductor: `Error 500: boom` no le sirve a
      // alguien que está en ruta.
      setError(
        err instanceof ApiError && err.status === 404
          ? 'No encontramos tu cuenta. Vuelve a iniciar sesión.'
          : 'No pudimos cargar tus servicios. Revisa tu señal e intenta nuevamente.',
      );
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void cargarServicios().finally(() => {
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
      .catch(() => {
        // No tragar el fallo: sin esto el botón de GPS quedaba deshabilitado
        // para siempre y el conductor no sabía por qué.
        if (!cancelled) {
          setGeoPermission('unknown');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cargarServicios]);

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
      <section className="mt-6 space-y-3">
        {/* Este SÍ es un alert: acaba de pasar algo que el conductor tiene que
            saber ahora. */}
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-danger-200 bg-danger-50 p-4 text-danger-700 text-sm"
        >
          {error}
        </div>
        <button
          type="button"
          onClick={() => void cargarServicios()}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-neutral-300 bg-white px-4 py-3 font-medium text-base text-neutral-700 transition hover:bg-neutral-50"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          Reintentar
        </button>
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
        {/* El conductor recibe servicios con la pantalla abierta: sin esto
            tendría que saber recargar la app para verlos. */}
        <button
          type="button"
          onClick={() => void cargarServicios()}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-md border border-neutral-300 bg-white px-4 py-3 font-medium text-base text-neutral-700 transition hover:bg-neutral-50"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          Actualizar
        </button>
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
      <button
        type="button"
        onClick={() => void cargarServicios()}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-neutral-300 bg-white px-4 py-3 font-medium text-base text-neutral-700 transition hover:bg-neutral-50"
      >
        <RefreshCw className="h-4 w-4" aria-hidden />
        Actualizar
      </button>
    </section>
  );
}

/**
 * Traduce el fallo de `PATCH /assignments/:id/confirmar-entrega` a algo que un
 * conductor pueda accionar desde la ruta.
 *
 * Verificado contra el API real (e2e 2026-08-02): con
 * `REQUIRE_DOCUMENT_TO_CLOSE=true` —el default de `config.ts`— el cierre
 * responde 409 `documento_requerido` mientras el viaje no tenga guía o factura
 * subida, y 200 apenas existe una. El conductor **no puede** subirla:
 * `requireWriteRole` en transport-documents exige `dueno|admin|despachador`.
 * Un mensaje genérico lo deja golpeando el botón sin saber que el bloqueo no
 * es suyo ni de su señal.
 */
function mensajeDeCierre(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'documento_requerido':
        return 'Falta la guía de despacho o factura de este viaje. Pídela en tu oficina: desde esta pantalla no se puede subir.';
      case 'ted_no_decodificado':
        return 'El documento del viaje se está procesando. Intenta de nuevo en unos minutos.';
      case 'invalid_status':
        return 'Este viaje ya está entregado o cerrado. No hay nada más que confirmar.';
      case 'forbidden_owner_mismatch':
      case 'no_active_empresa':
        return 'Tu cuenta no tiene permiso para cerrar este viaje. Avísale a tu empresa.';
      case 'assignment_not_found':
      case 'trip_not_found':
        return 'No encontramos este viaje. Actualiza la lista.';
      default:
        // El backend contestó: culpar a la señal sería mentira.
        return 'No pudimos confirmar la entrega. Avísale a tu empresa.';
    }
  }
  return 'No pudimos confirmar la entrega. Revisa tu señal e intenta de nuevo.';
}

/**
 * Traduce el fallo de `PATCH /assignments/:id/confirmar-recogida`.
 *
 * Mismo criterio que `mensajeDeCierre`: si el backend contestó, culpar a la
 * señal sería mentira.
 */
function mensajeDeRecogida(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'invalid_status':
        return 'Este viaje ya no está esperando la carga. Actualiza la lista para ver cómo quedó.';
      case 'forbidden':
        return 'Este viaje no está a tu nombre. Avísale a tu empresa.';
      case 'assignment_not_found':
        return 'No encontramos este viaje. Actualiza la lista.';
      default:
        return 'No pudimos registrar la recogida. Avísale a tu empresa.';
    }
  }
  return 'No pudimos registrar la recogida. Revisa tu señal e intenta de nuevo.';
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
  const [entregando, setEntregando] = useState(false);
  const [entregada, setEntregada] = useState(false);
  const [entregaError, setEntregaError] = useState<string | null>(null);
  const [recogiendo, setRecogiendo] = useState(false);
  const [recogida, setRecogida] = useState(a.status === 'recogido');
  const [recogidaError, setRecogidaError] = useState<string | null>(null);

  async function confirmarRecogida() {
    if (!window.confirm('¿Confirmas que ya cargaste esta carga en el camión?')) {
      return;
    }
    setRecogidaError(null);
    setRecogiendo(true);
    try {
      await api.patch(`/assignments/${a.id}/confirmar-recogida`);
      setRecogida(true);
    } catch (err) {
      setRecogidaError(mensajeDeRecogida(err));
    } finally {
      setRecogiendo(false);
    }
  }

  async function confirmarEntrega() {
    // Acción irreversible en la operación: se confirma antes, para que no la
    // dispare un toque accidental con el celular en el bolsillo.
    if (!window.confirm('¿Confirmas que entregaste esta carga?')) {
      return;
    }
    setEntregaError(null);
    setEntregando(true);
    try {
      await api.patch(`/assignments/${a.id}/confirmar-entrega`);
      setEntregada(true);
    } catch (err) {
      setEntregaError(mensajeDeCierre(err));
    } finally {
      setEntregando(false);
    }
  }

  return (
    <article
      className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm"
      data-testid={`assignment-card-${a.id}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="font-mono text-neutral-600 text-sm">{a.trip.tracking_code}</div>
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
            <div className="text-neutral-500 text-sm">Origen</div>
            <div className="text-neutral-900">{a.trip.origin.address_raw}</div>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-danger-700" aria-hidden />
          <div>
            <div className="text-neutral-500 text-sm">Destino</div>
            <div className="text-neutral-900">{a.trip.destination.address_raw}</div>
          </div>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
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
            <div className="rounded-md bg-success-50 px-3 py-2 text-sm text-success-700">
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

      {/* Acciones del conductor, en SU pantalla.
          Antes acá había un link a `/app/asignaciones/$id`, que es superficie
          del TRANSPORTISTA: el conductor pasa su gate (su empresa es
          transportista) y terminaba viendo herramientas de su jefe — "asignar
          conductor" y el factoring de Cobra hoy—, cuyas acciones después le
          respondían 403. */}
      <div className="mt-4 space-y-2 border-neutral-100 border-t pt-4">
        <a
          href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
            a.trip.destination.address_raw,
          )}`}
          target="_blank"
          rel="noreferrer"
          data-testid="navegar-destino"
          className="flex w-full items-center justify-center gap-2 rounded-md border border-primary-300 bg-primary-50 px-4 py-3 font-medium text-base text-primary-700"
        >
          <MapPin className="h-4 w-4" aria-hidden />
          Navegar al destino
        </a>

        {/* Recogida: solo mientras la carga no subió al camión. Confirmarla
            mueve el viaje a `en_proceso`, que es lo que destraba la posición
            en el link de tracking del destinatario y lo que hace que su
            empresa deje de ver «Por recoger» en Servicios. */}
        {!recogida && (
          <button
            type="button"
            onClick={() => void confirmarRecogida()}
            disabled={recogiendo}
            data-testid="confirmar-recogida"
            className="flex w-full items-center justify-center gap-2 rounded-md bg-primary-600 px-4 py-3 font-medium text-base text-white transition hover:bg-primary-700 disabled:opacity-50"
          >
            <PackageCheck className="h-4 w-4" aria-hidden />
            {recogiendo ? 'Registrando…' : 'Confirmar recogida'}
          </button>
        )}

        {recogidaError && (
          <div
            role="alert"
            aria-live="assertive"
            className="rounded-md border border-danger-200 bg-danger-50 p-2 text-danger-700 text-sm"
          >
            {recogidaError}
          </div>
        )}

        {recogida && (
          <output className="block rounded-md border border-neutral-200 bg-neutral-50 p-2 text-neutral-700 text-sm">
            Carga recogida. Cuando llegues a destino, confirma la entrega.
          </output>
        )}

        {/* La entrega NO exige recogida previa: la tabla de transiciones
            permite `asignado → entregado` y bloquearla castigaría al conductor
            que olvidó apretar el botón anterior. */}
        <button
          type="button"
          onClick={() => void confirmarEntrega()}
          disabled={entregando}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-success-700 px-4 py-3 font-medium text-base text-white transition hover:bg-success-800 disabled:opacity-50"
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          {entregando ? 'Confirmando…' : 'Confirmar entrega'}
        </button>

        {entregaError && (
          <div
            role="alert"
            aria-live="assertive"
            className="rounded-md border border-danger-200 bg-danger-50 p-2 text-danger-700 text-sm"
          >
            {entregaError}
          </div>
        )}
        {entregada && (
          // <output> ya tiene role=status implícito: el lector de pantalla
          // anuncia el cierre sin que haya que declararlo a mano.
          <output className="block rounded-md border border-success-200 bg-success-50 p-2 text-sm text-success-800">
            Entrega confirmada. ¡Gracias!
          </output>
        )}
      </div>
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
