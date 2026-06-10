# Runbook — Bootstrap del cluster GKE del telemetry-gateway

- **Estado**: Vigente
- **Creado**: 2026-06-10
- **Origen**: pasos extraídos de `deploy-phase-2.sh` (eliminado 2026-06-10, `.specs/ops-eliminar-deploy-phase-2/`). El script era el único lugar del repo que documentaba la creación del secret K8s, el binding de Workload Identity y el grant de Artifact Registry — sin esto los pods quedan en `ImagePullBackOff` / `CreateContainerConfigError`. El review (devils-advocate 2026-06-10) marcó la pérdida como objeción fuerte; este runbook la cierra.
- **Relación**: el deploy de imagen recurrente lo hace `scripts/deploy-telemetry-gateway.sh` (o los pipelines `cloudbuild-primary-deploy.yaml` post-ADR-059). Este runbook es solo para el **primer levantamiento** de un cluster (primary nuevo, o reactivación del cluster DR cold post-ADR-058).

## Cuándo se ejecuta

- Primer deploy del gateway a un cluster GKE recién creado por Terraform.
- Reactivación del cluster DR (`booster-ai-telemetry-dr`, us-central1) que vive en `replicas: 0` (ADR-058) — al escalarlo necesita el secret y los bindings en su propio namespace.

## Prerequisitos

- `kubectl` + `gke-gcloud-auth-plugin` instalados.
- Identidad gcloud del operador (dev@boosterchile.com o grupo engineers@) con acceso al cluster vía DNS endpoint + IAM `roles/container.developer` (ADR-059).
- Credenciales del cluster obtenidas con `--dns-endpoint` (ADR-059), p.ej.:
  `gcloud container clusters get-credentials booster-ai-telemetry --location=southamerica-west1 --dns-endpoint --project=booster-ai-494222`

## Pasos (idempotentes — re-ejecutables sin daño)

```bash
PROJECT=booster-ai-494222
NS=telemetry

# 1. Namespace
kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f -

# 2. Secret database-url (leído de Secret Manager, nunca hardcodeado)
DATABASE_URL=$(gcloud secrets versions access latest --secret=database-url --project="$PROJECT")
kubectl create secret generic telemetry-gateway-secrets \
  --namespace="$NS" \
  --from-literal=database-url="$DATABASE_URL" \
  --dry-run=client -o yaml | kubectl apply -f -

# 3. Workload Identity binding (K8s SA → GCP SA booster-cloudrun-sa)
gcloud iam service-accounts add-iam-policy-binding \
  booster-cloudrun-sa@${PROJECT}.iam.gserviceaccount.com \
  --role roles/iam.workloadIdentityUser \
  --member "serviceAccount:${PROJECT}.svc.id.goog[${NS}/telemetry-gateway-sa]" \
  --project="$PROJECT" || true

# 4. Compute default SA (kubelet de Autopilot) necesita pull de Artifact
#    Registry. Projects post-mayo 2024 NO traen el rol por default → sin
#    esto: ImagePullBackOff.
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format="value(projectNumber)")
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/artifactregistry.reader" \
  --condition=None --quiet
```

Tras el bootstrap, el deploy de la imagen y el manifiesto se hacen con `scripts/deploy-telemetry-gateway.sh` (que también arregla el bug de REPO_ROOT tracked en `.specs/_followups/deploy-telemetry-gateway-repo-root-bug.md`).

## Nota de seguridad

Estos comandos mutan IAM y secrets fuera de Terraform — son setup imperativo deliberado (el secret K8s no puede vivir en el state de TF en claro). NO forman parte de un deploy de aplicación: ejecutarlos solo en bootstrap/reactivación, no en cada release. El grant de `artifactregistry.reader` al compute default SA es a nivel proyecto; revisar si Terraform debería absorberlo (follow-up: `infrastructure/` no lo declara hoy).
