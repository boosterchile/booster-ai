# E2E conductor con Auth emulator (Slot 3, paso 6)

**Estado**: aceptada (brief #5 del PO, 2026-09-21) · **Rama**: `cursor/conductor-e2e-auth-emulator-7907` · **Base**: `origin/main` @ `34f000a` (#692)

**Slot**: paso 6 del Slot 3 «Conductor operativo» (`docs/frentes-vivos.md`): *«`connectAuthEmulator` en `apps/web` y el E2E del flujo completo»*. Criterio de término del slot.

**Excepción explícita del PO** (Felipe Vicencio, `dev@boosterchile.com`, 2026-09-21): continuar y mergear cuando CI+review+smoke lo justifiquen. Este trabajo **es** el paso 6 del Slot 3; no abre frente nuevo. **No se modifica** `docs/frentes-vivos.md`. Patrón PR: igual que #689–#692.

GPS resiliente (#686), vista ruta/resultado (#687) e higiene (#688) ya están en `main`; no se reimplementan.

## 1. El problema

`apps/web` pega Identity Platform de prod en `signInWithCustomToken`. Sin `connectAuthEmulator`, el flujo conductor no se camina en un navegador local ni en CI contra API + emulador `:9099`. El Slot 3 no puede cerrar: el criterio exige Playwright verde del flujo activar → recogida → posición → entrega → certificado (o degradación honesta).

## 2. Regla de producto

- Flag de env `VITE_USE_AUTH_EMULATOR` (default `false`; `"true"`/`"1"` enciende, `"false"`/`"0"`/ausente apaga — mismo anti-footgun que `booleanFlag`).
- Con el flag **on**, `connectAuthEmulator` apunta **solo** a loopback (`http://127.0.0.1:9099` por defecto; override `VITE_AUTH_EMULATOR_URL` si el host es loopback). **Nunca** Identity Platform de prod: no hay fallback silencioso.
- Con el flag **on** no se inicializa App Check (reCAPTCHA v3 pegaría a Google). Con el flag **off** el cableado actual no cambia.
- E2E Playwright del flujo conductor contra API local `:8080` + Auth emulator `:9099` + web `:5173`.
- Certificado: en CI/local **no** se exige PDF emitido si falta `CERTIFICATES_BUCKET` / KMS. Basta entrega confirmada + métricas visibles y/o «Certificado en proceso» / degradación explícita. Un 503 de storage **no** tumba el E2E (mismo FAIL_ENV honesto que #692).
- Gate de rol: usuario ≠ conductor en `/app/conductor` → redirect `/app`.
- Waits explícitos (`expect` / `waitForURL` / `waitForRequest`); cero `waitForTimeout` ciego.
- Copy vos rioplatense solo en strings **nuevos** de UI. Este paso no agrega pantallas; el copy existente del conductor queda.

## 3. Entradas y salidas

**Web**

- `apps/web/src/lib/env.ts`: `VITE_USE_AUTH_EMULATOR`, `VITE_AUTH_EMULATOR_URL` opcional.
- `apps/web/src/lib/firebase.ts`: si el flag está on, `connectAuthEmulator` a loopback y sin App Check.
- Playwright: `apps/web/e2e-conductor/` + `playwright.conductor.config.ts`. Target: `pnpm --filter @booster-ai/web test:e2e:conductor`.

**API (soporte del E2E, no contrato público nuevo)**

- `getFirebaseApp`: si `FIREBASE_AUTH_EMULATOR_HOST` está seteado, inicializa **sin** ADC (el emulador no pide credenciales reales).
- Seed T2: `apps/api/scripts/seed-conductor-e2e.ts` — Gen `72727272-0`, Tra `70707070-6`, Cond `71717171-3`, clave `482913`. Asignación activa sin Teltonika.

**CI**

- Job en `.github/workflows/e2e-pr.yml` (workflow Playwright de PR ya existente; no se tocan quality gates de `ci.yml`). Postgres + Redis services, Auth emulator, API local, seed, Playwright Chromium. Exit 0 en PR a `main`.
- El check `E2E conductor (Auth emulator + API local)` se publica en **todo** `pull_request` a `main` (skip documentado `exit 0` si el diff no toca superficie E2E). Queda listo para required en branch protection; Slot 3 CI cierra cuando ops humana de GitHub marque ese check.

## 4. Criterios de salida

- [ ] Flag + `connectAuthEmulator` cableado; tests unitarios: on → emulador loopback y sin App Check; off → Identity Platform / App Check como hoy; host no-loopback → throw (no prod).
- [ ] Spec en `.specs/conductor-e2e-auth-emulator/`.
- [ ] E2E Playwright: login conductor T2 → asignación en `/app/conductor` → confirmar recogida → ≥1 `POST …/driver-position` (geolocation mock) → confirmar entrega → resultado visible (métricas y/o «Certificado en proceso» / degradación). Gate rol cubierto.
- [ ] Typecheck + biome + harness OK.
- [ ] PR draft a `main` con `## Evidencia`.

## 5. Fuera de alcance

- Rehacer GPS resiliente / mapa eco-route / ResultadoViaje.
- Fleet, retorno, armado camión, reoptimizar, score, mantención.
- Worker TED, Sovos, emitir DTE.
- Cobertura ≥80 % prod GPS.
- `docs/frentes-vivos.md`, ADRs, quality gates de `ci.yml`.
- `--dangerously-skip-permissions`.
