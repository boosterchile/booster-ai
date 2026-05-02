import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { RootComponent } from './routes/__root.js';
import { AdminDispositivosRoute } from './routes/admin-dispositivos.js';
import { AppRoute } from './routes/app.js';
import { IndexRoute } from './routes/index.js';
import { LoginRoute } from './routes/login.js';
import { OfertasRoute } from './routes/ofertas.js';
import { OnboardingRoute } from './routes/onboarding.js';
import { PerfilRoute } from './routes/perfil.js';

/**
 * Router programático de TanStack Router. Cada ruta se declara con
 * `createRoute` referenciando su parent. Ventaja vs file-based: cero
 * codegen (no `routeTree.gen.ts`), todo el árbol es código tipado y
 * trazable. Trade-off: hay que registrar manualmente cada ruta nueva
 * acá (B.4+ agrega más).
 */

const rootRoute = createRootRoute({
  component: RootComponent,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: IndexRoute,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginRoute,
});

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/onboarding',
  component: OnboardingRoute,
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app',
  component: AppRoute,
});

const ofertasRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/ofertas',
  component: OfertasRoute,
});

const perfilRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/perfil',
  component: PerfilRoute,
});

const adminDispositivosRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/admin/dispositivos',
  component: AdminDispositivosRoute,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  onboardingRoute,
  appRoute,
  ofertasRoute,
  perfilRoute,
  adminDispositivosRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent', // prefetch on link hover
});

// Module augmentation para que useNavigate / Link tengan los paths tipados.
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
