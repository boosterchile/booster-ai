# Drift prod ↔ main — hallazgos FUERA DE ALCANCE del PR de costos

**Fecha:** 2026-06-05 · **Detectado por:** `terraform plan` (rama `chore/cost-optimization-precomercial`) + verificación `gcloud` read-only contra prod (`booster-ai-494222`).
**No aplicar junto con la optimización de costos.** Cada ítem requiere su propio tracking/revisión.

## 1. SEC-001 — control de seguridad en estado inconsistente (PRIORITARIO)

`main` migró SEC-001 H1.2 (cierre leg Google) de "blocking Cloud Function `beforeCreate`" a "logging metric + alert" (ADR-057, commit `d867bdf`; cierre marcado *Shipped* en `5f2b411`). El estado real de prod NO refleja la migración:

| Componente | Esperado (según `main`/git) | Real en prod (verificado) |
|---|---|---|
| `beforeCreate` Cloud Function | eliminada | **existe, STATE=OFFLINE** (us-east1, 1st gen) — gestionada por TF (plan la marca DELETE) |
| buckets `auth_blocking_*` | eliminados | existen (plan los marca DELETE) |
| `logging_metric.auth_is_demo_blocked` | creado | **NO existe** |
| `monitoring_alert_policy.auth_is_demo_blocked_anomaly` | creado | NO existe |

**Riesgo:** control viejo OFFLINE + control nuevo ausente ⇒ posible hueco de cobertura del control de auth en prod, mientras el repo lo da por cerrado. **Acción:** investigar por qué el `terraform apply` del cierre no se reflejó en prod (¿nunca corrió? ¿rollback? ¿apply parcial?). Verificar si Identity Platform (`google_identity_platform_config.default`, que el plan marca UPDATE) sigue apuntando a la función OFFLINE. Tratar como issue de seguridad con revisor que tenga rol Owner actual.

## 2. IAM humana — downgrade de Owner

- Prod: `roles/owner` = `group:admins@boosterchile.com` (único Owner, verificado).
- `main` (vía `var.human_owners` en tfvars): `["user:dev@boosterchile.com"]`.
- El plan REEMPLAZARÍA el grupo por un usuario individual como único Owner del proyecto.

**Riesgo:** cambio de control de acceso; un único usuario como sole Owner es frágil (orfandad si pierde acceso). **Acción:** PR dedicado, aprobado por un Owner actual del grupo `admins@`. Prohibido mezclar con costos o aplicar vía `-target`. (CLAUDE.md: IAM humana requiere PR revisado.)

## 3. helloTest — Cloud Function huérfana

`helloTest` (us-east1, 1st gen, OFFLINE) **no está en el código Terraform** (no aparece en el plan) → desplegada fuera de banda, probable artefacto de debugging. **Acción:** revisar y limpiar por separado.

---

## Resumen para quien aplique costos

El `terraform plan` de la rama de costos arrastra los ítems #1 y #2 (9 cambios). **No correr `terraform apply opt.plan` completo.** Opciones para aislar costos: resolver primero el drift (#1, #2) y re-planear; o aplicar costos por recurso (`-target`) asumiendo el smell. Ver pregunta abierta al PO.
