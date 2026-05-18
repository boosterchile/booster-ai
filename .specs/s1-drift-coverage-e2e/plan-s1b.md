# Plan S1b: branches coverage + Playwright + sharding

- Plan maestro: [`plan.md`](./plan.md)
- Spec: [`spec.md`](./spec.md) (Approved v2)
- Plan dependiente: [`plan-s1a.md`](./plan-s1a.md) (debe cerrar OK antes de S1b)
- Status: **Approved** (PO 2026-05-18) — arranque sujeto a cierre S1a OK
- Estimación lane Felipe: **4–6 días** (con buffer 20%)
- LOC estimado: ~700–900

---

## Scope

Bloques C + D + E de la spec maestra: subir branches coverage `apps/api` ≥80% con lista nombrada de error paths reales + 4 specs Playwright críticos con axe-core en CI por PR + sharding + path-filter + cierre del Sprint S1 (CURRENT.md update).

**Cubre SCs**: SC-S1.7a, SC-S1.7b, SC-S1.9, SC-S1.10, SC-S1.11, SC-S1.12, SC-S1.checkpoint (renombrado), SC-S1.14.

---

## Dependencia bloqueante

S1b **NO arranca** hasta que `.specs/s1-drift-coverage-e2e/s1a-cierre.md` (T1.S1a.cierre del plan-s1a) tenga:

- Ratio Bloque A+B mergeado ≥40% del estimado.
- Firma PO explícita "S1b arranca".

Si S1a no cierra OK, S1b se difiere a sprint separado con su propio /spec.

---

## Tasks (atomizadas; T1.10 split en spike + 4 specs)

### T1.8: Identificar branches sin cobertura + lista nombrada

- **Files**:
  - `scripts/repo-checks/branches-uncovered.mjs` (nuevo, perm — utilidad cross-sprint).
  - `.specs/s1-drift-coverage-e2e/coverage-targets.md` (nuevo).
- **LOC estimate**: ~50 script + ~80 doc = ~130 (waiver: script + doc, cada uno ≤100 LOC).
- **Depends on**: ninguna (S1b arranque OK).
- **Acceptance** (T-S1.7a, **gate de pre-T1.9**):
  - Lista ≥10 error paths reales en `coverage-targets.md`. Cada path con: archivo + línea + tipo (validation/race/4xx/5xx) + plan de test (1-2 líneas).
  - **Sin esta lista no arranca T1.9** (convención; PR de T1.9 referencia coverage-targets.md en su descripción).
- **Rollback**: revert PR. Script perm (utilidad cross-sprint).

### T1.9a..T1.9j: Tests añadidos por path (≥10 sub-tasks, una por path en coverage-targets.md)

- **Plantilla recurrente**: una T1.9x por cada path en `coverage-targets.md`.
- **Files por sub-task**: 1 archivo de test en `apps/api/test/unit/` (típicamente extensión de test existente o nuevo `<service>-error-paths.test.ts`).
- **LOC por sub-task**: ≤30 (cumple ≤100 LOC).
- **Depends on**: T1.8 (lista nombrada cerrada).
- **Acceptance por sub-task** (parte de T-S1.7b):
  - Path específico del coverage-targets.md está ejercido en el test.
  - Test verifica comportamiento real (validation Zod failure, 4xx HTTP, race condition, etc.).
- **Acceptance T1.9 global** (T-S1.7b):
  - `apps/api/coverage/coverage-summary.json total.branches.pct ≥ 80`.
- **Rollback por sub-task**: revert PR. Tests no afectan runtime.

### T1.10.spike: Auth strategy decision para Playwright

- **Files**: `.specs/s1-drift-coverage-e2e/playwright-auth-decision.md` (nuevo).
- **LOC estimate**: ~30 (doc con decisión).
- **Depends on**: ninguna.
- **Acceptance** (cubre O-3 review):
  - Documento con decisión auth: fixture compartido (mock JWT) **o** flujo login real cada vez.
  - LOC estimado revisado para T1.10a..T1.10d en función de la decisión.
  - **Si extend fixture >50 LOC**: firma PO en el doc antes de arrancar T1.10a.
- **Rollback**: doc-only.

### T1.10a: Playwright spec login-universal-rut-clave-numerica (valida fixture)

- **Files**:
  - `apps/web/e2e/login-universal-rut-clave-numerica.spec.ts` (nuevo).
  - `apps/web/e2e/fixtures.ts` (extended si decisión spike lo requiere).
- **LOC estimate**: ~100 (spec) + posible ~50 extend fixture = ~100-150 según spike.
- **Depends on**: T1.10.spike.
- **Acceptance** (parte de T-S1.9, T-S1.10):
  - Spec corre verde con `pnpm --filter @booster-ai/web test:e2e`.
  - Incluye `injectAxe()` + `checkA11y()` con 0 violations P0/P1.
  - Login universal con RUT + clave numérica verifica auth happy path.
- **Rollback**: revert PR. Spec nuevo no impacta runtime.

### T1.10b: Playwright spec shipper-publica-carga

- **Files**: `apps/web/e2e/shipper-publica-carga.spec.ts`.
- **LOC estimate**: ~100.
- **Depends on**: T1.10a (fixture validado).
- **Acceptance**: idem T1.10a (corre verde, axe-core OK, flujo end-to-end de publicar carga).
- **Rollback**: revert PR.

### T1.10c: Playwright spec carrier-acepta-oferta

- **Files**: `apps/web/e2e/carrier-acepta-oferta.spec.ts`.
- **LOC estimate**: ~100.
- **Depends on**: T1.10a.
- **Acceptance**: idem (flujo carrier ve oferta + acepta + redirect).
- **Rollback**: revert PR.

### T1.10d: Playwright spec public-tracking-via-link

- **Files**: `apps/web/e2e/public-tracking-via-link.spec.ts`.
- **LOC estimate**: ~100.
- **Depends on**: T1.10a.
- **Acceptance**: idem (UUID v4 link público + opacity check + telemetría visible).
- **Rollback**: revert PR.

### T1.11: `ci.yml` actualizado para Playwright + axe-core en PR

- **Files**: `.github/workflows/ci.yml` (edit ~40 LOC).
- **LOC estimate**: ~40.
- **Depends on**: T1.10a (al menos 1 spec listo para probar el job).
- **Acceptance** (T-S1.11):
  - Job `playwright` en `ci.yml` con dependency en `setup`.
  - Job corre en PR (validable con primer PR post-T1.11).
- **Rollback**: revert PR.

### T1.12: Sharding + path-filter + dry-run pre-merge

- **Files**: `.github/workflows/ci.yml` (edit) + `apps/web/playwright.config.ts` (edit `workers: N`).
- **LOC estimate**: ~30 + ~10 = ~40.
- **Depends on**: T1.11.
- **Acceptance** (T-S1.12, **OQ-S1.3 trigger**):
  - Path-filter: job Playwright corre solo si cambios tocan `apps/web/**` o config.
  - Playwright `workers: N` (N = 2-4 según hardware GitHub Actions).
  - **OQ-S1.3 resuelta**: comentario inline en `ci.yml` declara `dorny/paths-filter@v3` o alternativa con razón (cubre O-10 trigger).
  - Dry-run en branch fake antes de merge a `main`: documentar tiempo wall-clock observado.
- **Rollback**: revert PR. Playwright corre sin sharding.

### T1.13: Wall-clock measurement post-merge (≥10 PRs)

- **Files**: `.specs/s1-drift-coverage-e2e/ci-wall-clock-tracking.md` (nuevo).
- **LOC estimate**: ~30.
- **Depends on**: T1.11 + T1.12 mergeados + ≥10 PRs post-merge **dentro de S1b o follow-up S2**.
- **Acceptance** (T-S1.12 follow-up):
  - Tabla ≥10 PRs + wall-clock por job + p95.
  - Si p95 ≤10 min, SC-S1.12 cumple.
  - Si p95 >10 min y ≤12 min, waiver con plan optimización.
  - Si p95 >12 min, ticket migración a runners distribuidos (S2 evalúa, cubre alt E spec).
- **Si menos de 10 PRs en S1b**: tracking pasa a `SC-S1.12-followup` en CURRENT.md para S2.
- **Rollback**: doc-only.

### T1.checkpoint: Revisión de progreso S1b día 3-4

- **Files**: `.specs/s1-drift-coverage-e2e/s1b-checkpoint.md` (nuevo).
- **LOC estimate**: ~50.
- **Depends on**: progreso de S1b.
- **Acceptance** (SC-S1.checkpoint, cubre O-9 cuantitativo):
  - Tabla LOC mergeado vs planificado por bloque C / D.
  - Ratio agregado ≥40% **mandatorio** para continuar con T1.10c+T1.10d.
  - Si <40%, difiere 2 specs Playwright restantes a S2; ajusta CURRENT.md.
  - Firma PO explícita con justificación cuantitativa.
- **Rollback**: doc-only.

### T1.14: CURRENT.md update + plan tasks DONE + pickup S2

- **Files**: `docs/handoff/CURRENT.md` (edit ~70 LOC) + `.specs/s1-drift-coverage-e2e/plan-s1a.md` + `plan-s1b.md` (tasks marcadas DONE).
- **LOC estimate**: ~70.
- **Depends on**: T1.1..T1.13 completos (modulo split si aplica).
- **Acceptance** (T-S1.14, cubre O-9 cuantitativo):
  - Sección "Sprint S1 cerrado" en CURRENT.md con tabla:
    - PRs mergeados por bloque (A+B en S1a, C+D en S1b).
    - ADRs nuevos producidos (si Clase B/C).
    - SCs `Implemented` / `Deferred` / `N/A` cada uno con evidencia citada (PR número).
    - Decisiones clave (clases A/B/C detectadas, flag activations, OQs resueltas).
  - Pickup point S2 explícito: `stubs-decision execution + D11 T8-T12 + RLS lint extension + 4 Playwright restantes + velocity check post-S2 (SC-28)`.
- **Rollback**: revert PR.

---

## Out-of-band

- Velocity tracking continúa actualizándose en `velocity-tracking.md` por cada PR mergeado.

## Open questions

- ~~OQ-S1.3~~ → resuelta en acceptance T1.12.

## Order of execution

```
Día 0 S1b   → planning + lectura del cierre S1a + plan-s1b.md
Día 1       → T1.8 (lista nombrada). Gate SC-S1.7a evaluado.
Día 2-3     → T1.9a..T1.9j en paralelo (típicamente 3-5 sub-tasks por día)
Día 1-2     → T1.10.spike + T1.10a en paralelo a T1.8/T1.9
Día 3       → T1.checkpoint (decisión continuar 4 specs o diferir 2 a S2)
Día 3-4     → T1.10b + T1.10c + T1.10d (según checkpoint) + T1.11
Día 4-5     → T1.12 + T1.13 (tracking pendiente)
Día 5-6     → T1.14 (cierre)
```

Velocity check día 3 (T1.checkpoint): si <40% LOC mergeado, difiere T1.10c+T1.10d a S2.
