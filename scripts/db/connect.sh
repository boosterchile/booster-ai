#!/usr/bin/env bash
# =============================================================================
# Booster AI — conexión a Cloud SQL desde laptop de operadores
# =============================================================================
# Implementación de la Capa 1 del ADR-013: bastion VM + IAP TCP forwarding +
# cloud-sql-proxy (en bastion) + IAM database authentication (en laptop).
#
# Sin VPN, sin IPs públicas, sin password humanos. Cada operador conecta como
# su email IAM, autenticando con su access token de gcloud.
#
# Uso:
#   bash scripts/db/connect.sh                     → psql interactivo (IAM auth)
#   bash scripts/db/connect.sh -f scripts/sql/x    → ejecuta x.sql y sale
#   bash scripts/db/connect.sh -c "SELECT 1"       → ejecuta query y sale
#
#   AUTH_MODE=password bash scripts/db/connect.sh  → conecta como booster_app
#                                                    (para DDL/migrations/GRANTs)
#
# Qué hace:
#   1. Verifica gcloud auth y permisos IAP.
#   2. Levanta `gcloud compute start-iap-tunnel` hacia el bastion en background.
#   3. Conecta psql al puerto local del túnel.
#      - IAM mode: user = email gcloud, password = access token efímero.
#      - Password mode: user = booster_app, password = Secret Manager.
#   4. Cleanup del túnel al exit.
#
# Configuración (env vars):
#   PROJECT_ID        proyecto GCP (default: booster-ai-494222)
#   ZONE              zona del bastion (default: southamerica-west1-a)
#   BASTION_NAME      VM bastion (default: db-bastion)
#   LOCAL_PORT        puerto local del túnel (default: 5433)
#   DB_NAME           database (default: booster_ai)
#   AUTH_MODE         "iam" (default) | "password"

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-booster-ai-494222}"
ZONE="${ZONE:-southamerica-west1-a}"
BASTION_NAME="${BASTION_NAME:-db-bastion}"
LOCAL_PORT="${LOCAL_PORT:-5433}"
DB_NAME="${DB_NAME:-booster_ai}"
AUTH_MODE="${AUTH_MODE:-iam}"

# ------------------------------------------------------------------------------
# Pre-reqs
# ------------------------------------------------------------------------------
if ! command -v gcloud >/dev/null 2>&1; then
  echo "✗ gcloud no instalado." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "→ psql no encontrado, instalando con brew…"
  brew install libpq && brew link --force libpq
fi

ACTIVE_ACCOUNT=$(gcloud config get-value account 2>/dev/null || echo "")
if [[ -z "$ACTIVE_ACCOUNT" ]]; then
  echo "✗ No hay gcloud auth activa. Corré: gcloud auth login" >&2
  exit 1
fi

echo "→ proyecto    : $PROJECT_ID"
echo "→ bastion     : $BASTION_NAME ($ZONE)"
echo "→ db          : $DB_NAME"
echo "→ auth mode   : $AUTH_MODE"
echo "→ local port  : $LOCAL_PORT"

# ------------------------------------------------------------------------------
# IAP tunnel en background
# ------------------------------------------------------------------------------
TUNNEL_LOG=$(mktemp)
TUNNEL_PID=""
cleanup() {
  if [[ -n "$TUNNEL_PID" ]] && kill -0 "$TUNNEL_PID" 2>/dev/null; then
    kill "$TUNNEL_PID" 2>/dev/null || true
    wait "$TUNNEL_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

gcloud compute start-iap-tunnel "$BASTION_NAME" 5432 \
  --local-host-port="127.0.0.1:${LOCAL_PORT}" \
  --zone="$ZONE" \
  --project="$PROJECT_ID" \
  >"$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!

# Esperar al túnel — TCP probe contra el puerto local (más confiable que
# parsear el output de gcloud, que no emite un mensaje de "ready" estable).
echo "→ levantando IAP tunnel…"
TUNNEL_READY=0
for _ in $(seq 1 30); do
  if (echo > /dev/tcp/127.0.0.1/"$LOCAL_PORT") 2>/dev/null; then
    echo "  túnel listo"
    TUNNEL_READY=1
    break
  fi
  if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
    echo "✗ tunnel murió. Log:" >&2
    cat "$TUNNEL_LOG" >&2
    exit 1
  fi
  sleep 1
done
if [[ "$TUNNEL_READY" -eq 0 ]]; then
  echo "✗ tunnel no quedó listening tras 30s. Log:" >&2
  cat "$TUNNEL_LOG" >&2
  exit 1
fi

# ------------------------------------------------------------------------------
# Construir credenciales según modo
# ------------------------------------------------------------------------------
if [[ "$AUTH_MODE" == "iam" ]]; then
  PGUSER="$ACTIVE_ACCOUNT"
  PGPASSWORD="$(gcloud auth print-access-token)"
  export PGPASSWORD
else
  echo "→ obteniendo credenciales password de Secret Manager…"
  DB_URL=$(gcloud secrets versions access latest --secret=database-url --project="$PROJECT_ID")
  # libpq decodifica %XX cuando se le pasa una conn URL — usamos eso. El proxy
  # ya termina TLS hacia Cloud SQL, así que sslmode=disable en la conexión
  # local (sin esto libpq pide TLS contra el túnel TCP plano).
  PGUSER="booster_app"
  CONN_URL=$(python3 -c "
import sys, urllib.parse as u
p = u.urlparse(sys.stdin.read().strip())
new = p._replace(netloc=f'{p.username}:{u.quote(u.unquote(p.password), safe=\"\")}@127.0.0.1:${LOCAL_PORT}', query='sslmode=disable')
print(u.urlunparse(new))
" <<<"$DB_URL")
fi

# ------------------------------------------------------------------------------
# Ejecutar psql
# ------------------------------------------------------------------------------
if [[ "$AUTH_MODE" == "iam" ]]; then
  if [[ $# -gt 0 ]]; then
    psql -h 127.0.0.1 -p "$LOCAL_PORT" -U "$PGUSER" -d "$DB_NAME" "$@"
  else
    echo "→ psql interactivo. Salí con \\q o Ctrl+D."
    psql -h 127.0.0.1 -p "$LOCAL_PORT" -U "$PGUSER" -d "$DB_NAME"
  fi
else
  if [[ $# -gt 0 ]]; then
    psql "$CONN_URL" "$@"
  else
    echo "→ psql interactivo (booster_app). Salí con \\q o Ctrl+D."
    psql "$CONN_URL"
  fi
fi
