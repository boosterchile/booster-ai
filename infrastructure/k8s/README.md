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

## Datadog Observability

Datadog Agent instalado vía Datadog Operator en el namespace `datadog`.
Habilita: **Infrastructure Monitoring + Log Collection** (todos los containers).

> **Alcance (ADR-071, Decisión 1 = C): SIN APM Datadog.** No se inyecta
> `ddtrace` por Single Step Instrumentation. Los traces del gateway siguen
> por **OTel → `RedactingSpanExporter` → Cloud Trace** (`apps/telemetry-tcp-gateway`).
> Motivo: `ddtrace` exportaría spans **fuera** del redactor de credenciales y
> duplicaría la auto-instrumentación OTel del proceso Node. Ver ADR-071.

### Archivos

- `datadog-agent.yaml` — `DatadogAgent` CR (cluster `booster-ai-telemetry`, site `us5.datadoghq.com`, env `production`; `apm.instrumentation.enabled: false`)
- `setup-datadog.sh` — runbook de bootstrap (Operator vía Helm → secret desde GSM → `kubectl apply` del CR)

**Nota IaC:** el cluster GKE se provisiona en Terraform, pero sus **workloads**
(incluido el propio gateway) se aplican con `kubectl`/Cloud Build, no por
Terraform (ADR-065). El Agent Datadog sigue ese mismo patrón: el CR es un
manifest versionado (`datadog-agent.yaml`) y el Operator se instala con
`helm upgrade --install` (bootstrap). Lo único en Terraform es el **contenedor
del secret** `datadog-api-key` en Secret Manager (`security.tf`); su versión
real la puebla el owner. No se introduce un provider TF de Helm/Kubernetes solo
para Datadog. External Secrets Operator queda **diferido** (mismo estado que el
secret del gateway).

### Instalación inicial

Requisito previo (una sola vez, lo hace el owner): poblar la API key en GSM.

```bash
echo -n "<dd-api-key>" | gcloud secrets versions add datadog-api-key --data-file=-
```

Luego el bootstrap lee la key desde GSM (no del entorno):

```bash
bash infrastructure/k8s/setup-datadog.sh
```

### Pasos manuales equivalentes

```bash
# 1. Credenciales del cluster
gcloud container clusters get-credentials booster-ai-telemetry \
  --region=southamerica-west1 --project=booster-ai-494222

# 2. Instalar Datadog Operator
helm repo add datadog https://helm.datadoghq.com && helm repo update datadog
helm upgrade --install datadog-operator datadog/datadog-operator \
  --namespace datadog --create-namespace

# 3. Materializar el secret k8s desde GSM (source-of-truth)
kubectl create secret generic datadog-secret --namespace datadog \
  --from-literal api-key="$(gcloud secrets versions access latest \
    --secret=datadog-api-key --project=booster-ai-494222)"

# 4. Aplicar el DatadogAgent CR (infra + logs, sin APM)
kubectl apply -f infrastructure/k8s/datadog-agent.yaml
```

> No se reinicia el gateway: la log collection opera a nivel de nodo
> (`containerCollectAll`) y no hay tracer que inyectar.

### Verificar

```bash
# Pods del Agent (esperar 1-2 min tras apply)
kubectl get pods -n datadog

# Confirmar flujo de datos (infra + logs)
open https://app.us5.datadoghq.com/infrastructure
```

### Cobertura

| Señal | Fuente | Destino |
|---|---|---|
| Infra (nodos/pods) | Datadog Agent | Datadog |
| Logs de containers | Datadog Agent (`containerCollectAll`) | Datadog |
| Traces del gateway | OTel + `RedactingSpanExporter` | Cloud Trace (no Datadog) |

Otros workloads de Booster corren en Cloud Run (no GKE) — el Agent del Operator no los cubre.
