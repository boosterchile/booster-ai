import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from '@tanstack/react-router';
import { RouteFallback } from './components/RouteFallback.js';
import { RootComponent } from './routes/__root.js';
// Rutas EAGER (primer-paint público): no se code-splittean, para evitar un
// flash de carga en landing / login / login conductor / link de tracking
// externo. El resto se carga lazy vía lazyRouteComponent (audit P1-J).
import { IndexRoute } from './routes/index.js';
import { LoginConductorRoute } from './routes/login-conductor.js';
import { LoginRoute } from './routes/login.js';
import { PublicTrackingRoute } from './routes/public-tracking.js';

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

// Modo demo — selector de persona para el subdominio
// demo.boosterchile.com. Sin Firebase signup; el backend mintea custom
// token Firebase con claim is_demo:true via POST /demo/login.
const demoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/demo',
  component: lazyRouteComponent(() => import('./routes/demo.js'), 'DemoRoute'),
});

// SC-INT-1 (sec-001-cierre): página de mantenimiento renderizada por
// DemoRoute cuando flag demo_mode_activated=false. Ruta directa
// `/maintenance` expone también el componente para preview/QA sin
// depender del flag.
const maintenanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/maintenance',
  component: lazyRouteComponent(() => import('./routes/maintenance.js'), 'MaintenanceRoute'),
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
  component: lazyRouteComponent(() => import('./routes/onboarding.js'), 'OnboardingRoute'),
});

// W1.3 (hito CORFO) — alta de usuarios operativa: consume el token de
// onboarding emitido por el admin al aprobar un signup-request (ver
// /solicitar-acceso). Distinta de /onboarding (flujo viejo SC3 self-signup,
// dead-end permanente, no se toca): el aprobado ya tiene cuenta Firebase
// pero aún no existe en la DB, así que también requiere
// meRequirement="allow-pre-onboarding".
const onboardingAdminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/onboarding-admin',
  component: lazyRouteComponent(
    () => import('./routes/onboarding-admin.js'),
    'OnboardingAdminRoute',
  ),
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app',
  component: lazyRouteComponent(() => import('./routes/app.js'), 'AppRoute'),
});

const ofertasRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/ofertas',
  component: lazyRouteComponent(() => import('./routes/ofertas.js'), 'OfertasRoute'),
});

const perfilRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/perfil',
  component: lazyRouteComponent(() => import('./routes/perfil.js'), 'PerfilRoute'),
});

// Dashboard del conductor — vista principal post-login del conductor
// (rol='conductor'). Lista de servicios asignados + alerta preventiva
// de WhatsApp + reporte GPS móvil + acceso a configuración.
// La empresa de transporte NO ve esta vista; tiene su propia surface.
const conductorDashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/conductor',
  component: lazyRouteComponent(() => import('./routes/conductor.js'), 'ConductorDashboardRoute'),
});

// Configuración del Modo Conductor — solo permisos del navegador, audio
// coaching, comandos de voz, "cómo funciona". El conductor entra aquí
// la primera vez (forzado si no tiene permisos) o vía el ícono de
// engranaje desde el dashboard. URL canónica: /app/conductor/configuracion.
const conductorConfiguracionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/conductor/configuracion',
  component: lazyRouteComponent(
    () => import('./routes/conductor-configuracion.js'),
    'ConductorConfiguracionRoute',
  ),
});

const adminDispositivosRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/admin/dispositivos',
  component: lazyRouteComponent(
    () => import('./routes/admin-dispositivos.js'),
    'AdminDispositivosRoute',
  ),
});

// ADR-029 v1 / ADR-032 — admin platform-wide Cobra Hoy. Auth real está
// en backend (BOOSTER_PLATFORM_ADMIN_EMAILS allowlist); la ruta queda
// bajo /app para mantener la auth de Firebase y el layout.
const adminCobraHoyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/admin/cobra-hoy',
  component: lazyRouteComponent(() => import('./routes/admin-cobra-hoy.js'), 'AdminCobraHoyRoute'),
});

const vehiculosListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/vehiculos',
  component: lazyRouteComponent(() => import('./routes/vehiculos.js'), 'VehiculosListRoute'),
});

// D3 — Surface dedicada de seguimiento de flota. Reemplaza el patrón
// anterior en el que la ubicación del vehículo se accedía desde el form
// de edición (`/app/vehiculos/$id`). El detalle quedó pure-edit.
const flotaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/flota',
  component: lazyRouteComponent(() => import('./routes/flota.js'), 'FlotaRoute'),
});

// D8 — CRUD de conductores del carrier. Solo accesible desde la interfaz
// transportista (no es self-signup driver). Roles dueno/admin/despachador
// crean y editan; conductor + visualizador solo leen.
const conductoresListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/conductores',
  component: lazyRouteComponent(() => import('./routes/conductores.js'), 'ConductoresListRoute'),
});
const conductoresNuevoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/conductores/nuevo',
  component: lazyRouteComponent(() => import('./routes/conductores.js'), 'ConductoresNuevoRoute'),
});
const conductoresDetalleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/conductores/$id',
  component: lazyRouteComponent(() => import('./routes/conductores.js'), 'ConductoresDetalleRoute'),
});

// D7b — Sucursales del shipper. Puntos físicos de origen/destino.
const sucursalesListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/sucursales',
  component: lazyRouteComponent(() => import('./routes/sucursales.js'), 'SucursalesListRoute'),
});
const sucursalesNuevaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/sucursales/nueva',
  component: lazyRouteComponent(() => import('./routes/sucursales.js'), 'SucursalesNuevaRoute'),
});
const sucursalesDetalleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/sucursales/$id',
  component: lazyRouteComponent(() => import('./routes/sucursales.js'), 'SucursalesDetalleRoute'),
});

// D11 — Stakeholder geo dashboard. Surface restringida a rol
// `stakeholder_sostenibilidad`. Datos agregados con k-anonymity ≥ 5;
// nunca expone shippers o carriers individuales.
const stakeholderZonasRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/stakeholder/zonas',
  component: lazyRouteComponent(
    () => import('./routes/stakeholder-zonas.js'),
    'StakeholderZonasRoute',
  ),
});

// D6 — Dashboard de cumplimiento: documentos vencidos o por vencer.
// Solo para carriers (transportistas).
const cumplimientoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/cumplimiento',
  component: lazyRouteComponent(() => import('./routes/cumplimiento.js'), 'CumplimientoRoute'),
});

// Platform admin — operaciones internas (init/clean seed demo, etc.).
// Acceso por allowlist de email en backend (BOOSTER_PLATFORM_ADMIN_EMAILS).
// meRequirement=skip → solo Firebase auth, no requiere onboarding/empresa.
const platformAdminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/platform-admin',
  component: lazyRouteComponent(() => import('./routes/platform-admin.js'), 'PlatformAdminRoute'),
});

// ADR-033 §8 — Matching engine v2 backtest UI. Misma gate platform-admin.
const platformAdminMatchingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/platform-admin/matching',
  component: lazyRouteComponent(
    () => import('./routes/platform-admin-matching.js'),
    'PlatformAdminMatchingRoute',
  ),
});

// ADR-039 — Site Settings Editor. Editar marca + copy del demo sin
// redeploy. Mismo gate platform-admin (BOOSTER_PLATFORM_ADMIN_EMAILS).
const platformAdminSiteSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/platform-admin/site-settings',
  component: lazyRouteComponent(
    () => import('./routes/platform-admin-site-settings.js'),
    'PlatformAdminSiteSettingsRoute',
  ),
});

// Spec 2026-05-13 — Observability dashboard (costos GCP + Twilio +
// Workspace + salud + capacity + forecast). Misma gate platform-admin.
const platformAdminObservabilityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/platform-admin/observability',
  component: lazyRouteComponent(
    () => import('./routes/platform-admin-observability.js'),
    'PlatformAdminObservabilityRoute',
  ),
});

// T10 SEC-001 Sprint 2b — signup-requests admin dashboard (ADR-052 + SC-1.2.1).
// Gate platform-admin (BOOSTER_PLATFORM_ADMIN_EMAILS). Feature flag
// SIGNUP_REQUEST_FLOW_ACTIVATED → coming-soon UI si OFF.
const platformAdminSignupRequestsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/platform-admin/signup-requests',
  component: lazyRouteComponent(
    () => import('./routes/platform-admin-signup-requests.js'),
    'PlatformAdminSignupRequestsRoute',
  ),
});

const vehiculosNuevoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/vehiculos/nuevo',
  component: lazyRouteComponent(() => import('./routes/vehiculos.js'), 'VehiculosNuevoRoute'),
});

const vehiculosDetalleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/vehiculos/$id',
  component: lazyRouteComponent(() => import('./routes/vehiculos.js'), 'VehiculosDetalleRoute'),
});

const cargasListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/cargas',
  component: lazyRouteComponent(() => import('./routes/cargas.js'), 'CargasListRoute'),
});

const cargasNuevaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/cargas/nueva',
  component: lazyRouteComponent(() => import('./routes/cargas.js'), 'CargasNuevoRoute'),
});

const cargasDetalleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/cargas/$id',
  component: lazyRouteComponent(() => import('./routes/cargas.js'), 'CargasDetalleRoute'),
});

const vehiculoLiveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/vehiculos/$id/live',
  component: lazyRouteComponent(() => import('./routes/vehiculo-live.js'), 'VehiculoLiveRoute'),
});

const cargaTrackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/cargas/$id/track',
  component: lazyRouteComponent(() => import('./routes/carga-track.js'), 'CargaTrackRoute'),
});

const certificadosRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/certificados',
  component: lazyRouteComponent(() => import('./routes/certificados.js'), 'CertificadosRoute'),
});

const asignacionDetalleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/asignaciones/$id',
  component: lazyRouteComponent(
    () => import('./routes/asignacion-detalle.js'),
    'AsignacionDetalleRoute',
  ),
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
  component: lazyRouteComponent(() => import('./routes/legal-terminos.js'), 'LegalTerminosRoute'),
});

// ADR-029 v1 / ADR-032 — Listado de adelantos solicitados por el
// carrier ("Booster Cobra Hoy"). Surface dedicada bajo /app, requiere
// auth + activeMembership de tipo transportista.
const cobraHoyHistorialRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/cobra-hoy/historial',
  component: lazyRouteComponent(
    () => import('./routes/cobra-hoy-historial.js'),
    'CobraHoyHistorialRoute',
  ),
});

// Adendum de T&Cs específico para el producto "Cobra Hoy". Pública,
// referenciable desde el modal de solicitud.
const legalCobraHoyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/legal/cobra-hoy',
  component: lazyRouteComponent(() => import('./routes/legal-cobra-hoy.js'), 'LegalCobraHoyRoute'),
});

// ADR-031 §4.1 — Listado de liquidaciones del carrier activo. Surface
// dedicada bajo /app. (DTE removido — ADR-069: Booster no emite DTE.)
const liquidacionesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/liquidaciones',
  component: lazyRouteComponent(() => import('./routes/liquidaciones.js'), 'LiquidacionesRoute'),
});

// SEC-001 Sprint 2b (ADR-052) — alta de usuarios gateada por admin. Reemplaza
// el self-signup directo de Firebase: el visitante pide acceso acá (POST
// público /api/v1/signup-request) y un admin aprueba/rechaza desde
// /app/platform-admin/signup-requests. Path raíz (NO /app/...) porque debe
// ser accesible sin sesión, igual que /login.
const solicitarAccesoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/solicitar-acceso',
  component: lazyRouteComponent(
    () => import('./routes/solicitar-acceso.js'),
    'SolicitarAccesoRoute',
  ),
});

// /apariencia — selector de acento (D1 · H4). Ruta pública: preferencia
// client-side inocua; demostrador del theming en runtime.
const aparienciaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/apariencia',
  component: lazyRouteComponent(() => import('./routes/apariencia.js'), 'AparienciaRoute'),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  demoRoute,
  loginConductorRoute,
  onboardingRoute,
  onboardingAdminRoute,
  appRoute,
  ofertasRoute,
  perfilRoute,
  conductorDashboardRoute,
  conductorConfiguracionRoute,
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
  stakeholderZonasRoute,
  cumplimientoRoute,
  platformAdminRoute,
  platformAdminMatchingRoute,
  platformAdminSiteSettingsRoute,
  platformAdminObservabilityRoute,
  platformAdminSignupRequestsRoute,
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
  liquidacionesRoute,
  adminCobraHoyRoute,
  maintenanceRoute,
  solicitarAccesoRoute,
  aparienciaRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPendingComponent: RouteFallback,
  defaultPreload: 'intent', // prefetch on link hover
});

// Module augmentation para que useNavigate / Link tengan los paths tipados.
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
