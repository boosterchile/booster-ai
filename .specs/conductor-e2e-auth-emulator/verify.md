# Verificación — E2E conductor + Auth emulator

Corrido sobre la rama `cursor/conductor-e2e-auth-emulator-7907`. Base `origin/main` @ `34f000a`.

## 1. TDD — rojo exhibido

Helper de loopback y `connectAuthEmulator` (tests escritos **antes** de la implementación):

```
$ pnpm --filter @booster-ai/web exec vitest run src/lib/auth-emulator.test.ts src/lib/firebase.test.ts
```

Rojo pre-implementación (sesión de construcción):

- `src/lib/auth-emulator.ts` no existía → fail al importar `resolveAuthEmulatorOrigin`.
- `flag ON`: `connectAuthEmulator` no se invocaba; App Check seguía inicializándose.
- API `getFirebaseApp`: con `FIREBASE_AUTH_EMULATOR_HOST` todavía llamaba `applicationDefault()` (ADC).

## 2. Verde (esta rama)

```
$ pnpm --filter @booster-ai/web exec vitest run src/lib/auth-emulator.test.ts src/lib/firebase.test.ts
 Test Files  2 passed (2)
      Tests  15 passed (15)

$ pnpm --filter @booster-ai/api exec vitest run test/unit/firebase-singleton.test.ts
 Test Files  1 passed (1)
      Tests  7 passed (7)

$ pnpm --filter @booster-ai/web typecheck   # tsc --noEmit OK
$ pnpm --filter @booster-ai/api typecheck    # tsc --noEmit OK
$ biome check <archivos tocados>            # 16 files, No fixes applied
```

E2E Playwright: `pnpm --filter @booster-ai/web test:e2e:conductor`

- **CI**: job `e2e-conductor` en `.github/workflows/e2e-pr.yml` (Postgres 15 + Redis 7 + Auth emulator `:9099` + API `:8080` + Chromium). Exit 0 esperado en PRs que toquen `apps/web/**` o este spec.
- **Local** (Mac de Felipe / cualquier clone): Postgres + Redis + `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` + `VITE_USE_AUTH_EMULATOR=true` + API `:8080`. Esta VM de agente no tiene Docker/Postgres/Redis; el camino de evidencia del flujo browser es el job de CI.

## 3. Certificado (FAIL_ENV honesto)

No se exige PDF. El E2E acepta: «Entrega confirmada» + `#resultado-viaje` con métricas, «Certificado en proceso», «La huella se está calculando» o el aviso de degradación. Un 503 de storage no falla el test.
