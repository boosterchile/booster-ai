import { useNavigate } from '@tanstack/react-router';
import {
  ArrowRight,
  BarChart3,
  Building2,
  type LucideIcon,
  ShieldCheck,
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
  },
  {
    persona: 'conductor',
    role: 'Conductor profesional',
    entityName: 'Pedro González',
    Icon: UserRound,
    tagline: 'Ve tu próximo viaje, navega con la ruta eco y reporta GPS desde el celular.',
    highlights: [
      'Modo Conductor full-screen',
      'Ruta eco-eficiente sugerida',
      'GPS móvil cuando no hay Teltonika',
    ],
  },
  {
    persona: 'stakeholder',
    role: 'Observatorio sostenibilidad',
    entityName: 'Observatorio Logístico',
    Icon: BarChart3,
    tagline: 'Métricas agregadas por zona logística con k-anonimización ≥ 5.',
    highlights: [
      'Zonas: puertos, mercados, polos industriales',
      'Sin PII, sin empresas individuales',
      'Metodología pública auditable',
    ],
  },
];

const CERTIFICATIONS = ['GLEC v3.0', 'GHG Protocol', 'ISO 14064', 'k-anonymity ≥ 5'] as const;

/**
 * /demo — Selector de persona para el subdominio demo.boosterchile.com.
 *
 * Diseño minimalista monocromático: el sistema visual de marca se
 * comunica con tipografía + espaciado + el logo, no con colores
 * saturados por persona. Todas las cards comparten el mismo tratamiento
 * para que la jerarquía la dé el contenido, no el cromatismo.
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
          'La demo se está provisionando por primera vez. Refresca la página en 30 segundos.',
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
    <div className="min-h-screen bg-neutral-50">
      <header className="border-neutral-200 border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-3">
            <img src="/icons/icon.svg" alt="" aria-hidden className="h-9 w-9" />
            <span className="font-semibold text-base text-neutral-900 tracking-tight">
              Booster AI
            </span>
          </div>
          <span className="rounded-full border border-neutral-300 bg-white px-3 py-1 font-medium text-neutral-700 text-xs">
            Modo demo · datos sintéticos
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 pt-16 pb-12">
        <section className="text-center">
          <h1 className="font-semibold text-4xl text-neutral-900 tracking-tight sm:text-5xl">
            Explora Booster AI desde cualquier rol
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base text-neutral-600 leading-relaxed">
            Selecciona una persona para entrar al producto con datos pre-cargados. Sin registro, sin
            contraseñas: un click y estás operando como ese rol.
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            {CERTIFICATIONS.map((label) => (
              <span
                key={label}
                className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 py-1 font-medium text-neutral-700 text-xs"
              >
                <ShieldCheck className="h-3.5 w-3.5 text-neutral-500" aria-hidden />
                {label}
              </span>
            ))}
          </div>
        </section>

        {errorMessage ? (
          <div
            role="alert"
            className="mx-auto mt-8 max-w-2xl rounded-md border border-neutral-300 bg-white px-4 py-3 text-neutral-800 text-sm"
          >
            {errorMessage}
          </div>
        ) : null}

        <section className="mt-12 grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {PERSONAS.map((card) => {
            const isLoading = loadingPersona === card.persona;
            return (
              <article
                key={card.persona}
                className="flex h-full flex-col rounded-xl border border-neutral-200 bg-white p-6 transition hover:border-neutral-400"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50 text-neutral-700">
                    <card.Icon className="h-5 w-5" aria-hidden />
                  </div>
                </div>

                <p className="mt-5 font-medium text-neutral-500 text-xs uppercase tracking-wider">
                  {card.role}
                </p>
                <h2 className="mt-1 font-semibold text-lg text-neutral-900 leading-snug">
                  {card.entityName}
                </h2>

                <p className="mt-3 text-neutral-600 text-sm leading-relaxed">{card.tagline}</p>

                <ul className="mt-5 space-y-2 text-neutral-700 text-sm">
                  {card.highlights.map((highlight) => (
                    <li key={highlight} className="flex items-start gap-2">
                      <span
                        className="mt-2 h-1 w-1 flex-shrink-0 rounded-full bg-neutral-400"
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
                  className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded-lg bg-neutral-900 px-4 py-2.5 font-medium text-sm text-white transition hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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
                      Entrar
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </>
                  )}
                </button>
              </article>
            );
          })}
        </section>

        <section className="mt-16 grid grid-cols-1 gap-8 sm:grid-cols-3">
          <div>
            <p className="font-medium text-neutral-900 text-sm">Aislado de producción</p>
            <p className="mt-1 text-neutral-600 text-sm leading-relaxed">
              Todas las acciones se etiquetan con <code className="text-xs">es_demo=true</code> ·
              limpiables sin afectar clientes reales.
            </p>
          </div>
          <div>
            <p className="font-medium text-neutral-900 text-sm">Telemetría real (espejo)</p>
            <p className="mt-1 text-neutral-600 text-sm leading-relaxed">
              El vehículo DEMO01 refleja la telemetría real de un Teltonika operativo — GPS,
              velocidad y CO₂ live, no mock.
            </p>
          </div>
          <div>
            <p className="font-medium text-neutral-900 text-sm">Huella certificada</p>
            <p className="mt-1 text-neutral-600 text-sm leading-relaxed">
              Cálculos bajo GLEC v3.0 + GHG Protocol. Cada viaje genera un certificado descargable
              como shipper.
            </p>
          </div>
        </section>

        <footer className="mt-16 border-neutral-200 border-t pt-6 text-center text-neutral-500 text-xs">
          <p>
            Booster AI ·{' '}
            <a href="https://boosterchile.com" className="underline hover:text-neutral-700">
              boosterchile.com
            </a>
            {' · '}
            <span className="font-mono">demo.boosterchile.com</span>
          </p>
          <p className="mt-2 max-w-2xl mx-auto">
            Las 4 personas comparten data. Lo que crea una lo ve la otra — simula el ciclo completo:
            shipper publica → carrier acepta → conductor entrega → stakeholder mide.
          </p>
        </footer>
      </main>
    </div>
  );
}
