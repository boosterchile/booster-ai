# ADR 059 — Deploy de los gateways de telemetría vía DNS-based control plane endpoint + Cloud Build pools

**Estado**: Aceptado
**Fecha**: 2026-06-06
**Autor**: Felipe Vicencio (PO) + Claude
**Relacionado**: ADR-005 (GKE para TCP), ADR-058 (pre-comercial), dr-region.tf (DR DNS endpoint, #194)

---

## Contexto

Aplicar cambios K8s al gateway de telemetría (B1: primary 2→1, C: DR→cold, y deploys en general) reveló que **no existía una vía de acceso reproducible al cluster primario** `booster-ai-telemetry`:

- `kubectl` directo desde laptop → timeout: el endpoint IP del master está protegido por `master_authorized_networks_config` + `privateEndpointEnforcement`, y la IP del operador no está en el allowlist.
- Cloud Build pool (`booster-production-pool`) contra el endpoint **IP público** → timeout: el pool tiene `egressOption: PUBLIC_EGRESS`, así que sale por una IP NAT pública de Google que **no** está en el allowlist (y `gcpPublicCidrsAccessEnabled=false`). El rango de peering del pool sí está en el allowlist, pero no es la IP origen del egress público.
- Cloud Build pool con `--internal-ip` (endpoint privado) → timeout: **VPC peering es no-transitivo** (pool ↔ booster-ai-vpc ↔ master no encadena).

El cluster **DR** ya había resuelto esto el 2026-05-13 (issue #194) habilitando el **DNS-based control plane endpoint**. El primario no lo tenía.

## Decisión

Estandarizar el acceso a **ambos** clusters de telemetría vía el **DNS-based control plane endpoint** (`controlPlaneEndpointsConfig.dnsEndpointConfig.allowExternalTraffic = true`) + autorización por **IAM** (`roles/container.developer`):

1. **Primary**: habilitar `allow_external_traffic = true` en `google_container_cluster.telemetry` (`infrastructure/compute.tf`). Aplicado 2026-06-06 vía `terraform apply -target` (in-place, sin downtime). El DR ya lo tenía (dr-region.tf).
2. **kubectl** (laptop u operador) y **Cloud Build pools** acceden con `gcloud container clusters get-credentials ... --dns-endpoint`. No depende de red/VPC peering; la autorización es IAM. El endpoint IP + `master_authorized_networks` se conservan como capa adicional para quien esté en red autorizada.
3. **Pipelines reproducibles** en `infrastructure/k8s/`:
   - `cloudbuild-primary-deploy.yaml` + `cloudbuild-primary-check.yaml` (nuevos, espejo del DR), pool `booster-production-pool`, `--dns-endpoint`.
   - `cloudbuild-dr-deploy.yaml` + `cloudbuild-dr-check.yaml` (existentes).
4. **Deprecar** el deploy manual `kubectl` desde laptop (frágil por authorized networks). El `check.yaml` es gate no-mutante previo al deploy.

## Consecuencias

### Positivas
- Acceso reproducible y auditable a ambos masters sin abrir el endpoint IP a internet ni montar túneles IAP.
- El DNS endpoint cuesta ~$0/mes y funciona desde cualquier red (laptop, pool de cualquier región, Cloud Run jobs) con IAM.
- Cierra el gap de CD del gateway primario (antes solo el DR tenía pipeline).

### Negativas / notas
- El acceso al master ahora depende también de IAM correcto (`container.developer`). Gobernar ese rol con cuidado (hoy: `github-deployer`; operadores vía membresía de grupo).
- `master_authorized_networks_config` y el endpoint IP siguen declarados; no se removieron (defensa en profundidad).

## Seguridad
- NO se abrió `0.0.0.0/0` ni se tocó `master_authorized_networks_config`. El único cambio en el primary fue `dns_endpoint_config.allow_external_traffic`. El DNS endpoint exige IAM; no es acceso anónimo.
- Sin relación con el drift SEC-001 / IAM Owner (esos van en flujo separado).

## Referencias
- `infrastructure/compute.tf` (cluster primary, `control_plane_endpoints_config`)
- `infrastructure/dr-region.tf` (cluster DR, mismo bloque, #194)
- `infrastructure/k8s/cloudbuild-primary-{deploy,check}.yaml`
- ADR-058 (reclasificación pre-comercial, habilita B1/C)
