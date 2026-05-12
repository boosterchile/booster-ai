import { Link } from '@tanstack/react-router';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  HelpCircle,
  Info,
  Mic,
  MicOff,
  Navigation,
  NavigationOff,
  Volume2,
} from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { useDriverPositionReporter } from '../hooks/use-driver-position-reporter.js';
import type { MeResponse } from '../hooks/use-me.js';
import { ApiError, api } from '../lib/api-client.js';
import { loadAutoplayPreference, saveAutoplayPreference } from '../services/coaching-voice.js';
import {
  type PermissionState,
  type PermissionStatus,
  queryDriverPermissions,
  requestGeolocationPermission,
  requestMicrophonePermission,
} from '../services/driver-mode-permissions.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

/**
 * /app/conductor/modo — onboarding y configuración del **Modo Conductor**
 * (Phase 4 PR-K8).
 *
 * Cierre del ciclo Phase 4 voice-first: K1-K7 implementaron features
 * voice (auto-play coaching, comandos para confirmar entrega, marcar
 * incidente, aceptar oferta, cancelar). Sin esta pantalla, todas esas
 * features eran "descoberables solo por accidente" — el conductor no
 * sabía que existían, no había explicación, y no había forma centralizada
 * de habilitar/probar los permisos del browser.
 *
 * **Una sola pantalla** con 4 cards:
 *
 *   1. **Audio coaching automático** — toggle único persistido en
 *      localStorage. ON = al terminar viaje se reproduce el coaching IA
 *      en voz alta sin que el conductor toque nada (gated por vehículo
 *      parado). OFF = mute, requiere tap manual del play.
 *
 *   2. **Permisos del navegador** — estado actual de mic + GPS con
 *      botones "Permitir" cuando están en `prompt`. Si están `denied`,
 *      muestra instrucción de habilitarlo en settings del browser.
 *
 *   3. **Comandos de voz disponibles** — lista de los 4 intents con
 *      las frases que disparan cada uno. Lectura — el "probar mic" real
 *      vive dentro de cada feature card (DeliveryConfirmCard,
 *      IncidentReportCard, VoiceAcceptOfferControl).
 *
 *   4. **Cómo funciona** — explainer breve del flujo: detección de
 *      vehículo parado (histeresis 3/8 km/h, HOLD_MS=4000ms), doble
 *      confirmación, comando "cancelar" como abort universal.
 *
 * **No bloquea ninguna feature**: si el conductor entra a `/app/ofertas`
 * sin haber visitado esta página, las features voice siguen funcionando
 * (con prompts de permiso ad-hoc del browser). Esta pantalla es para
 * onboarding + troubleshooting + transparencia de qué requiere Booster.
 */

export function ConductorModoRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        return <ConductorModoPage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function ConductorModoPage({ me }: { me: MeOnboarded }) {
  const [autoplayEnabled, setAutoplayEnabled] = useState(() => loadAutoplayPreference());
  const [permissions, setPermissions] = useState<PermissionState>({
    mic: 'unknown',
    geo: 'unknown',
  });
  const [requestingMic, setRequestingMic] = useState(false);
  const [requestingGeo, setRequestingGeo] = useState(false);

  // Initial query de permisos al montar. No dispara prompts — solo lee
  // el estado actual del browser.
  useEffect(() => {
    let cancelled = false;
    queryDriverPermissions()
      .then((state) => {
        if (!cancelled) {
          setPermissions(state);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPermissions({ mic: 'unknown', geo: 'unknown' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleAutoplayToggle(checked: boolean) {
    setAutoplayEnabled(checked);
    saveAutoplayPreference(checked);
  }

  async function handleRequestMic() {
    setRequestingMic(true);
    try {
      const newStatus = await requestMicrophonePermission();
      setPermissions((prev) => ({ ...prev, mic: newStatus }));
    } finally {
      setRequestingMic(false);
    }
  }

  async function handleRequestGeo() {
    setRequestingGeo(true);
    try {
      const newStatus = await requestGeolocationPermission();
      setPermissions((prev) => ({ ...prev, geo: newStatus }));
    } finally {
      setRequestingGeo(false);
    }
  }

  return (
    <Layout me={me} title="Modo Conductor">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <Link
          to="/app"
          className="mb-4 inline-flex items-center gap-1 text-neutral-600 text-sm transition hover:text-neutral-900"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Volver al inicio
        </Link>

        <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">Modo Conductor</h1>
        <p className="mt-2 max-w-xl text-neutral-600 text-sm">
          Configura una sola vez antes de manejar. Activamos audio, voz y GPS para que puedas operar
          la app sin tocar la pantalla mientras conduces.
        </p>

        <div className="mt-8 space-y-4">
          <AutoplayCard enabled={autoplayEnabled} onChange={handleAutoplayToggle} />
          <PermissionsCard
            permissions={permissions}
            onRequestMic={handleRequestMic}
            onRequestGeo={handleRequestGeo}
            requestingMic={requestingMic}
            requestingGeo={requestingGeo}
          />
          <MobileGpsReporterCard geoPermission={permissions.geo} />
          <VoiceCommandsReferenceCard />
          <HowItWorksCard />
        </div>
      </div>
    </Layout>
  );
}

// ---------------------------------------------------------------------------
// D2 — Card: Reporte GPS móvil para vehículos SIN Teltonika
// ---------------------------------------------------------------------------

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

function MobileGpsReporterCard({ geoPermission }: { geoPermission: PermissionStatus }) {
  // Estado de la lista de asignaciones activas del conductor logueado.
  // Se carga al montar; el conductor elige una en vez de pegar UUID.
  const [assignments, setAssignments] = useState<DriverAssignment[]>([]);
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const [assignmentsError, setAssignmentsError] = useState<string | null>(null);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string>('');
  const reporter = useDriverPositionReporter();

  // biome-ignore lint/correctness/useExhaustiveDependencies: cargar una sola
  // vez al montar el componente.
  useEffect(() => {
    let cancelled = false;
    setLoadingAssignments(true);
    setAssignmentsError(null);
    api
      .get<{ assignments: DriverAssignment[] }>('/me/assignments')
      .then((res) => {
        if (cancelled) {
          return;
        }
        setAssignments(res.assignments);
        // Pre-seleccionar si hay una sola asignación activa.
        if (res.assignments.length === 1) {
          setSelectedAssignmentId(res.assignments[0]?.id ?? '');
        }
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        const msg =
          err instanceof ApiError
            ? err.status === 404
              ? 'No encontramos tu cuenta en el sistema.'
              : `${err.status}: ${err.message}`
            : (err as Error).message;
        setAssignmentsError(msg);
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingAssignments(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const canStart =
    geoPermission === 'granted' && selectedAssignmentId.trim().length > 0 && !reporter.isWatching;

  return (
    <section
      aria-label="Reporte GPS móvil"
      className="rounded-lg border border-neutral-200 bg-white p-5"
      data-testid="gps-reporter-card"
    >
      <div className="flex items-start gap-3">
        <Navigation className="mt-0.5 h-5 w-5 shrink-0 text-primary-700" aria-hidden />
        <div className="flex-1">
          <h2 className="font-semibold text-base text-neutral-900">
            Reporte GPS móvil (sin Teltonika)
          </h2>
          <p className="mt-1 text-neutral-600 text-sm">
            Si tu vehículo no tiene equipo Teltonika instalado, podemos seguir tu trayecto usando el
            GPS de tu teléfono. Elegí cuál asignación querés reportar.
          </p>

          {geoPermission !== 'granted' && (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900 text-xs">
              Habilita el permiso GPS arriba antes de iniciar el reporte.
            </div>
          )}

          {loadingAssignments && (
            <div className="mt-3 text-neutral-500 text-sm">Cargando tus asignaciones…</div>
          )}

          {assignmentsError && (
            <div className="mt-3 rounded-md border border-danger-200 bg-danger-50 p-2 text-danger-700 text-xs">
              No pudimos cargar tus asignaciones: {assignmentsError}
            </div>
          )}

          {!loadingAssignments && !assignmentsError && assignments.length === 0 && (
            <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-neutral-600 text-sm">
              No tenés asignaciones activas en este momento. Cuando tu carrier te asigne un viaje,
              aparecerá acá.
            </div>
          )}

          {assignments.length > 0 && (
            <div className="mt-3 space-y-2">
              <div className="text-neutral-700 text-xs uppercase tracking-wide">
                Tus asignaciones activas
              </div>
              <ul className="space-y-2" data-testid="gps-reporter-assignment-list">
                {assignments.map((a) => {
                  const isSelected = selectedAssignmentId === a.id;
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedAssignmentId(a.id)}
                        disabled={reporter.isWatching}
                        className={`w-full rounded-md border p-3 text-left transition disabled:opacity-50 ${
                          isSelected
                            ? 'border-primary-500 bg-primary-50'
                            : 'border-neutral-200 hover:bg-neutral-50'
                        }`}
                        data-testid={`gps-reporter-assignment-${a.id}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-mono text-neutral-500 text-xs">
                            {a.trip.tracking_code}
                          </div>
                          <div className="text-neutral-500 text-xs">
                            {a.vehicle?.plate ?? 'Sin patente'}
                          </div>
                        </div>
                        <div className="mt-1 text-neutral-900 text-sm">
                          {a.trip.origin.address_raw} → {a.trip.destination.address_raw}
                        </div>
                        <div className="mt-1 text-neutral-500 text-xs">
                          {a.trip.cargo_type} ·{' '}
                          {a.trip.cargo_weight_kg
                            ? `${a.trip.cargo_weight_kg.toLocaleString('es-CL')} kg`
                            : 'peso no declarado'}{' '}
                          · {a.carrier_empresa.legal_name ?? 'Carrier'}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="mt-3">
            {reporter.isWatching ? (
              <button
                type="button"
                onClick={() => reporter.stop()}
                className="w-full rounded-md bg-danger-600 px-4 py-2 font-medium text-sm text-white hover:bg-danger-700"
                data-testid="gps-reporter-stop"
              >
                Detener reporte
              </button>
            ) : (
              <button
                type="button"
                onClick={() => reporter.start(selectedAssignmentId.trim())}
                disabled={!canStart}
                className="w-full rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-50"
                data-testid="gps-reporter-start"
              >
                Iniciar reporte de la asignación seleccionada
              </button>
            )}
          </div>

          {reporter.isWatching && (
            <div className="mt-3 rounded-md bg-success-50 px-3 py-2 text-success-700 text-sm">
              Reportando posición en vivo · {reporter.pointsSent} puntos enviados
              {reporter.lastPosition && (
                <div className="mt-1 font-mono text-xs">
                  {reporter.lastPosition.latitude.toFixed(5)},{' '}
                  {reporter.lastPosition.longitude.toFixed(5)}
                </div>
              )}
            </div>
          )}

          {reporter.lastError && (
            <div className="mt-3 rounded-md border border-danger-200 bg-danger-50 p-2 text-danger-700 text-xs">
              {reporter.lastError}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Card: Audio coaching automático
// ---------------------------------------------------------------------------

interface AutoplayCardProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

function AutoplayCard({ enabled, onChange }: AutoplayCardProps) {
  return (
    <section
      aria-label="Audio coaching automático"
      className="rounded-lg border border-neutral-200 bg-white p-5"
      data-testid="autoplay-card"
    >
      <div className="flex items-start gap-3">
        <Volume2 className="mt-0.5 h-5 w-5 shrink-0 text-primary-700" aria-hidden />
        <div className="flex-1">
          <h2 className="font-semibold text-base text-neutral-900">Audio coaching automático</h2>
          <p className="mt-1 text-neutral-600 text-sm">
            Cuando termines una entrega y el vehículo esté detenido, Booster te dice por voz cómo
            mejoraste tu manejo eco-eficiente en ese viaje. Sin tocar la pantalla.
          </p>

          <label className="mt-3 flex items-center gap-3 text-neutral-800 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => onChange(e.target.checked)}
              className="h-5 w-5 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
              data-testid="autoplay-toggle"
            />
            <span className="font-medium">
              {enabled
                ? 'Activado · escucharás coaching al terminar viajes'
                : 'Desactivado · botón manual de play en cada coaching'}
            </span>
          </label>

          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-neutral-500">
            <Info className="mt-px h-3 w-3 shrink-0" aria-hidden />
            Por seguridad, solo arranca cuando el vehículo está detenido (≤3 km/h por 4 s). Si
            comienzas a moverte se pausa.
          </p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Card: Permisos del navegador
// ---------------------------------------------------------------------------

interface PermissionsCardProps {
  permissions: PermissionState;
  onRequestMic: () => void;
  onRequestGeo: () => void;
  requestingMic: boolean;
  requestingGeo: boolean;
}

function PermissionsCard({
  permissions,
  onRequestMic,
  onRequestGeo,
  requestingMic,
  requestingGeo,
}: PermissionsCardProps) {
  return (
    <section
      aria-label="Permisos del navegador"
      className="rounded-lg border border-neutral-200 bg-white p-5"
      data-testid="permissions-card"
    >
      <h2 className="font-semibold text-base text-neutral-900">Permisos del navegador</h2>
      <p className="mt-1 text-neutral-600 text-sm">
        Booster necesita acceso al micrófono (para los comandos de voz) y al GPS (para detectar
        cuándo estás detenido y reproducir audio de forma segura).
      </p>

      <div className="mt-4 space-y-3">
        <PermissionRow
          icon={
            permissions.mic === 'granted' ? (
              <Mic className="h-5 w-5 text-success-700" aria-hidden />
            ) : (
              <MicOff className="h-5 w-5 text-neutral-500" aria-hidden />
            )
          }
          name="Micrófono"
          status={permissions.mic}
          purpose='Para decir "aceptar oferta", "confirmar entrega", "marcar incidente".'
          onRequest={onRequestMic}
          requesting={requestingMic}
          testIdPrefix="mic"
        />
        <PermissionRow
          icon={
            permissions.geo === 'granted' ? (
              <Navigation className="h-5 w-5 text-success-700" aria-hidden />
            ) : (
              <NavigationOff className="h-5 w-5 text-neutral-500" aria-hidden />
            )
          }
          name="GPS / Ubicación"
          status={permissions.geo}
          purpose="Para detectar cuándo el vehículo está detenido y reproducir audio sin distraer."
          onRequest={onRequestGeo}
          requesting={requestingGeo}
          testIdPrefix="geo"
        />
      </div>
    </section>
  );
}

interface PermissionRowProps {
  icon: ReactNode;
  name: string;
  status: PermissionStatus;
  purpose: string;
  onRequest: () => void;
  requesting: boolean;
  testIdPrefix: string;
}

function PermissionRow({
  icon,
  name,
  status,
  purpose,
  onRequest,
  requesting,
  testIdPrefix,
}: PermissionRowProps) {
  return (
    <div
      className="flex flex-col gap-3 rounded-md bg-neutral-50 p-3 sm:flex-row sm:items-center"
      data-testid={`${testIdPrefix}-permission-row`}
    >
      <div className="flex items-start gap-3 sm:flex-1">
        <div className="mt-0.5 shrink-0">{icon}</div>
        <div className="flex-1">
          <p className="font-medium text-neutral-900 text-sm">{name}</p>
          <p className="text-neutral-600 text-xs">{purpose}</p>
          <p className="mt-1 text-[11px]" data-testid={`${testIdPrefix}-status`}>
            <StatusBadge status={status} />
          </p>
        </div>
      </div>
      <div className="sm:shrink-0">
        {(status === 'prompt' || status === 'unknown') && (
          <button
            type="button"
            onClick={onRequest}
            disabled={requesting}
            className="inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white shadow-xs transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
            data-testid={`${testIdPrefix}-request-btn`}
          >
            {requesting ? 'Solicitando…' : 'Permitir'}
          </button>
        )}
        {status === 'denied' && (
          <p
            className="max-w-[16rem] text-amber-700 text-xs"
            data-testid={`${testIdPrefix}-denied-help`}
          >
            Activa este permiso en la configuración del navegador y vuelve a esta pantalla.
          </p>
        )}
        {status === 'granted' && (
          <span
            className="inline-flex items-center gap-1 rounded-md bg-success-50 px-2 py-1 font-medium text-success-800 text-xs"
            data-testid={`${testIdPrefix}-granted-pill`}
          >
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            Activado
          </span>
        )}
        {status === 'unsupported' && (
          <p className="max-w-[16rem] text-neutral-500 text-xs">
            Tu navegador no soporta este permiso. Prueba con Chrome o Safari recientes.
          </p>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: PermissionStatus }) {
  switch (status) {
    case 'granted':
      return <span className="text-success-700">Concedido</span>;
    case 'denied':
      return <span className="text-amber-700">Bloqueado</span>;
    case 'prompt':
      return <span className="text-neutral-600">Pendiente</span>;
    case 'unsupported':
      return <span className="text-neutral-500">No soportado</span>;
    default:
      return <span className="text-neutral-500">Estado desconocido</span>;
  }
}

// ---------------------------------------------------------------------------
// Card: Comandos de voz disponibles
// ---------------------------------------------------------------------------

interface VoiceCommandEntry {
  intent: string;
  title: string;
  phrases: string[];
  context: string;
}

const VOICE_COMMANDS: VoiceCommandEntry[] = [
  {
    intent: 'aceptar_oferta',
    title: 'Aceptar oferta',
    phrases: ['aceptar oferta', 'tomar oferta', 'acepto la oferta'],
    context: 'En la pantalla de Ofertas, cuando hay una sola oferta pendiente.',
  },
  {
    intent: 'confirmar_entrega',
    title: 'Confirmar entrega',
    phrases: ['confirmar entrega', 'ya entregué', 'entrega confirmada'],
    context: 'En el detalle de la asignación, después de descargar la mercadería.',
  },
  {
    intent: 'marcar_incidente',
    title: 'Marcar incidente',
    phrases: ['incidente', 'reportar problema', 'tengo un problema'],
    context: 'Cualquier momento del viaje. Luego eliges el tipo (accidente, demora, etc.).',
  },
  {
    intent: 'cancelar',
    title: 'Cancelar',
    phrases: ['cancelar', 'detente', 'olvídalo'],
    context: 'Si dijiste algo por error y aún no se procesó, abortas la acción.',
  },
];

function VoiceCommandsReferenceCard() {
  return (
    <section
      aria-label="Comandos de voz disponibles"
      className="rounded-lg border border-neutral-200 bg-white p-5"
      data-testid="voice-commands-card"
    >
      <div className="flex items-start gap-3">
        <Mic className="mt-0.5 h-5 w-5 shrink-0 text-primary-700" aria-hidden />
        <div className="flex-1">
          <h2 className="font-semibold text-base text-neutral-900">Comandos de voz disponibles</h2>
          <p className="mt-1 text-neutral-600 text-sm">
            Cada acción crítica del viaje se puede ejecutar diciéndola en voz alta. Mantén
            presionado el botón del micrófono en la card correspondiente y dí la frase.
          </p>

          <ul className="mt-4 space-y-3">
            {VOICE_COMMANDS.map((cmd) => (
              <li
                key={cmd.intent}
                className="rounded-md border border-neutral-100 bg-neutral-50 p-3"
                data-testid={`voice-cmd-${cmd.intent}`}
              >
                <p className="font-medium text-neutral-900 text-sm">{cmd.title}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {cmd.phrases.map((p) => (
                    <span
                      key={p}
                      className="inline-flex rounded-md bg-white px-2 py-0.5 font-mono text-[11px] text-neutral-700 ring-1 ring-neutral-200"
                    >
                      "{p}"
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-neutral-600 text-xs">{cmd.context}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Card: Cómo funciona
// ---------------------------------------------------------------------------

function HowItWorksCard() {
  return (
    <section
      aria-label="Cómo funciona el modo conductor"
      className="rounded-lg border border-primary-200 bg-primary-50/40 p-5"
      data-testid="how-it-works-card"
    >
      <div className="flex items-start gap-3">
        <HelpCircle className="mt-0.5 h-5 w-5 shrink-0 text-primary-700" aria-hidden />
        <div className="flex-1">
          <h2 className="font-semibold text-base text-primary-900">Cómo funciona</h2>
          <ul className="mt-3 space-y-2 text-neutral-700 text-sm">
            <li className="flex items-start gap-2">
              <span
                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-600"
                aria-hidden
              />
              <span>
                <strong>Detección de vehículo parado</strong>: el GPS reporta velocidad. Cuando cae
                a ≤3 km/h por al menos 4 segundos, te consideramos "detenido" y habilitamos audio +
                comandos seguros.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span
                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-600"
                aria-hidden
              />
              <span>
                <strong>Doble confirmación</strong>: para acciones críticas (aceptar oferta,
                confirmar entrega) pedimos repetir la frase o tocar un botón grande verde. Esto
                evita falsos positivos si dices la palabra en una conversación casual.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span
                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-600"
                aria-hidden
              />
              <span>
                <strong>"Cancelar" siempre funciona</strong>: si te equivocaste, di "cancelar"
                dentro de los 4 segundos siguientes y la acción se descarta.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span
                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-600"
                aria-hidden
              />
              <span>
                <strong>Toques al volante son ilegales</strong> (Ley 18.290 art. 199 letra C).
                Booster está diseñado para minimizar toques: voz primero, botones grandes segundos.
                Si tu pasajero/copiloto va contigo, también puede operar la app.
              </span>
            </li>
          </ul>

          <div className="mt-4 flex items-start gap-2 rounded-md bg-white p-3 text-neutral-700 text-xs ring-1 ring-primary-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
            <span>
              <strong>No usar WhatsApp manejando.</strong> El coaching y los avisos críticos te
              llegan por audio dentro de Booster. WhatsApp queda solo para coordinar con el
              destinatario o el generador de la carga antes y después del viaje.
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
