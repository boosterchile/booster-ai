import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { RootComponent } from './routes/__root.js';
import { AdminDispositivosRoute } from './routes/admin-dispositivos.js';
import { AppRoute } from './routes/app.js';
import { AsignacionDetalleRoute } from './routes/asignacion-detalle.js';
import { CargasDetalleRoute, CargasListRoute, CargasNuevoRoute } from './routes/cargas.js';
import { CertificadosRoute } from './routes/certificados.js';
import { IndexRoute } from './routes/index.js';
import { LoginRoute } from './routes/login.js';
import { OfertasRoute } from './routes/ofertas.js';
import { CargaTrackRoute } from './routes/carga-track.js';
import { OnboardingRoute } from './routes/onboarding.js';
import { PerfilRoute } from './routes/perfil.js';
import { VehiculoLiveRoute } from './routes/vehiculo-live.js';
import {
  VehiculosDetalleRoute,
  VehiculosListRoute,
  VehiculosNuevoRoute,
} from './routes/vehiculos.js';

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

const vehiculosListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/vehiculos',
  component: VehiculosListRoute,
});

const vehiculosNuevoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/vehiculos/nuevo',
  component: VehiculosNuevoRoute,
});

const vehiculosDetalleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/vehiculos/$id',
  component: VehiculosDetalleRoute,
});

const cargasListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/cargas',
  component: CargasListRoute,
});

const cargasNuevaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/cargas/nueva',
  component: CargasNuevoRoute,
});

const cargasDetalleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/cargas/$id',
  component: CargasDetalleRoute,
});

const vehiculoLiveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/vehiculos/$id/live',
  component: VehiculoLiveRoute,
});

const cargaTrackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/cargas/$id/track',
  component: CargaTrackRoute,
});

const certificadosRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/certificados',
  component: CertificadosRoute,
});

const asignacionDetalleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/asignaciones/$id',
  component: AsignacionDetalleRoute,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  onboardingRoute,
  appRoute,
  ofertasRoute,
  perfilRoute,
  adminDispositivosRoute,
  vehiculosListRoute,
  vehiculosNuevoRoute,
  vehiculosDetalleRoute,
  vehiculoLiveRoute,
  cargasListRoute,
  cargasNuevaRoute,
  cargasDetalleRoute,
  cargaTrackRoute,
  certificadosRoute,
  asignacionDetalleRoute,
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
