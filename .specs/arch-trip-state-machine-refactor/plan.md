# Plan: arch-trip-state-machine-refactor

- Spec: .specs/arch-trip-state-machine-refactor/spec.md (v2)
- Created: 2026-06-11
- Status: Complete

## Tasks

### T1 [DONE 2026-06-11]: Package real (estados + tabla + guards + errores) con TDD
- Files: packages/trip-state-machine/src/{index,estados,transiciones}.ts (+tests), package.json, vitest.config.ts
- LOC estimate: ~90 src + ~120 tests
- Acceptance: spec §10 T1–T5; coverage ≥80.
- Rollback: revert (stub vuelve).

### T2 [DONE 2026-06-11]: Paridad enum DDL ↔ package en apps/api
- Files: apps/api/test/unit/trip-state-machine-parity.test.ts
- LOC estimate: ~25
- Depends on: T1
- Acceptance: T6.

### T3 [DONE 2026-06-11]: Reconducir services + CAS en matching
- Files: apps/api/src/services/{matching,offer-actions,confirmar-entrega-viaje}.ts, apps/api/src/routes/trip-requests-v2.ts (+ ajustes de tests existentes)
- LOC estimate: ~90
- Depends on: T1
- Acceptance: T7 + suites existentes verdes; `git grep` sin Sets locales de estados de trip en services.
- Rollback: revert.

### T4 [DONE 2026-06-11]: ADR-061 (desviación de ADR-004)
- Files: docs/adr/061-trip-lifecycle-tabla-transiciones-pura.md
- LOC estimate: ~70
- Depends on: T3
- Acceptance: SC-7; check-adr-numbering verde.
