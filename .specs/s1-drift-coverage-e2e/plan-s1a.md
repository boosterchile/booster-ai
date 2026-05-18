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

### T1.2a..T1.2n: Resolución Clase A — una sub-task por divergencia (cubre O-1)

- **Plantilla recurrente**: una T1.2x por cada divergencia Clase A en `inventory.md`.
- **Files por sub-task**: 1-2 archivos en `packages/shared-schemas/src/domain/*` + consumers afectados (`apps/api/src/services/*` o `apps/api/src/routes/*`) + tests existentes ajustados.
- **LOC por sub-task**: ≤80 (cumple ≤100 LOC sin waiver).
- **Depends on**: T1.1 + SC-S1.0 gate `APPROVED_BY_PO`. Sub-tasks pueden ejecutar en paralelo entre sí.
- **Acceptance por sub-task** (parte de T-S1.3):
  - Identifier/enum value específico en `inventory.md` está alineado a SQL canónico.
  - `pnpm typecheck` + `pnpm test` verdes post-PR.
  - `grep -E "<valor inglés viejo>" packages/shared-schemas/src/domain/` retorna 0 hits para esa divergencia.
- **Acceptance T1.2 global**: todas las sub-tasks Clase A en `Implemented` + `grep -rE "'(delivered|confirmed|completed|pending|active|cancelled)'" packages/shared-schemas/src/domain/` retorna 0 hits totales.
- **Rollback por sub-task**: revert PR específico. Cero impacto runtime (cambio TS-only).

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

### T1.5: Tests integration drift sobre infra T1+T2

- **Files**: `apps/api/test/integration/drift-alignment.integration.test.ts` (nuevo).
- **LOC estimate** (adaptive, cubre O-7): `40 × patterns_aplicables` según inventario. Si 3 patterns (A+B+C), ~120 LOC. Si solo A, ~40 LOC. Anotado en `inventory.md` tras T1.1.
- **Depends on**: T1.2a..T1.2n + T1.3a..T1.3n + T1.4a..T1.4n (todos los aplicables, según inventario).
- **Acceptance** (T-S1.5):
  - Pattern A (round-trip enum) testeado si Clase A aplicó.
  - Pattern B (identifier match) testeado si Clase B aplicó.
  - Pattern C (flag transición / migration) testeado si Clase C aplicó.
- **Rollback**: revert PR.

### T1.6: `packages/trip-state-machine` scaffold con XState v5

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

### T1.7a: Wire flag `TRIP_STATE_MACHINE_ACTIVATED` + 1 service (liquidar-trip)

- **Files**: `apps/api/src/config.ts` (+1 flag) + `apps/api/src/services/liquidar-trip.ts` (branch flag legacy/machine) + `apps/api/test/unit/liquidar-trip-machine-wiring.test.ts`.
- **LOC estimate**: ~100 (flag + 1 service edit + 1 test).
- **Depends on**: T1.6.
- **Acceptance** (parte de T-S1.6/T-S1.6b):
  - Flag OFF: service usa branch legacy. Test verifica comportamiento idéntico al pre-S1.
  - Flag ON: service usa machine. Test verifica transiciones validadas.
  - Flag `TRIP_STATE_MACHINE_ACTIVATED` declarado con `booleanFlag(false)` default.
- **Rollback**: flag OFF retoma legacy en <5 min sin tocar consumers.

### T1.7b: Wire 2do service (confirmar-entrega-viaje)

- **Files**: `apps/api/src/services/confirmar-entrega-viaje.ts` + test.
- **LOC estimate**: ~80.
- **Depends on**: T1.7a (flag ya declarado).
- **Acceptance**: idem T1.7a para confirmar-entrega.
- **Rollback**: flag OFF retoma legacy.

### T1.7c: Wire 3er service (asignar-conductor-a-assignment)

- **Files**: `apps/api/src/services/asignar-conductor-a-assignment.ts` + test.
- **LOC estimate**: ~80.
- **Depends on**: T1.7a.
- **Acceptance**: idem T1.7a para asignar-conductor.
- **Rollback**: flag OFF retoma legacy.

### T1.7d: Followup doc OUT-of-scope state machine migration

- **Files**: `.specs/s1-drift-coverage-e2e/followup-state-machine-migration.md` (nuevo).
- **LOC estimate**: ~50 (doc).
- **Depends on**: T1.7a, T1.7b, T1.7c (auditoría completa de services que mutan trip state).
- **Acceptance**:
  - Lista exhaustiva de services OUT-of-scope (e.g. `reportar-incidente.ts`, `eco-route-preview.ts`, otros descubiertos durante auditoría) con archivo + línea.
  - Cada OUT-of-scope con owner (S2 o S3) + justificación de por qué no se migra en S1a.
- **Rollback**: revert PR (doc-only).

### T1.S1a.cierre: Decisión cierre S1a → arranque S1b (gate)

- **Files**: `.specs/s1-drift-coverage-e2e/s1a-cierre.md` (nuevo).
- **LOC estimate**: ~70 (doc con tabla cuantitativa).
- **Depends on**: T1.1..T1.7d completos.
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
