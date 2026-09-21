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

Corrido en esta VM contra Postgres 16 local + Redis 7 + Auth emulator `:9099` + API `:8080` + preview `:5173` (2026-09-21):

```
> playwright test -c playwright.conductor.config.ts
seed T2 conductor E2E listo
  2 passed (14.8s)
::notice title=🎭 Playwright Run Summary::  2 passed (14.8s)
```

- Flujo: login T2 → `/app/conductor` → `POST …/driver-position` → confirmar recogida → confirmar entrega → resultado visible.
- Gate rol: dueño generador en `/app/conductor` vuelve a `/app`.
- **CI**: el mismo target corre en el job `e2e-conductor-run` de `.github/workflows/e2e-pr.yml`. El check `E2E conductor (Auth emulator + API local)` se publica en todo PR a `main` (skip documentado si el diff no toca superficie E2E) y queda listo para required en branch protection; Slot 3 CI cierra tras ese setting (ops humana de GitHub).

## 3. Certificado (FAIL_ENV honesto)

No se exige PDF. El E2E acepta: «Entrega confirmada» + `#resultado-viaje` con métricas, «Certificado en proceso», «La huella se está calculando» o el aviso de degradación. Un 503 de storage no falla el test.
