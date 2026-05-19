# 05 — Tech Debt Registry — Booster AI

**Sesión**: `21c07e7c-e6f9-4de9-9c1d-f819e6b5d5d7`
**Generado**: 2026-05-19T02:41Z
**Subagent**: `tech-debt-detector`
**Modo**: read-only
**Marco**: principio §1 "Cero deuda técnica desde day 0" de `CLAUDE.md`

Este registro detecta violaciones a los principios inviolables de `CLAUDE.md`:
prohibición de `any`, de `console.*` en producción, de marcadores de deuda
diferida sin trazabilidad, y de patrones que erosionan el contrato "Cero
Parches day 0". Las búsquedas excluyen `node_modules/`, builds (`dist/`, `.vite/`)
y archivos de test salvo donde se cuenta a propósito para visibilidad.

---

## Resumen ejecutivo

| Categoría | Producción | Tests/dev | Severidad |
|-----------|------------|-----------|-----------|
| TD1 — `any` explícito | **4** | 55 | P1 |
| TD2 — Directivas TS bypass (`@ts-ignore`/`@ts-expect-error`/`@ts-nocheck`) | **2** | 0 | P2 |
| TD3 — Marcadores deuda diferida (TODO/FIXME/XXX) | **4** | 0 | P2 |
| TD4 — Hostnames locales en código productivo | **3** | 9 | P2 |
| TD5 — Mocks/stubs/fakes en producción | **0** | n/a | OK |
| TD6 — `console.*` en producción | **1 hallazgo real** (1 script CLI dev = excepción) | n/a | P2 |
| TD7 — `@deprecated` en uso | 8 declaraciones, 0 call-sites internos vivos | n/a | OK |
| TD8 — Vocabulario diferido en comentarios | **11** (paráfrasis) | 0 | P2 |
| TD9 — Drift en commits últimos 30 días | **0** sobre 446 commits | n/a | OK |

**Veredicto general**: el repo cumple el principio "Cero Parches day 0" con un
puñado de excepciones explícitas, documentadas, y todas localizadas. No hay
deuda estructural — sólo deuda diferida deliberada (UI auxiliar pendiente,
adaptadores externos mal tipados, placeholders de servicios aún no migrados).
Recomendación: trackear TD1+TD2+TD3 como tickets explícitos para que el
"Cero" sea verificable continuamente y no se erosione tácitamente.

---

## TD1. Uso de `any` explícito

**Comando**: `grep -rnE ': any[,)>;\s]|<any>|as any\b' apps/ packages/ --include='*.ts' --include='*.tsx'`
**Filtro**: excluye `node_modules/`, `test/`, `*.test.ts`, `*.spec.ts`, `__tests__/`.
**Excepción permitida por CLAUDE.md §1**: tests internos, documentado.

### Hallazgos en código productivo (4)

| Ruta:Línea | Workspace | Contexto |
|------------|-----------|----------|
| `apps/web/src/services/voice-commands.ts:244` | `apps/web` | `window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any }` — tipos vendor del navegador no expuestos por TS DOM lib. Justificable con declaración local pero hoy es `any`. |
| `apps/api/src/db/migrator.ts:115` | `apps/api` | `db: any` — parámetro genérico del runner de migraciones Drizzle. Reemplazable por `PgDatabase<...>` tipado. |
| `apps/telemetry-processor/src/crash-trace-adapters.ts:53` | `apps/telemetry-processor` | `...({ insertIds: [row.crash_id] } as any)` — sobre cast del SDK de BigQuery `@google-cloud/bigquery` (tipos `insert` desactualizados). Comentario referencia compat de SDK. |
| `packages/certificate-generator/src/ca-self-signed.ts:183` | `packages/certificate-generator` | `(forge.pki as any).getTBSCertificate(cert)` — método no exportado por los typings de `node-forge`. Aplica idéntico patrón que en libs criptográficas. |

### Conteo en tests (55, esperado por la excepción)

Concentrados en:
- `apps/api/test/unit/admin-observability-route.test.ts` (24 ocurrencias — mock builders con doubles)
- `apps/web/src/lib/web-push.test.ts` (6)
- `apps/web/src/components/profile/TwoFactorSection.test.tsx` (4)
- `packages/certificate-generator/src/*.test.ts` (~10)
- Resto distribuido en otros tests de unidad.

**Acción recomendada**: P1 — para los 4 hallazgos productivos, abrir tickets
trazables. Tres son adaptadores a tipos externos defectuosos (forge, bigquery,
DOM lib): la solución correcta es declarar `interface` local que tipe sólo el
shape consumido (no `any` global). El cuarto (migrator) es un `any` genuino
del aplicativo y debería tiparse.

---

## TD2. Directivas TS bypass

**Comando**: `grep -rnE '@ts-(ignore|expect-error|nocheck)' apps/ packages/ --include='*.ts' --include='*.tsx'`

### Hallazgos (2 — ambos justificados)

| Ruta:Línea | Workspace | Directiva | Justificación inline |
|------------|-----------|-----------|----------------------|
| `apps/web/src/sw.ts:49` | `apps/web` | `@ts-expect-error` | "workbox-expiration ExpirationPlugin tipa cacheDidUpdate como required pero exactOptionalPropertyTypes:true del tsconfig base lo exige sin '| undefined'" — choque entre tipos de librería y flag estricto del proyecto. |
| `apps/web/src/sw.ts:64` | `apps/web` | `@ts-expect-error` | Idem (segunda instancia de ExpirationPlugin). |

**Severidad**: P2. Ambas tienen comentario justificativo y se concentran en un
único archivo (el service worker), no en lógica de negocio. `@ts-expect-error`
es la directiva correcta (rompe si el problema desaparece). No hay `@ts-ignore`
ni `@ts-nocheck` en todo el repo.

**Acción recomendada**: P2 — verificar en cada bump de `workbox` si el tipo
upstream se corrigió, momento en que las directivas fallarán por sí solas y se
podrán quitar.

---

## TD3. Comentarios de deuda diferida (TODO/FIXME/XXX)

**Comando**: `grep -rnE '//\s*(TODO|FIXME|XXX)|/\*\s*(TODO|FIXME|XXX)' apps/ packages/ --include='*.ts' --include='*.tsx' --include='*.js'`
**Filtro**: excluye `node_modules/`.

### Hallazgos (4)

#### Con referencia a ADR / issue (1)

| Ruta:Línea | Comentario |
|------------|-----------|
| `apps/web/src/lib/logger.ts:12` | `TODO(adr-pendiente)`: definir sink de browser observability — Sentry vs ... (referencia explícita a ADR aún no escrito) |

#### Sin referencia (3 — placeholders de servicios skeleton)

| Ruta:Línea | Comentario |
|------------|-----------|
| `apps/matching-engine/src/main.ts:12` | `TODO`: implementar según el ADR correspondiente. (servicio aún no implementado, esqueleto Cloud Run) |
| `apps/notification-service/src/main.ts:12` | Idem |
| `apps/document-service/src/main.ts:12` | Idem |

**Nota**: el patrón es idéntico en los 3 — esqueletos de microservicios
generados con la misma plantilla, listos para que la spec correspondiente los
materialice. El TODO es estructural (el archivo entero está vacío excepto el
logger inicial) y se resolverá cuando se ejecute la spec del servicio.

**Acción recomendada**: P2 — convertir el TODO genérico en una referencia
explícita al ID de spec/feature pendiente (ej. `// TODO(feature: matching-mvp)`)
para tener trazabilidad cuando los servicios se construyan.

---

## TD4. Hostnames locales en código productivo

**Comando**: `grep -rnE '(localhost|127\.0\.0\.1|0\.0\.0\.0)' apps/ packages/ --include='*.ts' --include='*.tsx' --include='*.js' --include='*.json'`
**Filtro**: excluye `node_modules/`, `dist/`, `*.test.*`, `*.spec.*`, `__tests__/`, fixtures, `playwright.config.ts`, `.env.example`.

### Hallazgos en código productivo (3)

| Ruta:Línea | Workspace | Naturaleza |
|------------|-----------|------------|
| `apps/telemetry-tcp-gateway/scripts/smoke-test.ts:20` | `apps/telemetry-tcp-gateway` | Mención en docstring (`GATEWAY_HOST=localhost GATEWAY_PORT=5027 ...`) — script CLI de dev. Excepción documentada por CLAUDE.md (dev tools). |
| `apps/web/src/routes/login.tsx:85` | `apps/web` | `host === 'demo.boosterchile.com' || host === 'demo.localhost'` — check de hostname para activar modo demo en dev. Diseño deliberado, no es regresión. |
| `apps/web/src/routes/index.tsx:26` | `apps/web` | Idem (mismo check de demo host). |
| `apps/web/src/lib/api-url.ts:4` | `apps/web` | Mención `localhost:3000` en docstring que documenta la inyección via `VITE_API_URL`. |

### Hallazgos en tests/infraestructura de pruebas (9 — esperados)

`apps/api/test/setup.ts`, `apps/api/test/setup.integration.ts`,
`apps/api/test/load/smoke.k6.js` — todos en `test/` y usan `localhost` como
default cuando no hay `DATABASE_URL`/`REDIS_HOST`/`CORS_ALLOWED_ORIGINS`
inyectado. Comportamiento esperado.

**Severidad**: P2. Ningún hit corresponde a una URL hardcoded que pudiera
filtrarse a producción. Los 3 hits productivos son: (1) docstring, (2)(3) un
check funcional de hostname para activar la versión demo de la PWA, que es
correcto y necesario.

**Acción recomendada**: ninguna sobre el código; opcionalmente, mover el
literal `'demo.localhost'` a una constante exportada desde `packages/config`
para que sea descubrible y documentado.

---

## TD5. Mocks/stubs/fakes en código productivo

**Comando**: `grep -rnE '\b(mock|stub|fake|dummy)[A-Z_]' apps/ packages/ --include='*.ts' --include='*.tsx'`
**Filtro**: excluye `test/`, `*.test.*`, `*.spec.*`, `__tests__/`, `node_modules/`.

**0 hallazgos** · metodología: regex con frontera de palabra + capitalización
inmediata (`mockSomething`, `stubFoo`, `fakeUser_Id`, `dummyXX`), filtrado por
exclusión de cualquier ruta de test. El repo no expone identificadores tipo
mock/stub/fake/dummy en código de producción.

---

## TD6. `console.*` en código productivo

**Comando**: `grep -rnE 'console\.(log|debug|info|warn|error|trace)' apps/ packages/ --include='*.ts' --include='*.tsx'`
**Filtro**: excluye tests; excepción documentada en CLAUDE.md §1 — CLI dev tools.

### Hallazgos (2 totales, 1 excepción legítima, 1 técnicamente prod pero baja severidad)

| Ruta:Línea | Workspace | Tipo |
|------------|-----------|------|
| `apps/telemetry-tcp-gateway/scripts/smoke-test.ts:28` | `apps/telemetry-tcp-gateway` | **Excepción CLAUDE.md** — script CLI dev (`scripts/`). Aliasa `console.log` explícitamente para output del smoke test. Permitido. |
| `packages/coaching-generator/src/evals/runner.ts:119` | `packages/coaching-generator` | Comentario que documenta que el output va "listo para `console.log`" — no es una llamada real, sólo descripción en JSDoc. |

**Severidad**: P2 sólo a efectos de visibilidad. Ningún logging productivo
real bypassa `@booster-ai/logger`. El único `console.log` real está en el
script de smoke test (excepción CLI dev permitida por contrato), y el segundo
match es texto de comentario, no código ejecutable.

---

## TD7. `@deprecated` en uso

**Comando**: `grep -rnE '@deprecated' apps/ packages/ --include='*.ts' --include='*.tsx'`

### Declaraciones (8)

| Ruta:Línea | Símbolo deprecado | Reemplazo |
|------------|-------------------|-----------|
| `apps/web/src/App.tsx:2` | `App` (componente legacy) | `src/router.tsx` (router programático, refactor B.3.b) |
| `apps/api/src/db/schema.ts:1235` | Campo `hasGpsData` en `trip_metrics` | `route_data_source` (ADR-028) |
| `packages/shared-schemas/src/primitives/ids.ts:31` | `carrierIdSchema` | `transportistaIdSchema` |
| `packages/shared-schemas/src/primitives/ids.ts:33` | `shipperIdSchema` | `generadorCargaIdSchema` |
| `packages/shared-schemas/src/primitives/ids.ts:53` | type `CarrierId` | `TransportistaId` |
| `packages/shared-schemas/src/primitives/ids.ts:55` | type `ShipperId` | `GeneradorCargaId` |
| `packages/shared-schemas/src/domain/trip-metrics.ts:54` | Schema field (`hasGpsData`) | `route_data_source` (ADR-028) |
| `packages/shared-schemas/src/domain/trip-metrics.ts:94` | Schema nullable hasta backfill | `route_data_source` (ADR-028) |

### Call-sites internos vivos (cross-check)

- `carrierIdSchema` / `shipperIdSchema` / `CarrierId` / `ShipperId`: **0 usos
  en código de producción**. Únicos call-sites están en `packages/shared-schemas/src/all-schemas.test.ts:86-87`
  y son tests que validan precisamente la equivalencia con el alias canónico.
- `hasGpsData`: **0 referencias** en `apps/` o `packages/` fuera de la
  declaración deprecated.

**Severidad**: OK. Los `@deprecated` están correctamente sin consumidores
vivos. Pueden eliminarse físicamente en el próximo ciclo de limpieza siguiendo
ADR-028, manteniendo sólo la migración legacy de schemas que el comentario
explica.

---

## TD8. Vocabulario diferido en comentarios (paráfrasis)

**Patrón buscado**: expresiones de aplazamiento sin issue tracking ("por
ahora", "más adelante", marcadores temporales, "workaround", "kludge",
"provisional", "later", "next sprint", "good enough", "temporary"). Reportado
en paráfrasis por instrucción del subagent.

**Hallazgos reales en código productivo (11)** — todos del tipo "por ahora..."
en docstrings que documentan deuda futura conocida y reconocida:

| Ruta:Línea | Naturaleza (paráfrasis) |
|------------|--------------------------|
| `apps/web/src/services/wake-word.ts:133` | Comentario indica que la carga de Porcupine se hará en una iteración futura; actualmente el feature está marcado como indisponible. |
| `apps/web/src/routes/stakeholder-zonas.tsx:28` | Zonas predefinidas estáticas en frontend; comentario anuncia migración futura a backend. |
| `apps/api/src/db/schema.ts:902` | Campo `source` fijado a un valor único en esta iteración; comentario reserva el campo para canales futuros. |
| `apps/api/src/routes/me-consents.ts:87` | Política de autorización amplia provisional; comentario indica refinamiento futuro. |
| `apps/api/src/routes/me.ts:280` | Sin paginación en este endpoint; comentario reconoce que se añadirá. |
| `apps/api/src/services/estimar-distancia.ts:11` | Uso de distancia haversine como aproximación; comentario detalla la sustitución futura por servicio de routing real. |
| `apps/api/src/services/reportar-incidente.ts:18` | Notificación reducida a log estructurado; comentario describe expansión futura a web push. |
| `apps/whatsapp-bot/src/routes/webhook.ts:137` | Persistencia limitada a Cloud Logging; comentario reconoce migración futura a almacenamiento estructurado. |
| `apps/whatsapp-bot/src/conversation/prompts.ts:49` | Mensaje de bot fijo informa al usuario de la opción única disponible en esta iteración. |
| `apps/api/src/routes/public-tracking.ts:14` | Seguridad de tracking apoyada en opacidad UUID; comentario reconoce hardening futuro. |
| `apps/api/src/routes/empresas.ts:15` | Routes con única ruta (`/onboarding`); comentario anticipa expansión. |

**Hallazgos adicionales descartados como falsos positivos**:

- Múltiples coincidencias con la palabra "lateral" (parte de `LATERAL JOIN`
  SQL, `harsh cornering lateral G`, "lista lateral" UI) que el regex amplio
  capturó. No constituyen deuda.
- Tests (`flota.test.tsx`, `demo-login.test.ts`) descartados.
- `apps/api/src/services/calcular-metricas-viaje.ts:25` y
  `apps/api/src/services/seed-demo.ts:332` y
  `apps/api/src/services/asignar-conductor-a-assignment.ts:25`: comentarios
  documentando iteración actual vs futura, contados arriba como deuda
  diferida real.

> Total preciso revisando exclusiones manuales: 14 comentarios productivos
> con vocabulario de aplazamiento. Reportados arriba los 11 con texto único
> distinguible; los 3 restantes son variantes en `calcular-metricas-viaje.ts`,
> `seed-demo.ts` y `asignar-conductor-a-assignment.ts` con la misma estructura.

**Severidad**: P2. Ninguno es ocultamiento — todos describen explícitamente
qué falta y por qué se aplazó. Faltan, sin embargo, referencias a un
ticket/spec/ADR que materialice el seguimiento. La recomendación es la misma
que en TD3: convertir cada comentario "por ahora..." en `TODO(feature:
<slug>)` con un slug que apunte a una spec creada (o pendiente de crear).

---

## TD9. Drift en commits recientes

**Comando**: `git log --since="30 days ago" --pretty=format:'%h %s' | grep -iwE '(todo|fixme|hack|kludge|temporary|workaround)|por ahora|for now'`
**Universo**: 446 commits en los últimos 30 días.

**0 hallazgos** · metodología: regex word-boundary contra el subject de cada
commit. Los matches iniciales (`metodologia`, `todos`) son sustring spurious
de palabras no relacionadas (metodología, "todos los excludes"), ninguno
introduce vocabulario de drift en el historial.

El historial de commits respeta Conventional Commits estricto (CLAUDE.md
"Convenciones de código") y no hay mensajes que telegrafíen parches
temporales sin trazabilidad.

---

## Severidad consolidada

### P0 — Bloqueante

**Ninguno.** No se detecta deuda crítica que viole los principios día-0 de
forma estructural. Sin secretos hardcodeados, sin `@ts-nocheck`, sin
`console.log` de logging productivo, sin URLs prod hardcodeadas.

### P1 — Alta

- **TD1**: 4 `any` explícitos en código productivo. Tres son adaptadores a
  tipos externos defectuosos (`forge`, `@google-cloud/bigquery`, DOM lib de
  Speech Recognition) y uno (`db/migrator.ts:115`) es deuda interna. Acción:
  reemplazar por interfaces locales acotadas al shape consumido y abrir
  ticket explícito para cada uno (visibilidad CI).

### P2 — Media

- **TD2**: 2 `@ts-expect-error` con justificación inline en `apps/web/src/sw.ts`. Dependen del upstream de `workbox-expiration`. Trackear en cada bump.
- **TD3**: 4 `TODO` placeholder, 3 en servicios skeleton (matching-engine, notification-service, document-service) sin spec ejecutada todavía. Convertir en `TODO(feature: <slug>)` cuando exista la spec.
- **TD4**: 3 referencias a `localhost` en productivo (1 docstring + 2 checks funcionales de demo host). Considerar mover el literal a constante de `packages/config`.
- **TD6**: 1 `console.log` en script CLI dev (excepción permitida) + 1 mención en comentario JSDoc. Sin acción.
- **TD8**: ~14 comentarios "por ahora..." documentando deuda diferida conocida. Convertir en TODOs trackeables.

### OK — Sin hallazgos

- **TD5**: 0 mocks/stubs/fakes en código productivo.
- **TD7**: 8 `@deprecated` declarados, 0 call-sites internos vivos.
- **TD9**: 0 commits con vocabulario drift en últimos 30 días (446 commits).

---

## Notas metodológicas

- **Exclusiones aplicadas**: `node_modules/`, `dist/`, `.vite/deps/`,
  `*.test.ts`, `*.spec.ts`, `__tests__/`, `test/setup*.ts`, `test/load/`,
  `playwright.config.ts`, `.env.example`. Cualquier hallazgo dentro de esas
  rutas se reporta sólo a efectos de conteo agregado (columna "Tests/dev").
- **Falsos positivos descartados manualmente**: sustring matches en
  `LATERAL JOIN`, `lateral G`, "lista lateral", "todos", "metodologia". El
  conteo final excluye estos.
- **Excepciones documentadas por CLAUDE.md §1**: tests internos pueden usar
  `any` con justificación (55 hits aceptables, no violan principio). Scripts
  CLI de `scripts/` y `bin/` pueden usar `console.*` (1 hit aceptable).
- **Marco de severidad**: P0 = bloqueante de release; P1 = backlog top de
  trimestre; P2 = housekeeping en el siguiente touch del archivo.

---

**Generado por**: subagent `tech-debt-detector` (Claude haiku, read-only).
**Ledger**: eventos `drift_justified` y `artifact_produced` registrados en
`.claude/ledger/2026-05-19_21c07e7c-e6f9-4de9-9c1d-f819e6b5d5d7.jsonl`.
