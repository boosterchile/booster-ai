# Plan: feat-cloud-run-ingress-internal-lb

- Spec: .specs/feat-cloud-run-ingress-internal-lb/spec.md
- Created: 2026-06-14
- Status: Active

## Tasks

### T1: variable `ingress` en el módulo cloud-run-service (default ALL)
- Files: infrastructure/modules/cloud-run-service/{variables.tf, main.tf}
- LOC: ~15
- Acceptance: SC-1; `ingress = var.ingress` en el recurso; validation block que acota a los 3 valores válidos; `terraform validate` OK.
- Rollback: revert.

### T2: opt-in web + api a internal-LB; sms-fallback explícito a ALL
- Files: infrastructure/compute.tf
- LOC: ~10
- Depends on: T1
- Acceptance: SC-2/SC-3/SC-4; plan = `~ ingress` en web+api, sin recreación.

### T3: fix del comentario erróneo + ADR-062
- Files: infrastructure/networking.tf (línea ~696), docs/adr/062-cloud-run-ingress-posture.md
- LOC: ~70
- Depends on: T2
- Acceptance: SC-5/SC-6; check-adr-numbering verde.

### T4: VERIFY — terraform validate + plan inspeccionado + verify.md
- Files: .specs/feat-cloud-run-ingress-internal-lb/verify.md
- Depends on: T3
- Acceptance: T1/T2/T3 de la spec; plan adjunto mostrando update in-place.

## Notas
- El apply NO se ejecuta en este ciclo (lo hace el PO, spec §11).
- REVIEW: devils-advocate + security-auditor (toca seguridad de red) antes de cerrar.
