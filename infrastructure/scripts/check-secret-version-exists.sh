#!/usr/bin/env bash
# T7.5 SEC-001 — CI gate que valida que un Secret Manager secret tenga >= 1 version.
#
# Fail-closed loudly: exit 1 si
#   - gcloud auth no responde,
#   - el secret no existe,
#   - el secret tiene 0 versions.
# Nunca silent fail-open (regresión de SEC-2026-04-01 fue exactamente eso).
#
# Usage: check-secret-version-exists.sh <secret-id> [project-id]
# Defaults: project = booster-ai-494222 (override con env PROJECT o $2).
#
# Permisos necesarios: `roles/secretmanager.viewer` sobre el secret para el SA
# que ejecuta (en CI: github-deployer via WIF — grant en
# security-hotfixes-2026-05-14.tf T7.5.1).
#
# Spec: .specs/sec-001-cierre/plan.md T7.5; ronda 2 P0-C.

set -euo pipefail

SECRET="${1:-}"
if [ -z "${SECRET}" ]; then
  echo "::error::Usage: $0 <secret-id> [project-id]" >&2
  exit 1
fi
PROJECT="${2:-${PROJECT:-booster-ai-494222}}"

# `gcloud secrets versions list` falla si auth misconfig OR si secret no
# existe (ambas son fallas hard que queremos surfacing). `--limit=1
# --format='value(name)'` retorna el nombre completo de la version más
# reciente (e.g. `projects/.../secrets/X/versions/3`) o cadena vacía si 0.
if ! versions=$(gcloud secrets versions list "${SECRET}" \
  --project="${PROJECT}" \
  --limit=1 \
  --format='value(name)' 2>&1); then
  echo "::error::Failed to list versions of '${SECRET}' in project '${PROJECT}'." >&2
  echo "${versions}" >&2
  echo "::notice::Si auth falla, revisa que el SA del runner tenga roles/secretmanager.viewer sobre el secret (security-hotfixes-2026-05-14.tf grant T7.5.1)." >&2
  exit 1
fi

if [ -z "${versions}" ]; then
  echo "::error::Secret '${SECRET}' tiene 0 versions." >&2
  echo "::notice::Run-once setup pendiente: ejecuta infrastructure/scripts/init-demo-seed-password.sh desde la máquina del PO. Ver docs/runbooks/secret-init-runbook.md." >&2
  exit 1
fi

echo "✓ Secret '${SECRET}' tiene al menos 1 version: ${versions}"
