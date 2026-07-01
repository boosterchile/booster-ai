# Checklist de acciones del owner — cierre del backlog `_followups` (2026-06-22)

Barrido completo de los 47 stubs. **~36 cerrados** (17 PRs #509–#524 + ya-hechos +
moot/deuda-aceptada). Los **~11 restantes NO son agent-resolvables**: cada uno
requiere un insumo humano/infra que un agente no puede aportar. Acá está la acción
**exacta** para cerrar cada uno.

## Primero: mergear los 17 PRs de la sesión

`gh pr list --author @me --state open` (#509–#524). Orden sugerido: los de código/test
verdes primero; **#511 y #520 además requieren `terraform apply`** del owner tras merge;
#521 (canary-tag) y #524 (snapshots) son no-op hasta el próximo deploy.

## Acciones del owner — un insumo cada una

| # | Finding | Acción EXACTA | Insumo que solo vos tenés |
|---|---|---|---|
| 1 | **segundo-canal-alertas** | `var.sre_webhook_url = "<URL>"` en tfvars + `terraform apply` (el canal ya está cableado, #519). | URL del webhook Slack/Telegram |
| 2 | **castellanizar-adr-headers** | Decir "sí, castellanizá los 32 headers ADR (Status→Estado, Date→Fecha)" → lo hago en un PR. | Permiso para editar ADRs (CLAUDE.md me lo prohíbe sin tu OK) |
| 3 | **flaky-signup** | Correr `vitest --repeat=20` con Docker/Postgres + pegarme el output (o un trace). Ya descarté 2 hipótesis (#523); con la repro aíslo la causa y mando el fix. | Docker (ausente en mi entorno) |
| 4 | **P0-E** (Firebase dev/prod) | Resolver las 4 decisiones abiertas de ADR-055 (project-id, estructura TF, scope de réplica) → recién ahí scaffolding. | Crear proyecto GCP + rotar reCAPTCHA + decisiones ADR-055 |
| 5 | **app-check-enforcement** | Tras deploy de #401: ver App Check → Métricas, confirmar tráfico verificado, y **recién ahí** activar enforcement. Activarlo en 0/0 = outage. | Observación de tráfico real + Firebase Console |
| 6 | **main-branch-protection-iac** | Agregar provider `integrations/github` + PAT admin + `terraform import` de la protección (snapshot en el stub, #524). | PAT con scope admin (secreto) |
| 7 | **P0-C** historia git | Decisión legal: ¿`git filter-repo` de los UIDs en commits viejos? (el código vivo ya está limpio, #496). | Sign-off legal (reescritura destructiva de main) |
| 8 | **onboarding-flow-redesign** | Decidir cuándo activar el flujo (código en PR #428) + flipear flags. | Decisión de producto |
| 9 | **cloudbuild-submit-iam-gating** | Decidir el flujo break-glass, luego restringir `cloudbuild.builds.create` a `github-deployer@`. | Decisión PO (break-glass) |
| 10 | **canary-verify-mql** | Desarrollar la MQL de error_rate/p95 contra Cloud Monitoring real y validar que no bloquee deploys buenos. Un fail-safe la haría inútil (es un gate). | Acceso a Cloud Monitoring para desarrollar/testear la query |
| 11 | **telemetria-particion** | REABRIR al superar 50 devices o P95 `/flota` > 300ms (decisión del equipo §13); partición de tabla viva = ventana de mantenimiento. | Ventana de mantenimiento + el trigger de 50 devices |
| 12 | **sprint-2c-b-gate-bypasses** | Audit final al CERRAR Sprint 2c-B (tally de bypasses del escape-hatch; 1 registrado: #392). | Cierre de Sprint 2c-B (gate del equipo) |
| — | **revertir-ha** | LATENTE: revertir cost-opt (HA Cloud SQL/Redis, DR) al firmar el 1er contrato B2B con SLA. | Firma del 1er B2B SLA |

## Nota
Para los #1, #2 puedo cerrar en el acto con tu input. Para #3, #6, #10 puedo avanzar
con el insumo (Docker output / PAT / acceso). El resto (#4, #5, #7, #8, #9, #11, #12,
revertir-ha) son decisiones/ops/legal/triggers tuyos por naturaleza.
