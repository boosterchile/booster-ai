import { Outlet } from '@tanstack/react-router';
import { ImpersonationBanner } from '../components/ImpersonationBanner.js';

/**
 * Root layout — wrapper minimal. Providers (QueryClient, RouterProvider)
 * están en main.tsx. Outlet renderiza la ruta hija que matchee.
 *
 * No agrego layout aquí porque Login y Onboarding tienen layouts
 * distintos al app autenticado.
 *
 * `ImpersonationBanner` se monta global y se self-gatea (via
 * `useImpersonation()`) — sesiones sin el claim no ven el banner.
 */
export function RootComponent() {
  return (
    <>
      <ImpersonationBanner />
      <Outlet />
    </>
  );
}
