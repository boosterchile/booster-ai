# Verify — impersonación auditada backend

Evidencia fresca (Node 24, corrida en el momento). TDD de seguridad: cada test
se escribió PRIMERO y se vio fallar en ROJO (módulo/función inexistente) antes de
implementar. Rojos exhibidos durante la construcción (ver historial del PR).

## Criterios del goal → cobertura

| Criterio | Dónde | Estado |
|---|---|---|
| Trust boundary: no-admin→403, admin→admin→403, solo admin→no-admin emite, rate-limit activo | `routes/auth-impersonate.test.ts` (8) + `services/impersonation.test.ts` (6) + `middleware/rate-limit-impersonate.test.ts` (3) | ✅ |
| Guard central enumera POST/PUT/PATCH/DELETE; impersonado+no-demo+mutante→403; impersonado+demo→permitido; sesión normal sin cambios | `middleware/impersonation-write-guard.test.ts` (13) | ✅ |
| Cobertura de CADA ruta mutante (sin gap) | `scripts/check-impersonation-wire-completeness.ts` + `test/impersonation-wire-completeness.test.ts` (4, contra server.ts real) | ✅ |
| Atribución: toda mutación impersonada registra `impersonated_by`; cada inicio crea fila en `eventos_impersonacion` | guard logs (write_blocked/write_allowed) + route test (INSERT) + integration round-trip | ✅ |
| Sesión = target; token normal sin `impersonated_by` | `middleware/user-context.test.ts` (3) + route test (createCustomToken sobre UID target) | ✅ |
| Migración aplicada + reversible | `drizzle/0049_*.sql` + `drizzle/down/0049_*.down.sql` + journal + `test/integration/impersonation-events.integration.test.ts` | ✅ (integration corre en CI) |

## Salidas (corridas en el momento)

```
# TESTS de impersonación (6 archivos)
 Test Files  6 passed (6)
      Tests  37 passed (37)

# Suite unit completo del api (sin regresiones)
 Test Files  146 passed (146)
      Tests  1762 passed | 2 skipped (1764)

# typecheck
tsc --noEmit → OK

# build (api bundlea workspace packages)
ESM ⚡️ Build success

# biome check (18 archivos nuevos/cambiados) → sin errores

# coverage global (thresholds 80/75/75/80)
All files | 86.25 stmts | 78.4 branch | 88.95 funcs | 86.36 lines  → PASA
impersonation-write-guard.ts | 100 | 87.5 | 100 | 100

# gate wire-completeness
[check-impersonation-wire-completeness] OK — todos los mount points auth-required tienen el guard

# gate migration-safety (0049)
[check-migration-safety] OK — sin DDL destructivo no declarado
```

## No verificado localmente (corre en CI)

- **Integration tests** (`impersonation-events.integration.test.ts` + migración
  aplicada al Postgres de test): no hay `TEST_DATABASE_URL`/pg local. Corre en el
  job `integration-tests`.
- **Docker build**: corre en el job `docker-build`. No se agregaron deps externas
  nuevas al api → sin cambios de bundling.

---

## Parte 3 — Frontend (evidencia fresca, Node 24)

TDD: hook + banner + picker escritos con test primero (rojo), luego verde.

| Criterio | Dónde | Estado |
|---|---|---|
| Picker lista usuarios es_demo + "Ver como" (D2, sin hardcode) | `GET /auth/impersonate/targets` + `ImpersonationPicker(.test)` | ✅ |
| Banner por `impersonated_by`, fijo, imposible de ignorar, Salir | `ImpersonationBanner(.test)` (role=alert, danger, D2) | ✅ |
| Salir → signOut + /login | banner container test + E2E | ✅ |
| `useImpersonation()` lee el claim | `use-impersonation(.test)` | ✅ |
| 503 (flag OFF) manejado con gracia | picker container test (estado "desactivada") | ✅ |
| vitest-axe picker + banner | ambos test files | ✅ |
| E2E flujo picker→banner→salir→login (Chromium) | `e2e-local/impersonation.spec.ts` vía `/apariencia/impersonacion` | ✅ |

```
# Tests de impersonación frontend (hook + banner + picker)
 Tests  34 passed  (use-impersonation 4 + banner 8 + picker 10 + ... )

# Suite unit completo WEB (sin regresiones; __root actualizado)
 Test Files  121 passed (121)   Tests  1155 passed

# Suite unit completo API (endpoint targets; sin regresiones)
 Test Files  147 passed (147)   Tests  1766 passed | 2 skipped

# E2E Chromium (build + preview + flujo real de los *View)
 1 passed (12.1s)  picker → ver como → banner → salir → login

tsc --noEmit (web + api)  → OK
biome check (15 archivos) → sin errores
build web + api           → ✓ built / Build success
coverage web (80/75/75/80): 83.78 stmts | 78.02 branch | 82.7 funcs | 83.76 lines → PASA
gates api (wire-completeness + route default-deny + wire test) → verde
```

**Frontera:** el ciclo entrar/salir es el sellado (Salir = re-login como admin,
sin restaurar sesión). La caducidad de la ventana impersonada depende de N1
(token corto) — sin cambios respecto al backend.
