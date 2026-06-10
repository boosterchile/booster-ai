# Follow-up: canary-verify real en cloudbuild.production.yaml

**Origen**: Auditoría 2026-06-09 (riesgo alto CI/CD) + inventario adr-vs-prod Finding #1. Confirmado: el step `canary-verify` loguea umbrales (error_rate <1%, p95 <500ms) y hace `exit 0` (cloudbuild.production.yaml:255-274).
**Prioridad**: P2.

## Problema

La promoción del canary del API a 100% ocurre tras 30 min de sleep sin verificación automática: depende 100% de observación humana + el synthetic monitor signup_probe. Un deploy con regresión sutil que no dispare el probe se promueve solo. Además `release.yml` no espera a `ci.yml` verde (se disparan en paralelo en push a main) y el canary solo cubre el servicio API — el resto deploya directo a 100%.

## Acción propuesta

1. Implementar la query real en canary-verify: `gcloud monitoring` (MQL o PromQL API) sobre `run.googleapis.com/request_count` filtrado por la revisión canary (tag `canary-signup-*`): error rate 5xx y p95 de latencia de la ventana de 30 min; `exit 1` si excede umbrales → el build aborta sin promover.
2. Encadenar release.yml a ci.yml (workflow_run o gh api check de status) para que el deploy no corra con CI rojo.
3. Evaluar extender el patrón canary a web/telemetry-processor (hoy 100% directo).

**Atención**: toca el pipeline de deploy (archivo sensible per CLAUDE.md §archivos críticos) — requiere PR revisado por el PO y prueba en un deploy real observado.

## Estado

Pendiente. Sin asignar a ciclo.
