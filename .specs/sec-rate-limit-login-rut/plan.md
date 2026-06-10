# Plan: sec-rate-limit-login-rut

- Spec: .specs/sec-rate-limit-login-rut/spec.md
- Created: 2026-06-10
- Status: Active

## Tasks

### T1: Generalizar prefijos en rate-limit-pin + tests
- Files: apps/api/src/middleware/rate-limit-pin.ts, apps/api/src/middleware/rate-limit-pin.test.ts
- LOC estimate: ~30
- Depends on: none
- Acceptance: spec §10 T1, T5 verdes.
- Rollback: revert.

### T2: Wiring requerido en auth-universal + server.ts + tests
- Files: apps/api/src/routes/auth-universal.ts, apps/api/src/server.ts, apps/api/test/unit/auth-universal.test.ts
- LOC estimate: ~40
- Depends on: T1
- Acceptance: spec §10 T2–T4 verdes; suite auth-universal completa verde.
- Rollback: revert.
