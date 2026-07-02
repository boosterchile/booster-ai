# Follow-up — `infrastructure/terraform.tfvars.example` desactualizado vs estado real

**Origen**: `terraform plan` del 2026-06-05 (apply pendiente de SEC-001 boundary-closure: scheduler reaper + metric + alert).
**Tipo**: IaC / safety del onboarding. **Riesgo**: medio — un `terraform apply` reconstruido desde el `.example` propone cambios NO deseados a recursos de prod. **Estado**: ✅ **Fix #1 HECHO (2026-06-22)** — `terraform.tfvars.example` actualizado: `cloudsql_tier = "db-custom-1-6144"` (valor real de prod, ADR-058) + `organization_id = "435506363892"` (el proyecto SÍ está bajo org); ambos no-secretos (visibles en `gcloud projects describe`). Reduce la deriva del onboarding. **Fix #2/#3** (versionar tfvars canónico no-secreto / auditoría completa de drift code↔state) siguen ABIERTOS, ligados a `main-branch-protection-terraform-iac.md`.

## Problema

`infrastructure/terraform.tfvars` es **gitignored** (no hay tfvars canónico en el repo). El único punto de partida versionado es `terraform.tfvars.example`, y está **stale** respecto a la realidad de prod. Quien reconstruya su tfvars desde el example va a planear cambios espurios:

- **`cloudsql_tier`**: el example dice `db-custom-2-7680`, pero la instancia real `booster-ai-pg-07d9e939` está en **`db-custom-1-6144`**. Un `terraform plan` con el valor del example propone **resize de la DB de prod** (`db-custom-1-6144 → db-custom-2-7680`) — confirmado y descartado como falso positivo el 2026-06-05.
- **`organization_id`**: el example sugiere `null` ("si no estás bajo org, dejar null"), pero el proyecto **sí** está bajo organización (`gcloud projects describe booster-ai-494222` → `parent.type=organization`, `parent.id=435506363892`). Dejarlo en `null` puede divergir de cómo se aplicó el state (IAM/recursos a nivel org).

Pueden existir **otros overrides** del tfvars real que el example no refleja (no auditado exhaustivamente).

## Impacto

- Riesgo de un apply que **muta recursos no relacionados** (resize de Cloud SQL = posible downtime/costo) cuando alguien intenta aplicar un cambio acotado.
- Mitigación práctica usada el 2026-06-05: aplicar SEC-001 con `terraform apply -target=...` para limitar el blast radius — pero eso es un parche, no la cura.

## Fixes (NO ejecutados — elegir)

1. **Mínimo**: actualizar `terraform.tfvars.example` con los valores reales no-secretos (`cloudsql_tier = "db-custom-1-6144"`, comentar que el proyecto está bajo org `435506363892`). Reduce la deriva del onboarding.
2. **Mejor**: versionar un tfvars canónico no-secreto (sin billing/org sensibles) o moverlo a Secret Manager / un mecanismo declarativo, para que `terraform plan` sea reproducible y no dependa de reconstrucción manual. Liga con `main-branch-protection-terraform-iac.md`.
3. **Auditoría**: correr un `terraform plan` completo (no `-target`) contra un tfvars reconciliado y catalogar TODO el drift real entre código y state (ej. el `google_identity_platform_config.default` quiere remover `multi_tenant`/`phone_number`; el Cloud Run `template.revision → null` por deploys out-of-band). Resolver o documentar cada uno.

## Evidencia (2026-06-05)

- `terraform plan` (token de `gcloud auth print-access-token`, sin ADC): con `cloudsql_tier=db-custom-2-7680` (del example) → proponía resize de `google_sql_database_instance.main`. Corregido a `db-custom-1-6144` → el diff desapareció.
- Drift adicional catalogado (no de SEC-001): `google_identity_platform_config.default` (remueve `multi_tenant`/`phone_number`; el `blocking_functions` del decomiso ya estaba ausente) y `module.service_api...service` (`template.revision → null`, benigno: `image` está en `ignore_changes` por ADR-013).

## Relación

- Surgió preparando el `terraform apply` de [`.specs/sec-001-h1-2-google-boundary-closure/`](../sec-001-h1-2-google-boundary-closure/ship.md) (scheduler reaper + metric + alert).
- Liga con `main-branch-protection-terraform-iac.md` (IaC governance).
