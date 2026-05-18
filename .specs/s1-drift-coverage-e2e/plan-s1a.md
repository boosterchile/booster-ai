# Plan S1a: drift schema/domain + trip-state-machine

- Plan maestro: [`plan.md`](./plan.md)
- Spec: [`spec.md`](./spec.md) (Approved v2)
- Status: **Approved** (PO 2026-05-18)
- Estimación lane Felipe: **5–7 días** (con buffer 20%)
- LOC estimado: ~700–900

---

## Scope

Bloques A + B de la spec maestra: aplicar metodología ADR-043 (inventario + resolución por clase A/B/C + tests integration) + scaffold `packages/trip-state-machine` con XState v5 + refactor mínimo de services con flag obligatorio.

**Cubre SCs**: SC-S1.0, SC-S1.1, SC-S1.2, SC-S1.3, SC-S1.4, SC-S1.4b, SC-S1.5, SC-S1.6, SC-S1.6b.

---

## Tasks (15+ atómicas; estructura recurrente para T1.2/T1.7)

### T1.1: Inventario automatizado drift schema/domain — con enforcement [DONE 2026-05-18]

- **Files**: `scripts/repo-checks/drift-inventory.mjs` (nuevo, perm) + `.specs/s1-drift-coverage-e2e/inventory.md` (output) + edit `.husky/pre-commit` (~5 LOC adicional check).
- **LOC estimate**: ~80 (script) + ~50 (markdown output con frontmatter `gate: PENDING_PO`) + ~5 (hook).
- **Depends on**: ninguna.
- **Acceptance** (T-S1.0, T-S1.1):
  - Script `node scripts/repo-checks/drift-inventory.mjs` produce `inventory.md` con tabla A/B/C y conteos.
  - **Script exit code 1** si `N divergencias > 10` o `Clase C ≥ 1`.
  - `inventory.md` tiene frontmatter YAML con `gate: PENDING_PO` por default; PO cambia a `gate: APPROVED_BY_PO <fecha>` tras revisar.
  - **Pre-commit hook** rechaza commits con scope `feat(domain)` si frontmatter dice `gate: PENDING_PO`.
- **Rollback**: revert PR. Script + hook update se eliminan.

### T1.0.heuristic-improvement (NO bloqueante, paralelo a T1.2+)

- **Files**: `scripts/repo-checks/drift-inventory.mjs` (mejora `normalizeForMatch` con mappings explícitos).
- **LOC estimate**: ~50 (script edit + tests).
- **Depends on**: T1.1 (post-triage, inventory-classification.md ya producido).
- **Acceptance**:
  - Mappings agregados (mínimo): `licenseClass ↔ licenciaClase`, `nivelCertificacion ↔ certificationLevel`, `telemetrySource ↔ tripEventSource`, `role ↔ membershipRole`, `transportistaStatus ↔ empresaStatus`.
  - Re-correr `node scripts/repo-checks/drift-inventory.mjs` post-mejora reduce `divergences_total` de 10 a ~3-4 (los falsos positivos H se resuelven).
  - Tests cubren los nuevos matches en `drift-inventory.test.mjs`.
- **Rollback**: revert PR. Script funcional sin mappings extra.

### T1.2: Caso 5 — `tripEventTypeSchema` agregar 2 valores SQL faltantes [DONE 2026-05-18]

> **Scope cerrado post-triage**: T1.2 cubre **solo el Caso 5** (aditivo, Clase A). El Caso 1 (`cargoRequestStatusSchema` TS-only-orphan, eliminación) se mueve a **T1.3 separado** por razones de bisectability + perfil de riesgo distinto (aditivo vs destructivo).

- **Files**:
  - `packages/shared-schemas/src/domain/trip-event.ts` (edit: agregar `conductor_asignado` + `incidente_reportado` al enum).
  - `packages/shared-schemas/src/all-schemas.test.ts` (edit: nuevo describe block `tripEvent` con tests).
  - `.specs/s1-drift-coverage-e2e/t1.2-discovery.md` (nuevo: discovery findings).
- **LOC estimate**: ~5 (trip-event.ts edit) + ~30 (tests) + ~50 (discovery doc) = ~85.
- **Depends on**: T1.1 mergeado (gate SC-S1.0 APPROVED) + Discovery T1.2 completado (0 exhaustive matching consumers, 0 runtime parse, 2 valores YA emitidos en services).
- **Acceptance** (T-S1.3 parcial):
  - `tripEventTypeSchema` tiene exactamente **14 valores** (12 actuales + `conductor_asignado` + `incidente_reportado`).
  - Test **whitelist guardrail** en `all-schemas.test.ts` que valida `tripEventTypeSchema.options` contra listado explícito de los **19 valores esperados** (17 existentes + 2 nuevos; detecta remociones silenciosas en refactors futuros).
  - Test que `tripEventTypeSchema.parse('conductor_asignado')` y `.parse('incidente_reportado')` no lanzan.
  - `pnpm --filter @booster-ai/shared-schemas test` verde.
- **Rollback**: revert PR. Cero impacto runtime (Zod no se usa en `.parse()` runtime — ver Hallazgo H-S1a-1 en spec §12.5).

### T1.3: Caso 1 — reclasificar `cargoRequestStatusSchema` a Clase I + annotación machine-readable [DONE 2026-05-18]

> **Scope revisado post-discovery (PO firma Opción C)**: T1.3 cambia de "eliminar orphan" a **"introducir Clase I taxonomía + annotar con tags machine-readable"**. Razón: discovery broader (8 puntos checklist, ver `.specs/s1-drift-coverage-e2e/t1.3-discovery.md`) reveló que `cargoRequestStatusSchema` NO es orphan abandonado — es scaffolding deliberado con `cargoRequestIdSchema` ya integrado como FK en `trip.cargo_request_id` + 4 ADRs vivos + 1 skill core. Eliminarlo rompía planes documentados vigentes.

- **Files**:
  - `packages/shared-schemas/src/domain/cargo-request.ts` (edit: annotación estructurada con `@drift-status intentional-pre-materialization` + `@clase I` + `@materialization-trigger` + `@depends-on` + `@review-on`).
  - `.specs/s1-drift-coverage-e2e/inventory-classification.md` (edit: §Nomenclatura agrega Clase I paralela a H; Caso 1 reclasificado de "A sub-tipo orphan" a instancia de Clase I; tabla baseline updated).
  - `.specs/s1-drift-coverage-e2e/plan-s1a.md` (este archivo: T1.3 acceptance revisada + T1.x.parser follow-up agregado).
- **LOC estimate**: +30 docstring annotación + ~80 classification updates = ~110.
- **Depends on**: T1.2 mergeado + T1.3-discovery mergeado (PR #295).
- **Acceptance** (T-S1.3 parcial):
  - `domain/cargo-request.ts` tiene annotación estructurada arriba de `cargoRequestStatusSchema` con los 4 tags machine-readable obligatorios (`@drift-status`, `@materialization-trigger`, `@depends-on`, `@review-on`).
  - `inventory-classification.md` §Nomenclatura tiene definición de Clase I paralela a A/B/C/H + distinción explícita vs H y B+.
  - Caso 1 reclasificado como instancia de Clase I (no Clase A).
  - Tabla baseline updated: 1 A (caso 5 done) + 1 I (caso 1 annotada) + 1 B+ diferido + 0 C + 6 H = **0 drift estructural accionable en S1a**.
  - `pnpm typecheck` + `pnpm test` verdes (sin cambios funcionales).
- **Rollback**: revert PR. Schema vuelve sin annotación; classification doc vuelve a "A sub-tipo orphan" tentativa.

### T1.x.parser (NO bloqueante, follow-up sprint posterior)

> Tracking del PO refinamiento #3 post-T1.3: parsing de `@drift-status` en el drift-inventory script para que ignore automáticamente schemas Clase I anotados.

- **Files**: `scripts/repo-checks/drift-inventory.mjs` (edit: agregar `parseTags()` que extrae `@drift-status` del comentario JSDoc precedente al `export const ... = z.enum(`) + `scripts/repo-checks/drift-inventory.test.mjs` (tests del parser).
- **LOC estimate**: ~60 (parser + tests).
- **Depends on**: T1.3 (la annotación existe), T1.0.heuristic-improvement (refactor del script ya planificado).
- **Acceptance**:
  - Script con flag `--respect-drift-status-tags` (default true) ignora schemas Zod precedidos por `/** @drift-status intentional-pre-materialization */` o `/** @drift-status <otro estado válido> */`.
  - Tests verifican: (a) parser extrae el tag correctamente; (b) `findDivergences()` skipea schemas Clase I; (c) sin el flag (override), aparecen igual en el inventory.
  - Re-correr `node scripts/repo-checks/drift-inventory.mjs` post-implementación reporta **0 divergences para Caso 1** (en lugar de los 1 actuales) + agrega contador `intentional_pre_materialization: N` al frontmatter.
- **Rationale para diferir**: T1.3 mantiene scope atómico. La annotación tiene valor inmediato como documentación + categoría aunque el script aún la ignore. El parser se prioriza cuando aparezca el siguiente caso I (no urgente con solo 1). Mismo patrón que T1.0.heuristic-improvement.
- **Rollback**: revert PR. Script vuelve a flaggear Clase I como divergencias (comportamiento actual).

### T1.4..T1.n: (placeholder) Resoluciones de divergencias adicionales Clase A/B/C si emergen

Post-T1.2/T1.3, si `T1.0.heuristic-improvement` revela alguna Clase A real adicional (e.g. el caso 4 `transportistaStatus` resulta tener valores propios diferenciados → A real, no H), se agrega T1.4+ siguiendo la misma plantilla atomizada. Baseline actual post-triage: solo Casos 5 y 1 son A reales; T1.4+ probablemente N/A.

### T1.3a..T1.3n: Resolución Clase B — una sub-task por divergencia breaking API

- **Plantilla recurrente**: una T1.3x por cada divergencia Clase B.
- **Files por sub-task**: `apps/api/src/config.ts` (flag) + 1-2 routes (doble-emit) + `docs/adr/04N-domain-alignment-<X>.md` + integration test.
- **LOC por sub-task**: ≤100 (cumple ≤100 LOC).
- **Depends on**: T1.1 + SC-S1.0 gate.
- **Acceptance por sub-task** (parte de T-S1.4):
  - Flag `DOMAIN_ALIGNMENT_<X>_ACTIVATED` declarado con `booleanFlag(false)` default.
  - Integration test verifica doble-emit con flag ON.
  - ADR mergeado.
- **Rollback por sub-task**: flag OFF retoma legacy.

### T1.4a..T1.4n: Resolución Clase C — una sub-task por cambio SQL

- **Plantilla recurrente**: una T1.4x por cada Clase C en `inventory.md`.
- **Files por sub-task**: `apps/api/drizzle/00NN_*.sql` + ADR + integration test.
- **LOC por sub-task**: variable; migration típica ~30 LOC + ADR ~80 + tests ~50 = ~160 (waiver: migration SQL no es prose, ADR es prose-only, tests son tests; cada archivo individual ≤100).
- **Depends on**: T1.1 + SC-S1.0 gate.
- **Acceptance por sub-task** (T-S1.2):
  - Migration mergeada + `pnpm --filter @booster-ai/api db:migrate` exitoso en staging.
  - Down-migration testeada.
  - ADR mergeado.
- **Rollback por sub-task**: down-migration + revert PR.

### T1.4b: RLS policy en tablas nuevas (condicional, cubre O-12)

- **Trigger**: si alguna T1.4x agrega tabla nueva.
- **Files**: mismo SQL de T1.4x correspondiente (RLS policy en `CREATE POLICY`) + integration test que verifica RLS activo.
- **LOC**: ~30 (policy + test).
- **Depends on**: T1.4x específico.
- **Acceptance** (T-S1.4b):
  - `SELECT * FROM <tabla>` desde rol no-superuser falla sin SET de tenant.
  - Integration test verifica row isolation cross-empresa.
- **Rollback (dos paths, cubre O-8)**:
  - (a) Drop policy + queda tabla sin RLS — **no es rollback de seguridad**, solo del bug de policy. Aplicable si datos in-flight son críticos.
  - (b) Down-migration completa de la tabla — solo si datos no críticos (verificado pre-rollback).
  - Acceptance test prueba ambas paths en staging.

### T1.5: Tests integration drift sobre infra T1+T2 [DONE 2026-05-18]

- **Files**: `apps/api/test/integration/drift-alignment.integration.test.ts` (nuevo).
- **LOC estimate** (adaptive, cubre O-7): `40 × patterns_aplicables` según inventario. Si 3 patterns (A+B+C), ~120 LOC. Si solo A, ~40 LOC. Anotado en `inventory.md` tras T1.1.
- **Depends on**: T1.2a..T1.2n + T1.3a..T1.3n + T1.4a..T1.4n (todos los aplicables, según inventario).
- **Acceptance** (T-S1.5):
  - Pattern A (round-trip enum) testeado si Clase A aplicó.
  - Pattern B (identifier match) testeado si Clase B aplicó.
  - Pattern C (flag transición / migration) testeado si Clase C aplicó.
- **Rollback**: revert PR.

### T1.6: `packages/trip-state-machine` scaffold con XState v5 [DEFERRED — sub-spec tripstate-alignment]

> **Diferida en T1.S1a.cierre 2026-05-18** ([`s1a-cierre.md`](./s1a-cierre.md) §6, Opción A recomendada — pendiente firma PO): el scope de S1a no alcanzó a Bloque B en la sesión de ejecución. Spec §SC-S1.5 ya nombra los 5 canonical states (`borrador, asignado, en_curso, entregado, cancelado`) → el scaffold NO está bloqueado por foundational; lo está por scope. Recomendación: ejecutar Bloque B en S2 (paralelo a S1b) + crear sub-spec `.specs/tripstate-alignment/` (pre-requisito de Bloque B, avance gated por readiness no calendario) para el boundary mapping (17 TS ↔ 5 machine ↔ 9 SQL).


- **Files**: `packages/trip-state-machine/{package.json,tsconfig.json,vitest.config.ts,src/index.ts,src/trip.machine.ts,src/trip.machine.test.ts,README.md}` (nuevos).
- **LOC estimate**: ~330 distribuidos (waiver: 4 archivos config + machine + tests + README, ninguno individual >120 LOC).
- **Depends on** (cubre O-6): T1.2 sub-task que toca `tripStatusEnum` está Implemented (típicamente T1.2a si inventario lo ordena así).
- **Acceptance** (T-S1.5 spec acceptance + T-S1.6 OQ-S1.2 trigger):
  - `pnpm --filter @booster-ai/trip-state-machine test:coverage` retorna ≥80/80/80/80.
  - Machine con 5 estados explícitos: `borrador`, `asignado`, `en_curso`, `entregado`, `cancelado`.
  - Tests cubren transitions válidas + intento de transitions inválidas + guards básicos.
  - README documenta XState v5 + link a migration guide v4→v5.
  - **OQ-S1.2 resuelta**: sección README "Testing strategy" declara sí/no `@xstate/test` con razón (cubre O-10 trigger).
- **Rollback**: revert PR; package se elimina; consumers no lo importan todavía.

### T1.7a: Wire flag `TRIP_STATE_MACHINE_ACTIVATED` + 1 service (liquidar-trip) [DEFERRED — sub-spec tripstate-alignment]

> **Diferida en T1.S1a.cierre 2026-05-18** — depende de T1.6.


- **Files**: `apps/api/src/config.ts` (+1 flag) + `apps/api/src/services/liquidar-trip.ts` (branch flag legacy/machine) + `apps/api/test/unit/liquidar-trip-machine-wiring.test.ts`.
- **LOC estimate**: ~100 (flag + 1 service edit + 1 test).
- **Depends on**: T1.6.
- **Acceptance** (parte de T-S1.6/T-S1.6b):
  - Flag OFF: service usa branch legacy. Test verifica comportamiento idéntico al pre-S1.
  - Flag ON: service usa machine. Test verifica transiciones validadas.
  - Flag `TRIP_STATE_MACHINE_ACTIVATED` declarado con `booleanFlag(false)` default.
- **Rollback**: flag OFF retoma legacy en <5 min sin tocar consumers.

### T1.7b: Wire 2do service (confirmar-entrega-viaje) [DEFERRED — sub-spec tripstate-alignment]

> **Diferida en T1.S1a.cierre 2026-05-18** — depende de T1.7a.


- **Files**: `apps/api/src/services/confirmar-entrega-viaje.ts` + test.
- **LOC estimate**: ~80.
- **Depends on**: T1.7a (flag ya declarado).
- **Acceptance**: idem T1.7a para confirmar-entrega.
- **Rollback**: flag OFF retoma legacy.

### T1.7c: Wire 3er service (asignar-conductor-a-assignment) [DEFERRED — sub-spec tripstate-alignment]

> **Diferida en T1.S1a.cierre 2026-05-18** — depende de T1.7a.


- **Files**: `apps/api/src/services/asignar-conductor-a-assignment.ts` + test.
- **LOC estimate**: ~80.
- **Depends on**: T1.7a.
- **Acceptance**: idem T1.7a para asignar-conductor.
- **Rollback**: flag OFF retoma legacy.

### T1.7d: Followup doc OUT-of-scope state machine migration [DEFERRED — sub-spec tripstate-alignment]

> **Diferida en T1.S1a.cierre 2026-05-18** — depende de T1.7a/b/c.


- **Files**: `.specs/s1-drift-coverage-e2e/followup-state-machine-migration.md` (nuevo).
- **LOC estimate**: ~50 (doc).
- **Depends on**: T1.7a, T1.7b, T1.7c (auditoría completa de services que mutan trip state).
- **Acceptance**:
  - Lista exhaustiva de services OUT-of-scope (e.g. `reportar-incidente.ts`, `eco-route-preview.ts`, otros descubiertos durante auditoría) con archivo + línea.
  - Cada OUT-of-scope con owner (S2 o S3) + justificación de por qué no se migra en S1a.
- **Rollback**: revert PR (doc-only).

### T1.S1a.cierre: Decisión cierre S1a → arranque S1b (gate) [DONE 2026-05-18 — APPROVED_BY_PO Opción A + 3 condiciones]

- **Files**: `.specs/s1-drift-coverage-e2e/s1a-cierre.md` (gate `APPROVED_BY_PO`, §11 vinculante), `inventory-classification.md` §S1a — Outcomes, `docs/handoff/CURRENT.md` (updated).
- **LOC estimate**: ~70 (doc con tabla cuantitativa) — actual: ~280 (cierre + outcomes + §11 firma + 3 condiciones vinculantes).
- **Depends on**: T1.1, T1.2, T1.3, T1.5 mergeados (Bloque A) + firma PO sobre Bloque B (resuelta: Opción A).
- **Acceptance** (cubre O-9 cuantitativo):
  - Tabla LOC mergeado vs planificado por task.
  - Ratio agregado Bloque A+B ≥40% **mandatorio** para arranque S1b.
  - SC-S1.0..SC-S1.6b cada uno con status `Implemented` / `Deferred a S2` / `N/A` con evidencia citada (PR número).
  - Firma PO explícita: "S1b arranca" o "S1b difiere a sprint separado" con justificación cuantitativa.
- **Rollback**: doc-only.

---

## Out-of-band

- Velocity tracking: `.specs/s1-drift-coverage-e2e/velocity-tracking.md` actualizado tras cada PR mergeado de S1a.
- Pre-commit hook update se mergea junto con T1.1.

## Open questions

- ~~OQ-S1.2~~ → resuelta en acceptance T1.6.

## Order of execution

```
Día 0      → planning + lectura (NO ejecución)
Día 1      → T1.1 (inventario + script + hook). Gate SC-S1.0 evaluado.
Día 2      → T1.2a..T1.2n en paralelo (Clase A; típicamente 2-5 sub-tasks por día)
Día 3      → T1.3a..T1.3n + T1.4a..T1.4n + T1.4b si aplica
Día 4      → T1.5 (tests integration)
Día 5      → T1.6 (XState scaffold)
Día 6      → T1.7a + T1.7b
Día 7      → T1.7c + T1.7d + T1.S1a.cierre
```

Velocity check día 3-4: si LOC mergeado <40% del estimado para S1a, paralizar T1.6 y replan con scope reducido (eliminar T1.7 → diferir a S2).
