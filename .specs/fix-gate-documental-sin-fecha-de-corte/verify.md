# Verificación — gate documental sin fecha de corte

Corrido el 2026-09-13 sobre `fix/gate-documental-sin-fecha-de-corte` (base `main` 92ab7dc), node 24.17.0.

## Rojo exhibido

```
$ vitest run src/services/puede-cerrar-con-documentos.test.ts
 × sin fecha de corte (null) y flag ON, el guard NO aplica: la orden cierra sin documento
 × sin fecha de corte, tampoco exige TED aunque REQUIRE_TED_DECODE esté ON
AssertionError: expected false to be true
 Tests  2 failed | 9 passed (11)
```

## Verde

```
$ vitest run src/services/puede-cerrar-con-documentos.test.ts
 Test Files  1 passed (1) · Tests  11 passed (11)

$ pnpm --filter @booster-ai/api test
 Test Files  167 passed (167) · Tests  2030 passed (2030)

$ pnpm --filter @booster-ai/api typecheck   → exit 0
$ biome check (servicio + test)             → 0 errores
```

Ningún test de integración ni E2E fija `REQUIRE_DOCUMENT_TO_CLOSE_SINCE` ausente
(grep sobre `apps/api/test/integration`, `apps/web/e2e`, `apps/web/e2e-local`).
