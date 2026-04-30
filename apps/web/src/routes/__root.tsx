import { Outlet } from '@tanstack/react-router';

/**
 * Root layout — wrapper minimal. Providers (QueryClient, RouterProvider)
 * están en main.tsx. Outlet renderiza la ruta hija que matchee.
 *
 * No agrego layout aquí porque Login y Onboarding tienen layouts
 * distintos al app autenticado.
 */
export function RootComponent() {
  return <Outlet />;
}
