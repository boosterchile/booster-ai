import { Link } from '@tanstack/react-router';
import { LogOut, Menu, Settings, User as UserIcon, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
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
 * Responsive (BUG-006):
 *   - Desktop (sm+): logo + badge empresa a la izquierda, perfil + Salir
 *     a la derecha en una sola fila.
 *   - Mobile (<sm): logo a la izquierda, hamburguesa a la derecha. Al
 *     abrirla, panel desplegable con badge empresa, link a perfil y
 *     botón Salir. Esto evita que "Booster AI", el badge y "Salir" se
 *     rompan en múltiples líneas a 375px de viewport.
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
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleSignOut() {
    await signOutUser();
  }

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <header className="border-neutral-200 border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3 sm:px-6">
          {/* Logo (siempre visible). El badge de empresa solo en sm+ para
              evitar wraps a 375px; en mobile va dentro del menú. */}
          <Link
            to="/app"
            className="flex shrink-0 items-center gap-2 sm:gap-3"
            onClick={() => setMobileOpen(false)}
          >
            <div className="h-6 w-6 rounded-md bg-primary-500" aria-hidden />
            <span className="whitespace-nowrap font-semibold text-lg text-neutral-900">
              Booster AI
            </span>
          </Link>

          {activeEmpresa && (
            <span className="ml-3 hidden whitespace-nowrap rounded-md bg-neutral-100 px-2 py-1 font-medium text-neutral-700 text-xs sm:inline-flex">
              {activeEmpresa.legal_name}
            </span>
          )}

          {/* Spacer para empujar el cluster derecho */}
          <div className="hidden flex-1 sm:block" />

          {/* Desktop: perfil + salir */}
          <div className="hidden items-center gap-2 sm:flex">
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

          {/* Mobile: hamburguesa */}
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? 'Cerrar menú' : 'Abrir menú'}
            aria-expanded={mobileOpen}
            aria-controls="mobile-menu"
            className="flex items-center justify-center rounded-md p-2 text-neutral-700 hover:bg-neutral-100 sm:hidden"
          >
            {mobileOpen ? (
              <X className="h-5 w-5" aria-hidden />
            ) : (
              <Menu className="h-5 w-5" aria-hidden />
            )}
          </button>
        </div>

        {/* Mobile: panel desplegable */}
        {mobileOpen && (
          <div
            id="mobile-menu"
            className="border-neutral-200 border-t bg-white px-4 py-3 sm:hidden"
          >
            {activeEmpresa && (
              <div className="mb-3">
                <div className="text-neutral-500 text-xs uppercase tracking-wider">
                  Empresa activa
                </div>
                <div className="mt-1 inline-flex rounded-md bg-neutral-100 px-2 py-1 font-medium text-neutral-700 text-xs">
                  {activeEmpresa.legal_name}
                </div>
              </div>
            )}
            <Link
              to="/app/perfil"
              onClick={() => setMobileOpen(false)}
              className="-mx-2 flex items-center gap-2 rounded-md px-2 py-2 text-neutral-700 text-sm transition hover:bg-neutral-100"
            >
              <UserIcon className="h-4 w-4" aria-hidden />
              <span className="flex-1">{me.user.full_name}</span>
              <Settings className="h-3.5 w-3.5 text-neutral-400" aria-hidden />
            </Link>
            <button
              type="button"
              onClick={handleSignOut}
              className="-mx-2 flex w-full items-center gap-2 rounded-md px-2 py-2 text-rose-600 text-sm transition hover:bg-rose-50"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              Salir
            </button>
          </div>
        )}
      </header>
      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">{children}</div>
      </main>
    </div>
  );
}
