#!/usr/bin/env bash
# setup-datadog.sh — Bootstrap de Datadog en el cluster GKE Autopilot booster-ai-telemetry
#
# Runbook de instalación inicial / DR (ADR-071, Decisión 1 = C: infra + logs,
# SIN APM Datadog). La vía primaria de la config es declarativa: el CR vive en
# datadog-agent.yaml (versionado) y se aplica con `kubectl apply`, igual que el
# resto de workloads GKE (ADR-065). Este script sólo orquesta el bootstrap del
# Operator (Helm) y la materialización del secret desde Google Secret Manager.
#
# La API key NUNCA se pasa por el entorno ni se pega a mano: se lee de GSM
# (source-of-truth). Poblá el valor real una vez con:
#   echo -n "<dd-api-key>" | gcloud secrets versions add datadog-api-key --data-file=-
#
# Requiere: kubectl, helm, gcloud con credenciales del cluster + acceso a GSM.

set -euo pipefail

CLUSTER="booster-ai-telemetry"
REGION="southamerica-west1"
PROJECT="booster-ai-494222"
AGENT_NAMESPACE="datadog"
DD_SECRET_NAME="datadog-api-key" # secret en Google Secret Manager (Terraform)
MANIFEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Obteniendo credenciales del cluster ${CLUSTER}..."
gcloud container clusters get-credentials "${CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT}"

echo "==> Leyendo la API key de Datadog desde Secret Manager (${DD_SECRET_NAME})..."
DD_API_KEY="$(gcloud secrets versions access latest \
  --secret="${DD_SECRET_NAME}" \
  --project="${PROJECT}")"
if [ -z "${DD_API_KEY}" ] || printf '%s' "${DD_API_KEY}" | grep -q '^ROTATE_ME_'; then
  echo "ERROR: el secret ${DD_SECRET_NAME} aún tiene el placeholder o está vacío."
  echo "  Poblá el valor real (una sola vez) con:"
  echo "    echo -n \"<dd-api-key>\" | gcloud secrets versions add ${DD_SECRET_NAME} --data-file=-"
  exit 1
fi

echo "==> Instalando el Datadog Operator en namespace '${AGENT_NAMESPACE}'..."
helm repo add datadog https://helm.datadoghq.com
helm repo update datadog
helm upgrade --install datadog-operator datadog/datadog-operator \
  --namespace "${AGENT_NAMESPACE}" \
  --create-namespace

echo "==> Materializando el secret k8s datadog-secret desde GSM..."
kubectl create secret generic datadog-secret \
  --from-literal api-key="${DD_API_KEY}" \
  --namespace "${AGENT_NAMESPACE}" \
  --dry-run=client -o yaml | kubectl apply -f -
unset DD_API_KEY

echo "==> Aplicando el DatadogAgent CR (infra + logs, sin APM)..."
kubectl apply -f "${MANIFEST_DIR}/datadog-agent.yaml"

echo "==> Esperando que el Operator reconcilie (puede tardar 1-2 min)..."
kubectl get pods -n "${AGENT_NAMESPACE}"

echo ""
echo "✅ Bootstrap completado (infra + logs)."
echo "   NO se reinicia el gateway: log collection opera a nivel de nodo y no"
echo "   hay tracer inyectado (los traces del gateway siguen en Cloud Trace)."
echo "   Verificá el flujo de datos en: https://app.us5.datadoghq.com/infrastructure"
