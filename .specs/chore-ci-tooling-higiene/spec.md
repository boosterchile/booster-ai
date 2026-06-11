# Spec: chore-ci-tooling-higiene

- Author: Felipe Vicencio (with agent-rigor)
- Date: 2026-06-11
- Status: Approved
- Linked: Auditoría 2026-06-09, corte transversal CI/CD y calidad — riesgos medios "gate de coverage opt-in (9 workspaces fuera)" y "e2e PR contra prod si STAGING_URL vacía"; bajas: Node CI≠nvmrc, commitlint 100 vs CLAUDE.md 72, cloudbuild.staging.yaml muerto, deps web sin uso, bug REPO_ROOT.

## 1. Objective

Cerrar en un solo batch la higiene de tooling detectada: (1) el gate de coverage de ci.yml solo valida workspaces que emiten coverage-summary — los 8 stubs no lo emiten, así que código nuevo en ellos pasaría CI sin un test; (2) e2e de PRs cae a PRODUCTION_URL si `vars.STAGING_URL` está vacía (staging no existe); (3) `.nvmrc=22` vs CI/Docker en Node 24; (4) commitlint permite 100 chars vs regla ≤72 del CLAUDE.md; (5) `cloudbuild.staging.yaml` muerto y peligroso si se ejecuta a mano; (6) `zustand`/`idb` declarados sin uso en apps/web; (7) bug REPO_ROOT en deploy-telemetry-gateway.sh + falta banner post-ADR-059.

## 2. Why now

Mandato del PO de resolver todo lo detectado; cada ítem es chico pero el agujero del coverage gate y el e2e-contra-prod son reales.

## 3. Success criteria

- [ ] Los 8 stubs (document-service, matching-engine, notification-service, ai-provider, carta-porte-generator, document-indexer, trip-state-machine, ui-components) tienen vitest.config con thresholds + smoke test + `test:coverage` — el gate de ci.yml deja de ser opt-in.
- [ ] e2e-staging.yml en PRs se SALTA si `vars.STAGING_URL` está vacía (nunca corre contra prod por fallback).
- [ ] `.nvmrc` = 24 (alineado con Docker prod y CI).
- [ ] commitlint `subject-max-length` = 72.
- [ ] `cloudbuild.staging.yaml` eliminado (inactivo desde la remoción de deploy-staging; patrón `run deploy` ya abandonado).
- [ ] `zustand` e `idb` fuera de apps/web/package.json y lockfile.
- [ ] REPO_ROOT correcto en deploy-telemetry-gateway.sh + banner de deprecación parcial (ADR-059).

## 4. User-visible behaviour

Ninguno (tooling interno).

## 5. Out of scope

- Migrar el container de Playwright (Node 22) — el e2e corre en container propio pinneado; alinearlo es parte del ciclo e2e real cuando exista staging.
- Implementar los stubs (TSM tiene su ciclo propio en esta misma ola).
- Encadenar release.yml a ci.yml (va en el ciclo del pipeline de deploy, tarea #20).

## 6. Constraints

1. Quality gates de workflows: este cambio ENDURECE (coverage universal, e2e guard) — justificación: auditoría; ningún gate se afloja.
2. Smoke tests de stubs cubren el archivo real (sin excluir index/main de coverage) para que el summary sea numérico.

## 7. Approach

Por stub: vitest.config.ts (v8, thresholds 80, sin excluir el entrypoint), `src/index.test.ts` o `test/main.test.ts` (import-smoke), scripts `test:coverage`, devDep `@vitest/coverage-v8`. e2e-staging: `if` a nivel job que omite PRs sin STAGING_URL. Resto: ediciones puntuales + `git rm` + `pnpm install` para lockfile.

## 8. Alternatives considered

- **A. Gate de ci.yml que enumere workspaces y exija summary** — Rechazada: heurística frágil (¿qué workspace "debe" tener tests?); dar coverage real a todos es uniforme y a prueba de futuro.
- **B. Borrar los stubs en vez de testearlos** — Rechazada: reservan los slots del monorepo (decisión deliberada del repo, ADR-048) y Terraform ya despliega algunos.
- **C. .nvmrc → mantener 22 y bajar CI a 22** — Rechazada: prod corre node:24-alpine en Docker; CI debe testear lo que corre en prod; dev local converge a 24.

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Smoke test de apps ejecuta side-effects del main | L | L | Verificado: los 3 main.ts solo crean logger y loguean (sin listeners ni I/O) |
| commitlint 72 rompe hábitos de commits largos | M | L | Es la regla documentada del CLAUDE.md; commitlint la hace real |
| Algún flujo manual usaba cloudbuild.staging.yaml | L | M | Inactivo confirmado por grep + CLAUDE.md; history en git |

## 10. Test list

- T1: `pnpm --filter <stub> test:coverage` emite coverage-summary.json con pct numérico ≥80 en los 8 stubs.
- T2: lint del workflow e2e (yamllint implícito de Actions) + revisión del `if` (PR sin var → job skipped).
- T3: grep `zustand|idb` en apps/web/src y lockfile → solo ausencia.
- T4: `bash -n scripts/deploy-telemetry-gateway.sh` + path de manifests existente resuelto desde REPO_ROOT.

## 11. Rollout

- Flag: no. Migración: no. Rollback: revert.
- Monitoring: el próximo PR con código en un stub debe fallar coverage si no trae tests (auto-verificable).

## 12. Open questions

None as of 2026-06-11.

## 13. Decision log

- 2026-06-11 — Draft + mandato PO. Batch deliberado de higiene CI/tooling (7 ítems chicos, mismo scope chore).
