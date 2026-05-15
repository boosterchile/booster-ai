# Booster AI — Pasada 4: Performance + Observability

> **Fecha**: 2026-05-15
> **Auditor**: Claude (vía Explore subagent)
> **Scope**: Detectar hotspots por **inspección estática**: N+1 queries Drizzle, falta de LIMIT, Pub/Sub sin batch, ausencia de spans OTel en paths críticos, sync work en handlers Hono, code-splitting frontend, backpressure SSE/WebPush, telemetría TCP, redacción PII, cache, re-renders, connection pool.
> **Estado del repo**: `main` (b9f7b08, 2026-05-14).
> **Naturaleza**: lectura — sin benchmarks ni profiling runtime.

---

## Resumen ejecutivo

| Severidad | N | Áreas críticas |
|---|---|---|
| **HIGH** | 8 | OTel sin SDK init en api, sin spans en matching/persist/cert/liquidate, PII top-level no redactada, sin cache en `/feature-flags` y `/me`, sin React.memo en componentes > 400 LOC, N+1 en matching y persist |
| **MEDIUM** | 5 | JSON.parse en SSE, backpressure SSE en disconnect, web-push sin 429 backoff explícito, pool DB en 10, queries admin sin LIMIT verificado |
| **LOW** | 2 | Maps lib eager-loaded, router sin lazy() |

**El hallazgo más alto-impacto** es §4 — OTel está declarado como dependency pero **no inicializado** en `apps/api/src/main.ts`. Los hot paths (matching, telemetry persist, certificate emission, liquidation) corren completamente a oscuras más allá de los logs Pino. Sin spans no hay forma de medir latencia ni detectar regresiones, lo cual contradice CLAUDE.md §6 "Observabilidad desde el primer endpoint".

---

## 1. N+1 query patterns (Drizzle) — HIGH 2 / MEDIUM 0

### HIGH

**1.1 — matching: vehicle lookup en loop**
[apps/api/src/services/matching.ts:180-192](apps/api/src/services/matching.ts) — for-of itera `candidateEmpresas`, dentro hace `SELECT` en `vehiculos` per-iteración. Con un pool de 50+ carriers candidatos por trip, se disparan 50+ queries seriadas. Riesgo: latencia P95 del trip-request lineal con tamaño de pool.

**Patrón:**
```typescript
for (const empresa of candidateEmpresas) {
  const vehs = await db.select().from(vehiculos).where(eq(vehiculos.empresa_id, empresa.id));
  // ...
}
```

**Fix**: batch `WHERE empresa_id IN (...)` + agrupar en memoria.

**1.2 — telemetry persist: COUNT en cada inserción**
[apps/telemetry-processor/src/persist.ts:115-118](apps/telemetry-processor/src/persist.ts) — tras `INSERT` en `telemetria_puntos`, ejecuta `SELECT COUNT(*) FROM telemetria_puntos WHERE vehiculo_id = ?` por **cada registro**. Volumen esperado: millones/día en producción.

**Fix**: COUNT periódico (cron 1×/min) materializado a Redis o tabla agregada, no por evento.

### MEDIUM

**1.3 — notify-offer**: [apps/api/src/services/notify-offer.ts](apps/api/src/services/notify-offer.ts) usa `Promise.allSettled` sobre el resultado de `matching.ts:334` — bounded por `MATCHING_CONFIG.MAX_OFFERS_PER_REQUEST` (≤10). **Aceptable** al volumen actual; revisar si MAX_OFFERS sube.

---

## 2. Drizzle reads sin LIMIT — MEDIUM (no HIGH confirmado)

Inspección rápida no encontró queries críticas sin LIMIT que también careciesen de filtro PK. Sitios verificados:

- [apps/api/src/routes/site-settings.ts:119-123](apps/api/src/routes/site-settings.ts) — `.orderBy(desc(...)).limit(20)`. ✓
- [apps/api/src/routes/admin-stakeholder-orgs.ts:70](apps/api/src/routes/admin-stakeholder-orgs.ts) — `baseQuery = opts.db.select().from(organizacionesStakeholder)` sin LIMIT en la base. **Verificar** si el caller añade `.limit()` antes de ejecutar — si no, full table scan al crecer la tabla.
- [apps/api/src/routes/me.ts:38-42](apps/api/src/routes/me.ts) — `select().from(memberships).where(eq(...))` — fetch por foreign key (user_id). **Múltiples filas posibles** (un user con varias memberships). Bounded en práctica (un usuario activa pocas memberships), pero no semánticamente.

**Recomendación**: en cada Drizzle `.select()` sin `.where(eq(PK, ...))` añadir `.limit()` explícito o pagination.

---

## 3. Pub/Sub publish sin batching — CLEAN

- [apps/api/src/services/chat-pubsub.ts:48-75](apps/api/src/services/chat-pubsub.ts) — `publishChatMessage` se llama una vez por mensaje (fire-and-forget desde el POST handler). Sin loop.
- [apps/api/src/services/notify-offer.ts](apps/api/src/services/notify-offer.ts) — `Promise.allSettled` bounded ≤10. Aceptable.

No detecté loops `for (item of …) await publish(…)` sin batch en `apps/api/`, `apps/telemetry-processor/`, `apps/notification-service/`.

---

## 4. OTel span coverage en hot paths — HIGH

**EL HALLAZGO MÁS GRAVE DE ESTA PASADA**.

[apps/api/src/main.ts](apps/api/src/main.ts) — **NO inicializa el OpenTelemetry SDK**. No hay `new NodeSDK({...}).start()` ni import de `@opentelemetry/sdk-node` en el entrypoint. Las dependencies están instaladas (`apps/api/package.json` líneas 34-39 incluyen `@opentelemetry/{api,sdk-node,auto-instrumentations-node,exporter-trace-otlp-http,resources,semantic-conventions}` versión `^0.218.0`) pero **no se usan**.

Esto significa:
- Auto-instrumentación de Hono, pg, ioredis, fetch: **no carga**.
- Spans custom de `tracer.startSpan` en services: **no se exportan** (la API queda como no-op).
- Cloud Trace no recibe traces de api. Métricas custom (CLAUDE.md §6 "métrica custom si es operación de negocio") **probablemente tampoco**.

**Hot paths sin custom spans** (incluso si SDK arrancara):

| Path | Verificación |
|---|---|
| [apps/api/src/services/matching.ts:85-354](apps/api/src/services/matching.ts) | 0 `tracer.startSpan` / `startActiveSpan` |
| [apps/api/src/services/liquidar-trip.ts:73-170](apps/api/src/services/liquidar-trip.ts) | 0 spans en 3 lookups + cálculo financiero |
| [apps/telemetry-processor/src/persist.ts:59-122](apps/telemetry-processor/src/persist.ts) | 0 spans — millones/día sin observabilidad |
| [apps/api/src/services/emitir-certificado-viaje.ts:69-200](apps/api/src/services/emitir-certificado-viaje.ts) | 0 spans — KMS sign + GCS upload sin medir latencia |

**Impacto**:
- No se puede medir P95/P99 de matching → no se puede detectar regresiones cuando matching v2 cambia pesos.
- KMS sign tiene SLO de ~50ms-200ms; sin spans, una regresión a 2s pasaría inadvertida hasta que un usuario reporte.
- Telemetry persist a millones/día sin medición = imposible detectar contención de pool DB o latencia GCP.

**CLAUDE.md §6 explícitamente** dice: "Cada endpoint del backend y cada interacción relevante del frontend genera: log estructurado con correlationId consistente, **span de OpenTelemetry con contexto propagado**, métrica custom si es operación de negocio."

**Acción HIGH**: inicializar SDK en `main.ts` + añadir spans custom en los 4 paths listados como mínimo.

---

## 5. Sync work en handlers Hono — MEDIUM 1

[apps/api/src/routes/chat.ts:438](apps/api/src/routes/chat.ts) — `JSON.parse(msg.data.toString('utf-8'))` dentro del handler SSE del stream de mensajes. Sin validación de tamaño del payload entrante de Pub/Sub. Un payload malformed o muy grande bloquea el event loop brevemente; en contexto SSE no afecta latencia de otros clientes (es worker side), pero sí puede romper el handler.

**Mitigación parcial existente**: el `.catch()` en línea 470 evita crash.

**Acción**: añadir validación Zod del payload tipado antes del parse, con `max: 16KB` o similar.

No detecté `fs.readFileSync`, `bcrypt`, ni `crypto.scrypt` sync inside route handlers (scrypt en `clave-numerica.ts` se usa async correctamente).

---

## 6. Frontend bundle hotspots — LOW 2

### 6.1 — Sin `manualChunks` en vite.config

[apps/web/vite.config.ts:14-65](apps/web/vite.config.ts) — sin configuración de `build.rollupOptions.output.manualChunks`. Vite usa defaults; el bundle queda como un main.js gigante + chunks vendor por convención automática.

### 6.2 — Maps lib eager

- [apps/web/src/components/map/VehicleMap.tsx:8](apps/web/src/components/map/VehicleMap.tsx) — import top-level de `@vis.gl/react-google-maps`.
- [apps/web/src/components/map/LiveTrackingScreen.tsx:3](apps/web/src/components/map/LiveTrackingScreen.tsx) — id.
- [apps/web/src/components/offers/EcoRouteMapPreview.tsx:8](apps/web/src/components/offers/EcoRouteMapPreview.tsx) — id (este componente probablemente es lazy en su parent, pero el import top-level del lib lo arrastra).

Cualquier usuario que entre a `/login` paga el costo de descargar Maps lib aunque nunca abra una vista de tracking.

### 6.3 — Router sin `lazy()`

[apps/web/src/router.tsx](apps/web/src/router.tsx) — todas las rutas importadas sync (`import { AppRoute } from './routes/app.js'`). Sin TanStack Router `lazy()` wrapping. Initial JS payload = árbol completo.

**Impacto**: time-to-interactive elevado en mobile (segmento principal de Booster); PWA install + first-load amplifica el problema.

**Acción LOW**: lazy-load por ruta + dynamic import del Maps lib en componentes de map.

---

## 7. Web Push / SSE backpressure — MEDIUM 1

### SSE
[apps/api/src/routes/chat.ts:476-482](apps/api/src/routes/chat.ts) — disconnect detection via `stream.onAbort()` ✓. Cleanup OK.

**Brecha**: no hay AbortController explícito para shortcircuitar el callback `onMessage` si el client ya desconectó. Si onMessage dispara entre el disconnect y la propagación del abort, `stream.writeSSE` lanza — capturado por `.catch` (línea 470) sin afectar otros clientes, pero genera ruido en logs.

### Web Push
[apps/api/src/services/web-push.ts:115-131](apps/api/src/services/web-push.ts) — `Promise.all(subs.map(async sub => sendNotification(sub, ...)))`. Volumen típico: <5 subs/user. Sin 429 backoff explícito — depende del retry interno de la lib `web-push`. **Aceptable al volumen actual**; verificar si alguna vez se fan-out a >100 subs.

---

## 8. Telemetría hot path — CLEAN (con observación)

[apps/telemetry-tcp-gateway/src/connection-handler.ts:88-140](apps/telemetry-tcp-gateway/src/connection-handler.ts):
- State es local al callback de `handleConnection` (no global Map<imei, state> → **sin leak de memoria**).
- Buffer se re-concatena con cada chunk (línea 125) y se vacía conforme drena packets (212). **Safe**.
- Cleanup en `socket.on('close')`.

**Observación menor**: en alta concurrencia (cientos de dispositivos), el GC pressure por reasignación de `Buffer.concat(...)` puede ser medible. Bench candidato si la app escala a > 1000 dispositivos simultáneos (no urgente al volumen actual de Wave 3).

---

## 9. Logger PII redaction — HIGH 1

[packages/logger/src/redaction.ts:13-60](packages/logger/src/redaction.ts) — paths usan **wildcard nested only**:

```
'*.email', '*.phone', '*.rut', '*.dni', '*.full_name', ...
```

Pino redact con `*.email` matchea `user.email`, `req.body.email`, etc. **NO matchea `email` top-level**. Si un service hace:

```typescript
logger.info({ email, phone, rut }, 'auth attempt');
```

los tres campos top-level salen a Cloud Logging **sin redactar**. Esto contradice CLAUDE.md §7 "Toda PII se redacta en logs automáticamente via Pino serializers".

Hallazgo ya identificado en la security audit del usuario (`.specs/audit-2026-05-14/security.md` en la rama `feat/security-blocking-hotfixes`). En **main**: no remediado.

**Acción HIGH**: añadir keys bare a `redact.paths`: `'email', 'phone', 'phone_number', 'rut', 'dni', 'full_name', 'firebase_uid', 'whatsapp_e164'`.

---

## 10. Cache absence — HIGH 2 / MEDIUM 1

### HIGH

**10.1 — `/feature-flags` sin Cache-Control**
[apps/api/src/routes/feature-flags.ts:30-38](apps/api/src/routes/feature-flags.ts) — devuelve config booleanos sin header `Cache-Control`. Cada navegación a una PWA root la llama. Valor cambia sólo en deploys. Cache 1-24h sería trivial.

**10.2 — `/me` sin caché**
[apps/api/src/routes/me.ts](apps/api/src/routes/me.ts) — el endpoint que TanStack Query del cliente consume en cada rotación de ruta. Sin `Cache-Control: private, max-age=60` ni ETag. La query del cliente lo cachea local sí, pero un hard refresh va siempre al backend (~3 queries en serie).

### MEDIUM

**10.3 — `/public/site-settings` comentario miente**
El comentario en [apps/api/src/server.ts:379](apps/api/src/server.ts) dice "cache 5min". Pero el handler [apps/api/src/routes/site-settings.ts](apps/api/src/routes/site-settings.ts) **no setea `Cache-Control`** en respuesta. El cache vive sólo en el cliente PWA (Workbox). Side-effect: ningún CDN intermedio cachea.

**Acción**: añadir `c.header('Cache-Control', 'public, max-age=300, s-maxage=300')` antes del return.

---

## 11. Frontend re-render risk — HIGH

Top 5 componentes > 400 LOC **sin React.memo**:

| Path | LOC | Riesgo |
|---|---|---|
| [apps/web/src/components/onboarding/OnboardingForm.tsx](apps/web/src/components/onboarding/OnboardingForm.tsx) | 709 | Form multi-step + FormProvider. `buildDefaults()` invocada en cada render. |
| [apps/web/src/components/profile/AuthProvidersSection.tsx](apps/web/src/components/profile/AuthProvidersSection.tsx) | 621 | Re-render cascada con cambios del parent profile. |
| [apps/web/src/components/login/LoginUniversal.tsx](apps/web/src/components/login/LoginUniversal.tsx) | 446 | Sin memo; con cada re-render del padre re-evalúa conditional rendering completo. |
| [apps/web/src/components/chat/ChatPanel.tsx](apps/web/src/components/chat/ChatPanel.tsx) | 413 | Recibe `assignment_id`; cambios en parent props lo desmontan. Pérdida de scroll/draft. |
| [apps/web/src/components/offers/OfferCard.tsx](apps/web/src/components/offers/OfferCard.tsx) | 392 | En listas largas (`/ofertas`), cada cambio del padre re-renderiza todas las cards. |

**Acción HIGH**: `React.memo` con custom equality donde aplique, `useCallback` para handlers, `useMemo` para objetos derivados. Prioridad: `OfferCard` (vive en listas, multiplica costo) y `ChatPanel` (desmontaje destructivo).

---

## 12. Connection pool sizing — MEDIUM 1

- [apps/api/src/db/client.ts:18-25](apps/api/src/db/client.ts) — `pg.Pool({ max: config.poolMax, ... })`.
- [packages/config/src/schemas/database.ts:5](packages/config/src/schemas/database.ts) — `DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10)`.

**Default 10**. Cloud Run escala instancias horizontalmente; con 50 instancias activas son 500 conexiones agregadas al Cloud SQL. Cloud SQL `db-f1-micro` permite ~25 conexiones, `db-g1-small` ~50, `db-custom-2-7680` ~100, etc. Con instancias máximas y carrier sizing actual (ADR-034 right-sizing), **probable contención** ante picos de tráfico.

**Acción MEDIUM**: monitorear logs por `timeout acquiring connection from pool` después del próximo evento de alta carga. Si aparecen, subir a 20-30 + considerar PgBouncer.

---

## Acciones priorizadas

| Prioridad | Acción | Esfuerzo |
|---|---|---|
| 1 (HIGH) | Inicializar OTel SDK en [apps/api/src/main.ts](apps/api/src/main.ts) + añadir auto-instrumentations | 1-2h |
| 2 (HIGH) | Spans custom en matching / persist / cert / liquidate (4 paths) | 1d |
| 3 (HIGH) | Ampliar `redact.paths` del logger con keys top-level (`email`, `phone`, `rut`, etc.) | 30min |
| 4 (HIGH) | Cache-Control en `/feature-flags`, `/me`, `/public/site-settings` | 1h |
| 5 (HIGH) | `React.memo` en `OfferCard` + `ChatPanel` | 2h |
| 6 (HIGH) | Refactor N+1 en `matching.ts` vehicle loop (IN batch) | 2-4h |
| 7 (HIGH) | Refactor COUNT en persist a job periódico Redis | 4h |
| 8 (MEDIUM) | Validación Zod de payload Pub/Sub en SSE chat | 1h |
| 9 (MEDIUM) | LIMIT explícito en queries admin sin PK | 1h |
| 10 (MEDIUM) | Bump pool `max` a 20-30 + monitor | 30min |
| 11 (LOW) | TanStack Router `lazy()` + dynamic Maps lib | 4-8h |

---

## Procedencia

- Subagente Explore con scope performance.
- Reads dirigidos: [apps/api/src/main.ts](apps/api/src/main.ts), [apps/api/src/services/matching.ts](apps/api/src/services/matching.ts), [apps/telemetry-processor/src/persist.ts](apps/telemetry-processor/src/persist.ts), [packages/logger/src/redaction.ts](packages/logger/src/redaction.ts), [apps/api/src/db/client.ts](apps/api/src/db/client.ts), [apps/web/vite.config.ts](apps/web/vite.config.ts), [apps/web/src/router.tsx](apps/web/src/router.tsx).
- Grep estructurado: `await db.`, `Promise.all`, `for (const`, `tracer.startSpan`, `Cache-Control`, `React.memo`, `lazy(`, `publishMessage`.
- LOC contadas con `wc -l` filtrando `*.test.*` y `node_modules`.
- Sin ejecución de código ni benchmarks.
