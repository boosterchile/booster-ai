import { Link, Navigate } from '@tanstack/react-router';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  HelpCircle,
  Info,
  LogOut,
  Navigation,
  NavigationOff,
  Radio,
  Volume2,
} from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { signOutUser } from '../hooks/use-auth.js';
import { useFeatureFlags } from '../hooks/use-feature-flags.js';
import type { MeResponse } from '../hooks/use-me.js';
import { loadAutoplayPreference, saveAutoplayPreference } from '../services/coaching-voice.js';
import {
  type PermissionState,
  type PermissionStatus,
  queryDriverPermissions,
  requestGeolocationPermission,
} from '../services/driver-mode-permissions.js';
import { isWakeWordEnabled, setWakeWordEnabled } from '../services/wake-word-preference.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

/**
 * /app/conductor/configuracion — configuración del **Modo Conductor**
 * (refactor del antiguo /app/conductor/modo, Phase 4 PR-K8).
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
 *   2. **Permisos del navegador** — estado actual del GPS con botón
 *      "Permitir" cuando está en `prompt`. Si está `denied`, muestra la
 *      instrucción de habilitarlo en settings del browser. El micrófono
 *      ya no se pide acá: /app/conductor no monta ningún control de voz
 *      (los intents por voz viven en las feature cards de ofertas e
 *      incidentes, que no están en el panel del conductor), y pedirlo
 *      confundía —en iOS reaparecía el prompt en cada sesión.
 *
 *   3. **Activación por voz** — wake-word «Oye Booster» (ADR-036),
 *      detrás de feature flag.
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

export function ConductorConfiguracionRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        // Gate por rol, igual que /app/conductor: esta configuración es del
        // conductor; cualquier otro rol vuelve a su shell.
        if (ctx.me.active_membership?.role !== 'conductor') {
          return <Navigate to="/app" />;
        }
        return <ConductorConfiguracionPage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function ConductorConfiguracionPage({ me: _me }: { me: MeOnboarded }) {
  const [autoplayEnabled, setAutoplayEnabled] = useState(() => loadAutoplayPreference());
  const [permissions, setPermissions] = useState<PermissionState>({
    mic: 'unknown',
    geo: 'unknown',
  });
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
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <header className="border-neutral-200 border-b bg-white pt-safe">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link
            to="/app/conductor"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-neutral-600 transition hover:bg-neutral-100"
            aria-label="Volver al panel del conductor"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Link>
          <div>
            <h1 className="font-semibold text-base text-neutral-900">
              Configuración del Modo Conductor
            </h1>
            <p className="text-neutral-500 text-xs">Ajustes que se guardan en este dispositivo</p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <p className="max-w-xl text-neutral-600 text-sm">
          Configura una sola vez antes de manejar. Con el audio y el GPS activos la app te avisa
          sola y mide el viaje sin que tengas que tocar la pantalla.
        </p>

        <div className="mt-6 space-y-4">
          <AutoplayCard enabled={autoplayEnabled} onChange={handleAutoplayToggle} />
          <PermissionsCard
            permissions={permissions}
            onRequestGeo={handleRequestGeo}
            requestingGeo={requestingGeo}
          />
          <WakeWordCard />
          <HowItWorksCard />
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
          {/* El shell del conductor no tiene sidebar (donde el operador tiene
              "Salir"), así que la salida vive acá, junto al resto de lo que el
              conductor gestiona de su dispositivo. Solo cierra sesión:
              ProtectedRoute redirige a /login cuando el user queda null. */}
          <button
            type="button"
            onClick={() => {
              void signOutUser();
            }}
            className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-neutral-600 text-sm hover:bg-neutral-100 hover:text-neutral-900"
            style={{ minHeight: 'var(--touch-min)' }}
          >
            <LogOut className="h-4 w-4 shrink-0" aria-hidden />
            Salir
          </button>
          <Link
            to="/app/conductor"
            className="inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700"
          >
            Listo, volver al panel
          </Link>
        </div>
      </main>
    </div>
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

          <p className="mt-2 flex items-start gap-1.5 text-neutral-500 text-sm">
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
  onRequestGeo: () => void;
  requestingGeo: boolean;
}

// Solo GPS. El micrófono se pedía para comandos de voz que la app del
// conductor no ejecuta (no hay ningún control de voz montado en
// /app/conductor); pedirlo confundía y, en iOS, reaparecía en cada sesión.
function PermissionsCard({ permissions, onRequestGeo, requestingGeo }: PermissionsCardProps) {
  return (
    <section
      aria-label="Permisos del navegador"
      className="rounded-lg border border-neutral-200 bg-white p-5"
      data-testid="permissions-card"
    >
      <h2 className="font-semibold text-base text-neutral-900">Permisos del navegador</h2>
      <p className="mt-1 text-neutral-600 text-sm">
        Booster necesita acceso al GPS para medir el viaje cuando el camión no tiene equipo
        instalado y para reproducir audio solo cuando estás detenido.
      </p>

      <div className="mt-4 space-y-3">
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
          <p className="mt-1 text-sm" data-testid={`${testIdPrefix}-status`}>
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
// Card: Activación por voz (ADR-036 — wake-word "Oye Booster")
// ---------------------------------------------------------------------------

function WakeWordCard() {
  const { flags } = useFeatureFlags();
  const [enabled, setEnabled] = useState(() => isWakeWordEnabled());
  const featureLive = flags.wake_word_voice_activated;

  function handleToggle(checked: boolean) {
    setEnabled(checked);
    setWakeWordEnabled(checked);
  }

  return (
    <section
      aria-label="Activación por voz"
      className="rounded-lg border border-neutral-200 bg-white p-5"
      data-testid="wake-word-card"
    >
      <div className="flex items-start gap-3">
        <Radio className="mt-0.5 h-5 w-5 shrink-0 text-primary-700" aria-hidden />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-base text-neutral-900">Activación por voz</h2>
            {!featureLive && (
              <span className="inline-flex items-center rounded-md bg-neutral-100 px-2 py-0.5 font-medium text-neutral-600 text-xs">
                Próximamente
              </span>
            )}
          </div>
          {/* Todo lo que sigue está en FUTURO a propósito. El reconocedor es un
              stub declarado (`services/wake-word.ts`, Wave 5 PR 1): no abre el
              micrófono. Redactar la privacidad en presente —"solo escuchamos",
              "el micrófono se pausa"— le dice al conductor que la app lo está
              escuchando ahora, y no es verdad. Cuando PR 2 integre Porcupine,
              este texto pasa a presente. */}
          <p className="mt-1 text-neutral-600 text-sm">
            Cuando esté disponible, vas a poder decir <strong>“Oye Booster”</strong> con el vehículo
            detenido y dar tu comando sin tocar la pantalla.
          </p>

          {featureLive ? (
            <label
              className="mt-3 flex items-center gap-3 text-neutral-800 text-sm"
              data-testid="wake-word-toggle-label"
            >
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => handleToggle(e.target.checked)}
                className="h-5 w-5 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
                data-testid="wake-word-toggle"
              />
              <span className="font-medium">
                {enabled
                  ? 'Lo quiero activado · todavía lo estamos preparando'
                  : 'Desactivado · seguir usando el botón de mic en cada acción'}
              </span>
            </label>
          ) : (
            <div
              className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-neutral-600 text-sm"
              data-testid="wake-word-not-yet"
            >
              Estamos entrenando el reconocedor con voces chilenas. Cuando esté listo, podrás
              activarlo desde aquí. Mientras tanto, los comandos de voz funcionan tocando el ícono
              de micrófono.
            </div>
          )}

          <div className="mt-3 space-y-1 text-neutral-500 text-sm">
            <p className="flex items-start gap-1.5">
              <Info className="mt-px h-3 w-3 shrink-0" aria-hidden />
              Hoy la app no usa el micrófono por su cuenta: solo se abre cuando tú tocas el botón de
              mic.
            </p>
            <p className="flex items-start gap-1.5">
              <Info className="mt-px h-3 w-3 shrink-0" aria-hidden />
              Cuando lo activemos, reconoceremos solo la frase “Oye Booster”, el audio se procesará
              en tu teléfono sin enviarse a Booster, y se pausará al moverse el vehículo, al
              apagarse la pantalla o al cambiar de pestaña.
            </p>
          </div>
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
