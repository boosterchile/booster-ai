#!/usr/bin/env bash
# T2 SEC-001 Sprint 2a — run-once init de los 4 secrets demo-account-password-*-2026.
#
# Genera passwords random 128-bit (16 bytes base64) y agrega como version
# inicial de cada secret. Idempotente: si el secret ya tiene >= 1 version,
# skipea ese secret + log.
#
# Reemplaza el patrón TS planeado en plan-sprint-2a T2 v3 con shell para
# alinear con Sprint 1 T7.5 (init-demo-seed-password.sh) — explícitamente
# citado en plan T2 acceptance como "mismo pattern Sprint 1 T7.5". Cero
# nuevas devDeps en el monorepo. La idempotency-equivalent test es el CI
# gate check-secret-version-exists.sh (Sprint 1 pattern extensible a estos
# 4 secrets cuando T3+T4 mergeen).
#
# Requiere autenticación gcloud con rol `secretmanager.admin` sobre cada
# secret (PO). NO debe correr desde GitHub Actions — solo desde la máquina
# del PO post-`terraform apply` que cree los 4 secrets vacíos.
#
# Spec: .specs/sec-001-cierre/plan-sprint-2a.md T2; SC-1.1.5. ADR-053.

set -euo pipefail

PROJECT="${PROJECT:-booster-ai-494222}"

# Lista de secrets a inicializar. Hardcoded para evitar inferencia desde
# Terraform locals (cohesión: el script es self-documenting). Match exacto
# de los secret_id declarados en infrastructure/security-hotfixes-2026-05-14.tf.
SECRETS=(
  "demo-account-password-shipper-2026"
  "demo-account-password-carrier-2026"
  "demo-account-password-stakeholder-2026"
  "demo-account-password-conductor-2026-firebase"
)

echo "→ Project: ${PROJECT}"
echo "→ Inicializando ${#SECRETS[@]} secrets demo Sprint 2a H1.1..."
echo

created=0
skipped=0
failed=0

for secret in "${SECRETS[@]}"; do
  echo "─── ${secret}"

  # Verificar si ya tiene >= 1 version. `gcloud secrets versions list
  # --limit=1 --format='value(name)'` retorna nombre completo de la version
  # más reciente o cadena vacía si 0 versions. Falla si secret no existe
  # o auth fail — ambos casos hard.
  if ! versions=$(gcloud secrets versions list "${secret}" \
    --project="${PROJECT}" \
    --limit=1 \
    --format='value(name)' 2>&1); then
    echo "  ✗ ERROR listando versions de '${secret}':" >&2
    echo "    ${versions}" >&2
    echo "    Verifica: 1) terraform apply de T2 ya creó el secret;" >&2
    echo "             2) gcloud auth con rol secretmanager.admin;" >&2
    echo "             3) PROJECT correcto." >&2
    failed=$((failed + 1))
    continue
  fi

  if [ -n "${versions}" ]; then
    echo "  ✓ Ya tiene version — skip (idempotente). Latest: ${versions}"
    skipped=$((skipped + 1))
    continue
  fi

  echo "  → 0 versions detectadas. Generando password random 128-bit (16 bytes base64)..."
  new_password="$(openssl rand -base64 16)"

  echo "  → Agregando version inicial..."
  if printf '%s' "${new_password}" | gcloud secrets versions add "${secret}" \
    --project="${PROJECT}" \
    --data-file=- > /dev/null 2>&1; then
    echo "  ✓ Version creada."
    created=$((created + 1))
  else
    echo "  ✗ ERROR creando version de '${secret}'." >&2
    failed=$((failed + 1))
  fi
done

echo
echo "─── Resumen"
echo "  created: ${created}"
echo "  skipped: ${skipped}"
echo "  failed:  ${failed}"

if [ "${failed}" -gt 0 ]; then
  echo
  echo "✗ ${failed} secret(s) failed. Revisa logs arriba." >&2
  exit 1
fi

echo
echo "✓ Init completo. Próximos pasos:"
echo "  1. T3 (seed-demo refactor) puede consumir los secrets vía SDK."
echo "  2. T4 (harden-demo-accounts.ts --recreate) usará los passwords como"
echo "     primary credential de las 4 nuevas UIDs Firebase."
echo "  3. Anotar evidencia en .specs/sec-001-cierre/sprint-2a-evidence/t2-secret-init.md."
