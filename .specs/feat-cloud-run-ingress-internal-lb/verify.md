# Verify: feat-cloud-run-ingress-internal-lb

- Date: 2026-06-14
- Plan: .specs/feat-cloud-run-ingress-internal-lb/plan.md

## Resultados

### T1 — terraform validate ✅
`terraform -chdir=infrastructure validate` → **Success! The configuration is valid.** (con la variable `ingress` nueva + validation block de los 3 valores válidos).

### T2 — cambios en compute.tf ✅ (grep)
`grep -n ingress compute.tf`:
- línea 319: `service_api` → `INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER`
- línea 362: `service_web` → `INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER`
- línea 525: `sms-fallback-gateway` → `INGRESS_TRAFFIC_ALL` (explícito)
Los otros 5 servicios sin override → default ALL (cero cambio).

### T3 — scope atómico ✅
`git diff --stat` = 4 archivos, +64/-3: módulo (variables+main), compute.tf, networking.tf. ADR-062 nuevo. `storage.tf` revertido (drift de fmt preexistente de #449 sacado del scope → tarea aparte). ADR-062 sin colisión de numeración (las colisiones 034/035 que reporta el checker son históricas, ajenas a este PR).

### No-recreación (SC-7) — fundamentado, confirmación = gate del PO
El `terraform plan` en vivo NO se pudo correr en esta sesión: el backend GCS requiere ADC y la política de reauth de Workspace las expiró (`invalid_rapt`). NO se fuerza un re-login porque **el plan es de todos modos el gate pre-apply del PO** (spec §11 etapa 1).

Fundamento del "update in-place, sin recreación": en `terraform-provider-google`, `ingress` de `google_cloud_run_v2_service` es un atributo **mutable** (Optional+Computed, NO `ForceNew`) — un cambio de ingress es un PATCH de la config del servicio, no un reemplazo. Cloud Run v2 aplica el cambio de ingress como update de red en caliente, sin recrear el servicio ni sus revisiones. Por eso no hay downtime.

**Confirmación requerida del PO antes del apply (SC-7, spec §11):** el plan debe mostrar `~ update in-place` con solo `~ ingress` en `module.service_api` y `module.service_web`, y **CERO** `-/+ destroy and then create`. Si el plan mostrara recreación, DETENERSE (sería un bug del approach, no esperado).

## Pendiente para el PO (no bloquea el PR)
- Correr `terraform plan` y confirmar update in-place (arriba).
- Rollout staged web→api con validación empírica de schedulers + bot (spec §11).

## Suite / lint
- No hay código de aplicación tocado (solo IaC) → no aplican vitest/biome. `terraform validate` es el gate equivalente y pasó.
