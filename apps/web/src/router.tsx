import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { RootComponent } from './routes/__root.js';
import { AdminCobraHoyRoute } from './routes/admin-cobra-hoy.js';
import { AdminDispositivosRoute } from './routes/admin-dispositivos.js';
import { AppRoute } from './routes/app.js';
import { AsignacionDetalleRoute } from './routes/asignacion-detalle.js';
import { CargaTrackRoute } from './routes/carga-track.js';
import { CargasDetalleRoute, CargasListRoute, CargasNuevoRoute } from './routes/cargas.js';
import { CertificadosRoute } from './routes/certificados.js';
import { CobraHoyHistorialRoute } from './routes/cobra-hoy-historial.js';
import { ConductorModoRoute } from './routes/conductor-modo.js';
import {
  ConductoresDetalleRoute,
  ConductoresListRoute,
  ConductoresNuevoRoute,
} from './routes/conductores.js';
import { FlotaRoute } from './routes/flota.js';
import { IndexRoute } from './routes/index.js';
import { LegalCobraHoyRoute } from './routes/legal-cobra-hoy.js';
import { LegalTerminosRoute } from './routes/legal-terminos.js';
import { LoginConductorRoute } from './routes/login-conductor.js';
import { LoginRoute } from './routes/login.js';
import { OfertasRoute } from './routes/ofertas.js';
import { OnboardingRoute } from './routes/onboarding.js';
import { PerfilRoute } from './routes/perfil.js';
import { PublicTrackingRoute } from './routes/public-tracking.js';
import {
  SucursalesDetalleRoute,
  SucursalesListRoute,
  SucursalesNuevaRoute,
} from './routes/sucursales.js';
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

// D9 — Surface dedicada de login para conductores. Acepta RUT + PIN
// (primera vez) o RUT + password (después). No usa ProtectedRoute porque
// debe ser accesible sin sesión Firebase.
const loginConductorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login/conductor',
  component: LoginConductorRoute,
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

// Phase 4 PR-K8 — onboarding del Modo Conductor. Una sola pantalla con
// 4 cards (autoplay coaching, permisos mic+GPS, comandos de voz,
// explainer). Hub centralizado para que el conductor habilite y entienda
// las features voice-first de K1-K7. Layout `/app/*` autenticado.
const conductorModoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/conductor/modo',
  component: ConductorModoRoute,
});

const adminDispositivosRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/admin/dispositivos',
  component: AdminDispositivosRoute,
});

// ADR-029 v1 / ADR-032 — admin platform-wide Cobra Hoy. Auth real está
// en backend (BOOSTER_PLATFORM_ADMIN_EMAILS allowlist); la ruta queda
// bajo /app para mantener la auth de Firebase y el layout.
const adminCobraHoyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/admin/cobra-hoy',
  component: AdminCobraHoyRoute,
});

const vehiculosListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/vehiculos',
  component: VehiculosListRoute,
});

// D3 — Surface dedicada de seguimiento de flota. Reemplaza el patrón
// anterior en el que la ubicación del vehículo se accedía desde el form
// de edición (`/app/vehiculos/$id`). El detalle quedó pure-edit.
const flotaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/flota',
  component: FlotaRoute,
});

// D8 — CRUD de conductores del carrier. Solo accesible desde la interfaz
// transportista (no es self-signup driver). Roles dueno/admin/despachador
// crean y editan; conductor + visualizador solo leen.
const conductoresListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/conductores',
  component: ConductoresListRoute,
});
const conductoresNuevoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/conductores/nuevo',
  component: ConductoresNuevoRoute,
});
const conductoresDetalleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/conductores/$id',
  component: ConductoresDetalleRoute,
});

// D7b — Sucursales del shipper. Puntos físicos de origen/destino.
const sucursalesListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/sucursales',
  component: SucursalesListRoute,
});
const sucursalesNuevaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/sucursales/nueva',
  component: SucursalesNuevaRoute,
});
const sucursalesDetalleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/sucursales/$id',
  component: SucursalesDetalleRoute,
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

// Phase 5 PR-L4 — Surface pública del consignee/shipper con un link
// opaco UUID v4. Sin auth, sin app shell — layout dedicado mobile-first.
// Path raíz `/tracking/$token` (NO `/app/...`) para no quedar bajo el
// guard de ProtectedRoute que aplica a todo `/app/*`.
const publicTrackingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tracking/$token',
  component: PublicTrackingRoute,
});

const legalTerminosRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/legal/terminos',
  component: LegalTerminosRoute,
});

// ADR-029 v1 / ADR-032 — Listado de adelantos solicitados por el
// carrier ("Booster Cobra Hoy"). Surface dedicada bajo /app, requiere
// auth + activeMembership de tipo transportista.
const cobraHoyHistorialRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/cobra-hoy/historial',
  component: CobraHoyHistorialRoute,
});

// Adendum de T&Cs específico para el producto "Cobra Hoy". Pública,
// referenciable desde el modal de solicitud.
const legalCobraHoyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/legal/cobra-hoy',
  component: LegalCobraHoyRoute,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  loginConductorRoute,
  onboardingRoute,
  appRoute,
  ofertasRoute,
  perfilRoute,
  conductorModoRoute,
  adminDispositivosRoute,
  vehiculosListRoute,
  vehiculosNuevoRoute,
  vehiculosDetalleRoute,
  vehiculoLiveRoute,
  flotaRoute,
  conductoresListRoute,
  conductoresNuevoRoute,
  conductoresDetalleRoute,
  sucursalesListRoute,
  sucursalesNuevaRoute,
  sucursalesDetalleRoute,
  cargasListRoute,
  cargasNuevaRoute,
  cargasDetalleRoute,
  cargaTrackRoute,
  certificadosRoute,
  asignacionDetalleRoute,
  publicTrackingRoute,
  legalTerminosRoute,
  cobraHoyHistorialRoute,
  legalCobraHoyRoute,
  adminCobraHoyRoute,
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
