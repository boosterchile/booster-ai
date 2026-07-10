import { Outlet } from '@tanstack/react-router';
import { DemoBanner } from '../components/DemoBanner.js';
import { ImpersonationBanner } from '../components/ImpersonationBanner.js';

/**
 * Root layout — wrapper minimal. Providers (QueryClient, RouterProvider)
 * están en main.tsx. Outlet renderiza la ruta hija que matchee.
 *
 * No agrego layout aquí porque Login y Onboarding tienen layouts
 * distintos al app autenticado.
 *
 * `DemoBanner` e `ImpersonationBanner` se montan global y se self-gatean
 * (via `useIsDemo()` / `useImpersonation()`) — usuarios sin el claim
 * correspondiente no ven el banner.
 */
export function RootComponent() {
  return (
    <>
      <DemoBanner />
      <ImpersonationBanner />
      <Outlet />
    </>
  );
}
