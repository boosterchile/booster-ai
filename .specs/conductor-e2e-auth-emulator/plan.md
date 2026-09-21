# Plan — E2E conductor + Auth emulator

Orden: spec → helper loopback (TDD) → flag + `connectAuthEmulator` → ADC skip en API → seed T2 → Playwright → job en `e2e-pr.yml` → evidencia.

1. **Spec** — este directorio (`spec` / `plan` / `verify`).
2. **Helper puro** — `apps/web/src/lib/auth-emulator.ts`: origen loopback, default `http://127.0.0.1:9099`, throw si el host no es loopback.
3. **Env + Firebase client** — `VITE_USE_AUTH_EMULATOR` anti-footgun; con flag on: skip App Check + `connectAuthEmulator`; con flag off: idéntico a `main`.
4. **API Admin SDK** — `FIREBASE_AUTH_EMULATOR_HOST` seteado → `initializeApp({ projectId })` sin ADC.
5. **Seed T2** — `apps/api/scripts/seed-conductor-e2e.ts` (idempotente: upsert users/empresas; cancela asignaciones E2E viejas; inserta viaje `asignado` sin Teltonika).
6. **Playwright** — `e2e-conductor/` + `playwright.conductor.config.ts` + script `test:e2e:conductor`. Waits explícitos. Geolocation mock. Certificado no bloquea.
7. **CI** — job nuevo en `.github/workflows/e2e-pr.yml` (no `ci.yml`): postgres 15 + redis 7 + Auth emulator `:9099` + API `:8080` + preview `:5173`.
8. **Evidencia** — vitest (rojo exhibido del helper/firebase + verde), typecheck, biome, y el E2E en CI o documentado.
