# Archivo: `apps/auth-blocking-functions/`

**Decomisado**: 2026-06-04 (SEC-001 boundary-closure T10, SC-G7).
**Decisión**: [ADR-057](../adr/057-google-signup-boundary-and-reaper-supersedes-054.md) supersede [ADR-054](../adr/054-google-blocking-function-signup-gate.md).

## Qué era

Cloud Function Gen 1 `beforeCreate` (Identity Platform Blocking Function) + scripts de inventario de ghost users + tests de integración (emulator, race-documents-invariant, admin-sdk-no-impact). Construida en Sprint 2c-A para gatear self-signups Google no autorizados.

## Por qué se archivó (no se borró)

La dirección quedó **abandonada**: Gen 1 deprecado, Gen 2 no verificado (validación mutante de prod). El leg Google se cierra ahora por el boundary ADR-001 + harness CI default-deny (SC-G1b) + reaper de higiene. La fuente se conserva como **referencia deny-pure del invariante** (el handler documenta la forma canónica de un fail-closed gate) y por trazabilidad.

## Cómo recuperar la fuente

La fuente completa vive en el tag anotado:

```bash
git checkout archive/auth-blocking-functions-2026-06-04 -- apps/auth-blocking-functions
# o para inspeccionar sin tocar el working tree:
git show archive/auth-blocking-functions-2026-06-04:apps/auth-blocking-functions/src/handler.ts
```

## Artefactos removidos junto con el workspace

- Infra: `infrastructure/auth-blocking-functions.tf`, `infrastructure/auth-blocking-functions-monitoring.tf`, la wire `blocking_functions` en `infrastructure/identity-platform.tf`, el binding `roles/cloudfunctions.viewer` de github-deployer en `infrastructure/iam.tf`.
- Cloud Build: steps `build-auth-blocking` / `deploy-auth-blocking` / `verify-auth-blocking-deployed` + substitution `_AUTH_BLOCKING_DEPLOY` en `cloudbuild.production.yaml`.
- CI: workflows `sprint-2c-handler-completeness.yml`, `sprint-2c-build-gate.yml`, `sprint-2c-b-deploy-gate.yml` + sus scripts (`check-handler-completeness.ts`, `check-adr-status-accepted.ts`, `check-cloud-function-deployed.ts`, `check-7d-watch-log.ts`) + tests.

Análisis de remoción (state rm vs destroy + IAM-reuse): [`.specs/sec-001-h1-2-google-boundary-closure/t10-decommission-analysis.md`](../../.specs/sec-001-h1-2-google-boundary-closure/t10-decommission-analysis.md).
