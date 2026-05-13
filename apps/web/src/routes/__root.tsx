import { Outlet } from '@tanstack/react-router';
import { DemoBanner } from '../components/DemoBanner.js';

/**
 * Root layout — wrapper minimal. Providers (QueryClient, RouterProvider)
 * están en main.tsx. Outlet renderiza la ruta hija que matchee.
 *
 * No agrego layout aquí porque Login y Onboarding tienen layouts
 * distintos al app autenticado.
 *
 * `DemoBanner` se monta global y se self-gatea via `useIsDemo()` —
 * usuarios sin claim `is_demo: true` no ven el banner.
 */
export function RootComponent() {
  return (
    <>
      <DemoBanner />
      <Outlet />
    </>
  );
}
