# verify — Extender `lint-rls` a `services/` y `jobs/` (+ raw SQL)

Evidencia fresca corrida en la rama `feat/lint-rls-services-jobs` (worktree aislado, base `origin/main` @ b10519c), 2026-07-18.

## 1. TDD — rojo exhibido → verde

Test co-located `scripts/lint-rls.test.mjs` (node:test; scripts/ raíz no está en el vitest workspace, mismo criterio que `check-migration-safety.test.mjs`).

**ROJO** (contra la versión con solo el comportamiento previo, antes de fix-1/fix-2/+4):

```
ℹ tests 15
ℹ pass 8
ℹ fail 7
```
Los 7 rojos mapean 1:1 a lo que faltaba implementar:
- fix-1: `NO flaggea Buffer.from / Array.from` (el matcher previo flaggeaba `saltHex`).
- fix-2: `flaggea raw db.execute(sql`… FROM vehiculos …`)` y `flaggea pool.query(`… viajes …`)` (0 cobertura de raw).
- T3: `TENANT_FREE_TABLES incluye {solicitudesRegistro, matchingBacktestRuns, empresas, membershipTiers}` (×4).

**VERDE** (tras implementar fix-1 + fix-2 + SCAN_DIRS + tenant-free +4, y agregar el test de integración main/walk):

```
ℹ tests 17
ℹ pass 17
ℹ fail 0
```

## 2. `pnpm lint:rls` = 0 sobre routes + services + jobs

```
✅ lint-rls: 0 queries sin filtro empresaId fuera de allowlist.   (exit 0)
```
Escanea las 3 capas (`SCAN_DIRS = [routes, services, jobs]`).

## 3. Findings crudos y anotaciones (T1/T2/T4)

- **28 findings** tras fix-1 + SCAN_DIRS, **todos Drizzle en `services/`**. `jobs/` = 0 (Drizzle y raw).
- **Raw SQL findings = 0** (resultado real de T2): todos los sitios raw de `services/`+`jobs/` tocan solo tablas tenant-free (`usuarios`, `solicitudes_registro`, `posiciones_movil_conductor`) o usan tabla dinámica `${fk.table}` (invisible a matching textual, BYPASSRLS-by-design ya inventariado en `rls-viabilidad.md` §2D/§3). fix-2 verificado sobre código real: alcanza los `pool.query` multilínea reales (flaggea `reap-orphan-onboarding-firebase.ts:184/198` si se trata `solicitudes_registro` como scoped).
- **28 anotaciones `// rls-allowlist:`** aplicadas transcribiendo el inventario del censo (§2 nota C / §3) y `rls-viabilidad.md` (§2/§3): pipeline scoped-por-id-validado (tripId/assignmentId/vehicleId), matching core cross-tenant, tracking público por token, backtest platform-admin, notificadores server-side.
- **Regla de abort: 0 findings sin clasificar.** Cada uno verificado contra el código vivo (los line-numbers del censo del 14-jul drift-earon un mes): todos son scoped por id validado (equality en PK) o cross-tenant documentado. 3 archivos no name-checked por el censo (`persist-eco-route-polyline`, `notify-incident-shipper`, `notify-tracking-link`) verificados individualmente → caen en categorías (1) y (3). **Sin IDOR, sin escalamiento al PO.**

## 4. Gates de la casa

| Gate | Resultado |
|---|---|
| `pnpm lint` (biome check . && lint:rls) | **exit 0** (0 errores, 13 warnings pre-existentes) |
| `pnpm typecheck` (turbo, 32 paquetes `tsc --noEmit`) | **32/32 successful → exit 0** |
| Coverage del linter (node --test, gate 80/75/80) | **lines 97.69 / branch 90.00 / funcs 100.00** → exit 0 |
| Test (`node --test scripts/lint-rls.test.mjs`) | **17/17** |

## 5. Cero runtime diff

Diff = `scripts/lint-rls.mjs` (matcher) + `scripts/lint-rls.test.mjs` (nuevo) + 28 comentarios `// rls-allowlist:` en 14 archivos de `services/`. **Ninguna query de negocio modificada; ninguna lógica de runtime tocada** (criterio §6 del spec).
