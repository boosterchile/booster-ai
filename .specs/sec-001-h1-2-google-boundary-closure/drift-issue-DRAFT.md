# [SEC-001] Drift infra prod↔main: cleanup del decomiso + métrica de observabilidad sin aplicar (NO es hueco de seguridad)

**Tipo:** Infra drift / hygiene + observabilidad
**Prioridad:** Media (NO security incident — ver veredicto)
**Áreas:** SEC-001 H1.2, Terraform state vs prod, proceso de apply de infra

> Corrige un borrador previo que clasificaba esto como "blocking function ACTIVA / High security". Verificación read-only (2026-06-05) desmiente esa premisa: la función está **FAILED/OFFLINE** y **no está cableada** en Identity Platform. El control de seguridad real está en su lugar.

## Veredicto: SIN hueco de seguridad

SEC-001 H1.2 (ADR-057) está genuinamente cerrado en prod. El control NO es la blocking function (esa dirección se abandonó antes de prod): es el **boundary** (rutas userContext/gated, audit SC-G1 cero GAP) + **self-onboarding OFF** + **reaper** de higiene. Verificado en prod:

- `EMPRESA_SELF_ONBOARDING_ENABLED` ausente en `booster-ai-api` → default `false` (auto-promoción cerrada).
- Boundary desplegado (imagen api, Cloud Build `d61e54bc` SUCCESS).
- `google_cloud_scheduler_job.reap_inert_idp_accounts`: existe, **PAUSED** (por diseño), `southamerica-east1`.
- `google_identity_platform_config.default.blocking_functions = []` en el **estado real** → IdP no enruta signups a ninguna función.
- `beforeCreate`: Cloud Function 1ª gen us-east1, estado **FAILED** (deploy fallido 2026-05-29), no sirve tráfico.

## Causa raíz (resuelta — no hace falta cazar rollbacks)

El `terraform apply` del cierre (`ship.md` línea 13) fue **`targeted`** (solo recursos del reaper). El autor concluyó *"el decomiso ya estaba hecho (no apareció en el plan)"* — pero un plan/apply con `-target` **no lista los recursos no targeteados**. Falso negativo. El decomiso SC-G7 nunca se aplicó. No hubo rollback ni drift fuera de Terraform; simplemente quedó fuera del scope del `-target`.

## Pendiente real en prod (de un `terraform plan` completo)

- **DELETE** (decomiso SC-G7, `d867bdf`): `google_cloudfunctions_function.before_create`, `google_storage_bucket.auth_blocking_source`, `google_storage_bucket_object.auth_blocking_placeholder` → infra muerta (FAILED/OFFLINE), higiene.
- **CREATE** (observabilidad, T4 desde `c3a6ebb`/#350, H1.3): `google_logging_metric.auth_is_demo_blocked`, `google_monitoring_alert_policy.auth_is_demo_blocked_anomaly` → el bloqueo is-demo funciona en la app; falta la señal/alerta. Relevante: `DEMO_MODE_ACTIVATED` activo en prod.
- **UPDATE** benigno: `google_identity_platform_config.default` (multi_tenant/phone normalization), `google_monitoring_dashboard.telemetry_overview`.

## Remediación

1. Corregir `ship.md` del boundary-closure: la afirmación "decomiso ya estaba hecho" fue un falso negativo de `-target`. SC-1.2.2 = MET sigue siendo correcto en sustancia.
2. Reconciliar el drift con un `terraform apply -target` **explícito** a los recursos SEC-001 (decomiso + T4), **separado** del swap de IAM Owner.
3. Validar con `terraform plan` (sin diffs SEC-001 residuales).
4. **Antifrágil**: check de CI/cron con `terraform plan -detailed-exitcode` que alerte ante drift no vacío. Lección: `-target` enmascara estado; nadie corría el plan completo.

## Tareas relacionadas (abrir por separado)

- [ ] **IAM Owner drift** (PR propio, revisor Owner del grupo `admins@`): prod `roles/owner = group:admins@boosterchile.com` (único) vs `main` `human_owners = ["user:dev@boosterchile.com"]`. Aplicar reemplazaría grupo→usuario individual como único Owner. Cambio de control de acceso.
- [ ] **Limpiar `helloTest`** (Cloud Function us-east1, FAILED, no gestionada por Terraform — artefacto de debug).

## Notas

Diagnóstico read-only; no se modificó ningún recurso. La remediación que toca IAM o decomiso se ejecuta por una persona en un flujo revisado, no automatizada.
