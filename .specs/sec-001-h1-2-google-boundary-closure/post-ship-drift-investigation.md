# Post-ship investigation — SEC-001 H1.2 drift prod ↔ main

**Fecha:** 2026-06-05 · **Disparador:** `terraform plan` completo (no-targeted) durante trabajo de optimización de costos reveló cambios SEC-001 pendientes que el cierre daba por aplicados.
**Método:** `terraform plan` (state real prod) + `gcloud` read-only + lectura de ADR-057 / ship.md.

## Veredicto de seguridad: SIN hueco

La propiedad de seguridad de SEC-001 H1.2 (ADR-057) está **genuinamente en prod**. El drift es deuda de higiene + observabilidad, no una vulnerabilidad.

Controles reales verificados en prod (`booster-ai-494222`):
- **Self-onboarding OFF**: `EMPRESA_SELF_ONBOARDING_ENABLED` ausente en `booster-ai-api` → default `false`. Vector de auto-promoción cerrado.
- **Boundary desplegado**: imagen api vía Cloud Build `d61e54bc` SUCCESS. La autorización vive en el wiring de rutas (SC-G1 audit cero GAP), no en un gate de creación.
- **Reaper**: `google_cloud_scheduler_job.reap_inert_idp_accounts` existe, **PAUSED** (por diseño, `southamerica-east1`), dry-run.
- **IdP no cablea blocking function**: el diff de `google_identity_platform_config.default` NO toca `blocking_functions` (ni antes ni después) → la `beforeCreate` OFFLINE no recibe signups.
- `BOOSTER_PLATFORM_ADMIN_EMAILS = dev@boosterchile.com` (único email; intencional).

## Causa raíz de la discrepancia "Shipped vs prod"

`ship.md` línea 13: el `terraform apply` del cierre fue **`targeted`** (solo recursos del reaper). El autor concluyó *"el decomiso de la blocking-fn ya estaba hecho (no apareció en el plan)"*. **Un plan/apply con `-target` no lista los recursos no targeteados** → falso negativo. El decomiso SC-G7 nunca se aplicó.

## Pendiente real en prod (verificado vía plan completo)

| Pieza | Acción en plan | Origen | Deuda |
|---|---|---|---|
| `google_cloudfunctions_function.before_create` | delete | `d867bdf` (H1.2 SC-G7) | Higiene (fn OFFLINE, no cableada) |
| `google_storage_bucket.auth_blocking_source` + object | delete | `d867bdf` | Higiene |
| `google_logging_metric.auth_is_demo_blocked` | create | `c3a6ebb` #350 (**H1.3**) | Observabilidad (relevante: `DEMO_MODE_ACTIVATED` activo) |
| `google_monitoring_alert_policy.auth_is_demo_blocked_anomaly` | create | #350 | Observabilidad |
| `helloTest` (Cloud Function us-east1 OFFLINE) | — (no en TF) | fuera de banda | Artefacto debug huérfano |

Ya aplicado en prod (no-op en el plan): `reaper_account_reaped`, `reaper_volume_anomaly`, `signup_probe_failure`, uptime `signup_probe`.

## Hallazgo sistémico

Infra se aplica **manual + `-target`** (dos planos: `release.yml` = imagen api; `terraform apply` de infra = manual, ship.md línea 41). El state de prod **deriva en silencio** de `main` cuando un apply queda parcial. `auth_is_demo_blocked` lleva sin aplicarse desde #350. Solo un `terraform plan` completo destapa el drift acumulado — y no se corre completo porque "ensucia" con IAM/otros.

## Recomendación

1. **No es incidente de seguridad** — degradar urgencia. SC-1.2.2 = MET es correcto en sustancia; corregir en `ship.md` la afirmación "decomiso ya estaba hecho" (fue un falso negativo de `-target`).
2. **Reconciliar el drift SEC-001** (decomiso SC-G7 + métrica T4) con un `terraform apply` **targeted explícito** a esos recursos, separado del swap de IAM Owner (que va en su PR revisado).
3. **Antifrágil**: añadir un check de CI / cron que corra `terraform plan` completo (detailed-exitcode) y alerte si hay drift no vacío. Es la lección real: el `-target` enmascara estado.
4. **helloTest**: limpiar aparte.
