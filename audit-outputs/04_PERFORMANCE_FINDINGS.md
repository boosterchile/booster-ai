# 04 — Performance findings (estatico, read-only)

> Subagent: `performance-analyzer` · Sesión `21c07e7c-e6f9-4de9-9c1d-f819e6b5d5d7` · 2026-05-19T02:39Z
> Metodología: lectura de fuentes + grep/find. **NO** se ejecutó `vite build`, `pnpm test`, ni se instaló `rollup-plugin-visualizer`. Sin runtime profiling.

---

## Backend hotspots

### B1 — Queries N+1

#### B1.1 [HIGH] N+1 sobre `vehicles` en el orquestador de matching v1/v2
- `apps/api/src/services/matching.ts:180-192` — bucle `for (const emp of candidateEmpresas)` ejecuta `await tx.select().from(vehicles).where(...).limit(1)` por cada empresa candidata. Si el matching pondera 50 empresas → 50 round-trips serializados.
- **Recomendación**: pre-fetch en batch con `inArray(vehicles.empresaId, candidateEmpresas.map(e=>e.id))` y un `WHERE capacityKg >= cargoWeight` + `DISTINCT ON (empresaId)` ordenado por capacityKg ASC. Misma forma que ya usa `matching-v2-lookups.ts:97-138` (5 queries batch). Construir Map<empresaId, Vehicle> y consumirlo dentro del loop. Esperable: 50→1 query, ~p95 -200..-400ms en matching.

#### B1.2 [HIGH] `COUNT(*)` por cada record AVL persistido
- `apps/telemetry-processor/src/persist.ts:114-119` — tras cada INSERT exitoso ejecuta `SELECT COUNT(*) FROM telemetria_puntos WHERE vehiculo_id = ?` para detectar "primer punto del vehículo".
- Volumen: 50 devices × 1 record/min ≈ 72k counts/día; el índice `idx_telemetria_vehiculo_ts` sirve pero el `COUNT(*)` igual escanea todos los rows del vehículo (no es agregación O(1) en Postgres). A 1M rows/vehículo el COUNT se vuelve I/O-bound.
- **Recomendación**: marcar el flag `tiene_primer_punto BOOLEAN DEFAULT FALSE` en `vehiculos` y hacer `UPDATE ... WHERE tiene_primer_punto = FALSE RETURNING id`. O usar `INSERT ... RETURNING xmax = 0 AS was_insert` + un `EXISTS` con `LIMIT 1` (mucho más barato que `COUNT(*)`). Alternativa: detectar con `result.rows[0]?.id` y un check `WHERE NOT EXISTS (SELECT 1 FROM telemetria_puntos WHERE vehiculo_id = ? AND id < new_id)`.

#### B1.3 [LOW] Inserts secuenciales en backfill / merge / seed (job paths)
- `apps/api/src/jobs/backfill-certificados.ts:150-194` ya usa chunked `Promise.all` con `cli.concurrency`, **OK**.
- `apps/api/src/services/seed-demo.ts:412,451,488` — loops secuenciales con awaits en seeder; ejecuta una sola vez en startup, **aceptable** (no hot path).
- `apps/api/src/services/procesar-cobranza-cobra-hoy.ts:121-154` — `<50 candidatos/día` documentado en el código (línea 118-120) como decisión consciente para tener notas individuales. **Sin acción**.

### B2 — `await` dentro de `for` loops

- `apps/api/src/services/matching.ts:180` ya cubierto en B1.1 (es el caso clásico await-in-for con I/O independiente).
- `apps/api/src/services/reconciliar-dtes.ts:116` y `:197` — `for (const row of …)` con awaits a provider externo (Sii/Bsale). Es **rate-limit intencional** (uno por uno para no saturar al proveedor); aceptable, pero **debería tener comentario explícito**. Recomendación: añadir comentario `// secuencial por rate limit del provider (≤N rps)`.
- `apps/api/src/services/chat-whatsapp-fallback.ts:127` — loop sobre candidatos Twilio; verificar si Twilio supporta `Promise.all`; si la quota lo permite, paralelizar.
- `apps/api/src/services/observability/twilio-usage-service.ts:101` — paginación cursor-based de Twilio API, **necesariamente secuencial**. Sin acción.

### B3 — Índices Postgres y pgvector

- Cobertura de índices en migraciones: **136 `CREATE INDEX` en 27 archivos de 38 migraciones** — densidad alta. Tablas críticas inspeccionadas tienen índices adecuados:
  - `telemetria_puntos`: `(vehiculo_id, timestamp_device DESC)`, `(imei, timestamp_device DESC)`, `(vehiculo_id, timestamp_recibido_en DESC)` — `apps/api/drizzle/0005_dispositivos_telemetria.sql:79-82`. OK.
  - `viajes`: `(generador_carga_empresa_id)`, `(generador_carga_whatsapp)`, `(estado)`, `(origen_codigo_region)`, `(creado_en)` — `apps/api/drizzle/0004_phase_zero_unified_schema_es.sql:211-215`. OK.
  - `ofertas`: `viaje_id`, `empresa_id`, `estado`, `expira_en`, `notificado_en` (parcial) — `:236-243`. OK.
  - `posiciones_movil_conductor`: `(vehicle_id, ts)`, `(usuario_id, ts)` — `0025_posiciones_movil.sql:47-50`. OK.
- **Pendiente revisar**:
  - `adelantos_carrier` (`0017_factoring_v1.sql`) — no se verificó si tiene índice en `(status, desembolsado_en)` para la query de mora `procesar-cobranza-cobra-hoy.ts`. Recomendación: confirmar índice parcial `WHERE status = 'desembolsado'`.
  - Algunos índices son `single-column` cuando los queries usan `WHERE x = ? AND y = ?` — sin EXPLAIN ANALYZE no se puede afirmar regresión, pero es típica fuente de mejora.

#### Hallazgo informativo: pgvector NO se usa
- Grep en `packages/**/*.ts`, `apps/**/*.ts` y `apps/api/drizzle/*.sql` no encontró: `pgvector`, `CREATE EXTENSION vector`, operadores `<=>`/`<->`/`<#>`, ni tipos `ivfflat`/`hnsw`.
- Única extensión instalada: `pgcrypto` (`apps/api/test/integration/setup-global.ts:56`).
- **Corrige el blueprint inicial**: la asunción de uso de pgvector no aplica al estado actual del código.

### B4 — Cold start Cloud Run (api)

- `apps/api/src/main.ts:31` corre **migraciones bloqueantes antes del listen** (`await runMigrations(pool, logger)`). En cold start con N migraciones nuevas suma latencia al primer ready signal.
- `apps/api/src/main.ts:43` corre `ensureDemoSeeded` también en startup. En instancias donde `DEMO_*` está OFF debería ser literal no-op; comprobado que tiene early-return, **OK**.
- `firebase-admin/auth` se carga como **type-only import** en la mayoría de archivos (`apps/api/src/middleware/firebase-auth.ts:2`) y solo se instancia singleton en `apps/api/src/services/firebase.ts`. **OK**. El JWKS lazy-fetch en la primera `verifyIdToken` queda fuera del cold start.
- **Recomendaciones**:
  - Mover migraciones a un Cloud Run Job (precondición de deploy) en vez de runtime; el api startup queda <1s.
  - Verificar `package.json` de `apps/api` tiene `"type": "module"` y considerar `sideEffects: false` en packages internos para mejorar tree-shaking del bundle Node (efecto menor en Node, pero ayuda en TS transpilation).
  - Considerar `min-instances=1` en Cloud Run para api (decisión costo/latencia, no técnica).

### B5 — Conexiones a Postgres

- **api** (`apps/api/src/db/client.ts:18`):
  - `max = config.DATABASE_POOL_MAX` (default **10** — `packages/config/src/schemas/database.ts:5`).
  - `connectionTimeoutMillis = DATABASE_CONNECT_TIMEOUT_MS` (default 5000).
  - **No setea** `idleTimeoutMillis` ni `statement_timeout`. En Cloud Run con CPU-throttle al idle, conexiones zombies pueden acumularse del lado de Postgres.
- **telemetry-tcp-gateway** (`apps/telemetry-tcp-gateway/src/main.ts:53`): `max=20, idleTimeoutMillis=30_000`. OK.
- **telemetry-processor** (`apps/telemetry-processor/src/main.ts:57`): `max=10, idleTimeoutMillis=30_000`. OK.
- **Recomendaciones**:
  - Añadir `idleTimeoutMillis: 30_000` y `statement_timeout: 10_000` (ms) al pool del api. Evita queries colgadas que mantienen conexión.
  - Documentar cap total: Cloud Run `instances × poolMax`. Si api escala a 100 instancias con `poolMax=10` → 1000 conexiones potenciales contra Cloud SQL (límite depende del tier). Confirmar headroom o usar `pgbouncer`/Cloud SQL Auth Proxy con pooling lado servidor.
  - No se observa uso de `@google-cloud/cloud-sql-connector` — conexión via `DATABASE_URL` (Cloud Run con VPC connector + private IP, según comentario en client.ts:21-22). OK.

### B6 — Telemetría IoT (hot path)

- **Parsing Codec 8** (`packages/codec8-parser/src/buffer-reader.ts`): cada `readBytes(n)` hace `Buffer.from(slice)` (línea 97) → copia el slice para evitar memory leak via subarray-shared-memory. Decisión consciente y correcta para correctness, **pero genera N allocations por record** (N = cantidad de IO entries variables × 1..8B). En 50 devices × 1 record/min ≈ aceptable; con flota 1000+ devices, considerar pool de buffers o cambio a `subarray + structuredClone` solo cuando el callsite lo necesita.
- **Buffer.concat por chunk** (`apps/telemetry-tcp-gateway/src/connection-handler.ts:125`): cada `data` event hace `Buffer.concat([state.buffer, chunk])` — O(n) por chunk acumulado. Bajo carga normal (chunks pequeños) OK; bajo packet fragmentation patológica puede degradar. **Recomendación**: si llega `state.buffer.length > 1MB`, log warning y cerrar conexión (defensa contra slow-loris).
- **Pub/Sub batching** (`apps/telemetry-tcp-gateway/src/pubsub-publisher.ts:40-43`): batching configurado `maxMessages:100, maxMilliseconds:100`. OK.
- **Backpressure**: `apps/telemetry-processor/src/main.ts:70-72` usa `flowControl: { maxMessages: MAX_MESSAGES_IN_FLIGHT }`. Verificar que el valor configurado guarda relación con `poolMax=10` (si MAX_IN_FLIGHT > 10 hay queue interno bloqueando workers en `pool.connect()`).
- **B1.2 aplica aquí**: el `COUNT(*)` post-insert es el principal hotspot del processor.

---

## Frontend hotspots

### F1 — Bundle size

#### F1.1 [HIGH] Cero code-splitting de rutas — `router.tsx` monta 38 rutas eager
- `apps/web/src/router.tsx:1-46` importa **todas** las rutas con `import { XRoute } from './routes/xxx.js'`. TanStack Router soporta `createLazyRoute` / `lazyRouteComponent` pero **no se usa en ningún archivo** (grep retornó 0 matches).
- El router está en modo programático con plugin `@tanstack/router-plugin` deshabilitado (comentario en `vite.config.ts:8-13`).
- Impacto estimado: el `index.tsx` JS payload incluye routes platform-admin (Tremor + Recharts + d3), maps (`@vis.gl/react-google-maps`), Firebase Auth completo, todas las rutas legales, todos los CRUDs (vehículos, conductores, sucursales, cargas). Bundle gzipped estimado: 400-700KB+ (Tremor solo añade ~150-250KB con sus deps).
- **Recomendación**: convertir las rutas heavy a lazy:
  - `platform-admin-*` (4 rutas): contienen Tremor + Recharts.
  - `vehiculo-live`, `carga-track`, `flota`, `public-tracking`: usan `@vis.gl/react-google-maps`.
  - `cargas` (33KB de tsx), `vehiculos` (33KB), `conductores`, `sucursales`: CRUDs grandes.
  - Patrón: `import('./routes/platform-admin-observability.js').then(m => m.PlatformAdminObservabilityRoute)` o el helper `lazyRouteComponent` de TanStack Router. Esperable: -50..-70% del payload inicial.

#### F1.2 [LOW] Imports Tremor por barrel
- `apps/web/src/components/observability/{ForecastTab,CostosTab,TrendChart,CapacityTab}.tsx:1` importan `{ BarChart, DonutChart, LineChart, ProgressBar } from '@tremor/react'`. Tremor 3 NO tree-shakea bien históricamente; importar de subpath (`@tremor/react/charts/BarChart` si existe) o trasladarlo todo detrás de lazy route soluciona el bulto. Como F1.1 ya elimina Tremor del initial bundle, esto baja de prioridad.

#### F1.3 [OK] Firebase modular
- `apps/web/src/lib/firebase.ts:1` y otros usan `firebase/app`, `firebase/auth` (subpath imports). **No** se importa el SDK completo. **0 hallazgos en firebase**, metodología: grep `from 'firebase'` solo (sin subpath).

#### F1.4 [OK] `lucide-react` con destructuring named
- 55 imports, todos son `import { IconA, IconB } from 'lucide-react'`. Vite tree-shake los namespaced exports correctamente en producción (Rollup statically analyzes). **0 hallazgos**.

#### F1.5 [OK] Sin lodash, sin moment, sin dayjs
- Grep no encontró `from 'lodash'` ni `date-fns/moment/dayjs` en código de prod. `apps/web/src/lib/freshness.ts:7` comenta explícitamente "Sin dep externa (date-fns no está en el bundle del web)". OK.

### F2 — Re-renders innecesarios

#### F2.1 [MEDIUM] Cero uso de `React.memo`
- Grep `React.memo|memo(` en `apps/web/src/**/*.tsx` (excluyendo tests): **0 ocurrencias**.
- Componentes en listas largas (e.g. `FlotaRoute` en `apps/web/src/routes/flota.tsx:153-181` itera `flotaQ.data` con polling cada 20s) re-renderizan todos los items por cada update aunque solo cambien algunos campos.
- **Recomendación**: extraer item rows a componentes `memo(VehicleListItem)` con props granular. Aplicar a:
  - `flota.tsx:153` (re-render cada 20s)
  - `cargas.tsx:431,497` (refetch cada 30s)
  - `vehiculos.tsx:185,247`
- Impacto estimado en INP con 50 vehículos visibles: factor 2-5x menos work por tick de polling.

#### F2.2 [LOW] Uso bajo de `useMemo`/`useCallback`
- Solo 8 ocurrencias totales en todo `apps/web/src/**/*.tsx` (excluyendo tests). En sí no es un problema (premature memoization es anti-pattern), pero combinado con F2.1 sí hace que cualquier cb inline rompa memoización al añadirla. Conviene introducirla **junto** con `React.memo`.

#### F2.3 [OK] Sin React Context custom
- 0 `createContext` en `src/`. Estado compartido via Zustand + TanStack Query. Elimina riesgo de re-render por context-object identity.

### F3 — Lazy loading

#### F3.1 [HIGH] `lazyRouteComponent` no usado — duplica F1.1
- 0 ocurrencias. Toda navegación a `/app/platform-admin/observability` carga Tremor en cold visit a cualquier ruta. Ver F1.1.

#### F3.2 [MEDIUM] Imágenes sin `loading="lazy"`
- Grep `<img`: 9 occurrences; grep `loading="lazy"`: 1.
- Mayoría son iconos `<img src="/icons/icon.svg">` (e.g. `Layout.tsx:78`, `login.tsx:164`, `onboarding.tsx:36`) → caso aceptable porque son above-the-fold y muy pequeños.
- `apps/web/src/routes/demo.tsx:97` y `apps/web/src/routes/platform-admin-site-settings.tsx:524`, `ChatPanel.tsx:278` (fotos chat) — **deberían ser `loading="lazy" decoding="async"`**.

#### F3.3 [MEDIUM] `@vis.gl/react-google-maps` cargado eagerly
- Importado en `apps/web/src/components/offers/EcoRouteMapPreview.tsx`, `LiveTrackingScreen.tsx`. Junto con F1.1 (rutas eagerly montadas), el JS de Google Maps wrapper + el iframe init script pueden bloquear el primer paint. Resolver con dynamic import + Suspense fallback dentro de la ruta lazy.

### F4 — PWA / Service Worker

#### F4.1 [MEDIUM] Solo Google Fonts cacheado en runtime
- `apps/web/src/sw.ts:44-71` registra **únicamente** CacheFirst para `fonts.googleapis.com` y `fonts.gstatic.com`.
- **No hay runtime caching** para:
  - `/api/*` (NetworkFirst con fallback offline para reads del dashboard, p.ej. `/api/vehiculos`, `/api/cumplimiento`).
  - Imágenes de la app (CacheFirst con expiration policy).
  - Documentos del shipper (chat photos).
- Impacto: PWA offline degrade-mode no existe; cada refresh va a network. INP/LCP en redes 4G o congestionadas sufre.
- **Recomendación**: añadir `registerRoute` con:
  - API GET: `NetworkFirst({ cacheName: 'api', networkTimeoutSeconds: 3, plugins: [new ExpirationPlugin({ maxAgeSeconds: 5*60 })] })`.
  - Imágenes: `CacheFirst({ cacheName: 'images', plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30*24*3600 })] })`.
  - Chat photos signed-URL: `CacheFirst` con TTL ≤ 5 min (alineado a `staleTime` de TanStack Query — ver ChatPanel.tsx:246).

#### F4.2 [OK] Precaching configurado
- `vite.config.ts:30-32` `globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']`. OK para shell. **Riesgo lateral**: el bundle JS gigante de F1.1 entra al precache → primer install descarga ~700KB+. Resolver F1.1 lo mitiga.

### F5 — Web Vitals (estimación estática)

#### F5.1 [MEDIUM] LCP: hero/login con `<img>` sin priority
- `apps/web/src/routes/login.tsx:164`, `onboarding.tsx:36`, `Layout.tsx:78` usan `<img src="/icons/icon.svg">` — SVG inline sería más rápido (sin extra request, evita FOUC).
- `apps/web/src/routes/demo.tsx:97` `<img>` parece ser hero — añadir `fetchpriority="high" decoding="async"`.

#### F5.2 [HIGH] INP: payload eager + zero memoization
- Combinación F1.1 + F2.1 + F3.3. Primera interacción tras boot puede tardar >200ms en parsear/hydratar el bundle. En polling cada 15-30s las rutas live re-renderizan listas completas, también golpeando INP en mid-range mobile.
- **Acción**: lazy routes + memo + reducir `refetchInterval` o usar `keepPreviousData` para evitar suspense.

#### F5.3 [LOW] CLS: sin reservas explícitas
- No se encontró uso sistemático de `aspect-ratio` ni `width/height` en `<img>`. Como la app es shell + datos (no media-pesada), el riesgo de CLS está acotado. Recomendar añadir `width`/`height` a íconos para evitar reflow al cargar.

---

## Top-10 priorizado (impacto × esfuerzo)

| # | Hallazgo | Archivo | Impacto | Esfuerzo | Score |
|---|---|---|---|---|---|
| 1 | F1.1 — Lazy routes (split bundle) | `apps/web/src/router.tsx:1-46` | Alto (-40..70% initial JS) | M (1-2d) | 9 |
| 2 | B1.1 — N+1 vehicles en matching | `apps/api/src/services/matching.ts:180-192` | Alto (p95 -200..400ms) | S (0.5d) | 9 |
| 3 | B1.2 — COUNT(*) por record AVL | `apps/telemetry-processor/src/persist.ts:114-119` | Alto (escala con telemetría) | S (0.5d) | 9 |
| 4 | F4.1 — SW sin runtime caching API/imágenes | `apps/web/src/sw.ts:44-71` | Medio-alto (offline + LCP repeat) | M (1d) | 7 |
| 5 | F2.1 — `React.memo` en listas con polling | `flota.tsx`, `cargas.tsx`, `vehiculos.tsx` | Medio (INP polling) | M (1d) | 7 |
| 6 | B4 — Migraciones bloquean cold start | `apps/api/src/main.ts:31` | Medio (cold start -1..2s) | M (refactor pipeline) | 6 |
| 7 | B5 — Pool sin `idleTimeoutMillis`/`statement_timeout` | `apps/api/src/db/client.ts:18-25` | Medio (zombi conn + queries colgadas) | S (5min config) | 7 |
| 8 | F3.3 — Google Maps eager + F3.2 imágenes lazy | `EcoRouteMapPreview.tsx`, `demo.tsx:97` | Medio (LCP -300..500ms en rutas con maps) | S (0.5d) | 6 |
| 9 | B6 — Buffer.from por readBytes (allocations) | `packages/codec8-parser/src/buffer-reader.ts:97` | Bajo-medio (escala con flota >1000) | M (rewrite) | 4 |
| 10 | B2 — Loops secuenciales sin comentario rate-limit | `reconciliar-dtes.ts:116,197` | Bajo (correctness, no hot path) | XS (comentario) | 3 |

---

## Verificación de stack

- **pgvector**: **NO se usa.** Grep en `packages/**/*.ts`, `apps/**/*.ts`, `apps/api/drizzle/*.sql` retornó 0 matches para `pgvector`, `CREATE EXTENSION vector`, operadores de similitud (`<=>`, `<->`, `<#>`), ni tipos de índice (`ivfflat`, `hnsw`). Única extensión real: `pgcrypto` (`apps/api/test/integration/setup-global.ts:56`).
  - Corrige la asunción del blueprint inicial.
- **Hono 4**: confirmado en `apps/api/package.json` (no inspeccionado en detalle aquí — ver 02_BACKEND_FINDINGS).
- **pg pool**: confirmado `import pg from 'pg'` en `apps/api/src/db/client.ts:2`. Default pool=10.
- **React 18 + Vite 6 + @tanstack/react-router 1.169 + Tailwind 4 + Tremor 3.18 + react-hook-form + zod + zustand + TanStack Query 5 + Firebase 12 + lucide-react 0.469 + idb 8**: confirmado en `apps/web/package.json`.
- **PWA via workbox-* + vite-plugin-pwa**: confirmado, modo `injectManifest` con SW custom en `apps/web/src/sw.ts`.
- **Router mode**: programático con `createRoute` (no file-based codegen). `@tanstack/router-plugin` deshabilitado en `vite.config.ts`. Esto **bloquea** el use de `createFileRoute`/`createLazyFileRoute`; si se quiere lazy, usar `lazyRouteComponent` o dynamic imports manuales con el `component:` actual.
- **Bundle analyzer**: `rollup-plugin-visualizer` **no instalado** (no aparece en `apps/web/package.json` devDependencies). Análisis hecho por lectura de imports + tamaño de fuentes. Para baseline real, instalar el plugin y correr `vite build` en una sesión con permisos (fuera de esta auditoría read-only).

---

*Generado en ~10 min de análisis estático. Sin runtime profiling.*
