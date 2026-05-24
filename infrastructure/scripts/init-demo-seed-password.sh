#!/usr/bin/env bash
# T7.5 SEC-001 — run-once init de demo-seed-password
#
# Genera un password random (32 bytes base64) y lo agrega como nueva version
# del secret `demo-seed-password`. Idempotente: si la version más reciente NO
# es el placeholder `REPLACE_ME_BEFORE_DEPLOY`, asume que ya fue inicializado
# y skipea.
#
# Requiere autenticación gcloud con rol `secretmanager.admin` (PO). Esto NO
# debe correr desde GitHub Actions — solo desde la máquina del PO post-T7
# merge. La CI gate (`check-secret-version-exists.sh`) verifica que el script
# fue corrido, pero NO lo corre por sí misma.
#
# Spec: .specs/sec-001-cierre/plan.md T7.5; SC-1.4.2.

set -euo pipefail

PROJECT="${PROJECT:-booster-ai-494222}"
SECRET="${SECRET:-demo-seed-password}"
PLACEHOLDER_SENTINEL="REPLACE_ME_BEFORE_DEPLOY"

echo "→ Checking current latest version of '${SECRET}' in project '${PROJECT}'..."

# `gcloud secrets versions access latest` retorna el payload de la version
# más reciente. Requiere `secretmanager.secretAccessor` (PO/admin lo tiene).
# Si no podemos leer, fallamos loudly — silent fail-open es exactamente lo
# que el plan prohíbe.
if ! latest=$(gcloud secrets versions access latest \
  --secret="${SECRET}" \
  --project="${PROJECT}" 2>&1); then
  echo "✗ No se pudo leer '${SECRET}'. gcloud output:" >&2
  echo "${latest}" >&2
  echo "  Verifica: 1) gcloud auth login con cuenta PO/admin," >&2
  echo "           2) el secret existe (terraform apply de T7 completado)," >&2
  echo "           3) tienes rol secretmanager.secretAccessor o admin." >&2
  exit 1
fi

if [ "${latest}" != "${PLACEHOLDER_SENTINEL}" ]; then
  echo "✓ '${SECRET}' ya tiene valor no-placeholder. Skip (idempotente)."
  exit 0
fi

echo "→ Generando password random 32 bytes base64..."
new_password="$(openssl rand -base64 32)"

echo "→ Agregando nueva version a '${SECRET}'..."
printf '%s' "${new_password}" | gcloud secrets versions add "${SECRET}" \
  --project="${PROJECT}" \
  --data-file=-

echo "✓ Nueva version del secret '${SECRET}' creada."
echo
echo "Próximos pasos:"
echo "  1. Restart Cloud Run revision del api para que mountee la nueva version:"
echo "     gcloud run services update booster-ai-api --region=us-central1 --project=${PROJECT}"
echo "  2. T8 PR puede mergearse (CI gate validará version count >= 1)."
echo "  3. Anotar en .specs/sec-001-cierre/sprint-1-evidence/t7-5-secret-init.md."
