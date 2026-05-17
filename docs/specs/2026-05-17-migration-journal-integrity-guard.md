# Spec — Guard de integridad del journal Drizzle (disk ↔ journal ↔ applied)

- **Author**: Felipe Vicencio (PO) + Claude (agent-rigor)
- **Date**: 2026-05-17
- **Status**: **Approved** (PO, 2026-05-17 ~18:25 UTC)
- **Linked**: hallazgo T0 del plan `2026-05-17-test-integration-infra-apps-api.md`
- **ADR a crear**: `044-migration-journal-integrity-guard.md`

---

## 1. Objetivo

Prevenir que un archivo `.sql` de migration termine **en disco pero ausente del journal** (`apps/api/drizzle/meta/_journal.json`) y por lo tanto no se aplique nunca en producción. El control vive como **test unit + check CI** que diffea las tres fuentes de verdad de migrations:

- **Disk**: `apps/api/drizzle/*.sql`
- **Journal**: entries de `apps/api/drizzle/meta/_journal.json`
- **Applied**: filas de `drizzle.__drizzle_migrations` (verificable en integration, ya cubierto por T1b — fuera de scope de este spec).

## 2. Why now

T0 del plan `2026-05-17-test-integration-infra-apps-api.md` (commit `d644d96`, PR [#270](https://github.com/boosterchile/booster-ai/pull/270)) reveló que `apps/api/drizzle/0009_stakeholder_access_log.sql` existe en disco pero **no** está registrado en `meta/_journal.json` (37 archivos `.sql` vs 36 entries journal). Consecuencias:

- `drizzle migrate()` itera sobre journal entries → no procesa el `.sql` huérfano.
- `applyOutOfOrderPending` (recovery path en [`apps/api/src/db/migrator.ts:113`](../../apps/api/src/db/migrator.ts)) también itera sobre journal entries → tampoco recupera.
- La tabla `stakeholderAccessLog` está declarada en [`apps/api/src/db/schema.ts:1406`](../../apps/api/src/db/schema.ts). En prod la tabla **no existe**; cualquier endpoint que la lea/escriba devuelve 500 (`relation "stakeholder_access_log" does not exist`).

El bug pasó desapercibido durante ~4 días (commit `488c931`, "chore: hardening post-auditoría", 2026-05-14). Ningún check de CI ni test lo detectó. Un guard cuesta ~50 LOC; el costo de otro orphan en una migration crítica (ej. `0035_factoring_v2_holds`) sería un endpoint roto en prod sin alerta hasta que un usuario lo ejerza.

**Update durante PO approval (2026-05-17)**: grep en `apps/api/src/` reveló que `recordStakeholderAccess` está declarada en `apps/api/src/services/consent.ts:126` pero **NO se invoca desde ningún caller**. El bug es latente pero inactivo — no hay endpoints rotos en prod hoy. La urgencia del fix baja, pero la importancia del guard se mantiene (otra orphan podría no tener esa suerte).

**Scope ampliado durante PO approval**: bundlear el fix del orphan + el guard en el mismo PR. La task spawned separada queda absorbida — la historia "test rojo → fix → test verde" en un solo PR es más coherente que dos PRs descorrelacionados.

Este spec entrega **solo el guard**. La reincorporación del `0009_stakeholder_access_log.sql` al journal vive en task separada (ya spawned), porque exige verificación previa contra Cloud SQL prod.

## 3. Success criteria

Cada criterio verificable por test, output o file existente.

- [ ] **CR-1**: Existe un test unit `apps/api/test/unit/migration-journal-integrity.test.ts` (sin DB, sin red) que carga `apps/api/drizzle/meta/_journal.json` y `ls apps/api/drizzle/*.sql`, y falla si hay divergencia en cualquiera de los dos sentidos.
- [ ] **CR-2**: El test **falla en CI** del PR de este spec (corre antes del fix del orphan) — debe reportar `0009_stakeholder_access_log` como huérfano con file path + sugerencia (renumerar o agregar al journal).
- [ ] **CR-3**: El test **pasa en CI** una vez la task separada arregla el orphan (orden de merge: este spec primero como guard, el fix después como prueba viva). Alternativa: amerged sequencing — el fix entra antes y el guard pasa de saque. Decisión en plan.
- [ ] **CR-4**: El test detecta los dos sentidos de divergencia:
  - Disk file presente, journal entry ausente → "orphan migration on disk".
  - Journal entry presente, disk file ausente → "ghost migration referenced in journal".
- [ ] **CR-5**: El test corre como parte de `pnpm --filter @booster-ai/api test` (default suite). Coverage del package sigue ≥80/75/80 sin baja.
- [ ] **CR-6**: ADR-044 documenta: el problema observado en T0, el patrón de defensa (test unit como guard), por qué no Atlas (ROI), y cuándo escalar a Atlas (criterio explícito).

## 4. Comportamiento esperado del guard

El guard es un test unit que verifica integridad estructural; **no toca DB**. Su única dependencia es el filesystem del package `apps/api`. Salida ante divergencia:

```
FAIL  test/unit/migration-journal-integrity.test.ts > journal ↔ disk parity

  Migration journal integrity violations detected:

  Orphan migration on disk (file exists, journal entry missing):
    - apps/api/drizzle/0009_stakeholder_access_log.sql
      Suggestion: agregar entrada al journal con timestamp post-último-merged
                  o renumerar el archivo (ej. 0037_*) y agregar al journal.

  Ghost migration in journal (entry exists, file missing):
    (ninguno en esta corrida)
```

## 5. Out of scope

- **No** reincorporar `0009_stakeholder_access_log` al journal (task separada).
- **No** integrar Atlas. El ROI del guard custom (50 LOC, cero dependencias) supera Atlas para Booster TRL 10. Atlas vale la pena si: (a) >100 migrations, (b) schema drift TS↔DB se vuelve recurrente, (c) Booster amplía a múltiples DBs. Criterio en ADR-044.
- **No** detectar drift entre `apps/api/src/db/schema.ts` y migrations aplicadas. Ese es un problema distinto (TS-side declara vs SQL-side aplica). Lo punteo para un eventual spec futuro si el patrón se repite.
- **No** cubrir colisiones de numeración (`0009_*` duplicado). Ese es un caso edge que se resuelve revisando el spec del PR. Si pasa, el guard actual los detectaría como dos archivos pero solo uno en journal → falla con orphan. Bueno suficiente.
- **No** verificar `applyOutOfOrderPending` semantics. Eso es responsabilidad del migrator y se ejerce en T1b integration.

## 6. Risks

| Riesgo | Mitigación |
|---|---|
| El guard genera falsos positivos durante el merge de PRs paralelos que tocan ambos (disco + journal) → race condition entre commits | Drizzle genera ambos atómicamente con `drizzle-kit generate`. El guard solo falla si alguien commiteó el `.sql` sin commitear el journal (el bug original). Trabajo manual contra la herramienta → el guard es exactamente el control deseado. |
| Guard se vuelve obstáculo si Drizzle cambia el formato del journal | Test lee con type-narrowing claro; cualquier cambio breaking de Drizzle se ve en el output del test, no en producción. Aceptable. |
| Test pasa por casualidad si ambos lados están vacíos | Edge case improbable (siempre hay ≥1 migration); igual el test puede assertar `entries.length >= 1` para defensa. |
| Orphan migration NO se aplica antes del merge del guard → CI rojo bloquea el guard mismo | Orden de merge: aceptar dos caminos (a) fix-first then guard (guard pasa de saque); (b) guard-first with skip + issue → too sketchy. Decidir en plan. Default propuesto: **(a)**. |

## 7. Test list (TDD plan)

| # | Test | Verifica | Falla actual? |
|---|---|---|---|
| 1 | `journal ↔ disk parity: no orphan on disk` | Cada `.sql` en disk tiene entry en journal | **Sí** (orphan 0009_stakeholder_access_log) |
| 2 | `journal ↔ disk parity: no ghost in journal` | Cada entry en journal tiene `.sql` en disk | No (estado actual: 36/36 entries→files) |
| 3 | `journal entries.length matches sql files when both clean` | Counts iguales | Sí (37 disk vs 36 journal) |
| 4 | `journal entries son ordenados por idx ascendente` | Sanity check del journal | No |

Test 4 es bonus — agrega defensa contra journal corrupto sin esfuerzo extra.

## 8. Constraints técnicas

- **Sin dependencias nuevas**: leer journal con `JSON.parse(readFileSync())`, leer disk con `readdirSync()`. Node stdlib.
- **Compatibilidad CI**: el path `apps/api/drizzle/` es relativo al cwd del test runner (workspace `apps/api`). Test usa `resolve(__dirname, '..', '..', 'drizzle')`.
- **No leer schema.ts**: el guard es estructural sobre archivos de migration, no semántico sobre lo que las migrations crean. Cualquier check schema-vs-DB es otro problema.

## 9. Métricas / observability

No aplican. El guard es CI-time, no runtime.

## 10. Open questions

- **Orden de merge**: ¿guard primero (con test rojo conocido y override de CI), o fix-orphan primero (guard pasa de saque)? Default propuesto: fix-orphan primero. Confirmar con PO en plan.
- **Renumerar o agregar al journal**: la decisión de cómo arreglar `0009_stakeholder_access_log` vive en la task spawned; este spec NO la fija.
- **Test 4 (idx ordering)**: ¿bonus o scope? Default: bonus (1 línea extra).

## 11. Devils-advocate scope

Skip — cambio quirúrgico, 1 archivo de test + ADR. El riesgo principal (orden de merge) está explícito en §10. Si el PO discrepa, se invoca devils-advocate post-spec.
