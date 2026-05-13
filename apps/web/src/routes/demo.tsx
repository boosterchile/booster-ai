import { useNavigate } from '@tanstack/react-router';
import {
  ArrowRight,
  BarChart3,
  Building2,
  CheckCircle2,
  Leaf,
  Lock,
  type LucideIcon,
  ShieldCheck,
  Sparkles,
  Truck,
  UserRound,
} from 'lucide-react';
import { useState } from 'react';
import { signInDriverWithCustomToken } from '../hooks/use-auth.js';
import { getApiUrl } from '../lib/api-url.js';

type Persona = 'shipper' | 'carrier' | 'conductor' | 'stakeholder';

interface DemoLoginResponse {
  custom_token: string;
  persona: Persona;
  redirect_to: string;
}

interface PersonaCard {
  persona: Persona;
  role: string;
  entityName: string;
  Icon: LucideIcon;
  tagline: string;
  highlights: readonly string[];
  /** Color de acento Tailwind para la card (palette del proyecto). */
  accent: 'primary' | 'sky' | 'amber' | 'violet';
}

const PERSONAS: readonly PersonaCard[] = [
  {
    persona: 'shipper',
    role: 'Generador de carga',
    entityName: 'Andina Demo S.A.',
    Icon: Building2,
    tagline: 'Publica cargas, ve ofertas y descarga certificados de huella verificada.',
    highlights: [
      '2 sucursales activas (Maipú, Quilicura)',
      'Matching automático con transportistas',
      'Certificados GLEC v3.0 descargables',
    ],
    accent: 'sky',
  },
  {
    persona: 'carrier',
    role: 'Transportista',
    entityName: 'Transportes Demo Sur',
    Icon: Truck,
    tagline: 'Acepta cargas, asigna conductor y vehículo, factura sin papeles.',
    highlights: [
      '2 vehículos · 1 conductor activo',
      'Seguimiento en tiempo real vía Teltonika',
      'Cobra Hoy · pronto pago integrado',
    ],
    accent: 'primary',
  },
  {
    persona: 'conductor',
    role: 'Conductor profesional',
    entityName: 'Pedro González — RUT 12.345.678-5',
    Icon: UserRound,
    tagline: 'Ve tu próximo viaje, navega con la ruta eco y reporta GPS desde el celular.',
    highlights: [
      'Modo Conductor full-screen',
      'Ruta eco-eficiente sugerida',
      'GPS móvil cuando no hay Teltonika',
    ],
    accent: 'amber',
  },
  {
    persona: 'stakeholder',
    role: 'Observatorio sostenibilidad',
    entityName: 'Observatorio Logístico (Mesa pública)',
    Icon: BarChart3,
    tagline: 'Métricas agregadas por zona logística con k-anonimización ≥ 5.',
    highlights: [
      'Zonas: puertos, mercados, polos industriales',
      'Sin PII, sin empresas individuales',
      'Metodología pública auditable',
    ],
    accent: 'violet',
  },
];

const ACCENT_CLASSES: Record<
  PersonaCard['accent'],
  { ring: string; iconBg: string; iconFg: string; pill: string; button: string }
> = {
  primary: {
    ring: 'hover:border-primary-300 hover:shadow-primary-100',
    iconBg: 'bg-primary-50',
    iconFg: 'text-primary-700',
    pill: 'bg-primary-50 text-primary-800',
    button: 'bg-primary-600 hover:bg-primary-700 focus-visible:ring-primary-400',
  },
  sky: {
    ring: 'hover:border-sky-300 hover:shadow-sky-100',
    iconBg: 'bg-sky-50',
    iconFg: 'text-sky-700',
    pill: 'bg-sky-50 text-sky-800',
    button: 'bg-sky-700 hover:bg-sky-800 focus-visible:ring-sky-400',
  },
  amber: {
    ring: 'hover:border-amber-300 hover:shadow-amber-100',
    iconBg: 'bg-amber-50',
    iconFg: 'text-amber-700',
    pill: 'bg-amber-50 text-amber-900',
    button: 'bg-amber-600 hover:bg-amber-700 focus-visible:ring-amber-400',
  },
  violet: {
    ring: 'hover:border-violet-300 hover:shadow-violet-100',
    iconBg: 'bg-violet-50',
    iconFg: 'text-violet-700',
    pill: 'bg-violet-50 text-violet-800',
    button: 'bg-violet-700 hover:bg-violet-800 focus-visible:ring-violet-400',
  },
};

const CERTIFICATIONS = [
  { label: 'GLEC v3.0', tooltip: 'Global Logistics Emissions Council' },
  { label: 'GHG Protocol', tooltip: 'Estándar internacional de emisiones' },
  { label: 'ISO 14064', tooltip: 'Verificación de gases de efecto invernadero' },
  { label: 'k-anonymity ≥ 5', tooltip: 'Privacidad agregada para stakeholders' },
] as const;

/**
 * /demo — Selector de persona para el subdominio demo.boosterchile.com.
 *
 * Diseño profesional alineado con el sistema de marca Booster AI:
 *   - Logo SVG real (no placeholder)
 *   - Tipografía Inter con jerarquía clara
 *   - Cards con icono Lucide, acento de color por rol, métricas mock que
 *     muestran lo que verá cada persona post-login
 *   - Badges de certificaciones (GLEC v3, GHG Protocol, ISO 14064)
 *   - Sección "Qué es esto" para contexto Corfo / B2B
 *
 * Click en card → POST /demo/login → custom token Firebase (claim
 * `is_demo: true`) → signInWithCustomToken → navigate al surface
 * correcto (devuelto por el backend en `redirect_to`).
 */
export function DemoRoute() {
  const navigate = useNavigate();
  const [loadingPersona, setLoadingPersona] = useState<Persona | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleEnter(persona: Persona) {
    setErrorMessage(null);
    setLoadingPersona(persona);
    try {
      const res = await fetch(`${getApiUrl()}/demo/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ persona }),
      });

      if (res.status === 503) {
        setErrorMessage(
          'La demo se está provisionando por primera vez (suele tomar 30 segundos en el primer arranque del servidor). Refresca la página en un momento.',
        );
        setLoadingPersona(null);
        return;
      }

      if (!res.ok) {
        setErrorMessage('Hubo un problema entrando a la demo. Intenta de nuevo en 5 segundos.');
        setLoadingPersona(null);
        return;
      }

      const body = (await res.json()) as DemoLoginResponse;
      await signInDriverWithCustomToken(body.custom_token);
      void navigate({ to: body.redirect_to });
    } catch {
      setErrorMessage('Hubo un problema entrando a la demo. Intenta de nuevo en 5 segundos.');
      setLoadingPersona(null);
    }
  }

  const anyLoading = loadingPersona !== null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-50 via-neutral-50 to-white">
      {/* Header */}
      <header className="border-neutral-200 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <img src="/icons/icon.svg" alt="Booster AI" className="h-11 w-11" />
            <div className="flex flex-col leading-tight">
              <span className="font-semibold text-base text-neutral-900">Booster AI</span>
              <span className="text-neutral-500 text-xs">Logística sostenible · Chile</span>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 font-medium text-amber-900 text-xs ring-1 ring-amber-200">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Modo demo · datos sintéticos
          </span>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pt-12 pb-8 text-center">
        <p className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-3 py-1 font-medium text-primary-800 text-xs ring-1 ring-primary-200">
          <Leaf className="h-3.5 w-3.5" aria-hidden />
          Marketplace B2B de logística sostenible
        </p>
        <h1 className="mt-5 font-bold text-4xl text-neutral-900 tracking-tight sm:text-5xl">
          Explora Booster AI desde cualquier rol
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-neutral-600 text-lg leading-relaxed">
          Selecciona una persona para entrar al producto con datos pre-cargados. Sin registro, sin
          contraseñas: un click y estás operando como ese rol.
        </p>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
          {CERTIFICATIONS.map((cert) => (
            <span
              key={cert.label}
              title={cert.tooltip}
              className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 py-1 font-medium text-neutral-700 text-xs"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-primary-600" aria-hidden />
              {cert.label}
            </span>
          ))}
        </div>
      </section>

      {/* Error */}
      <div className="mx-auto max-w-6xl px-6">
        {errorMessage ? (
          <div
            role="alert"
            className="mb-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-rose-900 text-sm"
          >
            {errorMessage}
          </div>
        ) : null}
      </div>

      {/* Cards */}
      <section className="mx-auto max-w-6xl px-6 pb-12">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          {PERSONAS.map((card) => {
            const isLoading = loadingPersona === card.persona;
            const accent = ACCENT_CLASSES[card.accent];
            return (
              <article
                key={card.persona}
                className={`group flex flex-col rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm transition hover:shadow-lg ${accent.ring}`}
              >
                <div
                  className={`inline-flex h-12 w-12 items-center justify-center rounded-xl ${accent.iconBg}`}
                >
                  <card.Icon className={`h-6 w-6 ${accent.iconFg}`} aria-hidden />
                </div>

                <span
                  className={`mt-4 inline-flex w-fit items-center rounded-md px-2 py-0.5 font-medium text-xs ${accent.pill}`}
                >
                  {card.role}
                </span>

                <h2 className="mt-2 font-semibold text-lg text-neutral-900 leading-tight">
                  {card.entityName}
                </h2>

                <p className="mt-2 text-neutral-600 text-sm leading-relaxed">{card.tagline}</p>

                <ul className="mt-4 space-y-1.5 text-neutral-700 text-xs">
                  {card.highlights.map((highlight) => (
                    <li key={highlight} className="flex items-start gap-1.5">
                      <CheckCircle2
                        className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 ${accent.iconFg}`}
                        aria-hidden
                      />
                      <span>{highlight}</span>
                    </li>
                  ))}
                </ul>

                <button
                  type="button"
                  onClick={() => handleEnter(card.persona)}
                  disabled={anyLoading}
                  className={`mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 font-semibold text-sm text-white transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${accent.button}`}
                >
                  {isLoading ? (
                    <>
                      <span
                        className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                        aria-hidden
                      />
                      Entrando…
                    </>
                  ) : (
                    <>
                      Entrar como {card.role.toLowerCase().split(' ')[0]}
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </>
                  )}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      {/* Info strip */}
      <section className="border-neutral-200 border-y bg-white">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-6 py-8 sm:grid-cols-3">
          <div className="flex items-start gap-3">
            <Lock className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary-600" aria-hidden />
            <div>
              <p className="font-semibold text-neutral-900 text-sm">Aislado de producción</p>
              <p className="mt-1 text-neutral-600 text-xs leading-relaxed">
                Todas las acciones que hagas aquí se etiquetan con <code>es_demo=true</code> y son
                limpiables sin afectar clientes reales.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" aria-hidden />
            <div>
              <p className="font-semibold text-neutral-900 text-sm">Telemetría real (espejo)</p>
              <p className="mt-1 text-neutral-600 text-xs leading-relaxed">
                El vehículo demo DEMO01 refleja la telemetría real de un Teltonika operativo — verás
                GPS, velocidad y CO₂ live, no mock.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Leaf className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary-600" aria-hidden />
            <div>
              <p className="font-semibold text-neutral-900 text-sm">
                Huella de carbono certificada
              </p>
              <p className="mt-1 text-neutral-600 text-xs leading-relaxed">
                Cálculos bajo GLEC v3.0 + GHG Protocol. Cada viaje genera un certificado descargable
                como shipper.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mx-auto max-w-6xl px-6 py-8 text-center text-neutral-500 text-xs">
        <p>
          Booster AI ·{' '}
          <a href="https://boosterchile.com" className="underline hover:text-neutral-700">
            boosterchile.com
          </a>
          {' · '}
          <span className="font-mono">demo.boosterchile.com</span>
        </p>
        <p className="mt-1.5">
          Las 4 personas comparten data (ofertas, asignaciones, telemetría). Lo que crea una persona
          lo ve la otra — así puedes simular el ciclo completo: shipper publica → carrier acepta →
          conductor entrega → stakeholder mide.
        </p>
      </footer>
    </div>
  );
}
