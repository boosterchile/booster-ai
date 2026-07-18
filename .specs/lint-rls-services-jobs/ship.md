# ship — Extender `lint-rls` a `services/` y `jobs/` (+ raw SQL)

## Estado

- Rama: `feat/lint-rls-services-jobs` (worktree aislado bajo `.claude/worktrees/`, base `origin/main` @ b10519c).
- PR: **abierto, NO mergeado.** El merge lo aprueba y ejecuta el PO (frontera: quality gate de CI, CLAUDE.md §"Claude NO decide").

## Criterios de éxito del spec (§4) — todos cumplidos

1. `pnpm lint:rls` escanea routes + services + jobs (Drizzle **y** raw SQL) → **0 findings**. ✅
2. Test de regresión demuestra el **rojo** (query nueva sin filtro en services/ rompe CI). ✅ (verify.md §1)
3. Falsos positivos `.from(` (Buffer/Array/Date) ya no generan findings (fix-1). ✅
4. `pnpm lint` completo en verde. ✅
5. Coverage del linter ≥ 80/75/80; `typecheck` limpio. ✅ (97.69/90/100)
6. Cero diffs de runtime (solo linter + tests + comentarios allowlist). ✅

## Coordinación con PR #598 (spec §8)

`#598 fix/distancia-real-hibrida` (DRAFT, otra sesión) toca 6 archivos de `services/`. Dos de ellos recibieron anotaciones acá y quedan **al final del diff**:

- `apps/api/src/services/calcular-metricas-viaje.ts` (5 anotaciones)
- `apps/api/src/services/confirmar-entrega-viaje.ts` (2 anotaciones)

Los otros 4 archivos de #598 (`backfill-distancia-*`, `calcular-cobertura-telemetria`, `calcular-distancia-real`) produjeron **0 findings** → no se tocan.

**Acción de merge:** si #598 se mergea primero, **rebasar** esta rama sobre `main` antes del merge (las anotaciones son comentarios aislados → conflicto trivial, resolver conservando ambos cambios). Si esta rama se mergea primero, #598 rebasa.

## Riesgo residual declarado (spec §6)

El matcher es textual, no AST. Límites conocidos y aceptados:
- Raw SQL con tabla dinámica (`${fk.table}` en `merge-duplicate-users`) es invisible → BYPASSRLS-by-design, ya inventariado.
- Falso verde por token en ventana (columna `empresa_id` seleccionada sin WHERE) — defensa-en-profundidad, no prueba semántica.

Ninguno es regresión: son la misma clase de límite que el linter ya tenía sobre `routes/`.

## Post-merge

- El gate `pnpm lint:rls` ahora protege el 100% del código de acceso a DB de tenant contra queries nuevas sin filtro.
- Prerrequisito cumplido para el proyecto posterior de RLS a nivel Postgres (`rls-viabilidad.md` recomendación iii).
