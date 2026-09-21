import { Link, Navigate } from '@tanstack/react-router';
import {
  AlertTriangle,
  CheckCircle2,
  Inbox,
  MapPin,
  MessageCircle,
  Mic,
  Navigation,
  PackageCheck,
  RefreshCw,
  Settings,
  Truck,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { ChatPanel } from '../components/chat/ChatPanel.js';
import { ResultadoViaje } from '../components/conductor/ResultadoViaje.js';
import { EcoRouteMapPreview } from '../components/offers/EcoRouteMapPreview.js';
import { AssignmentEcoRouteCard } from '../components/scoring/AssignmentEcoRouteCard.js';
import { useAssignmentEcoRoute } from '../hooks/use-assignment-eco-route.js';
import { useConfirmarRecogida } from '../hooks/use-confirmar-recogida.js';
import { useDriverPositionReporter } from '../hooks/use-driver-position-reporter.js';
import { useFeatureFlags } from '../hooks/use-feature-flags.js';
import type { MeResponse } from '../hooks/use-me.js';
import { ApiError, api } from '../lib/api-client.js';
import { type LatLng, decodePolyline } from '../lib/polyline.js';
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
 *      ahora (origen → destino, carga, ventana de recogida, vehículo), con
 *      UNA acción principal según la fase: «Confirmar recogida» → «Confirmar
 *      entrega». La posición no es un botón: si el vehículo no tiene
 *      Teltonika, el teléfono reporta solo desde la recogida hasta la
 *      entrega; si lo tiene, el camión reporta y la tarjeta lo dice.
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

export interface DriverAssignment {
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
  vehicle: { id: string; plate: string | null; has_teltonika: boolean } | null;
}

export function ConductorDashboardRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        // Gate por rol: la pantalla es del conductor. Un dueño o despachador
        // que llegue acá (link viejo, URL a mano) vuelve a su shell; el API
        // igual respondería vacío, pero no tiene por qué ver el panel.
        if (ctx.me.active_membership?.role !== 'conductor') {
          return <Navigate to="/app" />;
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
    <header className="border-neutral-200 border-b bg-white pt-safe">
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
  const [refrescando, setRefrescando] = useState(false);

  // El fetch vive en un callback para poder repetirlo: el conductor recibe
  // servicios mientras tiene la pantalla abierta, y antes no había forma de
  // verlos sin saber recargar la app.
  const cargarServicios = useCallback(async () => {
    setError(null);
    setRefrescando(true);
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
    } finally {
      // El PO tocó «Actualizar» y «no funcionó»: sí recargaba, pero sin
      // ninguna señal visible. Ahora el botón lo dice mientras carga.
      setRefrescando(false);
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
          disabled={refrescando}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-md border border-neutral-300 bg-white px-4 py-3 font-medium text-base text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-60"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          {refrescando ? 'Actualizando…' : 'Actualizar'}
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
        disabled={refrescando}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-neutral-300 bg-white px-4 py-3 font-medium text-base text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-60"
      >
        <RefreshCw className="h-4 w-4" aria-hidden />
        {refrescando ? 'Actualizando…' : 'Actualizar'}
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

// ---------------------------------------------------------------------------
// Card de un servicio asignado: una acción principal por fase, posición
// automática. Antes mostraba cuatro botones a la vez (GPS, navegar, recogida,
// entrega) y el conductor no sabía cuál tocar (reporte del PO, 2026-09-14).
// ---------------------------------------------------------------------------

type FaseServicio = 'por_recoger' | 'en_ruta' | 'entregada';

/**
 * Enlace secundario a Google Maps. Con coordenadas va a las coordenadas:
 * el texto de una dirección como «Ruta 5 Norte km 470, La Serena» Google
 * Maps NO lo encuentra y abre un mapa vacío (reporte del PO, 2026-09-14),
 * mientras que la ruta eco de la asignación (Routes API) ya resolvió ambos
 * extremos. No es el camino principal: abrir Maps deja el documento oculto
 * y el browser corta `watchPosition` (BOO-83ND2C).
 */
function mapsHref(address: string, coords: LatLng | null): string {
  const destination = coords ? `${coords.lat},${coords.lng}` : address;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving&dir_action=navigate`;
}

/**
 * Ruta dentro de la tarjeta. El botón principal no sale de Conductor, así
 * el teléfono sigue siendo el reportero. Maps queda en un enlace aparte y,
 * cuando el teléfono es la fuente, el texto dice que eso pausa el GPS.
 */
function NavegacionEnPantalla({
  etiqueta,
  testId,
  mapsTestId,
  address,
  coords,
  polylineEncoded,
  cargandoRuta,
  pausaGps,
  className,
}: {
  etiqueta: string;
  testId: string;
  mapsTestId: string;
  address: string;
  coords: LatLng | null;
  polylineEncoded: string | null;
  cargandoRuta: boolean;
  pausaGps: boolean;
  className: string;
}) {
  const [abierta, setAbierta] = useState(false);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!abierta) {
      return;
    }
    const el = panelRef.current;
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [abierta]);

  return (
    <div className="space-y-2">
      <button
        type="button"
        data-testid={testId}
        className={className}
        aria-expanded={abierta}
        onClick={() => setAbierta((v) => !v)}
      >
        <MapPin className="h-4 w-4" aria-hidden />
        {etiqueta}
      </button>
      {abierta && (
        <section
          ref={panelRef}
          data-testid="ruta-en-app"
          aria-label="Ruta en esta pantalla"
          className="space-y-2 rounded-md border border-neutral-200 bg-white p-2"
        >
          <p className="font-medium text-neutral-900 text-sm">{address}</p>
          {polylineEncoded ? (
            <EcoRouteMapPreview polylineEncoded={polylineEncoded} height={260} />
          ) : cargandoRuta ? (
            <p className="text-neutral-700 text-sm" data-testid="ruta-en-app-cargando">
              Cargando la ruta…
            </p>
          ) : (
            <p className="text-neutral-700 text-sm" data-testid="ruta-en-app-sin-dibujo">
              Todavía no hay un dibujo de la ruta.
            </p>
          )}
          <p className="text-neutral-600 text-sm">
            {pausaGps
              ? 'La ruta queda en esta pantalla y el teléfono sigue enviando la posición.'
              : 'La ruta queda en esta pantalla.'}
          </p>
        </section>
      )}
      <a
        href={mapsHref(address, coords)}
        target="_blank"
        rel="noreferrer"
        data-testid={mapsTestId}
        className="block w-full py-1 text-center text-neutral-500 text-sm underline-offset-2 hover:underline"
      >
        {pausaGps ? 'Abrir en Maps (pausa el reporte GPS)' : 'Abrir en Maps'}
      </a>
    </div>
  );
}

/**
 * Franja de confirmación en la propia tarjeta, en vez del diálogo del
 * navegador: en la PWA de iOS ese diálogo aparece como alerta del sistema,
 * sin el estilo de la app, y la respuesta no siempre devuelve el foco a la
 * página. Dos botones grandes, para operarla con el celular en la mano.
 */
function ConfirmacionInline({
  pregunta,
  onConfirmar,
  onCancelar,
}: {
  pregunta: string;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  return (
    <section
      aria-label="Confirmación"
      data-testid="confirmacion-inline"
      className="space-y-3 rounded-md border border-primary-300 bg-primary-50 p-3"
    >
      <p className="font-medium text-neutral-900 text-sm">{pregunta}</p>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onConfirmar}
          className="flex items-center justify-center gap-2 rounded-md bg-primary-600 px-4 py-3 font-medium text-base text-white transition hover:bg-primary-700"
        >
          Sí, confirmar
        </button>
        <button
          type="button"
          onClick={onCancelar}
          className="flex items-center justify-center rounded-md border border-neutral-300 bg-white px-4 py-3 font-medium text-base text-neutral-700 transition hover:bg-neutral-100"
        >
          No
        </button>
      </div>
    </section>
  );
}

/**
 * Chat in-app del viaje (sistema de registro). Overlay mobile-first: el
 * conductor coordina con el generador desde su pantalla, no desde la de
 * la oficina. Tras entregar, el mismo overlay queda read-only.
 */
function ConductorChat({
  assignmentId,
  readOnly,
  buttonClassName,
}: {
  assignmentId: string;
  readOnly: boolean;
  buttonClassName: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="abrir-chat-viaje"
        aria-label="Abrir chat con el generador de carga"
        className={buttonClassName}
      >
        <MessageCircle className="h-4 w-4" aria-hidden />
        Chat con el generador
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-40 flex flex-col bg-white pt-safe"
          data-testid="chat-viaje-overlay"
        >
          <ChatPanel
            assignmentId={assignmentId}
            title="Chat con el generador de carga"
            readOnly={readOnly}
            onClose={() => setOpen(false)}
          />
        </div>
      ) : null}
    </>
  );
}

export function AssignmentCard({
  assignment,
  geoPermission,
}: {
  assignment: DriverAssignment;
  geoPermission: PermissionStatus;
}) {
  const reporter = useDriverPositionReporter();
  const a = assignment;
  // Con Teltonika la huella se mide con el equipo del camión (T10): el
  // teléfono no tiene que reportar nada y la tarjeta no lo pide.
  const hasTeltonika = a.vehicle?.has_teltonika === true;
  const [entregando, setEntregando] = useState(false);
  const [entregada, setEntregada] = useState(false);
  const [entregaError, setEntregaError] = useState<string | null>(null);
  // Acción pendiente de confirmar. Recogida y entrega son irreversibles en
  // la operación: se confirman antes, para que no las dispare un toque
  // accidental con el celular en el bolsillo. La confirmación es una franja
  // dentro de la tarjeta, no un diálogo del navegador: en la PWA de iOS ese
  // diálogo sale como alerta del sistema, sin estilo y sin devolver el foco.
  const [confirmando, setConfirmando] = useState<'recogida' | 'entrega' | null>(null);

  // Recogida híbrida (T9, medicion-huella-segmento): el geofence del origen
  // —que el API evalúa con cada posición reportada— SUGIERE; el conductor
  // confirma con un tap y viaja el instante del cruce. Sin geofence, el tap
  // manual sigue igual (el servidor pone la hora).
  const recogida = useConfirmarRecogida({
    assignmentId: a.id,
    initialRecogida: a.status === 'recogido',
    geofence: reporter.lastGeofence,
  });

  const fase: FaseServicio = entregada
    ? 'entregada'
    : recogida.recogida
      ? 'en_ruta'
      : 'por_recoger';

  // Extremos de la ruta eco = coordenadas reales de origen y destino para los
  // enlaces de navegación (ver mapsHref). Sin ruta, cae al texto.
  const ecoRoute = useAssignmentEcoRoute(a.id, { enabled: fase !== 'entregada' });
  const polylineEncoded = ecoRoute.data?.polyline_encoded ?? null;
  const extremos = useMemo<{ origen: LatLng; destino: LatLng } | null>(() => {
    if (!polylineEncoded) {
      return null;
    }
    const puntos = decodePolyline(polylineEncoded);
    const origen = puntos[0];
    const destino = puntos[puntos.length - 1];
    return puntos.length >= 2 && origen && destino ? { origen, destino } : null;
  }, [polylineEncoded]);

  // Posición automática (vehículo sin Teltonika). En ruta arranca siempre: es
  // el momento en que iOS pide la ubicación, no antes. Antes de recoger solo
  // si el permiso ya está concedido (sin prompt), para que el geofence del
  // origen pueda sugerir la recogida. Un intento por fase: si el permiso se
  // niega, no se insiste en cada render; queda el botón «Reintentar».
  const { isWatching, start: iniciarReporte } = reporter;
  const intentoAutoInicio = useRef<FaseServicio | null>(null);
  useEffect(() => {
    if (hasTeltonika || isWatching || fase === 'entregada') {
      return;
    }
    if (fase === 'por_recoger' && geoPermission !== 'granted') {
      return;
    }
    if (intentoAutoInicio.current === fase) {
      return;
    }
    intentoAutoInicio.current = fase;
    iniciarReporte(a.id);
  }, [a.id, fase, geoPermission, hasTeltonika, isWatching, iniciarReporte]);

  async function ejecutarConfirmacion() {
    const accion = confirmando;
    setConfirmando(null);
    if (accion === 'recogida') {
      await recogida.confirmar();
    } else if (accion === 'entrega') {
      await entregar();
    }
  }

  async function entregar() {
    setEntregaError(null);
    setEntregando(true);
    try {
      if (!hasTeltonika) {
        // Lo que quedó en cola sin señal cuenta para la cobertura solo si
        // entra ANTES de cerrar: tras la entrega el API lo rechaza (409).
        // flush() está acotado (8 s): si no alcanza, se confirma igual.
        await reporter.flush();
      }
      await api.patch(`/assignments/${a.id}/confirmar-entrega`);
      setEntregada(true);
      if (!hasTeltonika) {
        // La ventana de medición cierra con la entrega: el teléfono deja de
        // reportar solo, sin que el conductor tenga que acordarse.
        reporter.stop();
      }
    } catch (err) {
      setEntregaError(mensajeDeCierre(err));
    } finally {
      setEntregando(false);
    }
  }

  const botonPrimario =
    'flex w-full items-center justify-center gap-2 rounded-md px-4 py-3 font-medium text-base text-white transition disabled:opacity-50';
  const botonSecundario =
    'flex w-full items-center justify-center gap-2 rounded-md border border-primary-300 bg-primary-50 px-4 py-3 font-medium text-base text-primary-700';

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

      {/* Ruta eco sugerida (Slot 3, paso 4): colapsada, el mapa carga al abrir. */}
      {fase !== 'entregada' && (
        <div className="mt-4 overflow-hidden rounded-md border border-success-200">
          <AssignmentEcoRouteCard assignmentId={a.id} />
        </div>
      )}

      {/* Posición: nunca un botón para iniciar. */}
      <div className="mt-4 border-neutral-200 border-t pt-4">
        <div className="flex items-center gap-2 text-neutral-700 text-xs uppercase tracking-wide">
          <Navigation className="h-3 w-3" aria-hidden />
          Posición
        </div>
        {hasTeltonika ? (
          <output data-testid="posicion-camion" className="mt-2 block text-neutral-700 text-sm">
            Tu camión reporta la posición automáticamente. No necesitas hacer nada.
          </output>
        ) : reporter.isWatching ? (
          <output
            data-testid="posicion-en-vivo"
            className="mt-2 block rounded-md bg-success-50 px-3 py-2 text-sm text-success-700"
          >
            {reporter.avisoPausa
              ? `El reporte se pausó al salir de esta pantalla. Ya volvió a enviar · ${reporter.pointsSent} puntos enviados`
              : `Reportando mientras esta pantalla está al frente · ${reporter.pointsSent} puntos enviados`}
            {reporter.queued > 0 ? ` · ${reporter.queued} pendientes de envío` : ''}
          </output>
        ) : fase === 'por_recoger' ? (
          <p className="mt-2 text-neutral-600 text-sm">
            Al confirmar la recogida, tu teléfono empezará a reportar la posición. Si te lo pide,
            permite la ubicación.
          </p>
        ) : fase === 'en_ruta' ? (
          <div className="mt-2 space-y-2">
            <div
              role="alert"
              className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900 text-sm"
            >
              No estamos recibiendo tu posición. Permite la ubicación para app.boosterchile.com y
              vuelve a intentar.
            </div>
            <button
              type="button"
              onClick={() => reporter.start(a.id)}
              data-testid="gps-retry"
              className={botonSecundario}
            >
              <Navigation className="h-4 w-4" aria-hidden />
              Reintentar ubicación
            </button>
          </div>
        ) : null}
        {!hasTeltonika && fase !== 'entregada' && (
          <p data-testid="aviso-maps-pausa" className="mt-2 text-neutral-600 text-sm">
            Si abres Maps, el teléfono deja de enviar la posición hasta que vuelvas a esta pantalla.
            El seguimiento muestra la última que alcanzó a salir.
          </p>
        )}
        {!hasTeltonika && reporter.lastError && (
          <div className="mt-2 rounded-md border border-danger-200 bg-danger-50 p-2 text-danger-700 text-xs">
            {reporter.lastError}
          </div>
        )}
      </div>

      {/* Acciones del conductor, en SU pantalla: UNA principal por fase.
          Antes acá había un link a `/app/asignaciones/$id`, que es superficie
          del TRANSPORTISTA: el conductor pasa su gate (su empresa es
          transportista) y terminaba viendo herramientas de su jefe — "asignar
          conductor" y el factoring de Cobra hoy—, cuyas acciones después le
          respondían 403. */}
      <div className="mt-4 space-y-2 border-neutral-100 border-t pt-4">
        {fase === 'por_recoger' && (
          <>
            {recogida.sugerida && (
              // El geofence solo sugiere: <output> anuncia la llegada al punto
              // de recogida sin disparar nada. El tap sigue siendo del conductor.
              <output
                data-testid="sugerencia-recogida"
                className="block rounded-md border border-primary-200 bg-primary-50 p-2 text-primary-800 text-sm"
              >
                Estás en el punto de recogida. Cuando la carga esté arriba del camión, confírmala.
              </output>
            )}
            {/* Confirmarla mueve el viaje a `en_proceso`, que es lo que destraba la
                posición en el link de tracking del destinatario y lo que hace que
                su empresa deje de ver «Por recoger» en Servicios. */}
            {confirmando === 'recogida' ? (
              <ConfirmacionInline
                pregunta="¿Confirmas que ya cargaste esta carga en el camión?"
                onConfirmar={() => void ejecutarConfirmacion()}
                onCancelar={() => setConfirmando(null)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setConfirmando('recogida')}
                disabled={recogida.recogiendo}
                data-testid="confirmar-recogida"
                className={`${botonPrimario} bg-primary-600 hover:bg-primary-700`}
              >
                <PackageCheck className="h-4 w-4" aria-hidden />
                {recogida.recogiendo ? 'Registrando…' : 'Confirmar recogida'}
              </button>
            )}
            <NavegacionEnPantalla
              etiqueta="Ir al origen"
              testId="navegar-origen"
              mapsTestId="abrir-maps-origen"
              address={a.trip.origin.address_raw}
              coords={extremos?.origen ?? null}
              polylineEncoded={polylineEncoded}
              cargandoRuta={ecoRoute.isPending === true && polylineEncoded == null}
              pausaGps={!hasTeltonika}
              className={botonSecundario}
            />
            {recogida.error && (
              <div
                role="alert"
                aria-live="assertive"
                className="rounded-md border border-danger-200 bg-danger-50 p-2 text-danger-700 text-sm"
              >
                {recogida.error}
              </div>
            )}
            {/* La entrega NO exige recogida previa: la tabla de transiciones
                permite `asignado → entregado` y bloquearla castigaría al conductor
                que olvidó apretar el botón anterior. Pero va como enlace discreto,
                no como botón grande al lado de la recogida. */}
            {confirmando === 'entrega' ? (
              <ConfirmacionInline
                pregunta="¿Confirmas que entregaste esta carga?"
                onConfirmar={() => void ejecutarConfirmacion()}
                onCancelar={() => setConfirmando(null)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setConfirmando('entrega')}
                disabled={entregando}
                aria-label="Confirmar entrega sin haber confirmado la recogida"
                data-testid="entrega-sin-recogida"
                className="block w-full py-2 text-center text-neutral-500 text-sm underline-offset-2 hover:underline disabled:opacity-50"
              >
                {entregando ? 'Confirmando…' : '¿Ya entregaste sin confirmar la recogida?'}
              </button>
            )}
          </>
        )}

        {fase === 'en_ruta' && (
          <>
            <output className="block rounded-md border border-neutral-200 bg-neutral-50 p-2 text-neutral-700 text-sm">
              Carga recogida. Cuando llegues a destino, confirma la entrega.
            </output>
            {confirmando === 'entrega' ? (
              <ConfirmacionInline
                pregunta="¿Confirmas que entregaste esta carga?"
                onConfirmar={() => void ejecutarConfirmacion()}
                onCancelar={() => setConfirmando(null)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setConfirmando('entrega')}
                disabled={entregando}
                data-testid="confirmar-entrega"
                className={`${botonPrimario} bg-success-700 hover:bg-success-800`}
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                {entregando ? 'Confirmando…' : 'Confirmar entrega'}
              </button>
            )}
            <NavegacionEnPantalla
              etiqueta="Ir al destino"
              testId="navegar-destino"
              mapsTestId="abrir-maps-destino"
              address={a.trip.destination.address_raw}
              coords={extremos?.destino ?? null}
              polylineEncoded={polylineEncoded}
              cargandoRuta={ecoRoute.isPending === true && polylineEncoded == null}
              pausaGps={!hasTeltonika}
              className={botonSecundario}
            />
          </>
        )}

        {entregaError && (
          <div
            role="alert"
            aria-live="assertive"
            className="rounded-md border border-danger-200 bg-danger-50 p-2 text-danger-700 text-sm"
          >
            {entregaError}
          </div>
        )}
        {fase === 'entregada' && (
          // <output> ya tiene role=status implícito: el lector de pantalla
          // anuncia el cierre sin que haya que declararlo a mano.
          <>
            <output className="block rounded-md border border-success-200 bg-success-50 p-2 text-sm text-success-800">
              Entrega confirmada. ¡Gracias!
            </output>
            <ResultadoViaje assignmentId={a.id} />
          </>
        )}
        <ConductorChat
          assignmentId={a.id}
          readOnly={fase === 'entregada'}
          buttonClassName={botonSecundario}
        />
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
