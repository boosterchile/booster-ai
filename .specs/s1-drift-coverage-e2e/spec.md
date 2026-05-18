# Spec: s1-drift-coverage-e2e

- Author: Felipe Vicencio (con agent-rigor)
- Date: 2026-05-18
- Status: **Approved** (PO 2026-05-18, v2 post devils-advocate P0+P1+P2)
- Linked: [`../production-readiness/spec.md`](../production-readiness/spec.md), [`../production-readiness/roadmap.md`](../production-readiness/roadmap.md) §S1, [`../stubs-decision/spec.md`](../stubs-decision/spec.md), [`../../docs/adr/043-drift-schema-domain.md`](../../docs/adr/043-drift-schema-domain.md), [`./review.md`](./review.md)

---

## 1. Objective

Ejecutar el primer sprint post-housekeeping del plan production-readiness: aplicar la **metodología del ADR-043** para resolver el drift estructural entre `packages/shared-schemas/src/domain/` (inglés) y `apps/api/src/db/schema.ts` (español canónico), implementar `packages/trip-state-machine` como deliverable de la sub-spec `stubs-decision` **con flag obligatorio de activación**, subir branches coverage de `apps/api` del 75.01% actual al gate de 80% **con lista nombrada de error paths reales**, e introducir los primeros 4 specs Playwright + a11y en CI por PR con sharding (cumple SC-29 ≤10 min p95).

Usuario directo: Felipe Vicencio (solo-dev). Beneficiarios derivativos: cualquier futuro consumidor del domain canónico (sea `apps/api`, `apps/web`, o microservicios extraídos en S3/S4) y los usuarios finales que reciben mejor cobertura de tests + a11y en flujos críticos.

## 2. Why now

Sprint S0 cerró ADR-043 (metodología) pero **no su implementación**. El roadmap §S1 lo asigna como primer entregable. Razones para no postergar:

- **Bloquea S3 y S4** (microservicios extraction): si `notification-service` / `matching-engine` / `document-service` se extraen sobre un domain con drift, hereda el bug al boundary inter-servicio donde es más costoso revertir.
- **Branches coverage 75.01%** vive bajo el gate CI 75% solo por accidente — cualquier PR nuevo que baje 1 punto reactiva el gate. Subir a 80% da margen y cubre SC-2 maestra.
- **Playwright en CI por PR** cierra SC-15+SC-16 parciales (4 de 8 flujos) y permite que S2 cierre los 4 restantes.
- **Sub-spec stubs-decision** (Approved 2026-05-17) asignó `packages/trip-state-machine` a S1 porque resuelve estructuralmente la fuente del drift (estados de trip dispersos en services en vez de declarativos en una machine).

## 3. Success criteria

Cada criterio es comprobable de forma binaria. La spec se considera **Implementada** cuando todos están marcados.

### 3.0 Gate stop-the-line (cubre O-1 review)

- [ ] **SC-S1.0** (bloqueante, **NUEVO post-devils-advocate**) — Tras T1.1 (inventario), si **N divergencias > 10** o **≥1 Clase C** detectada, el sprint se **pausa** y produce un replan formal antes de iniciar T1.2. El replan reduce scope (típicamente: difiere Bloque D a S2, o split S1a/S1b). PO firma el replan antes de proceder. **Sin este SC se cumple si N ≤ 10 y 0 Clase C.**

### 3.1 Drift schema/domain — implementación ADR-043

- [ ] **SC-S1.1** — Inventario completo de divergencias `domain/*` ↔ `db/schema.ts` producido en `.specs/s1-drift-coverage-e2e/inventory.md` con clasificación Clase A (TS-only) / B (breaking API → flag + sunset) / C (cambio SQL → ADR de excepción).
- [ ] **SC-S1.2** — Migration breaking-safe (siguiente número drizzle libre, post-0037) mergeada cuando aplique Clase C. Si no hay Clase C tras inventario, este SC se marca N/A documentado.
- [ ] **SC-S1.3** — Refactor de consumers Clase A mergeado: `packages/shared-schemas/src/domain/` alineado a SQL canónico (español); búsqueda + reemplazo en consumers + tests verdes. Sin transformaciones de string en boundary HTTP.
- [ ] **SC-S1.4** — Clase B (si hay): ADR de excepción por cada divergencia + flag `DOMAIN_ALIGNMENT_<X>_ACTIVATED` declarado en `apps/api/src/config.ts` + period transición con doble-emit.
- [ ] **SC-S1.4b** (**NUEVO post-O-12**, condicional a Clase C) — Si T1.4 ejecuta (hay Clase C que añade tabla nueva), la migration incluye **RLS policy explícita** en el mismo SQL + integration test que verifica RLS activo. No se difiere a S2.

### 3.2 Trip state machine package

- [ ] **SC-S1.5** — `packages/trip-state-machine` implementado con XState v5. Estados canonical de la machine (subset documentado de `db/schema.ts` `tripStatusEnum`):

  <!-- canonical-source: apps/api/src/db/schema.ts:tripStatusEnum -->
  - `borrador`
  - `asignado`
  - `en_proceso`
  - `entregado`
  - `cancelado`

  Coverage ≥80/80/80/80.
- [ ] **SC-S1.6** — `apps/api/src/services/*` que mutan estado de trip consumen la state machine **detrás de flag** (cubre O-5 review). Lista IN-scope de call sites: `liquidar-trip.ts`, `confirmar-entrega-viaje.ts`, `asignar-conductor-a-assignment.ts`. Cualquier otro call site queda en `.specs/s1-drift-coverage-e2e/followup-state-machine-migration.md` con owner + sprint objetivo (S2 o S3).
- [ ] **SC-S1.6b** (**NUEVO post-O-5**) — Flag `TRIP_STATE_MACHINE_ACTIVATED` declarado en `apps/api/src/config.ts` (default `true` en dev, `false` en staging primer deploy). Services mantienen branch legacy (string comparison) + branch machine durante 1 sprint. Tras S2 con telemetría limpia, flag OFF rama legacy → cleanup en S3.

### 3.3 Branches coverage `apps/api` ≥ 80%

- [ ] **SC-S1.7a** (split post-O-2) — Lista **nombrada** de ≥10 error paths reales en `.specs/s1-drift-coverage-e2e/coverage-targets.md` producida **antes** de T1.9 (no después). Cada path: archivo + línea + tipo (validation/race/4xx/5xx). Si lista <10 paths, T1.9 no arranca.
- [ ] **SC-S1.7b** (mecánico) — `apps/api/coverage/coverage-summary.json` muestra `total.branches.pct ≥ 80`.
- [ ] ~~SC-S1.8~~ **ELIMINADO post-O-6** (era "tests no bajan otros ejes" — ausencia de regresión, no valor). Monitoreo de regresión movido a §9 risks como mitigación operacional.

### 3.4 Playwright + a11y en CI por PR

- [ ] **SC-S1.9** — 4 specs Playwright críticos producidos en `apps/web/e2e/`:
  - `shipper-publica-carga.spec.ts`
  - `carrier-acepta-oferta.spec.ts`
  - `login-universal-rut-clave-numerica.spec.ts`
  - `public-tracking-via-link.spec.ts`
- [ ] **SC-S1.10** — Cada spec incluye assertions axe-core (`@axe-core/playwright` ya instalado). **0 violations P0/P1** al merge.
- [ ] **SC-S1.11** — `.github/workflows/ci.yml` actualizado para correr Playwright + axe-core headless en PR (no solo en `e2e-staging.yml` post-deploy).
- [ ] **SC-S1.12** (reformulado post-O-8) — Sharding + path-filter en CI. Wall-clock medido sobre **≥10 PRs** post-merge de T1.11: p95 ≤10 min. Si S1 no genera 10 PRs, criterio se difiere a `SC-S1.12-followup` para S2 con tracking en CURRENT.md. **Dry-run pre-merge** en branch fake antes del PR a `main` para tener al menos 1 estimación temprana.

### 3.5 Checkpoint + hygiene

- [ ] **SC-S1.checkpoint** (**NUEVO post-O-4**) — **Día 5 del sprint**: revisión de progreso. Si Bloques A+B no están en `Implemented`, Bloque D (Playwright) se difiere a S2 (split S1a / S1b). Decisión documentada en `.specs/s1-drift-coverage-e2e/checkpoint-day-5.md`. PO firma split si aplica.
- [ ] ~~SC-S1.13~~ **ELIMINADO post-O-7** (era citar sub-spec ya Approved — decorativo).
- [ ] **SC-S1.14** — CURRENT.md actualizado al cierre con pickup point S2 + cita formal del sub-spec stubs-decision.

## 4. User-visible behaviour

### 4.1 Para el agente / Felipe (developer experience)

- Domain canónico Zod (`@booster-ai/shared-schemas`) usa identifiers y valores consistentes con SQL.
- State transitions de trip se declaran (`packages/trip-state-machine`), no se imperan — pero activables/desactivables via flag para rollback runtime.
- CI bloquea PR si branches coverage api baja debajo de 80%.
- CI corre Playwright + a11y en PR de `apps/web` — feedback temprano vs descubrir regresiones post-deploy en staging.
- **Stop-the-line activo** post-T1.1: si inventario es grande, el sprint pausa antes de explotar.

### 4.2 Para usuarios finales (indirecto)

- Sin cambios visibles si el inventario S1 es 100% Clase A (TS-only). Si hay Clase B, los endpoints afectados retornan doble-emit durante transición + sunset documentado.
- A11y mejora medible: 4 flujos críticos sin violations P0/P1 — usuarios con screen readers o navegación por teclado tienen experiencia confiable.

## 5. Out of scope

- **Cierre completo SC-15/SC-16** (los 8 flujos Playwright): solo los 4 críticos en S1. Los otros 4 en **S2**.
- **D11 T8-T12** (stakeholder geo aggregations): en **S2**.
- **Ejecución de eliminación de stubs** `ai-provider` / `document-indexer` / `ui-components` parcial: en **S2**.
- **Microservicios extraction**: S3 / S4.
- **RLS lint extension** general: S2. **Excepción**: si T1.4 ejecuta (Clase C añade tabla), SC-S1.4b cubre RLS de esa tabla específica.
- **`packages/trip-state-machine` consumido por `apps/web`**: en S1 solo `apps/api` lo consume.
- **Performance budget enforcement en CI** (más allá de tiempo wall-clock): SC-18 es S8.
- **Cleanup del branch legacy** (string comparisons) en services post-machine: S3 (tras S2 con telemetría limpia + flag OFF estable).
- **Runners Playwright distribuidos cloud** (cubre O-13): se evalúa solo si wall-clock CI con 8 specs (post-S2) >12 min. Umbral declarado.

## 6. Constraints

### 6.1 Performance

- **CI por PR ≤10 min p95 wall-clock** sobre ≥10 PRs (cubre SC-29 maestra). Si Playwright + a11y suben sobre umbral, sharding/path-filter primero; runners distribuidos cloud solo si umbral 12 min cruzado con 8 specs.

### 6.2 Compatibilidad / migración

- Sin breaking changes a consumers externos (`www.boosterchile.com`, integraciones externas) en este sprint. Toda divergencia Clase B requiere doble-emit + sunset documentado.
- Migration drizzle (Clase C) sigue pipeline existente + journal integrity guard (ADR-044) + down-migration testeada + RLS policy explícita si añade tabla.
- Postgres local 16 para integration tests.

### 6.3 Coverage / calidad

- `apps/api` branches ≥80% al cierre (hoy 75.01%), respaldado por lista nombrada de ≥10 error paths reales.
- Otros ejes `apps/api` ≥80 actuales (monitoreado como risk operacional, no SC).
- `packages/trip-state-machine` ≥80/80/80/80 al cierre.
- Sin `any` en código de producción nuevo.
- Tests añadidos verifican comportamiento real (Prove-It pattern).

### 6.4 Estilo / convenciones

- Conventional commits + commitlint.
- Pre-commit hooks (gitleaks + biome + check-adr-numbering) no se debilitan.
- XState v5 (vigente al 2026-05-18).

### 6.5 Disciplina solo-dev

- **Día 0 del sprint**: solo planning + lectura (cubre O-10 review). Ejecución arranca día 1.
- Pausa autoimpuesta si sesión continua >3h.
- Cooling-off entre sprints (skill 20 §Solo-Developer Adaptation).

## 7. Approach

### 7.0 Orden de ejecución obligatorio (cubre O-3 review)

Bloques A y B son **secuenciales**. Bloque C y D son paralelos a B desde el día indicado:

```
Día 0      → planning + lectura (no ejecución)
Día 1      → T1.1 (inventario)
Post-T1.1  → SC-S1.0 gate: stop-the-line si N > 10 o Clase C ≥ 1
Día 2-3    → T1.2 + T1.3 + T1.4 (resolución según clases) + T1.4b (RLS si Clase C)
Día 3      → T1.5 (tests integration drift)
Día 4-5    → T1.6 (XState scaffold) + T1.7 (refactor mínimo con flag)
Día 3-5    → T1.8 + T1.9 (coverage, paralelo a B)
Día 1-5    → T1.10 + T1.11 + T1.12 (Playwright + CI, paralelo desde día 1)
Día 5      → SC-S1.checkpoint (decisión split S1a/S1b si Bloques A+B no Implemented)
Día 6-8    → continuar tareas pendientes según checkpoint
Día 8-12   → T1.13 + T1.14 (cierre)
```

### 7.1 Bloque A — Drift schema/domain (T1.1 → T1.5)

1. **T1.1 — Inventario automatizado** (~80 LOC script + output): script `scripts/repo-checks/drift-inventory.mjs` que diffea identifiers y enum values entre `packages/shared-schemas/src/domain/*.ts` y `apps/api/src/db/schema.ts`. Output a `.specs/s1-drift-coverage-e2e/inventory.md` con clasificación A/B/C. **Gate SC-S1.0 evaluado tras este task.**
2. **T1.2 — Resolución Clase A** (~200 LOC base; replan si N > 10): refactor `domain/trip.ts` + consumers alineados a SQL canónico.
3. **T1.3 — Resolución Clase B** (~150 LOC + ADR por flag): si hay divergencias breaking API, flag + doble-emit + sunset.
4. **T1.4 — Resolución Clase C** (~migración + ~50 LOC): si requiere cambio SQL, migration con backfill + down-migration + ADR.
5. **T1.4b — RLS policy en Clase C** (si T1.4 añade tabla): policy en mismo SQL + integration test.
6. **T1.5 — Tests integration sobre infra T1+T2**: ≥3 tests verificando los 3 patterns ADR-043 §4.

### 7.2 Bloque B — Trip state machine (T1.6 → T1.7)

7. **T1.6 — `packages/trip-state-machine` scaffold** (~150 LOC src + 100 LOC tests): XState v5 machine con 5 estados + transitions + guards básicos. Export TypeScript types.
8. **T1.7 — Refactor mínimo `apps/api/src/services/`** (~80 LOC delta + flag wiring): los **3 call sites IN-scope** (`liquidar-trip.ts`, `confirmar-entrega-viaje.ts`, `asignar-conductor-a-assignment.ts`) consumen la machine **detrás de flag `TRIP_STATE_MACHINE_ACTIVATED`**. Branch legacy preservado.
   - **OUT-of-scope** explícito (queda en `followup-state-machine-migration.md`): cualquier otro service que mute trip state (e.g. `reportar-incidente.ts`, `eco-route-preview.ts`, etc.). Owner: S2 o S3 según prioridad.

### 7.3 Bloque C — Coverage branches `apps/api` (T1.8 → T1.9)

9. **T1.8 — Identificar branches sin cobertura + producir lista nombrada** (~30 LOC script + ~50 LOC doc): grep coverage report v8 para identificar líneas con branches descubiertas; producir `.specs/s1-drift-coverage-e2e/coverage-targets.md` con ≥10 paths reales (archivo + línea + tipo). **Gate SC-S1.7a evaluado tras este task.**
10. **T1.9 — Tests añadidos cubriendo la lista nombrada** (~250 LOC): foco en error paths reales del coverage-targets.md.

### 7.4 Bloque D — Playwright + a11y + CI sharding (T1.10 → T1.13)

11. **T1.10 — 4 specs Playwright** (~400-500 LOC, ver O-9 mitigación): **pre-T1.10 spike (30 min)** para decidir auth (fixture compartido vs login real). Si extender fixture >50 LOC, sumar al estimado (~450-500 total). Cada spec con assertions axe-core.
12. **T1.11 — `ci.yml` actualizado** (~40 LOC): job Playwright + axe-core en PR.
13. **T1.12 — Sharding + path-filter** (~30 LOC): `dorny/paths-filter` o equivalente; Playwright `workers: N`. Dry-run en branch fake antes del merge a main.
14. **T1.13 — Wall-clock measurement post-merge**: tracking de ≥10 PRs post-T1.11; si <10, follow-up a S2.

### 7.5 Bloque E — Cierre (T1.14)

15. **T1.14 — CURRENT.md update + plan.md tasks DONE + pickup S2** (~50 LOC).

## 8. Alternatives considered

- **A. State machine custom (sin XState)** — Rechazada. ~2-3× más LOC, duplica librería madura.
- **B. Subir coverage gate de 75% a 80% sin tests reales** — Rechazada por CLAUDE.md §1 + §"Evidence over assumption".
- **C. Postergar drift hasta S3** — Rechazada. Drift más costoso en boundary inter-service.
- **D. Cubrir los 8 flujos Playwright en S1** — Rechazada. Plan v2 post devils-advocate: 4 ahora, 4 en S2.
- **E. Sharding via Playwright runners distribuidos cloud (umbral declarado)** — Rechazada hoy. **Umbral**: si wall-clock con 8 specs (post-S2) >12 min, evaluar en S2 o S3 con ADR.
- **F. Path-filter implementation** — Decisión durante T1.12.
- **G. No usar flag `TRIP_STATE_MACHINE_ACTIVATED` (cambio directo sin fallback)** — Rechazada post-O-5. Cambios runtime en path crítico (liquidar trip, confirmar entrega) requieren flag para rollback < 5 min sin revertir sprint.
- **H. Inventario sin gate stop-the-line** — Rechazada post-O-1. Sin gate, inventario grande explota silenciosamente y arrastra Bloque D a S2 sin declarar.

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Inventario revela divergencias Clase C (cambio SQL) | M | H | SC-S1.0 stop-the-line + RLS en SC-S1.4b si añade tabla. Si scope >>1 migration, sub-spec aparte. |
| Branches descubiertas son error paths irrelevantes (placebo trap) | M | M | SC-S1.7a (lista nombrada ≥10 paths reales) **antes** de T1.9. Sin lista no arranca T1.9. |
| Playwright en PR sube tiempo CI >10 min | H | M | Sharding desde el inicio + path-filter. Si igual >10 min, waiver max 12 min + ticket optimización. |
| `packages/trip-state-machine` rompe consumers críticos | M | H | Flag `TRIP_STATE_MACHINE_ACTIVATED` (SC-S1.6b) permite OFF en <5 min sin revertir. Branch legacy preservado 1 sprint. |
| Inventario drift muy ruidoso (false positives) | M | M | Script con allowlist de identifiers conocidos. |
| Integration tests no levantan Postgres en este Mac Mini | L | M | Verificación pre-build: `pg_isready -h localhost` + `psql -l`. |
| XState v5 breaking change frente a v4 | L | L | README del package linkea migration guide v5. |
| **Felipe burnout post-S0 intensivo** (subido a **H/M** post-O-10) | **H** | **M** | Día 0 = planning + lectura (no código). Pausa autoimpuesta si sesión >3h continua. Velocity check post-S2 (SC-28 maestra) — si <0.7×, replan S3-S13. |
| **OQ-S1.4 auth Playwright** materializa +50-100 LOC sin avisar | M | M | Spike 30 min pre-T1.10 con decisión; si fixture extend >50 LOC, estimado se sube a 450-500. |
| **Wall-clock CI medido con n=1 sample** (post-O-8) | M | L | SC-S1.12 reformulado a ≥10 PRs; si <10 en S1, follow-up S2 con tracking. |
| Regresión coverage en otros ejes (lines/functions/statements) post-tests añadidos | L | M | Monitoreo en cada PR (CI muestra coverage delta); no es SC, es alerta operacional. |
| **Drift vocabulary suave** ("refactor mínimo", "resto difiere") (post-O-11) | L | L | Lista explícita IN/OUT-scope de call sites en T1.7. Out-of-scope tiene followup doc con owner. |
| **Sin gate stop-the-line en T1.1** (resuelto por SC-S1.0 nuevo) | M | H | SC-S1.0 bloqueante. |

## 10. Test list

- **T-S1.0** (SC-S1.0): post-T1.1, si N > 10 o Clase C ≥ 1, replan documento existe + firmado PO.
- **T-S1.1** (SC-S1.1): `.specs/.../inventory.md` con tabla A/B/C + conteos.
- **T-S1.2** (SC-S1.2): si Clase C, `apps/api/drizzle/00NN_*.sql` mergeado + integration test + down-migration.
- **T-S1.3** (SC-S1.3): `grep -r "'delivered'\|'confirmed'\|'completed'\|'pending'" packages/shared-schemas/src/domain/` retorna 0 hits.
- **T-S1.4** (SC-S1.4): si Clase B, ADR + flag + endpoint doble-emit verificado.
- **T-S1.4b** (SC-S1.4b, condicional): si T1.4 añade tabla, migration incluye RLS policy + integration test RLS activo.
- **T-S1.5** (SC-S1.5): `pnpm --filter @booster-ai/trip-state-machine test:coverage` ≥80/80/80/80.
- **T-S1.6** (SC-S1.6): integration test ejerce trip lifecycle invocando 3 services IN-scope; followup doc existe para OUT-of-scope.
- **T-S1.6b** (SC-S1.6b): `apps/api/src/config.ts` declara `TRIP_STATE_MACHINE_ACTIVATED`; integration test con flag OFF usa branch legacy, con flag ON usa machine.
- **T-S1.7a** (SC-S1.7a): `.specs/.../coverage-targets.md` con ≥10 paths nombrados antes de T1.9.
- **T-S1.7b** (SC-S1.7b): `apps/api/coverage/coverage-summary.json total.branches.pct ≥ 80`.
- **T-S1.9** (SC-S1.9): 4 specs Playwright + e2e fixtures correctas.
- **T-S1.10** (SC-S1.10): axe-core 0 violations P0/P1.
- **T-S1.11** (SC-S1.11): job Playwright en `ci.yml`.
- **T-S1.12** (SC-S1.12): sharding + path-filter; ≥10 PRs p95 ≤10 min, o follow-up S2.
- **T-S1.checkpoint** (SC-S1.checkpoint): doc día 5 existe + decisión split (si aplica) firmada PO.
- **T-S1.14** (SC-S1.14): CURRENT.md modificado al cierre.

## 11. Rollout

- **Feature-flagged**: Clase B siempre detrás de flag. **`TRIP_STATE_MACHINE_ACTIVATED` obligatorio para Bloque B.**
- **Migration**: pipeline Drizzle + journal integrity (ADR-044) + down-migration + RLS policy si añade tabla.
- **Rollback general**:
  - Refactor Clase A: revert PR. Cero impacto runtime.
  - Clase B: flag OFF retoma legacy.
  - Clase C: down-migration + revert PR.
  - **`packages/trip-state-machine`**: flag `TRIP_STATE_MACHINE_ACTIVATED=false` retoma branch legacy en <5 min sin tocar consumers.
- **Monitoring post-merge**: error rate api 24h post-deploy de cada PR Clase B / SC-S1.6b. Si >2× baseline, flag OFF inmediato.

## 12. Open questions

Resueltas pre-approve:

- ~~**OQ-S1.1**~~ → resuelta: `drift-inventory.mjs` permanente en `scripts/repo-checks/` (utilidad cross-sprint).
- ~~**OQ-S1.4**~~ → resuelta: spike 30 min pre-T1.10; presupuesto adicional si extend fixture >50 LOC.

Quedantes (no bloquean approve):

- **OQ-S1.2** (T1.6): `@xstate/test` agregado o no — decisión durante T1.6.
- **OQ-S1.3** (T1.12): `dorny/paths-filter@v3` vs custom — decisión durante T1.12.

## 12.5 Hallazgos S1a → backlog S2/S3

Observaciones arquitectónicas descubiertas durante el sprint S1a que NO modifican el scope/SCs del sprint actual pero **requieren visibilidad cuando se planifique S2/S3**. Documentadas acá (no en discovery docs sueltos) para que sean encontradas al hacer `/spec` de sprints posteriores.

### Hallazgo H-S1a-1: Zod schemas no enforced en runtime

**Origen**: Discovery T1.2 sobre `tripEventTypeSchema` (2026-05-18).

**Observación**: `tripEventSchema` (parent que contiene `event_type: tripEventTypeSchema`) **tiene 0 llamadas `.parse()` / `.safeParse()` en runtime** en todo el código de `apps/`. El schema vive como **documentación declarativa del dominio**, no como validation activa.

Por extensión muy probable (no verificado, pendiente investigación S2/S3): otros 5-6 schemas Zod en `packages/shared-schemas/src/domain/` tienen la misma propiedad — fuente de verdad teórica que ningún boundary HTTP / DB writer / queue consumer / event handler ejecuta como gate.

**Implicación**:

Alinear TS↔SQL en S1a (objetivo ADR-043) **elimina drift estructural** pero **NO previene** que código emita payloads con valores inválidos en runtime. La defensa real contra drift de runtime es `.parse()` en boundaries (routes, DB writers, etc.).

Si el problema de "drift" que S1 pretende resolver incluye también "código que serializa enum values inventados" (caso real: hoy services emiten `conductor_asignado` / `incidente_reportado` sin que ningún schema los rechace), entonces S1a sola **no resuelve** ese problema — solo resuelve la parte declarativa.

**Acciones diferidas** (S2 o S3, decisión PO en `/spec` del sprint):

1. Auditar boundaries críticos (`apps/api/src/routes/**`, `apps/api/src/services/notify-*`, queue consumers Pub/Sub, etc.) para identificar dónde `.parse()` debería aplicarse.
2. Decidir política: ¿`safeParse()` en todo boundary HTTP que retorna trip events? ¿`parse()` en DB writers? ¿Validation en consumers Pub/Sub?
3. Si la respuesta es "sí, enforce runtime", producir sprint dedicado con scope: instrumentar boundaries + tests de boundary + alert si parse falla en prod.
4. Si la respuesta es "no, drift estructural es suficiente", documentar en ADR-043 que el dominio Zod es **doc-only by design** y eliminar la ambigüedad.

Este hallazgo NO bloquea S1a porque T1.2 cierra el caso 5 (alinear TS con SQL) que es deliverable del sprint. La pregunta "¿sirve para algo?" queda explícita para los siguientes sprints.

**Severidad**: M (estructural — afecta efectividad del drift-elimination program a partir de T1.2). **Owner**: PO. **Sprint objetivo**: S2 o S3.

### Cobertura parcial via T1.5 (2026-05-18)

T1.5 (`apps/api/test/integration/drift-alignment.integration.test.ts`) cubre **parcialmente** este hallazgo:

- **✅ Cubierto por T1.5**:
  - Pattern A (round-trip enum values): tests integration ejercen INSERT + SELECT real con los 2 valores agregados en T1.2 (`conductor_asignado`, `incidente_reportado`) sobre Postgres local. Validan que (a) el valor SQL es preservado en el read, (b) `tripEventTypeSchema.parse()` lo acepta post-T1.2. **Esto valida la alineación T1.2 end-to-end via el code path real, NO theater declarativo.**
  - Pattern B (identifier match Drizzle): test integration replica EXACTAMENTE el `db.select({...})` que hace `apps/api/src/routes/trip-requests-v2.ts` (mapping `event_type: tripEvents.eventType`). Detecta: rename de schema field, Drizzle mapping break, response shape regression.

- **❌ NO cubierto por T1.5** (sigue siendo backlog S2/S3):
  - **`.parse()` / `.safeParse()` en boundaries HTTP**: T1.5 ejerce el code path real pero NO instala validation Zod activa en route handlers. Un POST con `{event_type: 'foo_invalido'}` hoy aún sería aceptado por el endpoint y rechazado solo al INSERT por el constraint pgEnum (defensa en capa SQL, no TS).
  - **DB writers**: ningún service usa `.parse()` antes de INSERT.
  - **Queue consumers Pub/Sub**: idem.

**Conclusión**: T1.5 cierra la **primera mitad** de H-S1a-1 (guardrail funcional + verificación end-to-end de alineamientos T1.2 vía Drizzle). La **segunda mitad** (enforcement runtime en boundaries) sigue siendo trabajo S2/S3.

---

## 13. Decision log

- **2026-05-18** — Initial draft post-aprobación spec maestra v2 + cierre S0. 14 SCs + 14 tareas.
- **2026-05-18** — Devils-advocate pass: 5 P0 + 5 P1 + 3 P2 = 13 objeciones (review.md). PO aprobó aplicar **todas (P0 + P1 + P2)**.
- **2026-05-18** — **Aplicado v2**: SC-S1.0 stop-the-line gate (O-1); SC-S1.7 split en lista nombrada + métrico (O-2); §7.0 orden de ejecución secuencial A→B (O-3); estimación 8-12 días + SC-S1.checkpoint día 5 (O-4); flag `TRIP_STATE_MACHINE_ACTIVATED` obligatorio SC-S1.6b (O-5); SC-S1.8 eliminado (O-6); SC-S1.13 eliminado (O-7); SC-S1.12 reformulado a ≥10 PRs sample (O-8); OQ-S1.4 resuelta pre-approve (O-9); burnout subido a H/M con mitigación accionable (O-10); T1.7 lista IN/OUT-scope explícita + followup doc (O-11); SC-S1.4b RLS en Clase C (O-12); umbral runners distribuidos declarado en §5 + alt E (O-13).
- **2026-05-18** — **APPROVED por PO**. Pasa a fase PLAN.
- **2026-05-18** — Post-T1.1 + discovery T1.2: agregada §12.5 con Hallazgo H-S1a-1 (Zod schemas no enforced en runtime — observación arquitectónica que afecta efectividad del drift-elimination program; diferido a S2/S3 con owner PO).
