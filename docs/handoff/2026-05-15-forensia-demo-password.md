# OPS-X — Forensia password-spray retroactivo (2026-05-15)

**Status**: CLOSED CLEAN. R17 NO activado. Proceder a OPS-1.

## Executive summary

El password literal `BoosterDemo2026!`, compartido en código source (`seed-demo.ts:86`, `seed-demo-startup.ts:142`) y en commits públicos del repo `boosterchile/booster-ai` entre `8400542` (2026-05-10) y `ec86cfd` (2026-05-13), NO está siendo usado actualmente por ninguna cuenta no-demo del tenant Firebase Auth `booster-ai-494222`.

Esto NO descarta exposición pasada (R21 sigue siendo riesgo residual histórico, mitigado por OPS-Y monitoring) pero confirma que la rotation H1.1 (OPS-1) puede proceder sin destruir evidencia activa de cadena de ataque.

## Método

Script `infrastructure/scripts/forensia-demo-password.ts` (~160 LOC) ejecuta:

1. **Sanity (positive control)**: `signInWithPassword` REST contra las 4 cuentas demo con literal. Esperado: 4/4 200 OK.
2. **Spray (real test)**: idem contra las 4 cuentas no-demo con password local. Esperado: 4/4 400 INVALID_LOGIN_CREDENTIALS.

Self-throttle 220ms (<=5 req/s) para no triggear alertas tenant.

## Resultados

### Sanity (ejecutado primero, 2026-05-15)

| UID | Email | Status | Esperado |
|---|---|---|---|
| nQSqGqVCHGUn8yrU21uFtnLvaCK2 | demo-shipper@boosterchile.com | 200 ✓ | match |
| s1qSYAUJZcUtjGu4Pg2wjcjgd2o1 | demo-carrier@boosterchile.com | 200 ✓ | match |
| Uxa37UZPAEPWPYEhjjG772ELOiI2 | demo-stakeholder@boosterchile.com | 200 ✓ | match |
| Gg9k3gIPa1cJZtgKC0RRkWQ0QHJ3 | drivers+123456785@boosterchile.invalid | **400** | match (anomalía) |

3/4 esperado. Conductor anomaly → ver sección dedicada.

### Spray (ejecutado segundo, 2026-05-15)

| UID | Email | Status | Esperado |
|---|---|---|---|
| tBZtLbhurnWyCdTObdMiUKkhllE3 | fvicencio@gmail.com | 400 ✓ | no-match |
| rCY9ZKFbfPWCh6XOJQxkIaUhwxZ2 | pensando@fueradelacaja.co | 400 ✓ | no-match |
| 9iTEKErBinemdNhRK9GGXdr3uxt2 | contacto@boosterchile.com | 400 ✓ | no-match |
| eMSaQTM7TbMWpOpTCOwfV7vnvzp1 | dev@boosterchile.com | 400 ✓ | no-match |

**4/4 expected. ZERO matches.**

## Anomalía conductor (resuelta)

La cuenta `drivers+123456785@boosterchile.invalid` retornó 400 en sanity, contra lo afirmado en `docs/qa/demo-accounts-inventory.md` (PF-5.1).

### Causa raíz

PF-5.1 fue verificación por code inspection (grep + lectura de `seed-demo-startup.ts:142`), no test empírico. La code path real:

1. **Seed crea conductor**: `seed-demo.ts:872` llama `generateActivationPin()` (6 dígitos random crypto-random), almacena hash en `activationPinHash`, firebaseUid = `pending-rut:...`.
2. **Activación via `/auth/driver-activate`** (en algún momento del sprint demo D1): handler en `auth-driver.ts:142` ejecuta `auth.updateUser(firebaseUid, { password: body.pin })`. **Password Firebase = PIN literal**, no el literal demo.
3. **DB cleanup** post-activate: `activationPinHash = null`, firebaseUid = real.
4. **Cold-starts subsequent**: `ensureConductorDemoActivated` chequea `firebaseUid.startsWith('pending-rut:')`. Real UID → early return. El password NO se sobreescribe al literal `BoosterDemo2026!`.

### Estado real del conductor demo

- Password Firebase = PIN 6-dígit random (10^6 combos).
- Plaintext ephemeral: solo existió en RAM/clipboard durante activate.
- Brute-force offline: trivial con hash (~1M attempts), pero hash no está expuesto.
- Brute-force online: mitigado por Firebase Auth rate-limit.

### Implicación para OPS-1

`harden-demo-accounts.ts` (T3) hace `auth.updateUser({ password: <random> })`. Sobreescribe el PIN actual independiente de su valor. Conductor entra al hardening normalmente, score igual a los 3 owners.

## Implicación para inventory

`docs/qa/demo-accounts-inventory.md` entry conductor afirma password = `Boost***2026!` activo. **EMPÍRICAMENTE INCORRECTO**. Corregido en este commit.

## Próximos pasos

- T6 (seed refactor → Secret Manager): siguiente en plan v3.1.
- T3 (script harden-demo-accounts.ts): después de T6.
- OPS-1 (rotation): después de T3, cierra SEC-001.

## Refs

- Plan v3.1: `.specs/security-blocking-hotfixes-2026-05-14/plan.md` T12a + OPS-X
- Spec: `.specs/security-blocking-hotfixes-2026-05-14/spec.md` §3 H1.5 + §9 R21
- ADR-040: decisión Opción C sobre compromise residual git history
- Script: `infrastructure/scripts/forensia-demo-password.ts` (commit `a962f47`)
- Report JSON sanity: `/tmp/forensia-result-1778811968727.json`
- Report JSON spray: `/tmp/forensia-result-1778853265886.json`
