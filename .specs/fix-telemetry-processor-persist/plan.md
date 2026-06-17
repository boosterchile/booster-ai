# Plan: fix-telemetry-processor-persist

- Spec: .specs/fix-telemetry-processor-persist/spec.md
- Created: 2026-06-10
- Status: Active

## Tasks

### T1: Lookup IMEI→vehiculo para vehicleId null + warn en descarte
- Files: apps/telemetry-processor/src/persist.ts, apps/telemetry-processor/test/persist.test.ts
- LOC estimate: ~45
- Depends on: none
- Acceptance: spec §10 T1–T3.
- Rollback: revert.

### T2: Primer punto vía SELECT 1 LIMIT 2 (elimina COUNT(*) del hot path)
- Files: apps/telemetry-processor/src/persist.ts, apps/telemetry-processor/test/persist.test.ts
- LOC estimate: ~15
- Depends on: none (mismo commit)
- Acceptance: spec §10 T4–T5.
- Rollback: revert.
