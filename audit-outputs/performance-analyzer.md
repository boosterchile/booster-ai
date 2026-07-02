# Performance Audit — Booster AI

Fecha: 2026-06-14
Auditor: performance-analyzer sub-agent (booster-skills)
Scope: apps/api, apps/web, apps/telemetry-tcp-gateway, apps/telemetry-processor, apps/matching-engine, apps/notification-service, apps/document-service; packages/matching-algorithm, packages/carbon-calculator, packages/pricing-engine, packages/codec8-parser

---

## Backend hotspots

### B1. Queries N+1

#### ALTA — [N+1-001] Matching engine: query por vehiculo dentro de loop de candidatos

**Archivo:** `apps/api/src/services/matching.ts:191-207`

```
for (const emp of candidateEmpresas) {
  const vehs = await tx.select().from(vehicles).where(...).limit(1);
```

El loop itera sobre `candidateEmpresas` (puede ser 1..50+ transportistas) y ejecuta un `SELECT` contra `vehiculos` por cada empresa. Para N candidatos = N+1 queries totales (1 del SELECT de empresas + N del SELECT de vehículos). Es el hot path del matching engine — se dispara en cada trip nuevo.

**Recomendación:** Batch fetch con un único `JOIN` o un `SELECT vehicles WHERE empresa_id = ANY($1)` agrupado:
```sql
SELECT DISTINCT ON (empresa_id) *
FROM vehiculos
WHERE empresa_id = ANY($1)
  AND estado_vehiculo = 'activo'
  AND capacidad_kg >= $2
ORDER BY empresa_id, capacidad_kg ASC
```
Alternativa Drizzle: `inArray(vehicles.empresaId, candidateEmpresaIds)` con post-process en memoria para seleccionar el vehículo óptimo por empresa. Esto reduce N+1 a 1 query.

**Impacto:** Con 20 transportistas candidatos = 21 queries dentro de una transacción. Latencia del matching ≈ N × (RTT DB) + overhead de transacción. RTT Cloud SQL ≈ 2-5ms → 40-100ms de overhead puro solo en esta parte. Si N crece a 50, se vuelve >200ms sólo en el loop.

---

#### ALTA — [N+1-002] chat-whatsapp-fallback: SELECT owner dentro de loop de mensajes

**Archivo:** `apps/api/src/services/chat-whatsapp-fallback.ts:141-156`

```
for (const c of candidates) {
  const ownerRows = await db.select().from(memberships).innerJoin(users, ...)...
```

Para cada mensaje candidato (hasta 100 por run) ejecuta un SELECT de membresías+usuarios para encontrar el dueño de la empresa destinataria. 100 mensajes = 100 queries adicionales en el tick del cron.

**Recomendación:** Pre-cargar los owners de todas las empresas únicas involucradas en un batch query antes del loop, usando `inArray(memberships.empresaId, uniqueEmpresaIds)` y construir un Map. El loop entonces hace solo un lookup en memoria.

**Impacto:** Cron each-minute. Bajo steady state (pocos mensajes), aceptable. Si el chat escala a 50+ conversaciones simultáneas con mensajes no leídos, el cron puede tardar >500ms, riesgo de overlapping con el siguiente tick.

---

#### MEDIA — [N+1-003] reconciliarDtes: await secuencial en loop de facturas

**Archivo:** `apps/api/src/services/reconciliar-dtes.ts:116-168` y `197-230`

```
for (const row of enProcesoRows) {
  dteStatus = await adapter.queryStatus(row.dteFolio, ...);
  await db.update(facturasBoosterClp)...
```

Cada factura `en_proceso` hace (1) una llamada HTTP al API de Sovos (`queryStatus`) + (2) un UPDATE a DB, secuencialmente. Para 200 facturas en el límite = 400 I/O operations serializadas. Si Sovos tiene RTT de ~100ms, 200 facturas = 20s de cron.

**Recomendación:** Las llamadas a `queryStatus` son independientes entre sí. Se pueden paralelizar con `Promise.allSettled(rows.map(row => adapter.queryStatus(...)))` sujeto al rate limit de Sovos. Los UPDATEs posteriores sí requieren ser individuales (por idempotencia de CAS). El comentario en el código (línea 118) sugiere que el volumen esperado es pequeño (<50/día), pero el cap de 200 hace viable el escenario largo.

---

#### MEDIA — [N+1-004] procesar-cobranza-cobra-hoy: UPDATE secuencial en loop

**Archivo:** `apps/api/src/services/procesar-cobranza-cobra-hoy.ts:121-155`

```
for (const cand of candidates) {
  await db.update(adelantosCarrier).set({...}).where(eq(...))
```

La nota en el código reconoce el problema: _"Para un bulk update con CASE WHEN para las notas si crece"_. Hasta 500 adelantos procesados uno a uno. El UPDATE incluye un `coalesce(notas_admin || E'\n')` que hace la vectorización no trivial pero posible con una sola query usando `CASE ... WHEN id = $1 THEN $nota1 WHEN id = $2 THEN $nota2 ...`.

**Recomendación:** Implementar la sugerencia ya documentada en el código: `UPDATE adelantos_carrier SET status = 'mora', notas_admin = CASE id WHEN ... THEN ... END WHERE id = ANY($ids) AND status = 'desembolsado'`. Reduce N queries a 1.

---

### B2. await dentro de for loops

#### ALTA — [ASYNC-001] matching.ts: await secuencial de vehicle query (mismo que N+1-001)

Referenciado en B1. El `await tx.select()...` dentro del `for (const emp of candidateEmpresas)` es la misma raíz.

---

#### MEDIA — [ASYNC-002] reconciliarDtes: dos loops secuenciales independientes

**Archivo:** `apps/api/src/services/reconciliar-dtes.ts`

Los dos loops (queryStatus de `enProcesoRows` + retry emit de `transientRows`) son secuenciales pero conceptualmente independientes. El Step 2 no depende del resultado del Step 1. Podrían ejecutarse en paralelo con `Promise.allSettled([step1(), step2()])`.

**Nota:** Excepciones válidas a la paralelización:
- `chat-whatsapp-fallback.ts:127`: procesamiento secuencial es correcto — rate limit de Twilio 1msg/seg (documentado en el comentario).
- `backfill-certificados.ts:174`: usa correctamente `Promise.allSettled` con batching configurable por `--concurrency`.
- `harden-demo-accounts.ts:118`: loop secuencial de creación de cuentas Firebase — Firebase Admin SDK puede tener rate limits; la serialización es conservadora pero correcta para una operación one-shot.

---

### B3. Índices Postgres

**pgvector:** No usado en este codebase. Las búsquedas de matching son por región geográfica + capacidad de vehículo, no por similitud vectorial. El blueprint inicial asumía pgvector incorrectamente — hallazgo informativo, ver sección "Verificación de stack".

#### ALTA — [IDX-001] telemetria_puntos: no hay índice por rango de tiempo puro

**Archivo:** `apps/api/src/db/schema.ts:1583` / `apps/api/drizzle/0040_integridad_indices.sql`

El índice `idx_telemetria_vehiculo_ts` cubre `(vehiculo_id, timestamp_device DESC)` — excelente para queries por vehículo + ventana de tiempo. Pero la migración 0040 eliminó `idx_telemetria_vehiculo_recibido` (correcto, era redundante). Sin embargo, la query de `calcularCobertura` (coverage calculation) usa `WHERE vehiculo_id = $1 AND timestamp_device >= $2 AND timestamp_device <= $3` — eso sí cae en el índice compuesto existente. No hay problema aquí.

El índice faltante realmente crítico es para `assignments.entregado_en` (deliveredAt). Está ausente:

**Archivo:** `apps/api/drizzle/0004_phase_zero_unified_schema_es.sql:267-269`
```sql
CREATE INDEX "idx_asignaciones_empresa" ON "asignaciones"("empresa_id");
CREATE INDEX "idx_asignaciones_estado" ON "asignaciones"("estado");
CREATE INDEX "idx_asignaciones_conductor" ON "asignaciones"("conductor_id");
-- NO hay idx en entregado_en
```

Y en `matching-v2-lookups.ts:92`:
```
.where(and(inArray(assignments.empresaId, empresaIds), gte(assignments.deliveredAt, sevenDaysAgo)))
```

El planner de Postgres usará `idx_asignaciones_empresa` para filtrar por `empresa_id = ANY(...)` pero luego hará un filtro secuencial sobre `entregado_en >= now() - 7 days`. Con muchas asignaciones históricas por empresa, este filtro de fecha adicional es costoso.

**Recomendación:** Agregar índice compuesto `(empresa_id, entregado_en)` en `asignaciones`. El propio comentario en el código (`matching-v2-lookups.ts:26`) documenta que este índice es necesario: `-- idx_assignments_empresa_delivered (parcial WHERE delivered_at IS NOT NULL)`.

```sql
CREATE INDEX CONCURRENTLY idx_asignaciones_empresa_entregado
  ON asignaciones (empresa_id, entregado_en DESC)
  WHERE entregado_en IS NOT NULL;
```

**Impacto:** La query de matching v2 lookups se dispara en cada ejecución del matching engine cuando `MATCHING_ALGORITHM_V2_ACTIVATED=true`. Con el flag activo en producción, todo trip matching lo ejecuta.

---

#### MEDIA — [IDX-002] eventos_conduccion_verde: UNIQUE como sustituto de índice de scoring

**Archivo:** `apps/api/src/db/schema.ts:1642-1650`

El índice `idx_eventos_conduccion_tipo_ts ON (tipo, timestamp_device)` fue conservado después de la limpieza del 0040. Las queries de scoring (`calcularScoreConduccionViaje`) usan `WHERE vehiculo_id = $1 AND timestamp_device BETWEEN $2 AND $3`. El UNIQUE `uq_eventos_conduccion_vehiculo_ts_tipo` sobre `(vehiculo_id, timestamp_device, tipo)` actúa como índice para el WHERE por vehiculo_id + timestamp — correcto. Sin embargo, el `typeTsIdx` sobre `(tipo, timestamp_device)` no ayuda a queries filtradas por `vehiculo_id` primero. Es de bajo valor para el hot path de scoring.

**Recomendación:** Evaluar drop de `idx_eventos_conduccion_tipo_ts` (solo útil para analytics globales por tipo, no para el scoring by-vehicle). Baja prioridad — las queries críticas usan el UNIQUE.

---

#### BAJA — [IDX-003] metricas_viaje sin índice en tripId (solo PK)

`metricas_viaje` tiene `tripId` como PK. La query de `calcularScoreConduccionViaje` hace `UPDATE ... WHERE tripId = $1` usando el PK — correcto, no se necesita índice adicional. No hay hallazgo crítico.

---

### B4. Cold start Cloud Run

#### MEDIA — [COLD-001] Pool no se calienta en cold start; idleTimeoutMillis ausente

**Archivo:** `apps/api/src/db/client.ts`

El pool `pg.Pool` se crea con:
- `max: config.poolMax` (default 10 del schema)
- `connectionTimeoutMillis: config.connectTimeoutMs` (default 5000ms)
- **Sin** `idleTimeoutMillis` — las conexiones idle nunca expiran. En Cloud Run con múltiples instancias, si una instancia escala a 0 y vuelve, los connections del pool están muertos (Cloud SQL Proxy puede cerrarlos tras períodos largos de inactividad). Postgres por defecto cierra conexiones idle después de `tcp_keepalives_idle` (no garantizado).

**Recomendación:**
```typescript
const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: config.poolMax,
  connectionTimeoutMillis: config.connectTimeoutMs,
  idleTimeoutMillis: 600_000, // 10 min — antes del idle timeout de Cloud SQL Proxy
});
```

Además, considerar un `pool.connect()` / `client.release()` en el startup para pre-calentar al menos una conexión antes de servir tráfico.

---

#### BAJA — [COLD-002] Firebase Admin SDK: carga en hot path

**Archivo:** `apps/api/src/services/firebase.ts` (importado desde middleware/firebase-auth.ts, que está en el boot path del server)

Firebase Admin se inicializa al arrancar el server. El SDK completo tiene un tamaño considerable (~3MB descomprimido en Node). No se usa lazy import. Sin embargo, dado que el auth middleware es obligatorio para todos los endpoints, la carga eagera es correcta aquí. La alternativa de dynamic import retrasaría el primer request autenticado más que el cold start. No hay acción recomendada a menos que el bundle target cambie.

---

### B5. Conexiones a Postgres

#### MEDIA — [POOL-001] idleTimeoutMillis ausente (mismo que COLD-001)

Ya documentado en B4.

#### BAJA — [POOL-002] Pool compartido correctamente — no hay instancias por-request

**Archivo:** `apps/api/src/main.ts:23-24`

El pool se crea UNA vez en main.ts y se inyecta via context de Hono. El comentario en `client.ts` documenta esto explícitamente. No hay instancias por-request. Patrón correcto.

#### INFO — [POOL-003] Cloud SQL Connector vs TCP directo

El `client.ts` usa TCP directo con `sslmode=require` vía la connection string. El comentario documenta que esto es correcto para Cloud Run con VPC Connector (private IP). No se usa `@google-cloud/cloud-sql-connector`. Para la arquitectura actual (VPC private IP), TCP directo es equivalente en seguridad y más simple. No hay acción necesaria.

---

### B6. Telemetría IoT — hot path crítico

#### BAJA — [TEL-001] Buffer.concat en cada chunk TCP

**Archivo:** `apps/telemetry-tcp-gateway/src/connection-handler.ts:125`

```typescript
state.buffer = state.buffer.length === 0 ? chunk : Buffer.concat([state.buffer, chunk]);
```

Cada evento `data` del socket hace un `Buffer.concat` que copia bytes del buffer anterior al nuevo. Para devices que transmiten muchos chunks pequeños, esto crea allocations frecuentes. La optimización es un buffer dinámico (lista de chunks con offsets, similar a cómo funciona `readable-stream`).

**Evaluación:** Para el volumen actual (1 record/30s × 50 devices = ~1.7 chunks/s total para toda la flota), el overhead es despreciable. Si la flota crece a 500 devices con configuración de alta frecuencia (1 record/1s), podrían acumularse ~500 concat/s. Baja prioridad ahora; monitorear si el fleet crece.

---

#### BAJA — [TEL-002] bigint en timestampMs: Number() coercion

**Archivo:** `apps/telemetry-processor/src/persist.ts:68`

```typescript
const tsDate = new Date(Number(msg.record.timestampMs));
```

`msg.record.timestampMs` es `bigint` (del parser Codec 8). La conversión `Number(bigint)` es correcta para timestamps en ms epoch (hasta 2^53, safe integer range cubre año 285428751). Sin overhead real — es una operación única por record. No hay hallazgo de performance.

---

#### INFO — [TEL-003] Dedup check LIMIT 2 correctamente optimizado

**Archivo:** `apps/telemetry-processor/src/persist.ts:106-111`

El código usa `LIMIT 2` para detectar si el record es el primero del vehículo, en vez de `COUNT(*)`. El comentario documenta la optimización explícitamente: _"El COUNT recorría TODO el histórico indexado del vehículo (O(n) por insert)"_. Buena práctica aplicada correctamente.

---

#### INFO — [TEL-004] codec8-parser: parsing eficiente

**Archivo:** `packages/codec8-parser/src/avl-packet.ts`, `buffer-reader.ts`

El parser opera sobre el `Buffer` ya recibido completo (no streaming byte-by-byte). `BufferReader` mantiene un offset sin copias intermedias (excepto `readBytes` donde se copia explícitamente por seguridad). Para el volumen esperado, el parser es correcto y eficiente. Los `readBigUInt64BE` para timestamps son nativos de Node.js. No hay hallazgos.

---

## Frontend hotspots

### F1. Bundle size

#### ALTA — [BUNDLE-001] Zero code-splitting: todas las rutas en el bundle inicial

**Archivo:** `apps/web/src/router.tsx`

El router importa SINCRÓNICAMENTE todos los componentes de ruta al nivel superior:
```typescript
import { FlotaRoute } from './routes/flota.js';
import { PlatformAdminObservabilityRoute } from './routes/platform-admin-observability.js';
// ... todos los ~30 módulos de ruta
```

Y todos usan `createRoute({ component: XyzRoute })` — no `lazyRouteComponent`. Esto significa que el bundle inicial incluye TODO el código de la aplicación, incluyendo componentes pesados como:
- `FleetMap.tsx` / `VehicleMap.tsx` → importan `@vis.gl/react-google-maps` (Google Maps SDK)
- `platform-admin-observability.tsx` → importa componentes de `@tremor/react` (LineChart, BarChart, DonutChart, ProgressBar)
- `TrendChart.tsx`, `CostosTab.tsx`, `CapacityTab.tsx`, `ForecastTab.tsx`, `SaludTab.tsx` → todos cargados en el primer parse

TanStack Router soporta `lazyRouteComponent(() => import('./routes/flota.js').then(m => ({ default: m.FlotaRoute })))` pero no se usa en ninguna ruta.

**Recomendación:** Aplicar `lazyRouteComponent` al menos para rutas pesadas:
- Rutas con mapas: `flota`, `vehiculo-live`, `public-tracking`, `asignacion-detalle`
- Rutas admin: `platform-admin-observability`, `platform-admin-matching`, `admin-dispositivos`
- Rutas conductor: `conductor`, `conductor-configuracion`

Esto puede reducir el bundle inicial en un 40-60%.

**Impacto LCP:** El bundle actual fuerza al browser a parsear y ejecutar TODO el JS antes de poder renderizar cualquier ruta. En mobile 3G, esto puede agregar 2-5 segundos al LCP de la ruta de login.

---

#### ALTA — [BUNDLE-002] @tremor/react: importaciones de componentes específicos (bien), pero Tremor 3.x no es tree-shakeable de manera perfecta

**Archivos:** `apps/web/src/components/observability/*.tsx`

Las importaciones son específicas (no barrel completo):
```typescript
import { LineChart } from '@tremor/react';         // TrendChart.tsx
import { BarChart, DonutChart } from '@tremor/react'; // CostosTab.tsx
import { ProgressBar } from '@tremor/react';        // ForecastTab.tsx, CapacityTab.tsx
```

Tremor 3.x tiene tree-shaking parcial pero incluye dependencias pesadas transitivas (Recharts, HeadlessUI, clsx). El bundle total de Tremor + dependencias es ~400KB minified (~120KB gzip). Si el admin observability panel se lazy-load (ver BUNDLE-001), esto solo afectará el chunk de esa ruta y no el inicial.

---

#### MEDIA — [BUNDLE-003] Firebase 12.x: importaciones modulares correctas

**Archivo:** `apps/web/src/lib/firebase.ts`

```typescript
import { type FirebaseApp, initializeApp } from 'firebase/app';
import { type AppCheck, ReCaptchaV3Provider, initializeAppCheck } from 'firebase/app-check';
import { GoogleAuthProvider, getAuth, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
```

Firebase 12.x modular (versión 9+ API) está correctamente importado. No se importa el barrel `firebase/app` completo ni módulos no usados (Firestore, Storage, etc.). Este patrón es correcto — no hay hallazgo negativo.

---

#### BAJA — [BUNDLE-004] @vis.gl/react-google-maps cargado en bundle inicial

**Archivos:** `apps/web/src/components/map/FleetMap.tsx`, `VehicleMap.tsx`

Google Maps SDK se carga incluso para usuarios shipper o stakeholder que nunca ven mapas. Con lazy-loading de rutas (BUNDLE-001) esto se resolvería automáticamente.

---

#### INFO — rollup-plugin-visualizer no está instalado

`package.json` de `apps/web` no incluye `rollup-plugin-visualizer` ni `vite-bundle-visualizer`. El análisis de bundle es estático (sin tamaños exactos). Para cuantificar exactamente, ejecutar:
```bash
pnpm --filter @booster-ai/web build && npx vite-bundle-visualizer
```

---

### F2. Re-renders innecesarios

#### MEDIA — [RERENDER-001] OfferCard: inline functions en cada render

**Archivo:** `apps/web/src/components/offers/OfferCard.tsx:106-126`

```typescript
async function handleAccept() { ... }
async function handleSubmitReject(e: FormEvent) { ... }
```

Estas funciones se recrean en cada render del componente. Si `OfferCard` está en un contexto donde su parent re-renderiza frecuentemente (polling cada 30s vía `useOffersMine`), habrá re-creaciones. Sin embargo, el componente no está memoizado con `React.memo`, por lo que si se memoizara el padre, las inline functions romperían la memoización.

**Recomendación:** Envolver `OfferCard` con `React.memo` y usar `useCallback` para las handlers si se introduce memoización del parent. Actualmente, sin `React.memo` en el parent ni en `OfferCard`, el impacto es bajo (las re-renders son proporcionales al polling de 30s).

---

#### BAJA — [RERENDER-002] FlotaPage: nuevos objetos en cada render

**Archivo:** `apps/web/src/routes/flota.tsx:68-76`

```typescript
const mapVehicles: FleetMapVehicle[] = (flotaQ.data ?? [])
  .filter(...)
  .map((v) => ({ id: v.id, plate: v.plate, ... }));
```

El `.filter().map()` crea un nuevo array con nuevos objetos en cada render. `FleetMap` re-renderizará aunque los datos no hayan cambiado. `TanStack Query` gestiona bien el refresco (solo cambia la referencia cuando los datos cambian realmente), así que esto principalmente ocurre en los refetch de 20s.

**Recomendación:** `useMemo(() => computation, [flotaQ.data])` si el cálculo es costoso. Dada la simplicidad de la transformación, la prioridad es baja.

---

#### BAJA — [RERENDER-003] Listas sin virtualización

**Archivos:** `apps/web/src/routes/ofertas.tsx`, `conductores.tsx`, `vehiculos.tsx`

Las listas de ofertas, conductores y vehículos se renderizan completamente sin virtualización (`react-window` o similar). Para el volumen esperado del MVP (decenas de items), no es un problema. Si un carrier tiene >200 vehículos activos, la renderización de la lista de flota sí lo sería.

**Recomendación:** No acción urgente hasta que el piloto muestre carriers con >100 items en una lista.

---

#### INFO — TanStack Query: query keys consistentes

Las query keys revisadas son arrays estables:
- `['offers', 'mine', status]`
- `['assignment', 'behavior-score', assignmentId]`
- `['chat-messages', assignmentId]`
- `['flota']`

No se detectaron query keys creadas como objetos inline (que causarían cache misses en cada render). Patrón correcto.

---

### F3. Lazy loading

#### ALTA — [LAZY-001] Cero uso de lazyRouteComponent en 30+ rutas

(Mismo hallazgo que BUNDLE-001 — la raíz es el mismo archivo.)

**Archivo:** `apps/web/src/router.tsx`

Ninguna de las ~30 rutas usa `lazyRouteComponent`. TanStack Router provee esta API:
```typescript
const flotaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/flota',
  component: lazyRouteComponent(() =>
    import('./routes/flota.js').then(m => ({ default: m.FlotaRoute }))
  ),
});
```

Esta es la principal oportunidad de mejora de performance frontend.

---

#### BAJA — [LAZY-002] Una sola imagen con loading="lazy"

**Archivo:** `apps/web/src/components/chat/ChatPanel.tsx:282`

La única imagen `<img loading="lazy">` encontrada está en el chat. No hay otras imágenes `<img>` en el codebase (el uso es principalmente de iconos SVG via `lucide-react`). No es un hallazgo crítico — la ausencia de imágenes hero implica que no hay LCP penalty por imágenes.

---

### F4. PWA / Service Worker

#### INFO — [PWA-001] Estrategia CacheFirst para Google Fonts — correcta

**Archivo:** `apps/web/src/sw.ts:44-71`

`CacheFirst` para Google Fonts (stylesheets y webfonts) con `maxAgeSeconds: 365 días` es la estrategia óptima para assets estáticos con cache-busting via URL. Correcto.

#### MEDIA — [PWA-002] No hay RuntimeCaching para API calls

**Archivo:** `apps/web/src/sw.ts`

El service worker solo precachea assets estáticos y aplica `CacheFirst` a Google Fonts. No hay `registerRoute` para llamadas a la API (`/api/v1/*`). Esto significa que en modo offline, la PWA no puede servir datos cacheados (listas de viajes, ofertas, etc.).

**Recomendación para conductores:** Una ruta `NetworkFirst` con fallback a cache para `/api/v1/me/assignments` (lista de asignaciones del conductor) mejoraría la experiencia offline del conductor que opera en zonas con señal intermitente. Esta es una oportunidad de UX, no un bug de performance.

#### INFO — [PWA-003] Precaching glob patterns

**Archivo:** `apps/web/vite.config.ts:29`

`globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']` — precachea todos los assets del build. El tamaño total depende del bundle size (ver BUNDLE-001). Sin code-splitting, el precache incluirá el bundle completo (~1MB+ gzip estimado), lo cual es significativo para devices con poco storage. Resolver BUNDLE-001 reducirá automáticamente el tamaño del precache.

---

### F5. Web Vitals (estimación estática)

#### ALTA — [VITALS-001] LCP degradado por bundle monolítico

El bundle no tiene code-splitting. El navegador debe descargar, parsear y ejecutar TODO el JS antes de que el primer componente sea interactivo. En conexiones lentas (3G, ~1.5Mbps):
- Bundle estimado: ~1-2MB gzip (sin medir; estimado por deps Firebase + Tremor + Maps + Router + React)
- Tiempo de download: ~5-10 segundos en 3G
- Parse time en mobile low-end: ~2-3 segundos adicionales

**LCP estimado en 3G:** >5 segundos. El umbral "bueno" de Core Web Vitals es ≤2.5s.

---

#### MEDIA — [VITALS-002] CLS: reserva de espacio para mapas

**Archivo:** `apps/web/src/components/map/FleetMap.tsx:79`

```typescript
<GoogleMap style={{ height, width: '100%' }} ...>
```

El mapa se renderiza con height fijo (`480px` default). Sin embargo, antes de que `APIProvider` cargue el SDK de Google Maps (que es async), el componente renderiza el div de container sin altura visible. Esto puede causar CLS si la lista lateral se muestra antes del mapa.

**Recomendación:** Agregar un skeleton/placeholder con la misma altura antes de que cargue el mapa:
```tsx
<div style={{ height, width: '100%' }} className="rounded-lg bg-neutral-100 animate-pulse" />
```

---

#### BAJA — [VITALS-003] INP: handlers async con await en click

**Archivos:** `OfferCard.tsx:106-113`

Los handlers `handleAccept` y `handleSubmitReject` son `async` y disparan mutaciones de red. El click handler no bloquea el thread (la operación async se encola), así que no hay INP issue. La UI se actualiza con el estado `isPending` del mutation. Correcto.

---

## Verificación de stack

### pgvector
**No está instalado ni en uso.** El codebase usa Postgres estándar para todas las operaciones. Las búsquedas de matching son por atributos discretos (región, capacidad, transportista activo) + scoring matemático puro en memoria (`packages/matching-algorithm`). No hay extensión pgvector en ningún migration file ni en el schema Drizzle.

### Vite bundle analysis
`rollup-plugin-visualizer` o `vite-bundle-visualizer` no están instalados en `apps/web/package.json`. El análisis de tamaños de chunk es estático (sin números exactos de KB). Para obtener el breakdown real: instalar `vite-bundle-visualizer` como devDependency y correr `vite-bundle-visualizer` post-build.

### Cloud SQL Connector
No usado. El proyecto usa TCP directo con `sslmode=require` vía VPC Connector (private IP). Documentado como intencional en el comentario de `client.ts`.

### TanStack Router lazy routes
La API `lazyRouteComponent` existe en `@tanstack/react-router@1.169.2` (instalado) pero no se usa en ninguna ruta del router programático.

---

## Top-10 priorizado

| # | ID | Área | Descripción | Impacto | Esfuerzo |
|---|-----|------|-------------|---------|---------|
| 1 | BUNDLE-001 / LAZY-001 | Frontend | Code-splitting con `lazyRouteComponent` para 30 rutas | Reduce LCP 50-70%, bundle inicial -40-60% | MEDIO (1-2 días) |
| 2 | N+1-001 / ASYNC-001 | Backend | Matching engine: batch vehicles query fuera del loop | Reduce latencia de matching N×(RTT DB) → 1×(RTT DB) | BAJO (2-3h) |
| 3 | VITALS-001 | Frontend | LCP >5s en 3G como consecuencia de BUNDLE-001 | Crítico para UX de conductores en campo | Bloqueado por #1 |
| 4 | IDX-001 | Backend | Índice `(empresa_id, entregado_en)` en `asignaciones` | Matching v2 lento con histórico grande por empresa | BAJO (1h: migration) |
| 5 | N+1-002 | Backend | chat-whatsapp-fallback: batch fetch de owners antes del loop | Escala linealmente con mensajes no leídos en cron | BAJO (2-3h) |
| 6 | POOL-001 / COLD-001 | Backend | Agregar `idleTimeoutMillis` al pool Postgres | Previene conexiones muertas tras idle en Cloud Run | BAJO (30min) |
| 7 | ASYNC-002 | Backend | reconciliarDtes: paralelizar Step 1 y Step 2 | Reduce tiempo de cron de reconciliación DTE | BAJO (1-2h) |
| 8 | N+1-003 | Backend | reconciliarDtes: await secuencial por factura | Escalabilidad cuando DTE_PROVIDER=sovos esté activo | MEDIO (requiere batch API) |
| 9 | PWA-002 | Frontend | RuntimeCaching NetworkFirst para assignments del conductor | Mejora UX offline de conductores en zona sin señal | MEDIO (3-4h) |
| 10 | VITALS-002 | Frontend | CLS: skeleton de mapa antes de cargar Google Maps SDK | Estabilidad de layout en ruta /app/flota y /vehiculo-live | BAJO (1h) |

---

## Metodología

- Análisis completamente estático (sin ejecutar la app ni instalar dependencias).
- Se leyeron todos los archivos `.ts`/`.tsx` de `apps/api/src/services/`, `apps/api/src/routes/`, `apps/api/src/db/`, `apps/api/drizzle/` (migrations), `apps/web/src/routes/`, `apps/web/src/components/`, `apps/web/src/hooks/`, `apps/web/src/sw.ts`, `apps/web/vite.config.ts`, `apps/web/package.json`, `packages/codec8-parser/src/`, `packages/config/src/`.
- Búsqueda de patrones con grep para: `await` dentro de `for (const`, `Promise.all`, `Buffer.concat`, imports de Firebase, imports de Tremor, `lazyRouteComponent`, `React.memo`.
- Todos los índices de Drizzle schema y migrations verificados manualmente.

