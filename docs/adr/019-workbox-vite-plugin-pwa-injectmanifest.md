# ADR-019 — Workbox v7 + `vite-plugin-pwa` en modo `injectManifest` para el Service Worker

- **Estado**: Accepted
- **Fecha**: 2026-04-30 (decisión inicial); 2026-05-01 (pivote a `injectManifest`); 2026-05-03 (ADR escrito retroactivo)
- **Decisores**: Felipe Vicencio (Product Owner)
- **Supersede**: —

## Contexto

`apps/web` es la PWA multirol (shipper / carrier / driver / admin / stakeholder) servida desde Cloud Run + Global HTTPS LB en `https://app.boosterchile.com`. Debe ser instalable como PWA (icon en home screen, fullscreen `display: standalone`, splash) y resiliente offline (al menos shell + assets cacheados). A partir de la fase P3.c también necesita un **Service Worker custom** que maneje:

- `push` events (Web Push estándar — ver ADR-016) para mostrar notificaciones nativas con tab cerrada.
- `notificationclick` para deep-link al chat con focus de tab existente.
- Eventualmente: background sync, periodic sync para refresh de listas.

Espacio de decisión:

- **Stack base**: vanilla Service Worker / Workbox / `serwist` (fork de Workbox, más moderno).
- **Build integration con Vite**: `vite-plugin-pwa` / `serwist/vite` / build manual.
- **Estrategia de SW**:
  - `generateSW`: el plugin genera el SW completo (precaching auto, runtime caching declarativo).
  - `injectManifest`: el desarrollador escribe el SW; el plugin solo inyecta el manifest de assets.

## Decisión

Usar **Workbox v7.3.0** + **`vite-plugin-pwa@^0.21.1`** en modo **`injectManifest`** (`apps/web/vite.config.ts:14-50`).

Concreto:

- **SW source**: `apps/web/src/sw.ts` — lo escribe el desarrollador, importa primitives de Workbox según necesite.
- **Precaching**: el plugin inyecta `__WB_MANIFEST` en build time (lista de hashes de `**/*.{js,css,html,ico,png,svg,woff2}`). El SW llama `precacheAndRoute(self.__WB_MANIFEST)` para cachear.
- **Runtime caching**: `registerRoute()` con `CacheFirst` + `ExpirationPlugin` para Google Fonts CSS (`fonts.googleapis.com`, 4 entries × 1 año) y WebFonts (`fonts.gstatic.com`, 20 entries × 1 año). Ver `sw.ts:44-71`.
- **Lifecycle**: `self.skipWaiting()` + `clientsClaim()` explícitos al inicio del SW. `registerType: 'autoUpdate'` en el plugin para que el cliente refresque el SW al detectar cambio.
- **Push handlers custom**: `addEventListener('push', ...)` y `addEventListener('notificationclick', ...)` agregados al final del SW (ver `sw.ts:96-160`).
- **Manifest del PWA**: declarado inline en `vite.config.ts:31-49` (name "Booster AI", short_name "Booster", theme `#1FA058`, icons 192/512/maskable).

## Alternativas consideradas y rechazadas

### A. `vite-plugin-pwa` modo `generateSW` (estado inicial)

Configuramos `globPatterns` + `runtimeCaching` declarativo y el plugin genera el SW automáticamente. **Era el modo inicial de Booster AI hasta la fase P3.c**.

- **Por qué se pivoteó a `injectManifest`**:
  - **Necesitamos handlers custom**: `push` + `notificationclick` para Web Push (ADR-016). En modo `generateSW` no se puede agregar código arbitrario al SW; solo se configuran routes via JSON. Hay un workaround con `additionalManifestEntries` + `importScripts`, pero termina siendo más complejo que escribir el SW directo.
  - **Control sobre `skipWaiting`/`clientsClaim`**: en `generateSW` se configura por flags; en `injectManifest` se llaman explícitamente — más visible en el code review.
  - **Migración mínima**: el SW custom mantiene el mismo precaching y runtime caching del modo anterior. Cambia: `skipWaiting` y `clientsClaim` ahora son llamadas explícitas; `runtimeCaching` se hace con `registerRoute()` de `workbox-routing`. El comment en `sw.ts:13-17` documenta la migración.

### B. `serwist` (fork modernizado de Workbox)

Activamente mantenido, mejor TypeScript types, plugin Vite oficial.

- **Por qué se rechazó (por ahora)**:
  - **Madurez**: serwist tiene <50K downloads/semana vs Workbox ~7M/semana. Comunidad chica, menos respuestas en Stack Overflow / GitHub Issues.
  - **Riesgo de abandono**: es un fork single-maintainer. Workbox es Google con compromiso de soporte largo.
  - **Sin ventaja decisiva**: las features que serwist agrega (mejor TS types) son nice-to-have. La fricción del SW custom es la misma.
- **Reevaluación**: si serwist supera 1M downloads/semana o si Workbox entra en deprecation explícito, migrar.

### C. Vanilla Service Worker (sin Workbox)

Escribir el SW desde cero con `caches.open()` + fetch handlers manuales.

- **Por qué se rechazó**:
  - El precaching robusto con cache versioning es ~150 líneas de boilerplate. Workbox lo resuelve en 1.
  - `ExpirationPlugin` tiene casos edge (LRU + TTL) que ya están testeados y funcionando — no vale reimplementar.
  - La complejidad agregada de Workbox (~30KB minified) es trivial frente al beneficio de tener primitives probados.

### D. Workbox CLI standalone (sin Vite plugin)

Ejecutar `workbox-cli` post-build para generar/inyectar el SW.

- **Por qué se rechazó**: dos pasos en CI (build Vite + workbox CLI). El plugin de Vite hace ambos en un solo `pnpm build`. Menos chance de drift entre el manifest del bundle y el manifest del SW.

### E. Ignorar PWA y servir SPA pelado

No PWA, sin SW, sin install.

- **Por qué se rechazó**: la propuesta de valor del producto incluye uso mobile en zonas de carga (a veces sin red estable). PWA con shell offline + push notification es feature core, no nice-to-have. Está formalizado en ADR-008.

## Consecuencias

### Positivas

- **Push handlers controlables**: el SW source vive en el repo, se code-reviewa como cualquier otro `.ts`. Fácil agregar background sync / periodic sync en el futuro sin desarmar la stack.
- **Type safety**: `sw.ts` corre con `tsc` y la config TS del workspace. Errores capturables pre-build.
- **Workbox primitives reusables**: `CacheFirst`, `NetworkFirst`, `StaleWhileRevalidate`, `ExpirationPlugin`, `BroadcastUpdatePlugin`. Coverage probada de casos edge.
- **AutoUpdate**: cuando se publica una versión nueva, los clientes la reciben transparentemente al próximo navigate (no requiere refresh manual).
- **Manifest inline en `vite.config.ts`**: una sola fuente de verdad. No hay un `public/manifest.json` separado que pueda quedar drift con el bundle.
- **Bundle ~30KB extra**: Workbox primitives. Cargado solo en el SW (no en el bundle principal del cliente).

### Negativas

- **`skipWaiting + clientsClaim` agresivos**: la combinación hace que un nuevo SW tome control inmediato de tabs abiertas. Si el usuario está en medio de un flujo (ej. completando un formulario), el SW nuevo podría cachear assets nuevos que no son compatibles con el JS del SPA viejo cargado en memoria. Mitigación: el SPA evita state cross-cache (todo en TanStack Query), y un fallback "actualizá la página" en caso de error inesperado del cliente.
- **`@ts-expect-error` en `ExpirationPlugin`**: el tsconfig base tiene `exactOptionalPropertyTypes: true`; `workbox-expiration` tipa `cacheDidUpdate` como required. Hay 2 supresiones explícitas en `sw.ts` con comentario justificando. Eventualmente fix upstream o relajar el flag para `apps/web` solo.
- **Acoplamiento a Workbox**: si en el futuro se decide mover a serwist, hay que cambiar imports y reescribir las llamadas. Mitigación: el SW son ~80 líneas; reescritura factible en 1 sprint.
- **Debugging del SW**: requiere abrir DevTools → Application → Service Workers, registrar/unregister, simular offline. UX de debugging menos cómodo que el resto del SPA.

### Riesgos abiertos

- **iOS Safari Limitation**: Service Worker en Safari iOS tiene gotchas (storage quota más estricto, eventos en background limitados). Validar en E2E mobile-safari antes de cada release que toca el SW.
- **Cache poisoning**: si un asset se cachea con un hash y después el deploy cambia el contenido sin cambiar el hash (bug de build), los clientes ven contenido stale hasta el próximo `autoUpdate`. Mitigación: trust en el bundler (Vite) que genera hashes únicos por contenido.
- **Workbox v8 (futuro)**: cuando salga, evaluar migración. Probable que sea drop-in.

## Implementación (estado actual)

| # | Ítem | Archivo | Estado |
|---|------|---------|--------|
| 1 | `vite-plugin-pwa@^0.21.1` configurado modo `injectManifest` | `apps/web/vite.config.ts:14-50` | ✅ commiteado |
| 2 | Workbox v7.3.0 (core, expiration, precaching, routing, strategies, window) | `apps/web/package.json:52-57` | ✅ commiteado |
| 3 | SW source `apps/web/src/sw.ts` con precaching + runtime caching + push handlers | `apps/web/src/sw.ts` | ✅ commiteado |
| 4 | Manifest inline (name, theme_color, icons 192/512/maskable) | `apps/web/vite.config.ts:31-49` | ✅ commiteado |
| 5 | `registerType: 'autoUpdate'` para refresh transparente | `apps/web/vite.config.ts:26` | ✅ commiteado |
| 6 | Limpiar `@ts-expect-error` de `ExpirationPlugin` | `apps/web/src/sw.ts:49,64` | 📅 backlog (espera fix upstream o relajar tsconfig de apps/web) |
| 7 | Smoke E2E iOS Safari (mobile-safari project en Playwright) post-cada release | tooling | 📅 backlog (ver task #122 + ADR-008) |

## Referencias

- `apps/web/vite.config.ts` — config del plugin
- `apps/web/src/sw.ts` — Service Worker custom
- `apps/web/package.json` — deps Workbox
- ADR-008 — PWA multirole (rationale de elegir PWA)
- ADR-016 — Web Push VAPID (motivó el pivote a `injectManifest`)
- Workbox — [Documentation v7](https://developer.chrome.com/docs/workbox)
- vite-plugin-pwa — [GitHub](https://github.com/vite-pwa/vite-plugin-pwa)
- web.dev — [Service Workers](https://web.dev/learn/pwa/service-workers/)
