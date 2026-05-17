# Handoff D11 v2 — listo para BUILD T8–T12 en sesión fresca

**Fecha**: 2026-05-17 ~06:50 UTC
**Audiencia**: próxima sesión de Claude (o Felipe directo)
**Contexto perdido al cerrar sesión**: ninguno crítico — todo el state vive en `main` + docs.

## Estado actual (verificable desde main)

### Infra D11 completa en main

| Componente | Commit en main | Verificación |
|---|---|---|
| Helper k-anonymity (3 niveles privacy) | `3e1765e` (#259) | `packages/shared-schemas/src/aggregations/k-anonymity.ts` |
| Migration 0034 tabla `zonas_stakeholder` | `2843e69` (#248) | `apps/api/drizzle/0034_zonas_stakeholder.sql` |
| Migration 0036 `comuna_codes` + seed | `4aa4f6c` (#261) | `apps/api/drizzle/0036_zonas_stakeholder_comuna_codes.sql` |
| Zod + Drizzle schema (numeric mode + comuna_codes) | `4aa4f6c` (#261) | `packages/shared-schemas/src/domain/zona-stakeholder.ts`, `apps/api/src/db/schema.ts:639` |
| Helpers T5/T6 (hora+pico, tipo+combustible) | `b21dbec` (#263), `9b52106` (#264) | `apps/api/src/services/stakeholder-aggregations.ts` |
| ADR-041 (Superseded por ADR-042) | `bb08099` (#262) | `docs/adr/041-stakeholder-geo-aggregations-bounding-boxes-k-anonymity.md` |
| ADR-042 (decisión Opción 2) | `495d744` (#260) | `docs/adr/042-stakeholder-geo-aggregations-comuna-filter-and-domain-alignment.md` |
| Plan v2 con T8-T12 | `31106d5` (#265) | `docs/plans/2026-05-17-d11-v2-stakeholder-geo-aggregations.md` |
| Status post-review tracker | `e52b4bc` (#258) | `docs/handoff/2026-05-17-d11-review-plan.md` |

### Lo que NO está hecho

T8-T12 v2 implementations. Definidas con acceptance + rollback + LOC waivers en plan v2.

### PRs cerrados (no relevantes para continuación)

- #246 (T1), #247 (T2), #249 (T4), #250 (T5), #251 (T6) — reemplazados por versiones v2 ya en main.
- #252 (T7 puntoEnBoundingBox) — DEPRECATED por Opción 2.
- #253 (T8 abort doc), #254 (T9 rejected) — abortados.
- #255 (T10 UI), #256 (T11 UI), #257 (T12 perf) — pueden quedar OPEN como referencia histórica o cerrarse; sus implementaciones v2 saldrán como PRs nuevos targeting main.

## Cómo seguir en sesión fresca

### Opción A — `/goal` autónomo (recomendada)

1. Cerrar este Claude Code (cmd+W o `/clear` en la conversación).
2. Abrir Claude Code Desktop en el worktree `/Volumes/Pendrive128GB/Booster-AI/.claude/worktrees/naughty-sinoussi-c8ddf8/`.
3. Pegar este `/goal` (también vive en `docs/runbooks/goal-templates.md` con sanity check + terse post-abort):

```
/goal Ejecutar BUILD de docs/plans/2026-05-17-d11-v2-stakeholder-geo-aggregations.md tareas T8 v2, T9 v2, T10 v2, T11 v2, T12 v2 en orden. Sanity check zero: si el archivo no existe, ABORTAR antes del pre-flight. Post-abort terse: en TODA re-invocación del Stop hook tras un ABORT responder ÚNICAMENTE con un punto literal `.` (1 carácter). Pre-flight: leer /Users/fvicencio/.claude/plugins/cache/agent-rigor/agent-rigor/0.2.0/CLAUDE.md + skill_read al ledger + phase_enter "d11-v2" phase "build" + leer skills 30-incremental-implementation y 32-context-engineering + leer docs/adr/042-stakeholder-geo-aggregations-comuna-filter-and-domain-alignment.md. Por cada Ti v2: (1) articular en chat qué hace + por qué + qué podría romper (pre_build_articulation al ledger); (2) test FIRST con TDD si nuevo comportamiento; (3) implementar mínimo código que pasa el test; (4) refactor manteniendo tests verdes; (5) pnpm --filter <pkg> test, pnpm typecheck, pnpm lint; (6) commit Conventional (subject ≤72, body ≤95), diff atómico respetando LOC waiver del plan (T8=150, T9=120, T10=130, T11=150, T12=100); (7) marcar Ti como [done] en plan.md y commitear; (8) push branch + PR + WATCH CI con gh pr checks --watch --interval 15; (9) NO mergear (review humano cooling-off 30 min). Condición de cierre: pegar (a) git log main..HEAD --oneline con los commits, (b) plan v2 con todas las Ti v2 [done], (c) URLs de los 5 PRs abiertos. Abort si: Ti revela gap en spec/plan/schema (no replantear mid-build), test falla 2 reintentos sin diagnóstico nuevo, vocabulario drift en código, Ti excede 200 LOC, o más de 5 PRs intentan abrir el mismo branch.
```

### Opción B — manual incremental

Una task por turno: pegar al inicio "Implementar T8 v2 per `docs/plans/2026-05-17-d11-v2-stakeholder-geo-aggregations.md` §T8". Repetir para T9, T10, T11, T12.

Ventaja: más control granular, review por PR. Desventaja: 5 turnos vs 1 `/goal`.

### Opción C — `/build` formal con devils-advocate por task

Más disciplinado (agent-rigor formal). Cada task termina con devils-advocate antes del commit. Más lento pero menos riesgo de hallazgos en review post-merge.

## Verificación pre-arranque

Antes de invocar el `/goal`, confirmá en el repo limpio:

```bash
cd /Volumes/Pendrive128GB/Booster-AI/.claude/worktrees/naughty-sinoussi-c8ddf8
git fetch github main
git log github/main -1 --oneline  # debería estar en commit posterior a #266 (este handoff)
git status                          # working tree clean
gh pr list --state open --json number,title --jq length  # número de PRs abiertos D11 v1 residuales
ls docs/plans/2026-05-17-d11-v2-*.md  # debe existir
ls docs/adr/042-stakeholder-geo-aggregations-*.md  # debe existir
```

Si alguno falla, recoger context vía Plan 1 `/goal` (sync CURRENT.md) antes de Bloque C.

## Estimación

T8-T12 v2 entre 4-6h focado vía `/goal`, distribuible en 1-3 sesiones.

## Lecciones de este sprint para Bloque C

1. **Verificar schema real antes de la spec acceptance** — no asumir nombres del spec. Ya hecho en plan v2.
2. **k-anonymity siempre a 3 niveles** — helpers ya están (`aplicarKAnonymityHorario` para universo cerrado, `aplicarKAnonymityQuasiId` para drop-sub-k).
3. **Tests integration NO mocked** — usar test DB real per Drizzle helper.
4. **UI tests son render reales** (RouterProvider + QueryClient mock), NO type-only smoke.
5. **Endpoint NO hardcodea valores de enums** (`tipo_carga`, `fuel_type`) — siempre desde cargo_request real.
6. **Naming bilingüe**: TS camelCase (alineado con Drizzle inferSelect), SQL snake_case español.
7. **LOC waivers** justificados con razón cohesiva, no "el plan estaba mal granulado".
8. **PRs stacked auto-cierran** cuando su base se elimina al mergear. Solución: target `main` directo para cada fix-PR.

## Settings recordatorio

`.claude/settings.json` local (gitignored) ya tiene:
- 119 allow rules (`gh pr view/list/checks`, `git fetch/log/diff`, `pnpm test/typecheck/lint`, `Write` a `apps/**/*.ts`, `packages/**/*.ts`, `docs/**/*.md`).
- 30 deny rules (force-push a main, `terraform apply`, edits a `CLAUDE.md`, etc.).

Los hooks de agent-rigor están activos. El sanity check zero del `/goal` template está embebido — placeholder literal o recurso ausente → ABORT antes del pre-flight, terse `.` en re-invocaciones.

---

**TL;DR**: cerrá esta sesión, abrí una nueva, pegá el `/goal` de Opción A. Todo el estado necesario está en main.
