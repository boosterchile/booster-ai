#!/usr/bin/env bash
# Carga las credenciales OAuth 2.0 de la app HERE (el credentials.properties que descarga
# el portal de HERE) en los secretos que lee .github/workflows/probe-here-usage.yml.
# Lo corre el PO desde su máquina: el agente no tiene credencial de GitHub ni de GCP
# con permiso para escribir secretos. Los valores nunca se imprimen ni pasan por argv:
# van por stdin a gh / gcloud.
#
# Uso:
#   bash scripts/probes/set-here-usage-secrets.sh <ruta a credentials.properties> [--gcp] [--dry-run]
#
#   (sin flag) crea o actualiza los secretos del repo HERE_ACCESS_KEY_ID y
#              HERE_ACCESS_KEY_SECRET (requiere `gh auth login` con admin en el repo).
#              Son los que el workflow lee hoy.
#   --gcp      además crea (si no existen) y versiona here-access-key-id y
#              here-access-key-secret en Secret Manager de booster-ai-494222 (requiere
#              gcloud autenticado con roles/secretmanager.admin). Ningún workflow los lee
#              desde ahí todavía: github-deployer no tiene secretAccessor y ese binding
#              IAM es decisión del PO (CLAUDE.md, archivos protegidos).
#   --dry-run  muestra qué haría; de cada valor solo se imprime su largo.
set -euo pipefail

REPO="${GH_REPO:-boosterchile/booster-ai}"
PROJECT="${GOOGLE_CLOUD_PROJECT:-booster-ai-494222}"
FILE="${1:-}"
[[ $# -gt 0 ]] && shift
DO_GCP=0
DRY=0
for arg in "$@"; do
  case "$arg" in
    --gcp) DO_GCP=1 ;;
    --dry-run) DRY=1 ;;
    *) echo "Argumento desconocido: $arg" >&2; exit 2 ;;
  esac
done
if [[ -z "$FILE" || ! -r "$FILE" ]]; then
  echo "Uso: $0 <credentials.properties> [--gcp] [--dry-run]" >&2
  exit 2
fi

# prop <clave> → valor sin espacios ni CR; falla si la clave no está en el archivo.
prop() {
  local key="${1//./\\.}" val
  val=$(sed -n "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*//p" "$FILE" | head -1 | tr -d '[:space:]\r')
  [[ -n "$val" ]] || { echo "Falta '$1' en $FILE" >&2; exit 1; }
  printf '%s' "$val"
}
mask() { printf '(%d chars)' "${#1}"; }

KEY_ID=$(prop here.access.key.id)
KEY_SECRET=$(prop here.access.key.secret)

set_gh() { # set_gh <NOMBRE> <valor>
  if (( DRY )); then
    echo "[dry-run] gh secret set $1 --repo $REPO  ← $(mask "$2")"
    return
  fi
  printf '%s' "$2" | gh secret set "$1" --repo "$REPO"
  echo "ok: secreto de repo $1"
}

set_gcp() { # set_gcp <secret_id> <valor>
  if (( DRY )); then
    echo "[dry-run] gcloud secrets create|versions add $1 --project $PROJECT  ← $(mask "$2")"
    return
  fi
  if ! gcloud secrets describe "$1" --project "$PROJECT" >/dev/null 2>&1; then
    gcloud secrets create "$1" --project "$PROJECT" --replication-policy=automatic \
      --labels=managed_by=manual,uso=probe-here-usage
  fi
  printf '%s' "$2" | gcloud secrets versions add "$1" --project "$PROJECT" --data-file=-
  echo "ok: Secret Manager $1"
}

if (( ! DRY )); then
  command -v gh >/dev/null || { echo "Falta gh (https://cli.github.com)" >&2; exit 1; }
  gh auth status >/dev/null 2>&1 || { echo "gh sin sesión: corre 'gh auth login'" >&2; exit 1; }
  if (( DO_GCP )); then
    command -v gcloud >/dev/null || { echo "Falta gcloud" >&2; exit 1; }
  fi
fi

set_gh HERE_ACCESS_KEY_ID "$KEY_ID"
set_gh HERE_ACCESS_KEY_SECRET "$KEY_SECRET"
if (( DO_GCP )); then
  set_gcp here-access-key-id "$KEY_ID"
  set_gcp here-access-key-secret "$KEY_SECRET"
fi
echo "Listo. La revisión programada del 23-10 dispara probe-here-usage.yml; para probarlo antes,"
echo "un push en la rama que toque ese workflow o scripts/probes/probe-here-usage.py lo corre."
