#!/usr/bin/env bash
# =============================================================================
# Booster AI — conexión a Cloud SQL desde Mac de operadores
# =============================================================================
# Uso:
#   bash scripts/db/connect.sh           → abre psql interactivo
#   bash scripts/db/connect.sh -f x.sql  → ejecuta x.sql y sale
#
# Qué hace:
#   1. Verifica que cloud-sql-proxy esté instalado (sino: brew install).
#   2. Verifica gcloud auth login activo.
#   3. Lanza el proxy en background apuntando a la instancia productiva.
#      Usa --auto-iam-authn si la DB tiene IAM auth habilitada (TF apply
#      del flag database_flags.cloudsql.iam_authentication=on); sino
#      cae al modo password con booster_app + secret de Secret Manager.
#   4. Abre psql al puerto local 5433.
#   5. Cleanup del proxy al exit.
#
# Configuración:
#   PROJECT_ID        proyecto GCP (default: booster-ai-494222)
#   INSTANCE_NAME     nombre de la instancia (default: booster-ai-pg-07d9e939)
#   REGION            región (default: southamerica-west1)
#   LOCAL_PORT        puerto local del proxy (default: 5433)
#   DB_NAME           DB a conectar (default: booster_ai)
#   AUTH_MODE         "iam" (default si IAM enabled) | "password"

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-booster-ai-494222}"
INSTANCE_NAME="${INSTANCE_NAME:-booster-ai-pg-07d9e939}"
REGION="${REGION:-southamerica-west1}"
LOCAL_PORT="${LOCAL_PORT:-5433}"
DB_NAME="${DB_NAME:-booster_ai}"
AUTH_MODE="${AUTH_MODE:-auto}"

CONN_STR="${PROJECT_ID}:${REGION}:${INSTANCE_NAME}"

# ------------------------------------------------------------------------------
# Pre-reqs
# ------------------------------------------------------------------------------
if ! command -v cloud-sql-proxy >/dev/null 2>&1; then
  echo "→ cloud-sql-proxy no encontrado, instalando con brew…"
  if ! command -v brew >/dev/null 2>&1; then
    echo "✗ Homebrew no instalado. Instalalo desde https://brew.sh/ primero."
    exit 1
  fi
  brew install cloud-sql-proxy
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "→ psql no encontrado, instalando con brew…"
  brew install libpq
  brew link --force libpq
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "✗ gcloud no instalado."
  exit 1
fi

ACTIVE_ACCOUNT=$(gcloud config get-value account 2>/dev/null || echo "")
if [[ -z "$ACTIVE_ACCOUNT" ]]; then
  echo "✗ No hay gcloud auth activa. Corré: gcloud auth login"
  exit 1
fi

# ------------------------------------------------------------------------------
# Detectar modo de auth
# ------------------------------------------------------------------------------
if [[ "$AUTH_MODE" == "auto" ]]; then
  IAM_FLAG=$(gcloud sql instances describe "$INSTANCE_NAME" \
    --project="$PROJECT_ID" \
    --format="value(settings.databaseFlags[?name=cloudsql.iam_authentication].value)" 2>/dev/null || echo "")
  if [[ "$IAM_FLAG" == "on" ]]; then
    AUTH_MODE="iam"
  else
    AUTH_MODE="password"
  fi
fi

echo "→ instancia : $CONN_STR"
echo "→ db        : $DB_NAME"
echo "→ usuario   : $ACTIVE_ACCOUNT"
echo "→ auth mode : $AUTH_MODE"
echo "→ proxy port: $LOCAL_PORT"

# ------------------------------------------------------------------------------
# Lanzar proxy en background
# ------------------------------------------------------------------------------
PROXY_PID=""
cleanup() {
  if [[ -n "$PROXY_PID" ]] && kill -0 "$PROXY_PID" 2>/dev/null; then
    kill "$PROXY_PID" 2>/dev/null || true
    wait "$PROXY_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

PROXY_LOG=$(mktemp)
if [[ "$AUTH_MODE" == "iam" ]]; then
  cloud-sql-proxy "$CONN_STR" --port "$LOCAL_PORT" --auto-iam-authn >"$PROXY_LOG" 2>&1 &
else
  cloud-sql-proxy "$CONN_STR" --port "$LOCAL_PORT" >"$PROXY_LOG" 2>&1 &
fi
PROXY_PID=$!

# Esperar al proxy
echo "→ esperando proxy (max 15s)…"
for i in {1..15}; do
  if grep -q "ready for new connections" "$PROXY_LOG" 2>/dev/null; then
    echo "  proxy listo"
    break
  fi
  if ! kill -0 "$PROXY_PID" 2>/dev/null; then
    echo "✗ proxy murió. Log:"
    cat "$PROXY_LOG"
    exit 1
  fi
  sleep 1
done

# ------------------------------------------------------------------------------
# Conectar
# ------------------------------------------------------------------------------
if [[ "$AUTH_MODE" == "iam" ]]; then
  # Cloud SQL trunca emails en >63 chars; el role coincide con el email completo
  # mientras quepa. Para dev@boosterchile.com cabe sin problema.
  PGUSER="$ACTIVE_ACCOUNT"
  # En IAM auth no se manda password (el proxy lo gestiona via OAuth token).
  PSQL_CMD=(psql "host=127.0.0.1" "port=$LOCAL_PORT" "dbname=$DB_NAME" "user=$PGUSER" "sslmode=disable")
else
  # Modo password: leer DATABASE_URL de Secret Manager y extraer user/password.
  echo "→ obteniendo credenciales password de Secret Manager…"
  DB_URL=$(gcloud secrets versions access latest --secret=database-url --project="$PROJECT_ID")
  # postgresql://user:password@host:port/dbname?...
  # Parseo simple sin dependencias externas.
  PGUSER=$(echo "$DB_URL" | sed -E 's|postgresql://([^:]+):.*|\1|')
  PGPASS_RAW=$(echo "$DB_URL" | sed -E 's|postgresql://[^:]+:([^@]+)@.*|\1|')
  # Decodificar URL-encoding (libpq decodifica solo si pasa la URL como string,
  # acá pasamos campos sueltos).
  PGPASS=$(printf '%b' "${PGPASS_RAW//%/\\x}")
  export PGPASSWORD="$PGPASS"
  PSQL_CMD=(psql "host=127.0.0.1" "port=$LOCAL_PORT" "dbname=$DB_NAME" "user=$PGUSER" "sslmode=disable")
fi

if [[ "${1:-}" == "-f" && -n "${2:-}" ]]; then
  echo "→ ejecutando archivo: $2"
  "${PSQL_CMD[@]}" -f "$2"
else
  echo "→ abriendo psql interactivo. Salí con \\q o Ctrl+D."
  "${PSQL_CMD[@]}"
fi
