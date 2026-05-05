import { Link } from '@tanstack/react-router';
import { LogOut, Settings, User as UserIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { signOutUser } from '../hooks/use-auth.js';
import type { MeResponse } from '../hooks/use-me.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

/**
 * AppShell estándar para todas las páginas de `/app/*` autenticadas.
 *
 * Contiene el banner global con logo Booster AI, badge de empresa
 * activa, link a perfil del usuario y botón Salir. El children se
 * renderiza dentro de un `<main>` con max-width consistente.
 *
 * Siempre que crees una página nueva bajo `/app/*`, envolvé el cuerpo
 * en `<Layout me={me} title="...">` — sin Layout, el usuario pierde la
 * navegación principal y "Salir", lo que cuenta como una regresión de
 * UX bloqueante (ver BUG-003).
 *
 * El prop `title` actualmente no se renderiza acá (cada página define
 * su propio `<h1>` para flexibilidad), pero queda reservado para
 * cuando agreguemos un breadcrumb o título de pestaña dinámico.
 */
export function Layout({
  me,
  title: _title,
  children,
}: {
  me: MeOnboarded;
  title: string;
  children: ReactNode;
}) {
  const activeEmpresa = me.active_membership?.empresa;
  async function handleSignOut() {
    await signOutUser();
  }
  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <header className="border-neutral-200 border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <Link to="/app" className="flex items-center gap-3">
              <div className="h-6 w-6 rounded-md bg-primary-500" aria-hidden />
              <span className="font-semibold text-lg text-neutral-900">Booster AI</span>
            </Link>
            {activeEmpresa && (
              <span className="ml-3 rounded-md bg-neutral-100 px-2 py-1 font-medium text-neutral-700 text-xs">
                {activeEmpresa.legal_name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/app/perfil"
              className="flex items-center gap-2 rounded-md px-2 py-1 text-neutral-700 text-sm transition hover:bg-neutral-100"
            >
              <UserIcon className="h-4 w-4" aria-hidden />
              <span>{me.user.full_name}</span>
              <Settings className="h-3.5 w-3.5 text-neutral-400" aria-hidden />
            </Link>
            <button
              type="button"
              onClick={handleSignOut}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-neutral-600 text-sm transition hover:bg-neutral-100"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              Salir
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-6 py-10">{children}</div>
      </main>
    </div>
  );
}
