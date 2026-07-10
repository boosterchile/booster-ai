import { RegisterProvider } from '@booster-ai/ui-components';
import { Menu } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { MeResponse } from '../hooks/use-me.js';
import { ConsentTermsBanner } from './ConsentTermsBanner.js';
import { Sidebar } from './Sidebar.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

/**
 * AppShell estándar para las superficies de operador (`/app/*`): transportista,
 * generador, stakeholder y perfil. **Sidebar persistente** (D2) con navegación
 * role-aware; colapsa a **drawer** en móvil. Envuelto en `RegisterProvider`
 * (registro **operador**) para que las primitivas D2 respondan al registro.
 *
 * El **conductor** (`conductor.tsx`) y el **platform-admin** (`platform-admin.tsx`)
 * tienen shell propio y NO usan este Layout — el sidebar no los alcanza.
 *
 * Siempre que crees una página de operador bajo `/app/*`, envolvé el cuerpo en
 * `<Layout me={me} title="…">`. Sin Layout, el usuario pierde el sidebar, el
 * switcher y "Salir" (regresión de UX bloqueante). El `title` se muestra como
 * contexto en la topbar (cada página mantiene su propio `<h1>`).
 */
export function Layout({
  me,
  title,
  children,
}: {
  me: MeOnboarded;
  title: string;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <RegisterProvider
      register="operador"
      density="comoda"
      className="flex min-h-screen bg-neutral-50"
    >
      {/* Sidebar persistente (desktop) */}
      <aside className="hidden w-64 shrink-0 border-neutral-200 border-r bg-neutral-0 md:block">
        <div className="sticky top-0 h-screen">
          <Sidebar me={me} />
        </div>
      </aside>

      {/* Sidebar como drawer (móvil) */}
      {mobileOpen && (
        <div className="md:hidden">
          <button
            type="button"
            aria-label="Cerrar menú"
            onClick={() => setMobileOpen(false)}
            className="fixed inset-0 z-40 bg-neutral-1000/40"
          />
          {/* El landmark de navegación lo aporta el <nav> interno del Sidebar. */}
          <div
            data-testid="mobile-drawer"
            className="fixed inset-y-0 left-0 z-50 w-72 border-neutral-200 border-r bg-neutral-0 shadow-xl"
          >
            <Sidebar me={me} onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      {/* Columna principal */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-neutral-200 border-b bg-neutral-0 px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir menú"
            aria-expanded={mobileOpen}
            className="rounded-md p-2 text-neutral-700 hover:bg-neutral-100 md:hidden"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>
          <span className="font-semibold text-neutral-900">{title}</span>
        </header>

        <ConsentTermsBanner />

        <main className="flex-1">
          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">{children}</div>
        </main>
      </div>
    </RegisterProvider>
  );
}
