# Plan: fix-factoring-exposicion-y-flag

- Spec: .specs/fix-factoring-exposicion-y-flag/spec.md
- Created: 2026-06-10
- Status: Active

## Tasks

### T1: Exposición en transiciones admin (tx) + tests
- Files: apps/api/src/routes/admin-cobra-hoy.ts, apps/api/test/unit/admin-cobra-hoy.test.ts
- LOC estimate: ~80
- Depends on: none
- Acceptance: spec §10 T1–T4.
- Rollback: revert.

### T2: FACTORING_V1_ACTIVATED default false + docstring
- Files: apps/api/src/config.ts (+ test si existe cobertura de flags)
- LOC estimate: ~15
- Depends on: none (mismo commit)
- Acceptance: spec §10 T5.
- Rollback: revert.

## Out-of-band tasks

- Al activar en prod: agregar env var en infrastructure/compute.tf (service api) vía PR.
- Si existieran adelantos desembolsados pre-fix: backfill manual de current_exposure_clp.
