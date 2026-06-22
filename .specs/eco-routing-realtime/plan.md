# Eco-routing realtime — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Durante un viaje activo, anticipar congestión vía Google Routes API y avisar al conductor por voz la ruta alternativa de menor emisión (con guardrail de ETA), midiendo la adopción para el storytelling de CO₂e.

**Architecture:** Servicio dedicado event-driven (`apps/eco-routing-service`) que consume posición en vivo de viajes `en_proceso`, delega la lógica a dos packages puros (`traffic-condition-detector`, `route-alternatives-evaluator`), reusa `routes-api.ts` (Google Routes API v2: tráfico en vivo + alternativas + fuel) y `carbon-calculator`, persiste en `sugerencias_ruta`, y entrega por el canal coaching-voice (TTS client-side). Un job `adoption-resolver` resuelve la adopción post-viaje.

**Tech Stack:** TypeScript (Node 24), Hono, Drizzle ORM (Postgres), Zod, `@booster-ai/carbon-calculator`, Google Routes API v2 (vía `routes-api.ts`), Pub/Sub, Cloud Run, Vitest.

## Global Constraints

- **Node 24** (`.nvmrc`=24; CI `NODE_VERSION='24'`). Verificar `node -v`==24 antes de testear (node 25+ rompe apps/web jsdom).
- **Zero `any`** (Biome lo prohíbe); si TS no infiere, crear Zod schema + `z.infer<>`.
- **Validación Zod en boundaries** (Pub/Sub payloads, HTTP, respuestas de APIs externas).
- **Zero `console.*`** → `@booster-ai/logger` (structured logs + trace_id + span OTel por operación de negocio).
- **No silently swallow errors**: cada `catch` loguea con contexto + re-throw o recovery explícito con métrica. El servicio es best-effort: nunca bloquea el viaje.
- **Naming bilingüe**: TS identifiers inglés camelCase; SQL tablas/columnas español snake_case sin tildes; enum values español snake_case.
- **Algoritmos en `packages/`** (puros); `apps/*/src/services/` orquesta. Prohibido lógica de evaluación inline en el servicio.
- **Coverage 80%+** en código nuevo (líneas/branches/funciones). Tests `*.test.ts` al lado del archivo.
- **TDD obligatorio** (dominio crítico: carbono/ruteo) — test primero, ver fallar, implementar mínimo, ver pasar, commit.
- **Migrations**: Drizzle, expand-only, con `.down.sql` (ADR-066). Tabla Drizzle debe coincidir con un schema canónico en `packages/shared-schemas/src/domain/`.
- **Conventional Commits con scope**: `feat(eco-routing): ...`, summary español ≤72 chars.
- **Secretos**: Google Secret Manager; API keys GCP con restricciones. La `GOOGLE_ROUTES_API_KEY` ya existe (la usa `routes-api.ts`).

---

## File Structure

**Nuevos packages (lógica pura):**
- `packages/traffic-condition-detector/` — detecta degradación material de ETA con margen de anticipación. Un solo propósito: ¿amerita evaluar alternativas ahora?
- `packages/route-alternatives-evaluator/` — rankea alternativas por emisión y aplica el guardrail de ETA. Un solo propósito: ¿cuál sugerir (o ninguna)?

**Domain canónico (shared-schemas):**
- `packages/shared-schemas/src/domain/route-suggestion.ts` — schema canónico de `sugerencias_ruta`.

**Migration + Drizzle:**
- `apps/api/drizzle/0046_sugerencias_ruta.sql` + `apps/api/drizzle/down/0046_sugerencias_ruta.down.sql` + journal.
- `apps/api/src/db/schema.ts` — agregar la tabla `routeSuggestions`/`sugerencias_ruta`.

**Servicio nuevo:**
- `apps/eco-routing-service/` — orquestador event-driven (consumer Pub/Sub posición + loop de evaluación + entrega + persistencia).

**Publicación de posición del PWA:**
- `apps/api/src/routes/vehiculos.ts` (o el endpoint que recibe la posición del PWA) — publicar al topic de posición.
- `infrastructure/messaging.tf` — topic `driver-positions` + subscription para el servicio.

**Entrega (PWA):**
- `apps/web/src/services/eco-route-suggestion.ts` + componente que dispara el TTS reusando `coaching-voice.ts`.

**Adoption resolver:**
- `apps/eco-routing-service/src/adoption-resolver.ts` (o un job aparte) + ruta interna trigger.

**Deploy:**
- `apps/eco-routing-service/Dockerfile`, `cloudbuild.production.yaml` (entry), `infrastructure/compute.tf` (módulo Cloud Run), `infrastructure/monitoring.tf` (alertas), `docs/runbooks/service-eco-routing.md`.

> Cada task abajo termina en un deliverable independientemente testeable. El orden respeta dependencias: packages puros primero (sin deps), luego schema, luego servicio, luego integración, luego deploy.

---

## Task 1: `packages/traffic-condition-detector`

Detecta si la ETA en vivo degradó lo suficiente vs la baseline como para evaluar alternativas, con margen de anticipación.

**Files:**
- Create: `packages/traffic-condition-detector/package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `packages/traffic-condition-detector/src/index.ts`
- Test: `packages/traffic-condition-detector/src/index.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface DetectorInput {
    etaEnVivoSegundos: number;      // ETA actual con tráfico (Routes API)
    etaBaselineSegundos: number;    // ETA al iniciar el viaje
    segundosHastaProximaDivergencia: number; // lead time disponible
  }
  export interface DetectorConfig {
    umbralDegradacionPct: number;   // default 0.15 (15%)
    leadTimeMinimoSegundos: number; // default 120 (2 min)
  }
  export type DetectorResult =
    | { degradado: false }
    | { degradado: true; severidadPct: number };
  export function detectarDegradacion(input: DetectorInput, config?: Partial<DetectorConfig>): DetectorResult;
  ```

- [ ] **Step 1: Scaffold del package** (package.json privado `@booster-ai/traffic-condition-detector`, tsconfig extends `../../tsconfig.base.json`, vitest.config copiado de un package existente como `packages/driver-scoring`).

- [ ] **Step 2: Write the failing test**
```ts
// packages/traffic-condition-detector/src/index.test.ts
import { describe, expect, it } from 'vitest';
import { detectarDegradacion } from './index.js';

describe('detectarDegradacion', () => {
  it('no degradado si ETA en vivo ≈ baseline', () => {
    expect(detectarDegradacion({ etaEnVivoSegundos: 1000, etaBaselineSegundos: 1000, segundosHastaProximaDivergencia: 300 }))
      .toEqual({ degradado: false });
  });
  it('degradado si ETA en vivo supera baseline por > umbral (15%) y hay lead time', () => {
    const r = detectarDegradacion({ etaEnVivoSegundos: 1200, etaBaselineSegundos: 1000, segundosHastaProximaDivergencia: 300 });
    expect(r.degradado).toBe(true);
    if (r.degradado) expect(r.severidadPct).toBeCloseTo(0.2);
  });
  it('NO degradado si la degradación llega pero NO hay lead time (ya pasó el cruce)', () => {
    expect(detectarDegradacion({ etaEnVivoSegundos: 1200, etaBaselineSegundos: 1000, segundosHastaProximaDivergencia: 30 }))
      .toEqual({ degradado: false });
  });
  it('umbral configurable', () => {
    expect(detectarDegradacion({ etaEnVivoSegundos: 1100, etaBaselineSegundos: 1000, segundosHastaProximaDivergencia: 300 }, { umbralDegradacionPct: 0.05 }).degradado).toBe(true);
  });
});
```

- [ ] **Step 3: Run test, verify FAIL** — `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"; pnpm --filter @booster-ai/traffic-condition-detector test` → FAIL ("detectarDegradacion is not a function").

- [ ] **Step 4: Implement**
```ts
// packages/traffic-condition-detector/src/index.ts
export interface DetectorInput {
  etaEnVivoSegundos: number;
  etaBaselineSegundos: number;
  segundosHastaProximaDivergencia: number;
}
export interface DetectorConfig {
  umbralDegradacionPct: number;
  leadTimeMinimoSegundos: number;
}
export type DetectorResult = { degradado: false } | { degradado: true; severidadPct: number };

const DEFAULTS: DetectorConfig = { umbralDegradacionPct: 0.15, leadTimeMinimoSegundos: 120 };

export function detectarDegradacion(input: DetectorInput, config: Partial<DetectorConfig> = {}): DetectorResult {
  const cfg = { ...DEFAULTS, ...config };
  if (input.segundosHastaProximaDivergencia < cfg.leadTimeMinimoSegundos) return { degradado: false };
  if (input.etaBaselineSegundos <= 0) return { degradado: false };
  const severidadPct = (input.etaEnVivoSegundos - input.etaBaselineSegundos) / input.etaBaselineSegundos;
  return severidadPct > cfg.umbralDegradacionPct ? { degradado: true, severidadPct } : { degradado: false };
}
```

- [ ] **Step 5: Run test, verify PASS** — mismo comando → PASS (4/4).

- [ ] **Step 6: Commit** — `git add packages/traffic-condition-detector && git commit -m "feat(eco-routing): traffic-condition-detector (degradación de ETA con lead time)"`

---

## Task 2: `packages/route-alternatives-evaluator`

Rankea alternativas por emisión (vía carbon-calculator) y elige la de mínima emisión que respeta el guardrail de ETA.

**Files:**
- Create: `packages/route-alternatives-evaluator/{package.json,tsconfig.json,vitest.config.ts}`
- Create: `packages/route-alternatives-evaluator/src/index.ts`
- Test: `packages/route-alternatives-evaluator/src/index.test.ts`

**Interfaces:**
- Consumes: `@booster-ai/carbon-calculator` (`calcularEmisionesViaje` — ver su firma real en `packages/carbon-calculator/src`); el tipo `RouteSuggestion` de `apps/api/src/services/routes-api.ts` (distancia, duración con tráfico, `fuelLiters` nullable).
- Produces:
  ```ts
  export interface AlternativaInput {
    polyline: string;
    distanciaKm: number;
    duracionSegundos: number;       // con tráfico
    fuelLitros: number | null;      // de Routes API FUEL_CONSUMPTION; null → estimar vía carbon-calculator
  }
  export interface EvaluadorInput {
    alternativas: AlternativaInput[]; // [0] = ruta actual (TRAFFIC_AWARE_OPTIMAL), resto alternativas
    fuelType: string;               // tipo_combustible del vehículo
    guardrailEtaPct: number;        // default 0.10
  }
  export type EvaluadorResult =
    | { tipo: 'ninguna_mejor' }
    | { tipo: 'recomendada'; polyline: string; deltaEtaSegundos: number; deltaCo2eKg: number };
  export function evaluarAlternativas(input: EvaluadorInput): EvaluadorResult;
  ```

- [ ] **Step 1: Scaffold** (igual patrón que Task 1; dependency `@booster-ai/carbon-calculator` en package.json).

- [ ] **Step 2: Write the failing test** (cubre: elige la de menor CO₂e dentro del guardrail; descarta una más limpia pero que viola el guardrail de ETA; `ninguna_mejor` si la actual ya es la mejor; usa fuelLitros si viene, estima si null). Mockear `calcularEmisionesViaje` para determinismo.
```ts
// packages/route-alternatives-evaluator/src/index.test.ts
import { describe, expect, it, vi } from 'vitest';
vi.mock('@booster-ai/carbon-calculator', () => ({
  // emisión = litros * 2.68 (placeholder determinista para el test)
  calcularEmisionesViaje: ({ fuelLitros }: { fuelLitros: number }) => ({ kgCo2e: fuelLitros * 2.68 }),
}));
import { evaluarAlternativas } from './index.js';

const actual = { polyline: 'A', distanciaKm: 10, duracionSegundos: 1200, fuelLitros: 2.0 };
it('elige la alternativa de menor CO2e dentro del guardrail de ETA', () => {
  const r = evaluarAlternativas({
    alternativas: [actual, { polyline: 'B', distanciaKm: 11, duracionSegundos: 1260, fuelLitros: 1.5 }],
    fuelType: 'diesel', guardrailEtaPct: 0.10,
  });
  expect(r).toEqual({ tipo: 'recomendada', polyline: 'B', deltaEtaSegundos: 60, deltaCo2eKg: expect.closeTo((1.5 - 2.0) * 2.68, 5) });
});
it('descarta una alternativa más limpia pero que viola el guardrail de ETA (+10%)', () => {
  const r = evaluarAlternativas({
    alternativas: [actual, { polyline: 'C', distanciaKm: 9, duracionSegundos: 1400, fuelLitros: 1.0 }],
    fuelType: 'diesel', guardrailEtaPct: 0.10,
  });
  expect(r).toEqual({ tipo: 'ninguna_mejor' });
});
it('ninguna_mejor si la actual ya es la de menor emisión', () => {
  const r = evaluarAlternativas({
    alternativas: [actual, { polyline: 'D', distanciaKm: 12, duracionSegundos: 1260, fuelLitros: 3.0 }],
    fuelType: 'diesel', guardrailEtaPct: 0.10,
  });
  expect(r).toEqual({ tipo: 'ninguna_mejor' });
});
```

- [ ] **Step 3: Run test, verify FAIL.**

- [ ] **Step 4: Implement** — para cada alternativa, resolver emisión (usar `fuelLitros` si no-null, sino estimar con `calcularEmisionesViaje` por distancia+fuelType); filtrar las que excedan `actual.duracionSegundos * (1 + guardrailEtaPct)`; entre las que pasan el guardrail (incluida la actual), elegir la de menor CO₂e; si la ganadora es la actual ([0]) → `ninguna_mejor`; si no, devolver `recomendada` con deltas (alternativa − actual). Validar inputs con Zod al entrar.

- [ ] **Step 5: Run test, verify PASS.**

- [ ] **Step 6: Commit** — `feat(eco-routing): route-alternatives-evaluator (emisiones + guardrail ETA)`.

---

## Task 3: Domain schema + tabla `sugerencias_ruta`

**Files:**
- Create: `packages/shared-schemas/src/domain/route-suggestion.ts` + export en el index del domain
- Create: `apps/api/drizzle/0046_sugerencias_ruta.sql` + `apps/api/drizzle/down/0046_sugerencias_ruta.down.sql` + entry en `apps/api/drizzle/meta/_journal.json`
- Modify: `apps/api/src/db/schema.ts` (agregar `routeSuggestions = pgTable('sugerencias_ruta', {...})`)
- Test: `packages/shared-schemas/src/domain/route-suggestion.test.ts`

**Interfaces:**
- Produces: `routeSuggestionSchema` (Zod) + tipo `RouteSuggestion`; tabla Drizzle `routeSuggestions`. Columnas (español): `id uuid pk`, `viaje_id uuid fk viajes`, `emitida_en timestamptz`, `polyline_alternativa text`, `delta_eta_segundos integer`, `delta_co2e_kg numeric(10,3)`, `eta_baseline_segundos integer`, `posicion_lat numeric(9,6)`, `posicion_lng numeric(9,6)`, `entregada boolean default false`, `adoptada boolean nullable`, `evaluada_adopcion_en timestamptz nullable`, `creado_en`, `actualizado_en`.

- [ ] **Step 1: Write the failing test** del schema canónico (parse válido + rechazo de lat/lng fuera de rango + delta negativo permitido).
- [ ] **Step 2: Run, FAIL.**
- [ ] **Step 3: Implement** `route-suggestion.ts` (Zod), export en domain index; escribir la migration SQL (CREATE TABLE + índices `idx_sugerencias_ruta_viaje`, `idx_sugerencias_ruta_adopcion_pendiente WHERE adoptada IS NULL`); el `.down.sql` (`DROP TABLE`); agregar al journal; agregar la tabla Drizzle en `schema.ts` espejando el domain.
- [ ] **Step 4: Run** `pnpm --filter @booster-ai/shared-schemas test` + `pnpm --filter @booster-ai/api typecheck` → PASS. Correr el guard de migraciones del repo si existe (`scripts/repo-checks/` o el pre-commit de migration-safety).
- [ ] **Step 5: Commit** — `feat(eco-routing): tabla sugerencias_ruta + domain schema`.

---

## Task 4: Publicar posición del PWA a un topic

Hoy el PWA reporta posición solo al api. Para el servicio event-driven, publicar al topic `driver-positions`.

**Files:**
- Modify: el handler que recibe la posición del PWA (`apps/api/src/routes/vehiculos.ts` o el endpoint de `driver-position-reporter`) — publicar al topic tras persistir.
- Create: `apps/api/src/services/publish-driver-position.ts` (+ test) — wrapper fire-and-forget (patrón de `apps/telemetry-processor/src/publish-safety-events.ts`).
- Modify: `infrastructure/messaging.tf` — topic `driver-positions` + subscription `driver-positions-eco-routing-sub` (con dead_letter_policy, patrón existente).

**Interfaces:**
- Produces: payload del topic = `{ viajeId, vehiculoId, lat, lng, registradoEn }` validado con `positionSchema` (shared-schemas geo) + viajeId.

- [ ] **Step 1: Write the failing test** de `publish-driver-position` (publica el mensaje al topic correcto; fire-and-forget: si el publish falla, NO lanza).
- [ ] **Step 2: FAIL.** **Step 3: Implement** (mock de PubSub). **Step 4: PASS.**
- [ ] **Step 5:** cablear el publish en el handler de posición (solo si el viaje está `en_proceso`); agregar el topic + sub en `messaging.tf` (`terraform fmt` + `validate`).
- [ ] **Step 6: Commit** — `feat(eco-routing): publica posición del PWA al topic driver-positions`.

---

## Task 5: `apps/eco-routing-service` — scaffold + consumer de posición + baseline ETA

**Files:**
- Create: `apps/eco-routing-service/{package.json,tsconfig.json,Dockerfile,src/main.ts,src/config.ts}`
- Create: `apps/eco-routing-service/src/trip-state-store.ts` (+ test) — estado por viaje (Redis o in-memory con TTL): posición, ETA baseline, última sugerencia/cooldown.
- Create: `apps/eco-routing-service/src/position-consumer.ts` (+ test) — Pub/Sub consumer de `driver-positions` + telemetry-events (filtra a viajes `en_proceso`), valida Zod, actualiza el store, dispara la evaluación (Task 6) con throttle.

**Interfaces:**
- Consumes: el topic `driver-positions` (Task 4) + `telemetry-events`; `positionSchema`.
- Produces: `TripStateStore` con `getEstado(viajeId)`, `setPosicion(...)`, `setBaseline(...)`, `puedeSugerir(viajeId, cooldownSegundos)`.

- [ ] **Steps (TDD):** test del store (cooldown: `puedeSugerir` false dentro del cooldown, true después); test del consumer (mensaje válido → actualiza store; payload inválido → Zod rechaza + log, no crashea; viaje no `en_proceso` → ignora). Implementar; PASS. Baseline ETA: al ver el primer evento de un viaje, computar baseline vía `routes-api.ts` (la ruta `ecoRoutePolylineEncoded` del trip) y guardarla. Commit por sub-componente.

---

## Task 6: Loop de evaluación (orquestación)

**Files:**
- Create: `apps/eco-routing-service/src/evaluar-reruteo.ts` (+ test) — el orquestador que une todo.

**Interfaces:**
- Consumes: `detectarDegradacion` (Task 1), `evaluarAlternativas` (Task 2), `computeRoutes` de `routes-api.ts` (Google Routes API v2), el store (Task 5), el repo de `sugerencias_ruta` (Task 3).
- Produces: `evaluarReruteo(viajeId): Promise<RouteSuggestion | null>` — best-effort.

- [ ] **TDD:** test (con Routes API + carbon mockeados): degradado + alternativa mejor → persiste `sugerencias_ruta` + retorna la sugerencia; Routes API caído → retorna null sin crashear (best-effort); cooldown activo → no evalúa; `ninguna_mejor` → no persiste. Implementar: leer estado → `computeRoutes(posición→destino, computeAlternatives=true, TRAFFIC_AWARE_OPTIMAL)` → `detectarDegradacion` → si degradado, `evaluarAlternativas` → si `recomendada`, persistir + marcar cooldown + devolver. Span OTel + log estructurado. PASS. Commit.

---

## Task 7: Entrega por voz al PWA

**Files:**
- Create: `apps/eco-routing-service/src/entregar-sugerencia.ts` (+ test) — encola el evento de sugerencia al canal push/SSE del conductor.
- Create: `apps/web/src/services/eco-route-suggestion.ts` (+ test) — recibe la sugerencia, arma el texto ("En ~N min hay congestión; conviene la alternativa — ahorrás ~X min y ~Y kg CO₂"), y la **habla** reusando `coaching-voice.ts` (mismo opt-in toggle).
- Modify: el componente del conductor (donde vive `CoachingVoicePlayer`) para mostrar la alternativa en el mapa.

**Interfaces:**
- Consumes: el canal push/SSE existente; `coaching-voice.ts` (`createCoachingVoice().play(text)` + `loadAutoplayPreference`).
- Produces: el evento de sugerencia `{ viajeId, texto, polylineAlternativa, deltaEtaSegundos, deltaCo2eKg }`.

- [ ] **TDD:** test del armado del texto (formato + redondeos) + que respeta el opt-in (mute → no habla); test del backend (encola al canal correcto). Implementar. PASS. Commit.

---

## Task 8: `adoption-resolver` (medición de adopción post-viaje)

**Files:**
- Create: `apps/eco-routing-service/src/adoption-resolver.ts` (+ test) — al cerrarse un viaje (`entregado`), para cada `sugerencias_ruta` pendiente (`adoptada IS NULL`), correlaciona el path real (telemetría del trip) vs `polyline_alternativa` → setea `adoptada` + (si adoptada) confirma `delta_co2e_kg` como ahorro.
- Create: `packages/route-alternatives-evaluator/src/polyline-match.ts` (+ test) — helper puro: ¿el path real siguió la polyline alternativa? (overlap ≥ umbral).
- Create: ruta interna trigger en el servicio (invocada por el evento `entregado` o un Cloud Scheduler de barrido).

**Interfaces:**
- Consumes: la telemetría del trip (posiciones), `sugerencias_ruta`, `polyline-match`.
- Produces: `resolverAdopcion(viajeId)`.

- [ ] **TDD:** test de `polyline-match` (path real ≈ alternativa → match; path real = ruta original → no match); test del resolver (setea `adoptada` + `evaluada_adopcion_en`). Implementar. PASS. Commit.

---

## Task 9: Deploy + observabilidad + runbook

**Files:**
- `apps/eco-routing-service/Dockerfile` (patrón de otra app Node, ej. `apps/telemetry-processor/Dockerfile`).
- `cloudbuild.production.yaml` — agregar build/deploy del servicio (patrón existente).
- `infrastructure/compute.tf` — módulo `cloud-run-service` para `eco-routing-service` (ingress interno, min-instances según carga, secrets: `GOOGLE_ROUTES_API_KEY`, DB, Redis).
- `infrastructure/monitoring.tf` — alertas (consumer lag de la subscription, error rate, Routes API quota).
- `docs/runbooks/service-eco-routing.md` (patrón de los runbooks de #534).

- [ ] **Steps:** Dockerfile + `docker build` local OK; entry en cloudbuild; módulo TF (`terraform fmt` + `validate`); alertas TF; runbook; commit. (Deploy real = owner: `terraform apply` + el primer release.)

---

## Self-Review

**1. Spec coverage:** trigger (T6 via routes-api) ✓ · criterio emisiones-guardrail (T2) ✓ · anticipatorio/lead-time (T1) ✓ · voz advisory (T7) ✓ · arquitectura B servicio+packages (T5/T1/T2) ✓ · posición vía topic (T4) ✓ · opt-in mismo toggle (T7) ✓ · adopción incluida (T8) ✓ · Google Maps fundamental (T6 reusa routes-api) ✓ · persistencia sugerencias_ruta (T3) ✓ · consent/cooldown (T5/T7) ✓ · error handling best-effort (T5/T6) ✓ · testing TDD (todas) ✓ · deploy/runbook (T9) ✓. Sin gaps.

**2. Placeholder scan:** Tasks 1-3 con código/TDD completo; Tasks 4-9 con estructura + comportamiento explícito (sin "TBD"/"add error handling" — cada paso dice qué hace). Antes de ejecutar cada task, el implementador expande los pasos TDD al detalle del patrón del repo. **Nota de honestidad:** Tasks 5-9 están a nivel de task-spec (no cada línea de boilerplate), porque dependen de patrones del repo que el subagente fresco leerá (Dockerfile, módulo cloud-run, consumer Pub/Sub). El core determinista (T1-T2) está con código completo.

**3. Type consistency:** `DetectorInput/Result` (T1), `AlternativaInput/EvaluadorResult` (T2), `RouteSuggestion`/columnas `sugerencias_ruta` (T3), payload `driver-positions` (T4) — nombres consistentes entre tasks. `evaluarReruteo` (T6) consume las firmas de T1/T2/T3 tal como se declaran.

## Calibración (del spec §11, a fijar en ejecución/datos reales)
`umbralDegradacionPct` (0.15), `leadTimeMinimoSegundos` (120), `guardrailEtaPct` (0.10), cooldown, throttle de Routes API. Defaults puestos; ajustar con datos.
