# ADR-008 — PWA Multi-Rol en un solo `apps/web` (sin apps nativas iniciales)

**Status**: Accepted
**Date**: 2026-04-23
**Decider**: Felipe Vicencio (Product Owner)
**Related**: [ADR-004 Modelo Uber-like](./004-uber-like-model-and-roles.md), [ADR-001](./001-stack-selection.md)

---

## Contexto

El ADR-004 define cuatro roles: **Shipper, Carrier, Driver, Admin**. La propuesta técnica inicial (incorrecta) asumía apps nativas separadas (ej. React Native para driver). El Product Owner clarificó:

- **Conductor usa Booster AI como web app**, no como app nativa.
- Cada rol requiere **interfaz distinta**, pero sobre el mismo frontend web.
- Apps nativas entran al backlog para fase posterior, no son necesarias para go-live comercial.

Esto implica una única aplicación web que:
- Detecta el rol del usuario autenticado
- Renderiza **la UI apropiada por rol**
- Maneja casos de usuarios con múltiples roles (carrier unipersonal = carrier + driver)
- Funciona **robustamente en smartphone** (el driver opera desde móvil en cabina)

## Decisión

Consolidar todo el frontend en `apps/web` como **PWA (Progressive Web App) robusta** con cuatro interfaces por rol, sin apps nativas por ahora.

### Arquitectura del frontend

```
apps/web/
├── public/
│   ├── manifest.webmanifest         # PWA metadata
│   ├── icons/                       # iconos PWA 192x192, 512x512
│   └── service-worker.ts            # (generado por Workbox)
│
├── src/
│   ├── main.tsx                     # entry point
│   ├── App.tsx                      # router + providers
│   │
│   ├── auth/
│   │   ├── firebase.ts              # Firebase Auth setup
│   │   ├── useCurrentUser.ts        # hook
│   │   └── RoleGuard.tsx            # redirige según rol
│   │
│   ├── shared/                      # UI compartida entre roles
│   │   ├── components/              # Button, Dialog, etc (shadcn/ui)
│   │   ├── hooks/
│   │   ├── lib/
│   │   └── layouts/                 # AppShell, Navbar, Sidebar base
│   │
│   ├── roles/
│   │   ├── shipper/
│   │   │   ├── routes.ts            # TanStack Router tree
│   │   │   ├── pages/
│   │   │   │   ├── Dashboard.tsx
│   │   │   │   ├── NewCargoRequest.tsx
│   │   │   │   ├── MyTrips.tsx
│   │   │   │   ├── TripDetail.tsx
│   │   │   │   └── Documents.tsx
│   │   │   ├── components/          # específicos del rol
│   │   │   └── api/                 # TanStack Query hooks
│   │   │
│   │   ├── carrier/
│   │   │   ├── routes.ts
│   │   │   ├── pages/
│   │   │   │   ├── Dashboard.tsx    # cargas pendientes de aceptar
│   │   │   │   ├── OfferDetail.tsx  # aceptar/rechazar
│   │   │   │   ├── AssignDriver.tsx
│   │   │   │   ├── FleetMap.tsx     # ver vehículos en tiempo real
│   │   │   │   ├── Drivers.tsx
│   │   │   │   ├── Vehicles.tsx
│   │   │   │   ├── Earnings.tsx
│   │   │   │   └── Documents.tsx
│   │   │   └── ...
│   │   │
│   │   ├── driver/
│   │   │   ├── routes.ts
│   │   │   ├── pages/
│   │   │   │   ├── ActiveTrip.tsx   # card grande, minimalista
│   │   │   │   ├── TripExecution.tsx (Navegación paso a paso)
│   │   │   │   ├── CapturePhoto.tsx
│   │   │   │   ├── CaptureSignature.tsx
│   │   │   │   ├── ReportIncident.tsx
│   │   │   │   └── History.tsx
│   │   │   ├── components/          # UI grande, touch-friendly
│   │   │   └── offline/             # capacidad offline
│   │   │
│   │   ├── admin/
│   │   │   ├── routes.ts
│   │   │   ├── pages/
│   │   │   │   ├── Overview.tsx
│   │   │   │   ├── Users.tsx
│   │   │   │   ├── Trips.tsx
│   │   │   │   ├── Incidents.tsx
│   │   │   │   ├── Disputes.tsx
│   │   │   │   ├── Config.tsx
│   │   │   │   └── Audit.tsx
│   │   │   └── ...
│   │   │
│   │   └── stakeholder/
│   │       ├── routes.ts
│   │       ├── pages/
│   │       │   ├── Dashboard.tsx   # métricas ESG agregadas
│   │       │   ├── Certificates.tsx # certificados de trips del scope
│   │       │   ├── Reports.tsx      # exportación multi-estándar
│   │       │   ├── Scope.tsx        # qué datos tengo consent para ver
│   │       │   └── AuditTrail.tsx   # mis consultas propias
│   │       └── components/
│   │
│   └── pwa/
│       ├── ServiceWorkerRegister.ts
│       ├── pushNotifications.ts     # Web Push API + VAPID
│       ├── offlineCache.ts          # Workbox strategies
│       └── backgroundSync.ts        # para telemetría del driver
```

### Ruteo por rol

`src/App.tsx` usa TanStack Router:

```typescript
// Boceto
const rootRoute = createRootRoute({ component: AppShell });

const loginRoute = createRoute({...});

// Después de login, redirige según rol
const dashboardRedirect = createRoute({
  path: '/',
  beforeLoad: ({ context }) => {
    const roles = context.currentUser?.roles ?? [];
    // Si tiene múltiples roles, último usado o selector
    if (roles.includes('admin')) return redirect('/admin');
    if (roles.includes('carrier') && roles.includes('driver')) {
      return redirect('/role-switcher'); // unipersonal
    }
    if (roles.includes('carrier')) return redirect('/carrier');
    if (roles.includes('driver')) return redirect('/driver');
    if (roles.includes('shipper')) return redirect('/shipper');
    return redirect('/onboarding');
  },
});

const shipperRoutes = createRoute({...}).addChildren([...]);
const carrierRoutes = createRoute({...}).addChildren([...]);
const driverRoutes = createRoute({...}).addChildren([...]);
const adminRoutes = createRoute({...}).addChildren([...]);
```

### Multi-rol (carrier unipersonal)

Un User puede tener `['carrier', 'driver']`. En ese caso:

- Pantalla `/role-switcher` al login muestra dos tarjetas grandes:
  - "🚛 Modo Carrier" (ver ofertas, gestionar)
  - "🚚 Modo Conductor" (viaje activo)
- La selección se recuerda en localStorage hasta nueva sesión
- En header siempre hay un switcher visible para cambiar de contexto rápido
- Algunos eventos fuerzan el modo: si llega notificación de "nueva oferta" → sugiere Modo Carrier; si llega "carga asignada a ti" → sugiere Modo Conductor

### PWA — capacidades requeridas

#### Manifest

```json
{
  "name": "Booster AI",
  "short_name": "Booster",
  "start_url": "/",
  "display": "standalone",
  "theme_color": "#0d9488",
  "background_color": "#ffffff",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "share_target": {
    "action": "/shipper/new",
    "method": "POST",
    "enctype": "multipart/form-data",
    "params": {
      "title": "title",
      "text": "text",
      "files": [{"name": "documents", "accept": ["image/*", "application/pdf"]}]
    }
  }
}
```

El `share_target` permite que los usuarios compartan fotos/PDFs directamente a Booster AI desde WhatsApp u otras apps del teléfono (útil para documentos externos).

#### Service Worker (Workbox via vite-plugin-pwa)

Strategies por ruta:

| Ruta | Strategy | Razón |
|------|----------|-------|
| `/api/telemetry/report` | Network-first + Background Sync | Driver reporta posición incluso sin red; se envía cuando vuelva |
| `/api/trips/:id` | Stale-while-revalidate | Driver puede ver datos del trip offline |
| `/api/cargo-requests/active` | Network-first con fallback a cache | Carrier ve últimas ofertas |
| `/static/*` (assets) | Cache-first con versioning | Performance |
| `/fonts/*`, `/icons/*` | Cache-first eterno | Nunca cambian por URL |
| Páginas `/driver/*` | App Shell + route-specific cache | Driver navega offline |

#### Web Push Notifications

- Setup VAPID keys (generadas con `web-push generate-vapid-keys`)
- Backend endpoint `POST /api/push/subscribe` guarda el `PushSubscription`
- `notification-service` envía push via VAPID
- Service Worker muestra notification con:
  - Title, body, icon, badge
  - Actions (botones "Aceptar" / "Ver detalle")
  - Click → focus en la pantalla adecuada
- Fallback a FCM si Web Push no permitido o falla

#### Background Sync

Para driver que pierde red durante trip:
- Reportes de telemetría se guardan en IndexedDB queue
- Al recuperar red, Background Sync vacía la queue hacia el backend
- Esto previene pérdida de data en zonas con cobertura pobre (muy común en Chile rural)

#### Instalabilidad

- Banner "Agregar a inicio" aparece en Chrome Android cuando pasa los criterios de engagement
- iOS Safari: instrucciones explícitas "Compartir → Agregar a pantalla de inicio"
- Una vez instalada, Booster se comporta como app independiente

### Sistema de diseño compartido

`packages/ui-tokens` y `packages/ui-components` (nuevos packages):

- **Design tokens**: colores, espaciados, tipografías, sombras — centralizados
- **Componentes base shadcn/ui**: Button, Dialog, Form, Table, etc. — copiados al repo (no dep externa)
- **Componentes específicos Booster**: TripCard, VehicleAvatar, DriverRatingStars, CarbonBadge
- **Density variants**:
  - `driver` → touch-first, botones grandes (min 48x48px), tipografía 16px+, contraste alto
  - `carrier` → desktop/tablet friendly, info denso, tablas
  - `shipper` → equilibrio, UX amigable
  - `admin` → denso, tablas complejas, filtros avanzados

Theme CSS variables permite switch entre densities sin recompilar.

### Accesibilidad (WCAG 2.1 AA desde day 0)

Requisito TRL 10 + Ley 21.015 (Chile inclusión). Checklist:

- Contraste ≥ 4.5:1 para texto normal, ≥ 3:1 para texto grande
- Keyboard navigation en todas las interacciones
- Focus visible siempre
- aria-label en botones-solo-ícono
- aria-live para actualizaciones dinámicas (ej. "Trip actualizado")
- Formularios con labels explícitos
- Alt text en imágenes informativas
- Pruebas automáticas con axe-core en Playwright E2E
- Pruebas manuales con lectores de pantalla (NVDA, VoiceOver)

## Consecuencias

### Positivas

- **Time-to-market más rápido**: una sola app vs cuatro (web + 3 nativas) reduce ~60% del trabajo de frontend.
- **Stack consistente**: todo TypeScript, nada de Java/Kotlin/Swift/Dart. Equipo pequeño puede mantener.
- **Deploy continuo**: cada PR mergeado llega a producción inmediatamente; no hay review de App Store (que toma días).
- **Actualización forzada gratis**: si hay un bug, el próximo reload trae la versión nueva — no depende de que el usuario actualice su app.
- **Share target via OS**: driver puede compartir foto de documento desde la cámara o WhatsApp directamente a Booster.
- **Offline robusto**: Service Worker + Background Sync + IndexedDB cubren el 90% del gap entre web y nativa para el caso Booster.

### Negativas

- **iOS limitaciones**: Safari tiene restricciones en Web Push (soportado desde iOS 16.4 pero con limitaciones), no permite background location (solo cuando tab está activa). Mitigación:
  - Requerir iOS 16.4+ para drivers
  - Para reporte de ubicación crítico → Teltonika del camión cubre (el PWA es complementario)
  - Si hay gap grave → apps nativas en backlog
- **Descubrimiento vía App Store**: no estamos en stores. Los usuarios llegan via link directo o WhatsApp. Mitigación: banner "Instalar" bien diseñado + onboarding via WhatsApp que envía link.
- **No hay acceso a hardware nativo avanzado**: no podemos integrar con el head unit del camión, OBD-II directo, etc. Mitigación: Teltonika cubre esos datos; no son required para V1.
- **Performance en móviles antiguos**: PWAs en dispositivos con <2GB RAM pueden lag. Mitigación: bundle size target <500KB initial, code-splitting agresivo, lazy loading.

## Implementación inicial

### Dependencias adicionales

- `vite-plugin-pwa` — genera Service Worker vía Workbox
- `workbox-window` — registro del SW del lado del cliente
- `@tanstack/react-router` — router type-safe
- `web-push` (backend) — envío de push notifications
- `idb` — helper para IndexedDB tipado
- `react-hook-form` + `@hookform/resolvers` — formularios
- `zod` (ya en shared-schemas) — validación

### Tests

- Unit: Vitest para hooks y componentes
- E2E: Playwright cubre los 4 flujos principales por rol
- A11y: axe-core integrado en E2E (fail si hay violaciones WCAG AA)
- Visual regression: Playwright screenshots (opcional, costoso de mantener)

## Validación

- [ ] Lighthouse PWA score ≥ 90
- [ ] Lighthouse Accessibility score ≥ 95
- [ ] Lighthouse Performance score ≥ 85 (móvil mid-tier)
- [ ] Bundle inicial < 500KB (gzip)
- [ ] Funciona offline las pantallas críticas del driver
- [ ] Web Push notification llega en Chrome Android + iOS 16.4+
- [ ] Instalable en Android + iOS con banner
- [ ] A11y axe-core pasa sin violaciones AA
- [ ] Carrier unipersonal puede cambiar entre modo carrier/conductor sin pérdida de estado

## Path futuro — apps nativas

Cuando se considere necesario (feedback de drivers, necesidad de features nativas críticas):

1. **React Native con expo-router** reusando packages del monorepo
2. **Expo Application Services (EAS)** para build + submit
3. Reusar packages: `shared-schemas`, `logger`, `ai-provider`, `ui-tokens`
4. Nueva app `apps/driver-native` con paridad funcional con `apps/web/roles/driver`

Esta migración NO invalida el trabajo del PWA — coexistirán. El PWA sigue sirviendo a carriers + shippers + admin + drivers sin la app.

## Referencias

- [ADR-004 — Modelo Uber-like](./004-uber-like-model-and-roles.md)
- [ADR-001 — Stack](./001-stack-selection.md)
- Vite PWA: https://vite-pwa-org.netlify.app/
- Workbox: https://developer.chrome.com/docs/workbox/
- Web Push VAPID: https://web.dev/articles/push-notifications-web-push-protocol
- PWA Share Target: https://web.dev/articles/web-share-target
- Ley 21.015 Chile inclusión laboral: https://bcn.cl/2fhmz
