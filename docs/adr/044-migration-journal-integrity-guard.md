# ADR-044 — Migration journal integrity guard (disk ↔ journal)

**Fecha**: 2026-05-17
**Estado**: Accepted
**Refs**:
- `docs/specs/2026-05-17-migration-journal-integrity-guard.md` (spec, Approved 2026-05-17 ~18:25 UTC)
- `docs/plans/2026-05-17-migration-journal-integrity-guard.md` (plan, 4 tasks G1-G4)
- `docs/handoff/2026-05-17-t0-prototype-test-db-output.md` (T0 que descubrió el orphan)
- PR [#270](https://github.com/boosterchile/casino/pull/270) (T0 evidence)
- ADR-002 (skill framework / agent-rigor)
- `apps/api/src/db/migrator.ts` (migrator con `applyOutOfOrderPending`)

## Contexto

T0 del plan `test-integration-infra-apps-api` (2026-05-17) reveló que `apps/api/drizzle/0009_stakeholder_access_log.sql` existía en disco pero **no** estaba registrado en `apps/api/drizzle/meta/_journal.json` (37 archivos `.sql` vs 36 entries journal). Consecuencias:

- `drizzle migrate()` itera sobre journal entries → no procesa el `.sql` huérfano.
- `applyOutOfOrderPending` (recovery path en `apps/api/src/db/migrator.ts:113`) también itera sobre journal entries → tampoco recupera.
- La tabla `stakeholderAccessLog` está declarada en `apps/api/src/db/schema.ts:1406`. G1 verificó (Cloud SQL Studio, 2026-05-17) que la tabla `log_acceso_stakeholder` **no existía en prod** — el bug era latente pero inactivo (nadie invocaba `recordStakeholderAccess` desde código).

El bug se introdujo en commit `488c931` ("chore: hardening post-auditoría", 2026-05-14) y pasó **4 días invisible**: ningún check de CI ni test lo detectó.

Adicionalmente, el journal tenía drift entre `idx` y filename prefix: la entry idx=35 tenía `tag=0036_zonas_stakeholder_comuna_codes` (gap en el prefix `0035_*`, originado durante el merge race de PR #261).

## Decisión

### 1. Custom test ~50 LOC como CI-time guard

Test unit `apps/api/test/unit/migration-journal-integrity.test.ts` (7 tests) diffea las tres fuentes de verdad:

1. **Orphan on disk**: cada `.sql` debe tener entry en journal.
2. **Ghost in journal**: cada entry debe tener `.sql` en disk.
3. **Counts iguales**: `entries.length === sqlFiles.length`.
4. **idx monotónico [0..N-1]**: sin gaps, sin duplicados.
5. **Filename prefix == idx**: `int(tag.match(/^(\d{4})_/)) === idx` para toda entry.
6. **No duplicate filename prefixes**: dos archivos no pueden compartir prefix `NNNN_`.
7. **`when` strictly monotonic**: `entries[i].when > entries[i-1].when` para todo i ≥ 1. Previene el bug original que motivó `applyOutOfOrderPending`.

El test corre en suite default (`pnpm --filter @booster-ai/api test`). Sin DB, sin red, sin dependencias nuevas. Tiempo de ejecución: ~5ms.

### 2. NO se integra Atlas (atlasgo.io) — criterio explícito para reconsiderar

Atlas es la alternativa industry-standard. Costo: dependencia binaria + learning curve + CI plumbing. Para Booster TRL 10 (38 migrations, 1 Postgres en Cloud SQL), el ROI del custom test supera Atlas:

- Custom test: 50 LOC + cero deps + 5ms ejecución.
- Atlas: binary install + config + workflow integration + monitoreo.

**Re-evaluar Atlas cuando se cumpla CUALQUIERA de**:
- (a) >100 migrations en el repo (proxy de complejidad).
- (b) Drift TS-side (schema.ts) ↔ DB recurrente (>1 incidente en 3 meses).
- (c) Booster amplía a múltiples DBs (Spanner, AlloyDB, BigQuery).
- (d) Las migrations se vuelven multi-environment con diferencias intencionales (dev/staging/prod schemas distintos).

### 3. Resolución del orphan: rename + history marker (no manual SQL en prod)

El fix del orphan `0009_stakeholder_access_log` se hizo en el mismo PR (G2 del plan). Tres pasos:

1. Renombrado `0009_stakeholder_access_log.sql` → `0037_stakeholder_access_log.sql` con comment interno actualizado. Contenido SQL byte-idéntico al original (la migration nunca había corrido en prod, así que no hay hash que preservar).
2. Renumerado en journal: existing entry idx=35 `0036_zonas_stakeholder_comuna_codes` → idx=36 (sin tocar `when` ni hash; content intact → hash preservado → prod skipea via match).
3. Nueva migration **history marker** `0035_history_marker_renumber.sql` (`SELECT 1` no-op) llenó el slot idx=35. `when=1780876799999` (1ms antes que zonas) para mantener monotonicidad del journal **y** disparar el path `applyOutOfOrderPending` en prod (Drizzle skipea por `when ≤ lastDbMigration.created_at`, recovery aplica por hash mismatch).
4. Nueva entry orphan idx=37 `0037_stakeholder_access_log`, `when=1780876800001` (1ms después de zonas). Drizzle `migrate()` lo aplica regular.

Resultado: zero manual UPDATE sobre `drizzle.__drizzle_migrations`, cero violación de CLAUDE.md §1.

## Consecuencias

### Positivas

- **Cero deuda futura**: cualquier orphan/ghost/drift es detectado al merge.
- **Convención clara**: `filename_prefix == idx == int(NNNN_)` para todo el journal a partir del cleanup G2.
- **Zero overhead operacional**: 5ms en CI per run.
- **Documentación trazable**: el history marker SQL contiene su propio "por qué" en comments.

### Negativas

- **Una migration no-op permanente**: `0035_history_marker_renumber.sql` queda como cicatriz histórica pero está documentada. Removerla requeriría tocar `__drizzle_migrations` en prod — no vale el costo.
- **Tests dependen del filesystem**: si alguien refactorea estructura de `apps/api/drizzle/` (ej. nested folders por dominio), los tests fallan en CI hasta actualizar paths. Trade-off aceptable — refactor de migration layout es raro y siempre toca esta carpeta.

### No mitigadas (out of scope)

- **Schema TS ↔ DB drift**: `apps/api/src/db/schema.ts` declara tablas que pueden divergir del SQL aplicado. Este guard no lo detecta. Spec futuro si recurrente.
- **Migrations con efectos no idempotentes** (data backfills): el guard solo verifica integridad estructural del journal, no semántica de cada SQL.
- **Wirear `recordStakeholderAccess`**: la tabla `log_acceso_stakeholder` ahora aplica en prod, pero los callers que la usarían (per ADR-028 §audit log bloqueante) siguen sin existir. Ese gap se trackea separado.

## Alternativas consideradas

### Atlas (descartado para esta iteración)

Pros: standard de la industria, schema migration diff vs DB, drift detection nativo.
Cons: binary install, CI plumbing, cogenetic load. Para 38 migrations no justifica.

### Pre-commit hook con grep

Pros: feedback dev-time (antes de push).
Cons: no enforza en CI runner sin pre-commit configurado. Los devs pueden saltarlo con `--no-verify`. El guard como test CI es estricto y no-bypaseable.

### `drizzle-kit check`

Pros: si existiera como subcomando, sería la opción nativa.
Cons: no existe. Drizzle-kit tiene `generate`, `migrate`, `push`, `studio` — ningún subcomando hace integrity check del journal vs disk.

### Editar `__drizzle_migrations` manualmente en prod

Pros: permite cambiar comment del `0036_*.sql` sin renumerar.
Cons: viola CLAUDE.md §1 (sin infra manual). Auditable solo en logs gcloud, no en git. Descartado.

## Status

Accepted. Implementado en feat/migration-journal-integrity-guard-impl (G2 + G3 + G4).
