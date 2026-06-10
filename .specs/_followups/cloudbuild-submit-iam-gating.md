# Follow-up: gatear a nivel IAM quién puede ejecutar builds de producción

**Origen**: Eliminación de deploy-phase-2.sh (`.specs/ops-eliminar-deploy-phase-2/`, 2026-06-10) + seguimiento "Tooling operacional fuera de CI/CD" de la auditoría 2026-06-09.
**Prioridad**: P2.

## Problema

El gate de aprobación humana del deploy vive SOLO en GitHub Actions (Environment `production` con required_reviewers). La API de Cloud Build no está gateada: cualquier principal con `cloudbuild.builds.create` en el proyecto puede `gcloud builds submit --config=cloudbuild.production.yaml` desde una laptop y desplegar a prod sin CI ni aprobación (el vector de deploy-phase-2.sh, ya eliminado, pero la capacidad IAM persiste).

## Acción propuesta

- Auditar qué principals tienen `cloudbuild.builds.create`/`editor` hoy (humanos vía grupos Workspace + SAs).
- Restringir el rol a `github-deployer@` (WIF) y decidir el flujo de emergencia humano (¿break-glass documentado con justificación en ledger? ¿rol otorgable por tiempo acotado vía PAM de Google?).
- Considerar `gcloud builds submit` bloqueado por org policy o condición IAM si Cloud Build lo soporta para el caso.

## Estado

Pendiente. Requiere decisión PO sobre el flujo de emergencia antes de restringir.
