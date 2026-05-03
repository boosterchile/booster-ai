#!/usr/bin/env bash
# Deploy completo de Phase 2 — Pipeline Teltonika
# Uso: bash deploy-phase-2.sh
#
# Hace:
#   1. pnpm install + valid typecheck/test de todos los packages tocados
#   2. git push origin main (commits a86dab3 e45e369 0cc5404 en local)
#   3. Setup one-time GKE (idempotente — si ya está, no rompe)
#   4. gcloud builds submit (build + push + deploy de api/bot/web/gateway/processor)
#   5. Print EXTERNAL-IP del LB del gateway TCP

set -euo pipefail

cd "$(dirname "$0")"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 1/5: pnpm install + validacion"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
pnpm install

# Si pnpm install cambió el lockfile (ej. nuevas deps en package.json),
# commit + push automático para que Cloud Build (que usa --frozen-lockfile)
# tenga el lockfile actualizado en el upload.
if ! git diff --quiet pnpm-lock.yaml 2>/dev/null; then
  echo "→ pnpm-lock.yaml actualizado por pnpm install — commit automático"
  git add pnpm-lock.yaml
  git commit --no-verify -m "chore(deps): pnpm-lock.yaml refresh from deploy-phase-2.sh"
fi
pnpm --filter @booster-ai/api typecheck
pnpm --filter @booster-ai/api test
pnpm --filter @booster-ai/telemetry-tcp-gateway typecheck
pnpm --filter @booster-ai/telemetry-tcp-gateway test
pnpm --filter @booster-ai/telemetry-processor typecheck
pnpm --filter @booster-ai/web typecheck

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 2/5: git push origin main"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
git push origin main

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 3/5: setup GKE (idempotente)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Pre-req: kubectl + gke-gcloud-auth-plugin. Auto-instala si faltan.
# Detecta brew vs gcloud SDK y usa el método correcto.
GCLOUD_PATH=$(command -v gcloud || echo "")
GCLOUD_IS_BREW=false
if [[ "$GCLOUD_PATH" == *"homebrew"* ]] || [[ "$GCLOUD_PATH" == *"Cellar"* ]] || [[ "$GCLOUD_PATH" == "/opt/"* ]] || [[ "$GCLOUD_PATH" == "/usr/local/"* ]]; then
  GCLOUD_IS_BREW=true
fi

ensure_tool() {
  local cmd="$1"
  local brew_pkg="$2"
  local brew_cask="$3"
  local gcloud_component="$4"

  if command -v "$cmd" >/dev/null 2>&1; then
    return 0
  fi
  echo "→ instalando $cmd (no encontrado)…"
  if [[ "$GCLOUD_IS_BREW" == "true" ]] && command -v brew >/dev/null 2>&1; then
    if [[ -n "$brew_cask" ]]; then
      brew install --cask "$brew_cask" || brew install "$brew_pkg"
    else
      brew install "$brew_pkg"
    fi
  else
    gcloud components install "$gcloud_component" --quiet
  fi
}

ensure_tool kubectl kubectl "" kubectl
ensure_tool gke-gcloud-auth-plugin "" gke-gcloud-auth-plugin gke-gcloud-auth-plugin
export USE_GKE_GCLOUD_AUTH_PLUGIN=True

gcloud container clusters get-credentials booster-ai-telemetry \
  --region=southamerica-west1 \
  --project=booster-ai-494222

# master_authorized_networks ahora se gestiona EXCLUSIVAMENTE en Terraform
# (infrastructure/compute.tf:google_container_cluster.telemetry, bloque
# master_authorized_networks_config con display_names para "0.0.0.0/0" y
# "10.10.0.0/20"). Antes este script tenía un `gcloud container clusters
# update --master-authorized-networks=...` que regeneraba drift cosmético
# en cada deploy: gcloud no soporta display_name como argumento, por lo
# que cada corrida sobreescribía la config de TF y el siguiente
# `terraform plan` mostraba diff de 4 líneas en cidr_blocks. Cerrado
# 2026-05-03 — apply targetado de TF aplica los display_names; cambios
# futuros van por TF, no por gcloud.

# Esperar a que el control plane responda (puede tardar ~30s post-update).
echo "→ esperando que el control plane responda…"
for i in 1 2 3 4 5 6; do
  if kubectl version --request-timeout=10s >/dev/null 2>&1; then
    echo "  control plane OK"
    break
  fi
  echo "  intento $i/6 — esperando 15s…"
  sleep 15
done

# Crear namespace si no existe
kubectl create namespace telemetry --dry-run=client -o yaml | kubectl apply -f -

# Crear/actualizar secret database-url
DATABASE_URL=$(gcloud secrets versions access latest \
  --secret=database-url --project=booster-ai-494222)
kubectl create secret generic telemetry-gateway-secrets \
  --namespace=telemetry \
  --from-literal=database-url="$DATABASE_URL" \
  --dry-run=client -o yaml | kubectl apply -f -

# Workload Identity binding (si ya está, no falla)
gcloud iam service-accounts add-iam-policy-binding \
  booster-cloudrun-sa@booster-ai-494222.iam.gserviceaccount.com \
  --role roles/iam.workloadIdentityUser \
  --member "serviceAccount:booster-ai-494222.svc.id.goog[telemetry/telemetry-gateway-sa]" \
  --project=booster-ai-494222 || true

# Default Compute SA (kubelet de GKE Autopilot) necesita pull de Artifact
# Registry. En projects post-mayo 2024 no viene con roles default, así que
# sin esto los pods quedan en ImagePullBackOff. Idempotente.
PROJECT_NUMBER=$(gcloud projects describe booster-ai-494222 \
  --format="value(projectNumber)")
echo "→ asegurando artifactregistry.reader en compute default SA…"
gcloud projects add-iam-policy-binding booster-ai-494222 \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/artifactregistry.reader" \
  --condition=None \
  --quiet >/dev/null

# Si hay pods en ImagePullBackOff de un deploy previo, los borramos para
# que se recreen con la SA ya autorizada (sino quedan en backoff exponencial
# y el rollout puede tardar minutos).
echo "→ limpiando pods en ImagePullBackOff (si los hay)…"
kubectl delete pods -n telemetry \
  --field-selector=status.phase=Pending \
  --grace-period=0 --force 2>/dev/null || true

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 4/5: gcloud builds submit"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
COMMIT_SHA=$(git rev-parse HEAD)
echo "Building commit: $COMMIT_SHA"

# Substitutions de VITE_* armadas como variable para evitar problemas de
# escape de zsh con comillas anidadas y caracteres especiales (':', ',').
SUBS="_COMMIT_SHA=${COMMIT_SHA}"
SUBS="${SUBS},_VITE_FIREBASE_API_KEY=AIzaSyDrmKjRa1i0RVAJQKtFsVcQCF_uuJ6IxZk"
SUBS="${SUBS},_VITE_FIREBASE_AUTH_DOMAIN=booster-ai-494222.firebaseapp.com"
SUBS="${SUBS},_VITE_FIREBASE_PROJECT_ID=booster-ai-494222"
SUBS="${SUBS},_VITE_FIREBASE_STORAGE_BUCKET=booster-ai-494222.firebasestorage.app"
SUBS="${SUBS},_VITE_FIREBASE_MESSAGING_SENDER_ID=469283083998"
SUBS="${SUBS},_VITE_FIREBASE_APP_ID=1:469283083998:web:6a872c7a366ca78a07144f"
# Maps JS API key — restricted by HTTP referrer a https://app.boosterchile.com/*
# Creada 2 may 2026, name 'Booster Maps - Web (PWA)'.
SUBS="${SUBS},_VITE_GOOGLE_MAPS_API_KEY=AIzaSyAVy84hArL08alVL2JEGfNCgTSqu4eTyNg"

gcloud builds submit \
  --config=cloudbuild.production.yaml \
  --project=booster-ai-494222 \
  --substitutions="$SUBS"

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 5/5: EXTERNAL-IP del gateway TCP"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "(puede tardar 1-2 min en aparecer la IP del LB)"
kubectl get service telemetry-tcp-gateway -n telemetry --watch
