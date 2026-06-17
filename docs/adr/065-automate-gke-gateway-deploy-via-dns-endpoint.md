# ADR-065 — Automatizar el deploy del telemetry-tcp-gateway a GKE vía DNS endpoint

**Estado**: Accepted
**Fecha**: 2026-06-16
**Decider**: Felipe Vicencio (Product Owner)
**Related**: [ADR-059](./059-gke-dns-endpoint.md) (habilita la conectividad), `cloudbuild.production.yaml`, auditoría 2026-06-14 (P0-I)

---

## Contexto

`apps/telemetry-tcp-gateway` corre en GKE Autopilot (no Cloud Run): es el servidor TCP que reciben los devices Teltonika. El resto de los servicios los deploya Cloud Build directamente, pero el gateway **no**: el step `gke-deploy-instructions` de `cloudbuild.production.yaml` solo **imprime instrucciones por stdout** y un humano corre `scripts/deploy-telemetry-gateway.sh` a mano desde una laptop autorizada.

La auditoría 2026-06-14 lo marcó **P0-I**: en cada release el gateway queda en la versión anterior hasta que alguien corra el script, **sin alerta ni gate**. Los Teltonika hablan con código desactualizado en silencio — drift en el camino crítico de telemetría.

El comentario del step (2026-05-09) justificaba el stdout-only con que el Cloud Build private pool y el GKE control plane usan VPC peerings no-transitivos → `kubectl` desde el pool al master interno hace timeout. **Ese comentario quedó stale**: [ADR-059](./059-gke-dns-endpoint.md) (2026-05-13) habilitó el **DNS endpoint** del control plane (`controlPlaneEndpointsConfig.dnsEndpointConfig.allowExternalTraffic = true`), que es alcanzable por IAM **sin** depender del peering de la VPC.

### Validación de prerrequisitos (2026-06-16)

| Prerrequisito | Estado |
|---|---|
| SA del build `github-deployer@` tiene permisos GKE | ✅ `roles/container.developer` (cubre `clusters.get`, `deployments.get/update`) |
| DNS endpoint del cluster `booster-ai-telemetry` habilitado | ✅ `gke-ca908…gke.goog`, `allowExternalTraffic = True` |
| Build corre como ese SA | ✅ `serviceAccount:` en `cloudbuild.production.yaml` |

## Decisión

Reemplazar el step `gke-deploy-instructions` (stdout) por un step `gke-deploy` que **ejecuta el deploy real** desde Cloud Build:

```
gcloud container clusters get-credentials booster-ai-telemetry \
  --region=${_REGION} --project=${PROJECT_ID} --dns-endpoint
kubectl set image deployment/telemetry-tcp-gateway gateway=${_REGISTRY}/telemetry-tcp-gateway:${_COMMIT_SHA} -n telemetry
kubectl rollout status deployment/telemetry-tcp-gateway -n telemetry --timeout=300s
```

Decisiones de diseño:

1. **Conectividad vía `--dns-endpoint`** (IAM-gated, no VPC). Desbloqueado por ADR-059. La autenticación es el WIF del SA `github-deployer`; no hay keys.

2. **Ordenamiento: `waitFor: [deploy-api, push-telemetry-tcp-gateway]`.** El step corre **después** de que el API se promovió a 100% (step `deploy-api`). Razón: el `gke-deploy` puede fallar (rollout); si corriera en paralelo al canary del API, su fallo abortaría el build y dejaría el canary del API **sin promover** (el mismo mal estado del incidente de timeout, ADR del #484). Ejecutándolo tras la promoción, un fallo del gateway no pone en riesgo al API, que ya está a salvo al 100%.

3. **Falla ruidosa (fail-loud).** `set -euo pipefail` + `kubectl rollout status --timeout=300s`. Si el rollout falla o no converge, el step falla → el build falla → el operador es alertado. Esto **es** el fix de P0-I: el drift silencioso ("alguien olvidó deployar") se vuelve imposible. `kubectl set image` es atómico: si falla, el deployment queda en la imagen anterior (sin estado parcial).

4. **El script manual se conserva** como break-glass: si la ruta de Cloud Build falla (p.ej. el worker pool no tiene egress al DNS endpoint), el operador puede seguir corriendo `scripts/deploy-telemetry-gateway.sh` desde una laptop autorizada.

5. **Presupuesto de timeout.** El step agrega ~2-5 min después de `deploy-api` (~42 min en el build). Total ~47 min < `timeout: 3600s` (60 min, #484). Holgura suficiente.

## Consecuencias

**Positivas**:
- Elimina la clase de drift silencioso del gateway (riesgo P0). El gateway se deploya en cada release, automáticamente, con verificación de rollout.
- Sin paso manual en el camino feliz; el operador solo interviene en break-glass.
- Reusa la conectividad de ADR-059 sin infra nueva.

**Negativas / riesgos**:
- **Residual no testeable localmente**: el pipeline de Cloud Build no es ejecutable fuera de un release real. La reachability del worker pool privado → DNS endpoint (`*.gke.goog`, egress a internet) **se valida en el primer release** post-merge. Si el pool no tiene egress, el step falla ruidoso (no silencioso) y el operador cae al script manual; se itera con un follow-up de networking del pool.
- Un fallo del gateway ahora **falla el release** (después de que el API ya está al 100%). Es el comportamiento deseado (fail-loud vs drift), pero exige atención del operador ante un build rojo cuyo API sí se desplegó.

**Re-evaluar si**: el worker pool resulta sin egress al DNS endpoint (→ networking del pool o Cloud Deploy), o si se quiere auto-rollback (`kubectl rollout undo`) en vez de fail-loud.
