# Issue #194 — Deploy telemetry-tcp-gateway en cluster DR — Investigación 2026-05-13

**Sesión**: Claude Opus 4.7 + Felipe Vicencio
**Contexto**: Durante Playwright smoke test post-merge de PR #200 (Routes API ADC), validamos el estado del deploy DR. Bloquedos detectados — el deploy del manifest excede esta sesión.

## Lo que SÍ existe (no requiere acción)

- ✅ Manifests K8s listos en `infrastructure/k8s/`:
  - `telemetry-tcp-gateway-dr.yaml` (Deployment + Service + SA + securityContext hardened)
  - `cert-dr.yaml` (Certificate cert-manager para `telemetry-dr.boosterchile.com`)
  - `cert-manager-issuers.yaml` (ClusterIssuer letsencrypt-prod)
- ✅ Cluster GKE Autopilot `booster-ai-telemetry-dr` (us-central1) running
- ✅ IP estática `booster-ai-telemetry-dr-lb` (136.116.208.86) reservada
- ✅ DNS A record `telemetry-dr.boosterchile.com` → 136.116.208.86
- ✅ Cloud NAT DR
- ✅ Imagen `telemetry-tcp-gateway` en Artifact Registry (último SHA `6c6dbcbb44…`, 2026-05-10)
- ✅ SA `booster-cloudrun-sa@…` ya bindeado por workload-identity al K8s SA `telemetry-gateway-sa`

## Lo que falta (bloqueante)

### 1. Pods no desplegados en ningún cluster

`kubectl get pods -A | grep gateway` retorna vacío tanto en primary como DR. El telemetry-tcp-gateway no está corriendo en ninguno.

### 2. Imagen tag `:bootstrap` no existe

El manifest referencia `…/telemetry-tcp-gateway:bootstrap` pero el Artifact Registry no tiene ese tag (`gcloud artifacts docker images list` no muestra `bootstrap`).

- **Comentario en manifest**: *"Cloud Build hace `kubectl set image` al SHA real post-deploy"* — implica que el primer `kubectl apply` falla con `ImagePullBackOff` hasta que el pipeline corrija la imagen.
- **Fix**: tagear el último SHA productivo (`6c6dbcbb44…`) como `:bootstrap` antes del apply:
  ```bash
  gcloud artifacts docker tags add \
    southamerica-west1-docker.pkg.dev/booster-ai-494222/containers/telemetry-tcp-gateway:6c6dbcbb44ab2bfbdaf3faf181c75d311caf226c \
    southamerica-west1-docker.pkg.dev/booster-ai-494222/containers/telemetry-tcp-gateway:bootstrap
  ```
- **Alternativa**: editar el manifest para usar SHA explícito.

### 3. cert-manager status en DR — no verificado

No pude conectar al master DR para verificar si cert-manager está instalado. Si no lo está:
```bash
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --set crds.enabled=true \
  --set serviceAccount.annotations."iam\.gke\.io/gcp-service-account"="cert-manager-cloud-dns@booster-ai-494222.iam.gserviceaccount.com"
```

### 4. Acceso al master DR — bloqueante crítico

| Vector | Resultado |
|---|---|
| `kubectl` desde laptop | `i/o timeout` sobre `34.57.160.40:443` — IP del laptop NO está en `master_authorized_networks_config` |
| `kubectl` desde `db-bastion` (saw1) | `EOF` en handshake con `https://172.17.0.2:443` — el master internal IP del cluster DR no es alcanzable cross-region (saw1 → us-central1) a pesar de `master_global_access_config = enabled` y VPC peering global |
| SA `db-bastion-sa` permissions | Sin `roles/container.developer` (otorgado temporal para test, **ya revocado**) |

## Próximos pasos requeridos

### A. Decidir vector de acceso al master DR

Opciones (en orden de preferencia):

1. **Cloud Build private worker pool** (RECOMENDADO)
   - Ya está en `master_authorized_networks_config` (line `cloudbuild-private-pool`)
   - Crear `cloudbuild.yaml` con steps `kubectl apply` (ver `infrastructure/cloudbuild.tf` para SA + bindings ya configurados)
   - Trigger manual: `gcloud builds submit --config=cloudbuild-dr-deploy.yaml`

2. **Agregar IP del operador a allowlist**
   - Cambiar `var.gke_operator_authorized_cidrs` en tfvars + `terraform apply`
   - Después `kubectl apply` desde laptop
   - Revertir el cambio post-deploy

3. **Crear bastion en us-central1**
   - VM en subnet `booster-ai-dr-private` (10.30.0.0/20)
   - Mismo patrón que `db-bastion` pero en region DR
   - Permite operación continua sin tocar networking

### B. Tagear imagen + verificar cert-manager + apply en orden

Una vez con acceso al master:

```bash
# 1. Tagear imagen :bootstrap (en saw1, repo accesible cross-region)
gcloud artifacts docker tags add \
  …/telemetry-tcp-gateway:6c6dbcbb44ab2bfbdaf3faf181c75d311caf226c \
  …/telemetry-tcp-gateway:bootstrap

# 2. cert-manager (si no está)
helm repo add jetstack https://charts.jetstack.io
helm install cert-manager jetstack/cert-manager -n cert-manager --create-namespace --set crds.enabled=true

# 3. Apply en orden
kubectl apply -f infrastructure/k8s/cert-manager-issuers.yaml
kubectl apply -f infrastructure/k8s/cert-dr.yaml
kubectl apply -f infrastructure/k8s/telemetry-tcp-gateway-dr.yaml

# 4. Watch
kubectl rollout status deployment/telemetry-tcp-gateway -n telemetry
kubectl get certificate -n telemetry
kubectl get svc -n telemetry telemetry-tcp-gateway -o wide
# loadBalancerIP debe ser 136.116.208.86
```

### C. Smoke test de failover

Una vez los pods estén `Ready` y el cert haya hecho handshake con Let's Encrypt:

1. Apuntar un device de test a `telemetry-tcp-gateway:5061` (primary) — verificar mensaje fluye al Pub/Sub `telemetry-events`
2. Bloquear el primary (`kubectl scale deployment telemetry-tcp-gateway -n telemetry --replicas=0`) en el cluster saw1
3. Esperar 5 timeouts consecutivos del device
4. Verificar device hace switchover a `telemetry-dr.boosterchile.com:5061` y los mensajes siguen fluyendo al mismo Pub/Sub
5. Restaurar primary

### D. Runbook + cierre del issue

- Documentar el procedimiento de failover y recovery en `docs/runbooks/`
- Cerrar issue [#194](https://github.com/boosterchile/booster-ai/issues/194)

## Costo del cluster DR mientras tanto

~USD 130/mes (cluster fee $73 + NAT $32 + IP $7 + system pods $18). Aceptable bajo TRL 10 mientras se completa el deploy — pero **NO entrega SLA real hasta que pasen los pasos B y C**.

## Referencias

- [ADR-035](../adr/035-trl10-mantener-ha-recortar-ruido.md) — decisión TRL 10 que preserva el DR cluster
- [ADR-038](../adr/038-routes-api-adc-migration.md) — sesión donde se detectó
- `infrastructure/k8s/README.md` — patterns de deploy K8s
- `infrastructure/cloudbuild.tf` — Cloud Build private pool + SA bindings
- `infrastructure/dr-region.tf` — cluster DR config (eliminado en ADR-035 versión preliminar, restaurado para TRL 10)

🤖 Generado por Claude Opus 4.7
