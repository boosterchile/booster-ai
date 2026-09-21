# Verify: retiro-es-demo-auth-hot-path

## Rojo (antes de desmontar `server.ts`)

`pnpm --filter @booster-ai/api exec vitest run test/scripts/auth-hot-path-no-demo-enforcement.test.ts`

```
FAIL  test/scripts/auth-hot-path-no-demo-enforcement.test.ts > auth hot path sin enforcement es_demo > server.ts no importa ni monta demoExpires ni isDemoEnforcement
AssertionError: enforcement demo reintroducido: createDemoExpiresMiddleware, createIsDemoEnforcementMiddleware, demoExpiresMiddleware, isDemoEnforcementMiddleware, from './middleware/demo-expires, from './middleware/is-demo-enforcement: expected [ ... ] to deeply equal []

 Test Files  1 failed (1)
      Tests  1 failed | 4 passed (5)
```

El fallo lista los seis markers que `server.ts` tenía en el chain de cada request autenticado.

## Verde

- `vitest` del guard + parser + impersonación + firebase-auth + demo-expires + is-demo-enforcement: 6 files, 57 tests, pass.
- `pnpm --filter @booster-ai/api test`: 175 files, **2142 passed**.
- `pnpm --filter @booster-ai/api exec tsc --noEmit`: exit 0.
- `biome check` de los archivos tocados: exit 0.
- `pnpm --filter @booster-ai/api exec tsx scripts/check-is-demo-wire-completeness.ts`: `OK — server.ts no monta ni importa enforcement demo en el hot path.`
- `check-impersonation-wire-completeness.ts`: OK (el parser compartido sigue cubriendo el guard de impersonación).

Node local del agente: v22.14.0 (el repo pide >=24). El typecheck y la suite unitaria corrieron igual; CI usa Node 24.
