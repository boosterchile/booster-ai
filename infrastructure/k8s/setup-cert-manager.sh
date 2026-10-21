#!/usr/bin/env bash
# setup-cert-manager.sh — Lleva cert-manager del clúster booster-ai-telemetry a
# los valores versionados en cert-manager-values.yaml (Helm, versión fijada).
#
# Mismo patrón que setup-datadog.sh (ADR-071): el clúster vive en Terraform y
# sus workloads se aplican con Helm/kubectl desde un runbook (ADR-065).
#
# Uso:
#   ./setup-cert-manager.sh            # vista previa: NO cambia nada
#   ./setup-cert-manager.sh --apply    # aplica (helm upgrade --install)
#
# La vista previa renderiza los Deployments con Helm y los manda a la API del
# clúster con `kubectl apply --dry-run=server`: pasan por la admisión de
# Autopilot sin persistirse. Muestra los requests que quedarían de verdad.
#
# Qué pasa al aplicar: Helm reinicia los 3 pods de cert-manager (rolling).
# Mientras el webhook se reinicia (segundos), crear o editar recursos de
# cert-manager falla. El certificado TLS del gateway ya emitido no se toca:
# vive en el Secret telemetry/telemetry-tls-cert.
#
# Rollback: el script imprime los comandos antes de aplicar. Son dos pasos:
# `helm rollback` a la revisión previa y volver a poner la anotación de
# Workload Identity en el ServiceAccount. La revisión 1 no la trae en sus
# valores (se puso con `kubectl annotate`), así que un rollback a ella la
# borra; sin la anotación, el DNS-01 de la próxima renovación falla.
#
# El script usa un kubeconfig temporal que borra al salir: no cambia el
# contexto actual del operador.
#
# Requiere: gcloud, kubectl y helm 3, con roles/container.developer o más.
# Usa el endpoint DNS del control plane (ADR-059): el endpoint IP no es
# alcanzable desde fuera de la VPC.

set -euo pipefail

CLUSTER="booster-ai-telemetry"
REGION="southamerica-west1"
PROJECT="booster-ai-494222"
NAMESPACE="cert-manager"
RELEASE="cert-manager"
CHART="jetstack/cert-manager"
# Fijada a la versión que corre hoy. Subirla es un cambio aparte, con su PR.
CHART_VERSION="v1.20.2"
WI_ANNOTATION="iam.gke.io/gcp-service-account=cert-manager-cloud-dns@${PROJECT}.iam.gserviceaccount.com"
MANIFEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VALUES="${MANIFEST_DIR}/cert-manager-values.yaml"

APPLY=false
case "${1:-}" in
  --apply) APPLY=true ;;
  "") ;;
  *)
    echo "Uso: $0 [--apply]" >&2
    exit 2
    ;;
esac

for bin in gcloud kubectl helm; do
  if ! command -v "${bin}" >/dev/null 2>&1; then
    echo "ERROR: falta '${bin}' en el PATH." >&2
    exit 1
  fi
done

KUBECONFIG="$(mktemp -t cert-manager-kubeconfig.XXXXXX)"
export KUBECONFIG
trap 'rm -f "${KUBECONFIG}"' EXIT

kc() { kubectl --request-timeout=60s "$@"; }

REQUESTS_JSONPATH='{range .items[*]}{.metadata.name}{"\t"}{.spec.template.spec.containers[0].resources}{"\n"}{end}'

echo "==> Credenciales del clúster ${CLUSTER} (endpoint DNS, kubeconfig temporal)..."
gcloud container clusters get-credentials "${CLUSTER}" \
  --location="${REGION}" \
  --project="${PROJECT}" \
  --dns-endpoint

echo "==> Versión instalada..."
# --ignore-not-found: vacío si no hay instalación; un error de red o de
# permisos sí corta el script (set -e).
INSTALLED_CHART="$(kc get deployment cert-manager -n "${NAMESPACE}" --ignore-not-found \
  -o jsonpath='{.metadata.labels.helm\.sh/chart}')"
if [ -z "${INSTALLED_CHART}" ]; then
  echo "    cert-manager no está instalado: se instalará ${CHART_VERSION}."
elif [ "${INSTALLED_CHART}" != "cert-manager-${CHART_VERSION}" ]; then
  echo "ERROR: en el clúster corre ${INSTALLED_CHART} y este script fija ${CHART_VERSION}." >&2
  echo "  Cambiar de versión es otro cambio: actualizá CHART_VERSION en un PR propio." >&2
  exit 1
else
  echo "    ${INSTALLED_CHART} (coincide con la versión fijada)."
  echo "==> Requests actuales:"
  kc get deployment -n "${NAMESPACE}" -o jsonpath="${REQUESTS_JSONPATH}"
fi

echo "==> Repositorio Helm de jetstack..."
helm repo add jetstack https://charts.jetstack.io --force-update >/dev/null
helm repo update jetstack >/dev/null

if [ "${APPLY}" = false ]; then
  echo "==> Vista previa: requests e imagen que dejaría Autopilot (dry-run del servidor, no persiste)..."
  # Con varios documentos, `kubectl apply -o jsonpath` recibe una List: el
  # jsonpath recorre .items (probado con kubectl 1.35 contra el clúster).
  helm template "${RELEASE}" "${CHART}" \
    --namespace "${NAMESPACE}" \
    --version "${CHART_VERSION}" \
    --values "${VALUES}" \
    --show-only templates/deployment.yaml \
    --show-only templates/cainjector-deployment.yaml \
    --show-only templates/webhook-deployment.yaml |
    kc apply --dry-run=server -f - \
      -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.template.spec.containers[0].resources}{"\t"}{.spec.template.spec.containers[0].image}{"\n"}{end}'
  echo ""
  echo "Nada cambió en el clúster. Para aplicar: $0 --apply"
  exit 0
fi

if [ -n "${INSTALLED_CHART}" ]; then
  PREV_REVISION="$(helm history "${RELEASE}" -n "${NAMESPACE}" --max 1 | awk 'NR==2 {print $1}')"
  echo "==> Revisión Helm previa: ${PREV_REVISION}. Rollback, si hiciera falta:"
  echo "    gcloud container clusters get-credentials ${CLUSTER} --location=${REGION} --project=${PROJECT} --dns-endpoint"
  echo "    helm rollback ${RELEASE} ${PREV_REVISION} -n ${NAMESPACE} --wait"
  echo "    kubectl annotate serviceaccount cert-manager -n ${NAMESPACE} ${WI_ANNOTATION} --overwrite"
fi

echo "==> helm upgrade --install ${RELEASE} ${CHART} ${CHART_VERSION}..."
helm upgrade --install "${RELEASE}" "${CHART}" \
  --namespace "${NAMESPACE}" \
  --create-namespace \
  --version "${CHART_VERSION}" \
  --values "${VALUES}" \
  --wait \
  --timeout 5m

echo "==> Rollout de los 3 Deployments..."
for d in cert-manager cert-manager-cainjector cert-manager-webhook; do
  kc rollout status "deployment/${d}" -n "${NAMESPACE}" --timeout=180s
done

echo "==> Requests después del cambio:"
kc get deployment -n "${NAMESPACE}" -o jsonpath="${REQUESTS_JSONPATH}"

echo "==> Anotación de Workload Identity del ServiceAccount:"
kc get serviceaccount cert-manager -n "${NAMESPACE}" \
  -o jsonpath='{.metadata.annotations.iam\.gke\.io/gcp-service-account}{"\n"}'

echo "==> ClusterIssuer y Certificate del gateway (deben seguir Ready)..."
kc wait clusterissuer/letsencrypt-prod --for=condition=Ready --timeout=120s
kc wait certificate/telemetry-tls-cert -n telemetry --for=condition=Ready --timeout=120s

echo ""
echo "✅ cert-manager quedó con los valores de cert-manager-values.yaml."
echo "   Verificá la factura en 2-3 días: el SKU «Autopilot Pod mCPU Requests» debería"
echo "   bajar de ~2,0 a ~0,65 vCPU promedio (gateway 0,5 + cert-manager 0,15, más los"
echo "   canary-probe mientras dura un deploy), y «Memory Requests» de ~7 a ~1,3 GiB."
