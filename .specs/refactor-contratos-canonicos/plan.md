# Plan: refactor-contratos-canonicos

- Spec: .specs/refactor-contratos-canonicos/spec.md
- Created: 2026-06-11
- Status: Complete

### T1: telemetryRecordMessageSchema en shared-schemas + processor re-export [DONE 2026-06-11]
### T2: gateway buildWireRecordMessage + test de contrato (BigInt/Buffer) [DONE 2026-06-11]
### T3: borrar 4 archivos muertos ADR-004 + index + all-schemas.test [DONE 2026-06-11]

Verificación: shared-schemas 210, processor 38, gateway 34 tests; typecheck
api/web/processor/gateway/shared-schemas OK; git grep vocabulario muerto = 0.
