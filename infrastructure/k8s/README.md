# Booster AI — K8s manifests

Manifests Kubernetes para workloads que NO van a Cloud Run.

## telemetry-tcp-gateway

Long-lived TCP server para devices Teltonika. Cloud Run cierra
conexiones TCP idle ≤1 min, lo que rompe el patrón de telemetría
continua. GKE Autopilot mantiene conexiones indefinidamente.

### Pre-requisitos

1. Cluster `booster-ai-telemetry` creado por Terraform (`infrastructure/compute.tf`).
2. Imagen Docker `southamerica-west1-docker.pkg.dev/booster-ai-494222/containers/telemetry-tcp-gateway:<sha>` publicada en Artifact Registry (Cloud Build step).
3. Secret K8s `telemetry-gateway-secrets` en namespace `telemetry` con la key `database-url`. Crear una vez:
   ```bash
   gcloud container clusters get-credentials booster-ai-telemetry \
     --region=southamerica-west1 \
     --project=booster-ai-494222

   kubectl create namespace telemetry
   DATABASE_URL=$(gcloud secrets versions access latest \
     --secret=database-url --project=booster-ai-494222)
   kubectl create secret generic telemetry-gateway-secrets \
     --namespace=telemetry \
     --from-literal=database-url="$DATABASE_URL"
   ```
4. Workload Identity binding: dar al K8s SA permiso para impersonar el GCP SA `booster-cloudrun-sa`:
   ```bash
   gcloud iam service-accounts add-iam-policy-binding \
     booster-cloudrun-sa@booster-ai-494222.iam.gserviceaccount.com \
     --role roles/iam.workloadIdentityUser \
     --member "serviceAccount:booster-ai-494222.svc.id.goog[telemetry/telemetry-gateway-sa]"
   ```

### Apply

```bash
kubectl apply -f infrastructure/k8s/telemetry-tcp-gateway.yaml
```

Esperar el LoadBalancer IP externo:

```bash
kubectl get service telemetry-tcp-gateway -n telemetry --watch
```

Cuando aparezca `EXTERNAL-IP`, configurar el device Teltonika apuntando
ahí (puerto 5027) via Teltonika Configurator.

### Update de imagen

Cloud Build step automatizado (cloudbuild.production.yaml):

```bash
kubectl set image deployment/telemetry-tcp-gateway \
  gateway=southamerica-west1-docker.pkg.dev/booster-ai-494222/containers/telemetry-tcp-gateway:$_COMMIT_SHA \
  -n telemetry
kubectl rollout status deployment/telemetry-tcp-gateway -n telemetry --timeout=5m
```
