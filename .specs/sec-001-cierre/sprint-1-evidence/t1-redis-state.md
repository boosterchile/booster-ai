# T1 evidence — Memorystore Redis state verification

**Fecha**: 2026-05-25 00:35-00:45 UTC
**Operador**: Claude Opus 4.7 (headless via ADC token de `dev@boosterchile.com`)
**Spec**: `.specs/sec-001-cierre/plan.md` T1 (modificado v2 per P0-1)
**Resolución**: **NO-OP** — state ya cumple R-DA-REDIS-SPOF mitigation. Sin cambios HCL.

---

## 1. OQ-PLAN-1 — recurso Terraform

```bash
$ terraform state list | grep -i redis
google_project_service.apis["redis.googleapis.com"]
google_redis_instance.main
```

Nombre canónico: `google_redis_instance.main` (1 instancia única, declarada en `infrastructure/data.tf:312`).

## 2. OQ-PLAN-8 — tier actual en state

```bash
$ terraform state show google_redis_instance.main | grep -E "tier|location|replica|auth|encryption|connect"
    alternative_location_id     = "southamerica-west1-a"
    auth_enabled                = true
    connect_mode                = "PRIVATE_SERVICE_ACCESS"
    location_id                 = "southamerica-west1-b"
    name                        = "booster-ai-redis"
    read_replicas_mode          = "READ_REPLICAS_DISABLED"
    redis_version               = "REDIS_7_2"
    replica_count               = 1
    tier                        = "STANDARD_HA"  ◀── MITIGACIÓN R-DA-REDIS-SPOF
    transit_encryption_mode     = "SERVER_AUTHENTICATION"
```

## 3. Drift config ↔ state

- `variables.tf:161 redis_tier { default = "STANDARD_HA" }` ✅ alineado con state.
- `data.tf:315 tier = var.redis_tier` ✅ usa la variable, no literal.
- `terraform.tfvars.local` — sin override de `redis_tier` (grep retorna vacío).

Targeted plan confirma cero drift:

```bash
$ terraform plan -target=google_redis_instance.main
No changes. Your infrastructure matches the configuration.
```

## 4. SC traceability

- ✅ **R-DA-REDIS-SPOF** (spec §9): mitigado por STANDARD_HA tier + cross-zone (`southamerica-west1-b` primary + `southamerica-west1-a` alternative). Failover automático en caso de falla del nodo primario.
- ✅ **Round 4 P1-R4-2**: cerrado (estado real ya cumple, no requería cambio).
- ✅ **AUTH + TLS**: `auth_enabled = true` + `transit_encryption_mode = SERVER_AUTHENTICATION` (TLS server-side cert validation).
- ✅ **Network isolation**: `connect_mode = PRIVATE_SERVICE_ACCESS` (Cloud Run accede via VPC peering, sin egress público).

## 5. Decisión

**T1 = no-op**. Sin commit de código. Solo este archivo de evidence + tick `[DONE 2026-05-25]` en `plan.md`.

No requiere maintenance window. Sin riesgo de downtime. Sin rollback necesario.

## 6. Habilita T9 + T10

T1 era prerequisito de T9 (rate-limit-pin middleware usa Redis HA fail-closed). Con T1 cerrado, T9/T10 pueden arrancar — el middleware tendrá garantía de que el counter persiste tras failover de zona.
