# Plan: fix-viajes-cancel-accept-race

- Spec: .specs/fix-viajes-cancel-accept-race/spec.md
- Created: 2026-06-10
- Status: Active

## Tasks

### T1: Guard de estado del trip en acceptOffer + error tipado + mapeo 409
- Files: apps/api/src/services/offer-actions.ts, apps/api/src/routes/offers.ts, apps/api/test/unit/offer-actions.test.ts, apps/api/test/unit/offers.test.ts
- LOC estimate: ~80
- Depends on: none
- Acceptance: spec §10 T1–T4, T7 verdes.
- Rollback: revert commit.

### T2: Cancel transaccional con FOR UPDATE + invalidación de ofertas pendientes
- Files: apps/api/src/routes/trip-requests-v2.ts, apps/api/test/unit/trip-requests-v2.test.ts
- LOC estimate: ~70
- Depends on: none (mismo commit que T1 para atomicidad del fix)
- Acceptance: spec §10 T5–T6 verdes.
- Rollback: revert commit.

## Out-of-band tasks

- El refactor TSM (.specs/arch-trip-state-machine-refactor/) debe absorber estos guards como tabla de transiciones.
