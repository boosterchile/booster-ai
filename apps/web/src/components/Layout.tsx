import { RegisterProvider } from '@booster-ai/ui-components';
import { Link, useRouterState } from '@tanstack/react-router';
import { type ReactNode, useEffect } from 'react';
import { useFeatureFlags } from '../hooks/use-feature-flags.js';
import type { MeResponse } from '../hooks/use-me.js';
import { NOMBRE_PRODUCTO, productoDe } from '../lib/producto.js';
import { ConsentTermsBanner } from './ConsentTermsBanner.js';
import { MenuCuenta } from './MenuCuenta.js';
import { BarraInferior, MenuSuperior, PestanasGrupo } from './MenuSuperior.js';
import { grupoActivo, navGroupsForMe } from './nav-items.js';
import { useBadgesTransporte } from './use-badges-transporte.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

/**
 * Armazón de las pantallas de operador (`/app/*`): transportista, generador,
 * stakeholder y perfil (`.specs/frente8-menu-superior`). Menú superior con
 * pocas entradas; si la entrada activa agrupa varias pantallas, una fila de
 * pestañas las lista; bajo 640 px las entradas pasan a una barra inferior
 * fija. Envuelto en `RegisterProvider` (registro **operador**).
 *
 * El **conductor** (`conductor.tsx`) y el **panel de platform-admin**
 * (`platform-admin.tsx`) tienen armazón propio y NO usan este Layout. La
 * persona de Booster que entra a la web de su empresa sí lo usa, y el menú de
 * cuenta le ofrece volver al panel.
 *
 * Siempre que crees una página de operador bajo `/app/*`, envuelve el cuerpo en
 * `<Layout me={me} title="…">`. Sin Layout, el usuario pierde el menú, el
 * cambio de empresa y «Salir». El `title` queda como título del documento;
 * cada página mantiene su propio `<h1>`.
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
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { flags } = useFeatureFlags();
  const groups = navGroupsForMe(me, { rutas: flags.rutas_api_activada });
  const active = grupoActivo(groups, pathname);
  const esTransportista = Boolean(me.active_membership?.empresa?.is_transportista);
  const badges = useBadgesTransporte(esTransportista);
  const producto = NOMBRE_PRODUCTO[productoDe(me)];

  useEffect(() => {
    document.title = `${title} · ${producto}`;
  }, [title, producto]);

  return (
    <RegisterProvider
      register="operador"
      density="comoda"
      className="flex min-h-screen flex-col bg-neutral-50"
    >
      {/* pt-safe: en la PWA standalone de iOS la página corre bajo la barra de
          estado; la cabecera reserva ese inset. */}
      <header className="sticky top-0 z-30 border-neutral-200 border-b bg-neutral-0 pt-safe">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2 sm:px-6">
          <Link to="/app" className="flex shrink-0 items-center gap-2">
            <img src="/icons/icon.svg" alt="" aria-hidden className="h-7 w-7" />
            <span data-testid="marca-producto" className="font-semibold text-lg text-neutral-900">
              {producto}
            </span>
          </Link>
          <div className="min-w-0 flex-1">
            <MenuSuperior groups={groups} active={active} badges={badges} />
          </div>
          <MenuCuenta me={me} />
        </div>
      </header>

      <PestanasGrupo group={active} pathname={pathname} badges={badges} />

      <ConsentTermsBanner />

      {/* pb-24 bajo 640 px: la barra inferior fija no tapa el final de la página. */}
      <main className="flex-1 pb-24 sm:pb-0">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">{children}</div>
      </main>

      <BarraInferior groups={groups} active={active} badges={badges} />
    </RegisterProvider>
  );
}
