# IaC Hardening Sprint — 2026-05-08/09

**Owner**: dev@boosterchile.com
**Sprint**: 2 sesiones (2026-05-08 init + 2026-05-09 apply)
**Resultado**: Trivy IaC alerts 74 → 0 (100%) + terraform apply en producción

---

## TL;DR

Cerramos los 74 alerts de Trivy IaC scan que se acumularon desde el bootstrap del proyecto (Booster 2.0, abril 2026). 19 PRs (15 código + 4 hotfix post-apply), 0 alerts open, 85 closed, infrastructure aplicada en producción con smoke test verde.

Cambios estructurales relevantes que escalan:
- **CMEK ubicuo** en buckets operacionales + boot disk del bastion via 2 nuevas KMS keys (`storage-operational-cmek`, `compute-disk-cmek`).
- **Cloud Build private worker pool** con VPC peering reemplaza el default pool (que requería `0.0.0.0/0` en master_authorized_networks).
- **GKE master tightened**: removido `0.0.0.0/0`, solo permitido pool /24 + IAP CIDR + IPs operadores conocidos via `var.gke_operator_authorized_cidrs`.
- **IAM via Workspace groups**: `admins@boosterchile.com` (Owner) + `engineers@boosterchile.com` (cloudsql + IAP). Onboarding/offboarding sin terraform apply.
- **Audit logs comprehensive** (ADMIN_READ + DATA_READ + DATA_WRITE) en allServices.

---

## PRs (19 total)

### Sprint principal (15 PRs IaC)

| PR | Cierra | Tipo | Severity |
|---|---|---|---|
| #52 | 5 | Non-root user en 3 Dockerfiles + nginx-unprivileged | HIGH |
| #53 | 28 | K8s securityContext + readOnlyRootFilesystem + cap drop | HIGH×6 + Med×22 |
| #55 | 3 | GCS bucket versioning + lifecycle ARCHIVED | Med |
| #56 | 5 | Cloud SQL Postgres logging flags | Med |
| #57 | 2 | VPC Flow Logs (subnets primary + DR) | Med |
| #58 | 3 | UID/GID 10001 (Dockerfile + K8s) | Low |
| #59 | 4 | HEALTHCHECK en 4 Dockerfiles | Low |
| #60 | 3 | Bastion block-project-ssh-keys + 2 HEALTHCHECK | Med + Low |
| #61 | 4 | KMS+CMEK (3 buckets + bastion disk) | Low |
| #62 | 1 | IAM audit config (allServices) | Low |
| #63 | 4 | GCS bucket access logs | Med |
| #64 | 4 | K8s `:latest`→`:bootstrap` + `.trivyignore` registry | Med |
| #65 | 1 | http-proxy-agent>=7 (`@tootallnate/once` removed) | Low |
| #66 | 1 | `auto_create_network=false` + ignore_changes | HIGH |
| #67 | 4 | Trivy KSV-0125 ID fix + access_logs versioning + crash_traces logging | Med + Low |
| #68 | 2 HIGH | **Cloud Build private pool + tightened GKE master** | HIGH |
| #69 | 4 | **IAM groups: admins@ + engineers@** | Med |
| #70 | 2 | access_logs CMEK + scoped github SA impersonation | Med + Low |
| #71 | 4 | uuid 14.0.0 (CVE-2026-41907) + corrigió rule IDs | Med + Low |

### Hotfixes post-apply (4 PRs)

| PR | Razon |
|---|---|
| #73 | `kubectl --internal-ip` + bastion CMEK syntax fix (`dynamic disk_encryption_key` invalido en `google_compute_instance`) |
| #75 | `master_global_access_config.enabled = true` en ambos clusters (drift prevention) |
| #76 | Skip GKE deploy en Cloud Build + script manual (transitive peering issue) |
| #74 | Cerrado — commit perdió edits .tf por reset, recreado limpio en #75 |

---

## Decisión arquitectónica clave: Cloud Build pool ↔ GKE deploy

**Problema descubierto durante apply**: 3 builds fallaron consecutivos (`725b2cf5`, `227221c5`, `13c3a02d`) en el step `deploy-telemetry-tcp-gateway` con timeout a `172.16.0.2:443` (master interno).

**Causa raíz**: VPC peering en service networking NO es transitivo. Cloud Build private pool (peering propio) y GKE control plane (peering propio) ambos peerean al `booster-ai-vpc`, pero el pool no aprende rutas al master CIDR ni viceversa. `master_global_access_config.enabled = true` solo expone el master a peerings cross-region — no fuerza propagación de rutas entre peerings independientes.

**Solución oficial GCP**: configurar `import-custom-routes`/`export-custom-routes` en peerings managed por servicenetworking. NO se puede via Terraform (gestionado internamente).

**Decisión pragmática (PR #76)**: separar concerns.
- Cloud Build private pool: maneja build + push de las 6 imágenes (incluyendo gateway). Funciona perfecto.
- Deploy a Cloud Run (5 servicios): automático via pool, funciona perfecto.
- Deploy a GKE (1 servicio gateway): manual desde laptop operador via `./scripts/deploy-telemetry-gateway.sh ${SHA}`. Operador autorizado en `master_authorized_networks_config` por su IP whitelist en `terraform.tfvars.local` (variable `gke_operator_authorized_cidrs`).

Tradeoff aceptado: gateway se actualiza ~1×/sprint (vs Cloud Run ~10×/dia). Manual deploy es overhead aceptable para no introducir complejidad de peering routes manual.

**Reabrir cuando**:
- Frecuencia de updates al gateway suba significativamente
- Google publique mecanismo standard para transitive peering en service networking
- Migración a Config Connector / GitOps que deploya desde dentro del cluster

---

## Acciones manuales aplicadas (no en Terraform)

Estos cambios se hicieron via gcloud directo durante el apply. Reflejados en código en PRs subsiguientes para evitar drift.

### 1. Workspace groups (creados via Cloud Identity API)
```bash
gcloud identity groups create admins@boosterchile.com --organization=435506363892
gcloud identity groups create engineers@boosterchile.com --organization=435506363892

gcloud identity groups memberships add --group-email=admins@boosterchile.com --member-email=dev@boosterchile.com
gcloud identity groups memberships add --group-email=admins@boosterchile.com --member-email=contacto@boosterchile.com
gcloud identity groups memberships add --group-email=engineers@boosterchile.com --member-email=dev@boosterchile.com
```

Estado final:
- `admins@`: dev@ (OWNER) + contacto@ (MEMBER) → Project Owner
- `engineers@`: dev@ (OWNER) → cloudsql.client + cloudsql.instanceUser + bastion IAP + osLogin

### 2. Default VPC eliminada
4 firewall rules (`default-allow-icmp`, `-internal`, `-rdp`, `-ssh`) + network borradas. Project ya estaba en custom VPC `booster-ai-vpc`.

### 3. master_global_access_config (luego en PR #75)
```bash
gcloud container clusters update booster-ai-telemetry --region=southamerica-west1 --enable-master-global-access
gcloud container clusters update booster-ai-telemetry-dr --region=us-central1 --enable-master-global-access
```

---

## Estado producción post-apply

```
API health:       https://app.boosterchile.com/health → HTTP 200 (~75ms)
Gateway:          2 replicas Running con SHA 10b8d75 + securityContext hardened
                  Pod-level: runAsUser=10001, fsGroup=10001, runAsNonRoot=true, seccompProfile.RuntimeDefault
                  Container: allowPrivilegeEscalation=false, capabilities.drop=[ALL], readOnlyRootFilesystem=true
GKE master CIDR:  10.10.0.0/20 + 10.104.24.0/24 (pool) + 35.235.240.0/20 (IAP) + 181.42.135.69/32 (op laptop)
Cloud Build pool: booster-production-pool (e2-standard-2, RUNNING, peered)
Bastion VM:       Recreado con CMEK boot disk (compute-disk-cmek)
KMS keys:         storage-operational-cmek, compute-disk-cmek (rotation 90d)
Buckets CMEK:     6 cifrados (uploads_raw, public_assets, chat_attachments, access_logs, crash_traces, documents)
IAM:              Owner→group:admins@, cloudsql/IAP/osLogin→group:engineers@
Audit logs:       ADMIN_READ + DATA_READ + DATA_WRITE en allServices
```

---

## Ops runbook actualizado

### Para deployar el gateway (post-Cloud Build)
```bash
# Despues de que Cloud Build pushee la imagen (verificable en Cloud Build UI):
cd /path/to/Booster-AI
./scripts/deploy-telemetry-gateway.sh ${COMMIT_SHA}
```

### Para acceder al GKE master (operador)
- Opción A: agregar IP a `gke_operator_authorized_cidrs` en `terraform.tfvars.local` + `terraform apply -target=google_container_cluster.telemetry`
- Opción B: usar IAP TCP tunnel (más seguro, no requiere IP whitelist):
  ```bash
  gcloud compute start-iap-tunnel db-bastion 22 --local-host-port=localhost:2222 --zone=southamerica-west1-a
  # luego conectar via SSH y kubectl desde el bastion
  ```

### Para agregar un nuevo developer al equipo
1. Workspace Admin UI → Groups → `engineers@boosterchile.com` → Add member
2. Listo. Sin terraform apply, sin PR. (Para Owner-level: agregar a `admins@`)

### Para rotar las KMS keys
Auto-rotate cada 90 días configurado. Manual force rotation:
```bash
gcloud kms keys versions create --location=southamerica-west1 \
  --keyring=booster-ai-keyring \
  --key=storage-operational-cmek --primary
```

---

## Pending strategic (futuro sprint)

1. **GitHub Workflow PAT scope**: el PAT actual no permite push de cambios a `.github/workflows/`. Para refactors mayores de CI/Security/Release+Deploy/E2E workflows hay que usar Chrome web edit. PAT con `workflow` scope habilitaría flujo Git-native.

2. **Cloud Build pool egress**: actualmente `PUBLIC_EGRESS` (NAT'd Google IPs para internet). Migrar a `NO_PUBLIC_EGRESS` + Cloud NAT en VPC requeriría cambios + costos extra (~$30-50/mo NAT). Beneficio: full air-gap de builds. Reabrir cuando compliance lo pida.

3. **Trivy `.trivyignore` review trimestral**: 4 reglas suprimidas con justificación documentada (KSV-0125 trusted registries, GCP-0033 CSEK vs CMEK, GCP-0050 Autopilot node SA, GCP-0053 GKE control plane). Cada Q debería revisarse si las razones siguen vigentes.

4. **18 PRs DRAFT pre-existentes** (#20-47): mix de feat/* y test/* de sprints anteriores. Triage independiente de este sprint.

---

## Lessons learned

1. **Trivy rule IDs son inconsistentes**: a veces con prefijo `AVD-`, a veces sin. Validar siempre clickeando el alert antes de agregar a `.trivyignore`. PR #67 + #71 tuvieron que corregir IDs de PRs previos.

2. **Terraform `dynamic` blocks no son universales**: `dynamic "disk_encryption_key"` se vió bien sintácticamente pero el provider google rechazó el bloque porque `kms_key_self_link` es atributo directo de `boot_disk`, no un sub-block. Validar con `terraform plan` ANTES de merge cuando se introduce nueva sintaxis.

3. **VPC peering transitive limitation**: documentación GCP no destaca esto fuertemente. La asunción "Cloud Build pool tiene VPC peering, GKE master tiene VPC peering, ambos al mismo VPC, ergo se ven" es FALSA. Cada peering es bidireccional pero no transitivo. Workaround documentado en PR #76.

4. **Cloud Identity API debe habilitarse explícitamente**: no viene auto-enabled con un proyecto GCP nuevo. `gcloud services enable cloudidentity.googleapis.com` es prerequisito antes de crear groups.

---

## Refs

- Trivy alerts dashboard: https://github.com/boosterchile/booster-ai/security/code-scanning?query=tool%3ATrivy
- Sprint PRs: https://github.com/boosterchile/booster-ai/pulls?q=is%3Apr+merged%3A2026-05-08..2026-05-09+%22Trivy+IaC%22+OR+%22chore%28security%29%22
- Cloud Build pool: https://console.cloud.google.com/cloud-build/settings/worker-pool?project=booster-ai-494222
