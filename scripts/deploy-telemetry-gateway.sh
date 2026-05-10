#!/usr/bin/env bash
# Deploy manual del telemetry-tcp-gateway al GKE Autopilot.
#
# Por que manual y no automatico via Cloud Build:
#
# Cloud Build private pool (PR #68) y GKE control plane usan service
# networking peerings independientes al booster-ai-vpc. VPC peering NO es
# transitivo por default — el pool no aprende rutas al master CIDR
# (172.16.0.0/28) desde el peering del master, ni viceversa.
#
# Solucion oficial GCP requiere setear `import-custom-routes`/`export-custom-routes`
# en peerings managed (no se puede via Terraform — son creadas por
# servicenetworking automaticamente). Decision: mantener Cloud Build
# pool para builds + push, y deployar GKE manualmente desde laptop
# operador (autorizado en master_authorized_networks via IP whitelist en
# terraform.tfvars.local) o via IAP TCP tunnel.
#
# Usage:
#   ./scripts/deploy-telemetry-gateway.sh <COMMIT_SHA>
#   ./scripts/deploy-telemetry-gateway.sh latest      # tag :latest
#   ./scripts/deploy-telemetry-gateway.sh             # auto-detecta HEAD
#
# Pre-requisitos:
#   - gcloud auth login (con dev@boosterchile.com o miembro engineers@)
#   - IP del laptop en gke_operator_authorized_cidrs O conexion via IAP
#   - kubectl instalado
#
# Idempotente: detecta primer deploy (apply manifests) vs update (set image).

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-booster-ai-494222}"
REGION="${REGION:-southamerica-west1}"
CLUSTER="${CLUSTER:-booster-ai-telemetry}"
NAMESPACE="${NAMESPACE:-telemetry}"
DEPLOYMENT="${DEPLOYMENT:-telemetry-tcp-gateway}"
REGISTRY="${REGISTRY:-${REGION}-docker.pkg.dev/${PROJECT_ID}/containers}"

# Argumento opcional: SHA o tag. Default: HEAD del repo.
TAG="${1:-$(git rev-parse HEAD 2>/dev/null || echo 'latest')}"
IMAGE="${REGISTRY}/${DEPLOYMENT}:${TAG}"

echo "=========================================="
echo "  Deploy telemetry-tcp-gateway"
echo "=========================================="
echo "  Cluster:     ${CLUSTER} (${REGION})"
echo "  Image:       ${IMAGE}"
echo "  Namespace:   ${NAMESPACE}"
echo "  Deployment:  ${DEPLOYMENT}"
echo ""

# Get credentials para el cluster privado.
echo "--- Fetching cluster credentials ---"
gcloud container clusters get-credentials "${CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}"

echo ""
echo "--- Checking deployment state ---"
if ! kubectl get deployment "${DEPLOYMENT}" -n "${NAMESPACE}" > /dev/null 2>&1; then
  echo "Primer deploy — apply manifests completos"
  REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || dirname "$(realpath "$0")")/.."
  kubectl apply -f "${REPO_ROOT}/infrastructure/k8s/telemetry-tcp-gateway.yaml"
fi

echo ""
echo "--- Setting image ---"
kubectl set image "deployment/${DEPLOYMENT}" \
  "gateway=${IMAGE}" \
  -n "${NAMESPACE}"

echo ""
echo "--- Rolling out ---"
kubectl rollout status "deployment/${DEPLOYMENT}" \
  -n "${NAMESPACE}" --timeout=5m

echo ""
echo "=========================================="
echo "  ✓ Deploy completado"
echo "=========================================="
kubectl get pods -n "${NAMESPACE}" -l app="${DEPLOYMENT}" -o wide
