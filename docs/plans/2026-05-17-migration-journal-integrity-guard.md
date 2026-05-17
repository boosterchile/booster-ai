# Plan — Guard de integridad del journal Drizzle (disk ↔ journal ↔ applied)

- **Spec**: [`docs/specs/2026-05-17-migration-journal-integrity-guard.md`](../specs/2026-05-17-migration-journal-integrity-guard.md) (Status: Approved 2026-05-17 ~18:25 UTC)
- **ADR a crear**: `044-migration-journal-integrity-guard.md`
- **Created**: 2026-05-17 ~18:30 UTC
- **Owner**: Felipe Vicencio (PO) + Claude
- **Status**: **Draft** — pendiente PO approval

---

## Decisiones tomadas en spec (no re-litigar)

- **Custom test ~50 LOC, no Atlas**. Criterio para escalar a Atlas documentado en ADR-044: >100 migrations, drift TS↔DB recurrente, o multi-DB.
- **Fix-first, guard-second** dentro del mismo PR. Orden de commits: G1 (verify prod) → G2 (fix orphan) → G3 (guard test) → G4 (ADR). Justificación: el guard debe pasar en CI desde el primer push.
- **Out of scope**: integrar Atlas, schema-TS-vs-DB drift, colisiones de numeración como categoría separada (el guard las detecta como caso particular de orphan).

---

## Módulos tocados

| Módulo / archivo | Tipo de cambio | Tareas |
|---|---|---|
| `apps/api/drizzle/0009_stakeholder_access_log.sql` | rename → `00NN_stakeholder_access_log.sql` (NN = siguiente libre) | G2 |
| `apps/api/drizzle/meta/_journal.json` | add entry para la migration renumerada | G2 |
| `apps/api/drizzle/meta/00NN_snapshot.json` | nuevo snapshot (probablemente generado por `drizzle-kit generate`) | G2 |
| `apps/api/test/unit/migration-journal-integrity.test.ts` | nuevo | G3 |
| `docs/adr/044-migration-journal-integrity-guard.md` | nuevo | G4 |
| `docs/handoff/CURRENT.md` | update post-merge | out-of-band |

**Total**: 4 archivos nuevos, 1 modificado, 1 renombrado.

---

## Tasks

### G1: Verificar contra Cloud SQL prod si la tabla existe

- **Files**: ninguno (verificación operacional, evidencia en PR body).
- **LOC estimate**: 0.
- **Depends on**: nada.
- **Acceptance**:
  - `gcloud sql connect` o equivalente a Cloud SQL prod, ejecutar `SELECT to_regclass('public.log_acceso_stakeholder')` (nombre SQL real per migration line 28, no `stakeholder_access_log` que es nombre antiguo del comentario).
  - **Si retorna NULL** → confirma el bug. G2 procede a renumerar + agregar al journal. CREATE TABLE corre en la próxima deploy y crea la tabla por primera vez en prod.
  - **Si retorna `log_acceso_stakeholder`** → la tabla existe en prod (probablemente creada manualmente). G2 cambia approach: agregar `IF NOT EXISTS` al CREATE TABLE de la migration antes de renumerar, para que el deploy no falle.
  - **Si retorna error de conexión** → G1 bloquea. Documentar setup gcloud y reintentar.
- **Output documentado en PR body**: query + resultado + decisión G2 (fresh CREATE vs IF NOT EXISTS).
- **Rollback**: no aplica.

### G2: Fix del orphan migration (renumerar + agregar al journal)

- **Files**:
  - `apps/api/drizzle/0009_stakeholder_access_log.sql` → renombrar a `00NN_stakeholder_access_log.sql` donde NN = `lastJournalIdx + 1` (al 2026-05-17: 0037).
  - Si G1 reportó que la tabla existe en prod: editar el `CREATE TABLE` para que sea `CREATE TABLE IF NOT EXISTS` (también los CREATE INDEX).
  - `apps/api/drizzle/meta/_journal.json` — agregar entry para la migration renumerada con los campos estándar Drizzle (idx siguiente disponible, tag matching filename prefix, when monotónico vs último entry, breakpoints true).
  - `apps/api/drizzle/meta/0037_snapshot.json` — generado por `drizzle-kit generate` (o copia + bump idx de `0036_snapshot.json` agregando la tabla).
- **LOC estimate**: ~10 (renombre + journal entry; snapshot lo genera la herramienta).
- **Depends on**: G1.
- **Acceptance**:
  - `pnpm --filter @booster-ai/api test:integration` corre globalSetup contra `booster_test_prototype` y los 3 tests existentes (health-db + migrations) pasan con `count == 37` (era 36 antes de G2).
  - El test de migrations.integration verifica `count(__drizzle_migrations) == count(journal entries)` — debería seguir pasando porque ambos lados se mueven a 37 juntos.
  - Manual: ejecutar `npx tsx scripts/prototype-test-db.ts` (script T0 untracked en working tree) y confirmar PASS con 37/37/37.
- **Rollback**: revertir commit. Estado vuelve al orphan original.

### G3: Test guard `migration-journal-integrity.test.ts`

- **Files**:
  - `apps/api/test/unit/migration-journal-integrity.test.ts` (nuevo) — 4 tests per spec §7.
- **LOC estimate**: ~60 (4 tests + helpers de error message formatting).
- **Depends on**: G2 (sin el fix, el test G3.1 reporta orphan y CI falla).
- **Acceptance**:
  - Test 1 (orphan on disk): lista todos `apps/api/drizzle/*.sql`, compara contra `journal.entries.map(e => e.tag)`. PASS si todo .sql tiene entry.
  - Test 2 (ghost in journal): la inversa. PASS si toda entry tiene .sql en disk.
  - Test 3 (counts iguales): `entries.length === sqlFiles.length`.
  - Test 4 (idx ordering): `entries.every((e, i) => e.idx === i)`.
  - Verificación manual durante BUILD: revertir G2 localmente (solo durante dev, NO en commit), correr test, **ver fallar** con mensaje "Orphan migration on disk: 0009_stakeholder_access_log.sql". Re-aplicar G2 antes de push.
  - Test corre en suite default (`pnpm --filter @booster-ai/api test`) — incluido en los 1105 + nuevos.
  - Coverage del package sigue ≥80/75/80.
- **Rollback**: revertir commit. G2 sigue intacto; perdemos solo el guard preventivo.

### G4: ADR-044

- **Files**: `docs/adr/044-migration-journal-integrity-guard.md` (nuevo).
- **LOC estimate**: ~80.
- **Depends on**: G2, G3.
- **Acceptance**:
  - Secciones standard: Context, Decision, Consequences, Alternatives, Status.
  - **Context**: cita PR #270 (T0 hallazgo) + el commit `488c931` del bug original.
  - **Decision**: custom test vs Atlas. Cita el criterio numérico para escalar a Atlas (>100 migrations, drift recurrente TS↔DB, multi-DB).
  - **Alternatives**: pre-commit hook (descartado: no garantiza CI), drizzle-kit check (no existe ese subcomando), Atlas (criterio futuro).
  - **Consequences**: cada migration nueva exige journal entry. PRs futuros que olviden el journal entry → CI rojo con mensaje claro. Costo: 1 test extra en suite default (impacto <50ms).
  - **Status**: Accepted.
- **Rollback**: revertir commit. Guard sigue funcionando, solo perdemos la documentación.

---

## Out-of-band tasks

- Cerrar la task spawned "Reincorporar 0009_stakeholder_access_log al journal" (queda absorbida por G2).
- **No** wirear callers de `recordStakeholderAccess` en este PR — eso es otra historia (ADR-028 § audit log activation). Se documenta como gap conocido en CURRENT.md.

---

## Estimación total

- 4 tasks (G1 + G2 + G3 + G4).
- LOC neto: G1=0 + G2=10 + G3=60 + G4=80 = **~150 LOC** en 4 commits / 1 PR.
- Tiempo focado estimado: 1-1.5h (G1 es la incógnita — depende de tiempo de acceso a Cloud SQL prod).

---

## Solo-developer adaptation

- Cooling-off 30 min entre BUILD y REVIEW (per agent-rigor §6.1).
- Devils-advocate sub-agent obligatorio sobre el PR antes de merge (cierre /review).
- Cada task = un commit atómico dentro del PR. Squash final preserva el cuerpo del PR como changelog.

---

## Verificación del plan (skill checklist)

- [x] G1-G4 son vertical slices (G1 verifica, G2 corrige, G3 previene, G4 documenta).
- [x] Todas las tasks ≤ 100 LOC estimate (max=G4=80).
- [x] Acceptance verificable por test/output/file existente.
- [x] Rollback explícito por task.
- [x] Spec aprobado antes de plan.
- [ ] Devils-advocate sobre el plan — skip per spec §11 (cambio quirúrgico). Si PO discrepa, invocar antes de aprobar.
- [ ] PO approval — pendiente.

---

## Orden de implementación

1. **G1**: ejecutar la query contra Cloud SQL prod. PR body documenta resultado.
2. **G2**: aplicar fix orphan según resultado de G1. Verificar localmente con `prototype-test-db.ts` (T0 untracked).
3. **G3**: escribir guard test. Verificar TDD-style (revertir G2 localmente, ver fallar, re-aplicar).
4. **G4**: escribir ADR-044 con evidencia ya generada en G1-G3.
5. Push branch + abrir PR con los 4 commits en orden.
6. Devils-advocate review.
7. Merge.
