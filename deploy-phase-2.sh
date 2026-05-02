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
gcloud container clusters get-credentials booster-ai-telemetry \
  --region=southamerica-west1 \
  --project=booster-ai-494222

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
