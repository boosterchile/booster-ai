import { useNavigate } from '@tanstack/react-router';
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
  displayName: string;
  entityName: string;
  emoji: string;
  description: string;
  buttonLabel: string;
}

const PERSONAS: readonly PersonaCard[] = [
  {
    persona: 'shipper',
    displayName: 'Shipper',
    entityName: 'Andina Demo S.A.',
    emoji: '📦',
    description: 'Genero carga',
    buttonLabel: 'Entrar como shipper',
  },
  {
    persona: 'carrier',
    displayName: 'Carrier',
    entityName: 'Transportes Demo Sur',
    emoji: '🚚',
    description: 'Muevo carga',
    buttonLabel: 'Entrar como carrier',
  },
  {
    persona: 'conductor',
    displayName: 'Conductor',
    entityName: 'Pedro González',
    emoji: '🧑‍✈️',
    description: 'Conduzco',
    buttonLabel: 'Entrar como conductor',
  },
  {
    persona: 'stakeholder',
    displayName: 'Stakeholder',
    entityName: 'Observatorio Logístico',
    emoji: '📊',
    description: 'Monitoreo sostenibilidad',
    buttonLabel: 'Entrar como stakeholder',
  },
];

/**
 * /demo — Selector de persona para el subdominio demo.boosterchile.com.
 *
 * Click en cualquier card → POST /demo/login → backend mintea custom token
 * Firebase con claim `is_demo: true` → signInWithCustomToken → redirect
 * al surface correspondiente.
 *
 * No requiere Firebase signup ni passwords. Las 4 personas demo se
 * crean en el backend con `seedDemo` (idempotente, gated por
 * `DEMO_MODE_ACTIVATED=true`).
 *
 * Estados de error:
 * - 503 `demo_not_seeded`: el auto-seed startup no terminó todavía →
 *   mostrar "Demo aún provisionando. Refresca en 30s."
 * - Otros errores: mensaje genérico con sugerencia de retry.
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
        setErrorMessage('Demo aún provisionando. Refresca en 30 segundos.');
        setLoadingPersona(null);
        return;
      }

      if (!res.ok) {
        setErrorMessage('Hubo un problema entrando. Intenta de nuevo en 5 segundos.');
        setLoadingPersona(null);
        return;
      }

      const body = (await res.json()) as DemoLoginResponse;
      await signInDriverWithCustomToken(body.custom_token);
      void navigate({ to: body.redirect_to });
    } catch {
      setErrorMessage('Hubo un problema entrando. Intenta de nuevo en 5 segundos.');
      setLoadingPersona(null);
    }
  }

  const anyLoading = loadingPersona !== null;

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <header className="border-neutral-200 border-b bg-white px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center gap-2">
          <div className="h-6 w-6 rounded-md bg-primary-500" aria-hidden />
          <span className="font-semibold text-lg text-neutral-900">Booster AI</span>
          <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-900 text-xs">
            Modo Demo
          </span>
        </div>
      </header>

      <main className="flex flex-1 items-start justify-center px-6 py-10">
        <div className="w-full max-w-5xl">
          <div className="mb-8 text-center">
            <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">
              Selecciona tu rol para entrar
            </h1>
            <p className="mt-2 text-neutral-600 text-sm">
              Datos demostrativos, sin Firebase signup. Cada rol entra con un click.
            </p>
          </div>

          {errorMessage ? (
            <div
              role="alert"
              className="mb-6 rounded border border-rose-300 bg-rose-50 px-4 py-3 text-rose-900 text-sm"
            >
              {errorMessage}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PERSONAS.map((card) => {
              const isLoading = loadingPersona === card.persona;
              return (
                <div
                  key={card.persona}
                  className="flex flex-col items-center rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
                >
                  <div className="text-5xl" aria-hidden>
                    {card.emoji}
                  </div>
                  <h2 className="mt-3 font-semibold text-lg text-neutral-900">
                    {card.displayName}
                  </h2>
                  <p className="mt-1 text-center text-neutral-700 text-sm">{card.entityName}</p>
                  <p className="mt-1 text-center text-neutral-500 text-xs">{card.description}</p>
                  <button
                    type="button"
                    onClick={() => handleEnter(card.persona)}
                    disabled={anyLoading}
                    className="mt-4 w-full rounded bg-primary-500 px-4 py-2 font-medium text-sm text-white hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isLoading ? 'Entrando…' : card.buttonLabel}
                  </button>
                </div>
              );
            })}
          </div>

          <footer className="mt-10 text-center text-neutral-500 text-xs">
            URL: demo.boosterchile.com — Datos sintéticos, regenerables. Las 4 personas comparten
            datos compartidos (ofertas, asignaciones, telemetría espejo).
          </footer>
        </div>
      </main>
    </div>
  );
}
