# Plan: ops-eliminar-deploy-phase-2

- Spec: .specs/ops-eliminar-deploy-phase-2/spec.md
- Created: 2026-06-10
- Status: Active

## Tasks

### T1: Runbook rotacion-maps-api-key.md + git rm deploy-phase-2.sh
- Files: docs/runbooks/rotacion-maps-api-key.md (nuevo), deploy-phase-2.sh (eliminado)
- LOC estimate: ~70 (runbook)
- Depends on: none
- Acceptance: spec §10 T1–T3.
- Rollback: git revert.
