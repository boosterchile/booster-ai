# Spec — telemetry-processor min-instances + CPU always-on en IaC

**Estado**: SHIP
**Fecha**: 2026-06-08
**Gatillo**: follow-up del incidente 2026-06-07 (ver `.specs/telemetry-monitoring-observability`).
**Stack**: sobre la rama del PR #429 (alertas).

## Problema

El `telemetry-processor` es un consumidor Pub/Sub **PULL/StreamingPull** que corre el
loop dentro del container (`apps/telemetry-processor/src/main.ts:148`). En Cloud Run eso
requiere `min_instances>=1` **y** `cpu_idle=false` (CPU always-on): el loop de pull no es
request-driven, así que con `min=0` la instancia escala a cero (nadie consume) y con
`cpu_idle=true` queda CPU-throttled entre requests (el pull se starvea). La config previa
(`min_instances=0` + módulo con `cpu_idle=true` hardcodeado) causó el corte de ~26h.

El fix de runtime ya está aplicado (`gcloud run services update --min-instances=1
--no-cpu-throttling`, revisión 00312), pero la IaC seguía en `min=0` → **drift activo**
(drift-check rojo) y un `terraform apply` manual REVERTIRÍA el fix.

## Cambio

1. **Módulo `cloud-run-service`**: `cpu_idle` pasa de hardcodeado `true` a **variable**
   con default `true` (backward-compatible: cero cambio para los demás servicios).
2. **compute.tf (processor)**: `min_instances = 1` + `cpu_idle = false`.
3. **cloudbuild.production.yaml**: el step `deploy-telemetry-processor` agrega
   `--min-instances=1 --no-cpu-throttling` explícitos (idempotencia + auto-doc).

## Alcance / no-alcance

- **Único servicio afectado**: telemetry-processor. Verificado (tarea #3) que es el único
  consumidor pull de fondo: el otro `subscription.on('message')` (api `routes/chat.ts:457`)
  es request-scoped (se crea/destruye dentro del request → CPU asignada durante el request).
  El resto de los Cloud Run son request/push-driven → `min=0` correcto.
- **Costo**: ~1 instancia always-on con CPU continua 24/7. Ya se está pagando desde el fix
  de runtime; este cambio solo lo hace durable.

## Verificación

- `terraform validate` OK; `fmt` limpio.
- `terraform plan`: el processor muestra **0 cambios** (la IaC pasa a COINCIDIR con el
  estado vivo → drift resuelto, `apply` ya no revierte el fix). Otros servicios sin cambios
  por `cpu_idle` (default `true` preservado; api solo muestra el drift benigno `revision→null`,
  pre-existente y ajeno a este cambio).

## Criterios de aceptación

1. Processor: `min_instances=1` + `cpu_idle=false` en IaC; `plan` sin diff del processor.
2. Módulo: `cpu_idle` variable con default `true`; ningún otro servicio cambia su CPU.
3. cloudbuild explícito con los flags de escalado.
4. PR con Evidencia (ciclo agent-rigor).
