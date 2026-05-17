#!/usr/bin/env bash
# =============================================================================
# Booster AI — Agent query helper (Cloud SQL prod via IAP tunnel + ADC headless)
# =============================================================================
# Wrapper sobre la Capa 1 de ADR-013 (bastion + IAP) que funciona HEADLESS
# usando ADC (Application Default Credentials) en lugar de user OAuth — bypass
# del "Reauthentication failed" que rompe `connect.sh` en shells sin TTY.
#
# Use cases: el agente Claude/SDK ejecuta queries SELECT contra Cloud SQL prod
# sin intervención humana. Verificado empíricamente 2026-05-17 ~20:50 UTC.
# Memoria: `~/.claude/projects/.../memory/reference_prod_db_headless_query.md`.
#
# Uso:
#   scripts/db/agent-query.sh -c "SELECT 1"           # one-shot inline
#   scripts/db/agent-query.sh -f scripts/sql/foo.sql  # one-shot file
#   scripts/db/agent-query.sh -y -c "..."             # skip DML confirmation
#
# Env vars (todos opcionales):
#   PROJECT_ID          (default: booster-ai-494222)
#   ZONE                (default: southamerica-west1-a)
#   BASTION_NAME        (default: db-bastion)
#   LOCAL_PORT          (default: 5436 — distinto a connect.sh 5433)
#   DB_NAME             (default: booster_ai)
#   STATEMENT_TIMEOUT_S (default: 30 — pasado como SET statement_timeout)
#   TUNNEL_TIMEOUT_S    (default: 30 — wait máximo para que el tunnel suba)

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-booster-ai-494222}"
ZONE="${ZONE:-southamerica-west1-a}"
BASTION_NAME="${BASTION_NAME:-db-bastion}"
LOCAL_PORT="${LOCAL_PORT:-5436}"
DB_NAME="${DB_NAME:-booster_ai}"
STATEMENT_TIMEOUT_S="${STATEMENT_TIMEOUT_S:-30}"
TUNNEL_TIMEOUT_S="${TUNNEL_TIMEOUT_S:-30}"

# ------------------------------------------------------------------------------
# Arg parsing
# ------------------------------------------------------------------------------
SQL=""
SQL_FILE=""
SKIP_CONFIRM=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    -c) SQL="$2"; shift 2 ;;
    -f) SQL_FILE="$2"; shift 2 ;;
    -y) SKIP_CONFIRM=1; shift ;;
    -h|--help)
      sed -n '1,30p' "$0" | sed -n '/^# /p' >&2
      exit 0
      ;;
    *) echo "✗ Flag desconocido: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$SQL" && -z "$SQL_FILE" ]]; then
  echo "✗ Falta SQL. Uso: $0 -c <sql> | -f <file> [-y]" >&2
  exit 1
fi

if [[ -n "$SQL_FILE" ]]; then
  if [[ ! -r "$SQL_FILE" ]]; then
    echo "✗ Archivo no legible: $SQL_FILE" >&2
    exit 1
  fi
  SQL=$(<"$SQL_FILE")
fi

# ------------------------------------------------------------------------------
# Soft warning para DML/DDL/función-mutante (no es perimeter, es advisory).
#
# Estrategia: stripear string literals ('...' y "...") antes del grep para
# reducir falsos positivos (ej. SELECT '...UPDATE...' AS msg). Falsos negativos
# documentados: SQL con comentarios -- o /* */ que escondan keywords; CTEs con
# nombres que contengan keywords; queries que usen funciones mutantes NO
# listadas en el patrón. El helper es advisory; la línea de defensa real es
# que el agente revise su propio SQL antes de enviarlo.
# ------------------------------------------------------------------------------
SQL_STRIPPED=$(echo "$SQL" | sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g")
MUTATION_PATTERN='\b(UPDATE|DELETE|INSERT|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|MERGE|COPY|VACUUM|REINDEX|REFRESH|CLUSTER|LOCK|pg_terminate_backend|pg_cancel_backend|pg_advisory_unlock|pg_advisory_unlock_all|pg_advisory_xact_lock|setseed|setval|nextval|lo_import|lo_export|lo_create|lo_unlink|pg_read_server_files|pg_read_binary_file|pg_write_server_files)\b'
if [[ "$SKIP_CONFIRM" -eq 0 ]] \
   && echo "$SQL_STRIPPED" | grep -qiE "$MUTATION_PATTERN"; then
  echo "⚠ SQL contiene keywords mutantes o funciones de side-effect." >&2
  echo "  Patrones detectados: $(echo "$SQL_STRIPPED" | grep -oiE "$MUTATION_PATTERN" | sort -u | tr '\n' ' ')" >&2
  echo "  Para mutations de schema/data usar migrations (apps/api/drizzle/), no este helper." >&2
  echo "  Si es intencional (ej. forensia con SELECT pg_terminate_backend, raro), pasar -y." >&2
  if [[ -t 0 ]]; then
    read -r -p "  Continuar de todos modos? [y/N] " ans
    [[ "$ans" =~ ^[yY]$ ]] || { echo "Abortado." >&2; exit 1; }
  else
    # abort por seguridad si no-TTY: previene runaway agents que mutan sin confirmación
    echo "✗ stdin no es TTY y -y no fue pasado. Abortado por seguridad." >&2
    exit 1
  fi
fi

# ------------------------------------------------------------------------------
# Preconditions: psql, ADC, bastion reachable
# ------------------------------------------------------------------------------
if ! command -v gcloud >/dev/null 2>&1; then
  echo "✗ gcloud no instalado." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "✗ python3 requerido (parseo de Secret Manager response + URL rewrite)." >&2
  echo "  macOS: 'xcode-select --install' o 'brew install python@3.13'." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "→ psql no encontrado, instalando con brew…" >&2
  brew install libpq && brew link --force libpq
fi

# Pre-check port — error claro inmediato vs esperar 30s al tunnel timeout
if lsof -iTCP:"$LOCAL_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "✗ Puerto $LOCAL_PORT ya está LISTEN. Otro tunnel/proceso ocupa el puerto." >&2
  echo "  Fix: \`LOCAL_PORT=5440 $0 ...\` o \`lsof -iTCP:$LOCAL_PORT -sTCP:LISTEN\` para identificar." >&2
  exit 1
fi

# ADC token file con permisos 600, limpiado en EXIT.
TOKEN_FILE=$(mktemp -t gcloud-adc-token.XXXXXX)
chmod 600 "$TOKEN_FILE"
TUNNEL_PID=""
cleanup() {
  if [[ -n "$TUNNEL_PID" ]] && kill -0 "$TUNNEL_PID" 2>/dev/null; then
    kill "$TUNNEL_PID" 2>/dev/null || true
    wait "$TUNNEL_PID" 2>/dev/null || true
  fi
  rm -f "$TOKEN_FILE"
}
trap cleanup EXIT INT TERM

if ! gcloud auth application-default print-access-token >"$TOKEN_FILE" 2>/dev/null; then
  echo "✗ No hay credenciales ADC válidas. Corré: gcloud auth application-default login" >&2
  exit 1
fi

# ------------------------------------------------------------------------------
# IAP tunnel en background
# ------------------------------------------------------------------------------
TUNNEL_LOG=$(mktemp -t iap-tunnel.XXXXXX)
gcloud --access-token-file="$TOKEN_FILE" compute start-iap-tunnel "$BASTION_NAME" 5432 \
  --local-host-port="127.0.0.1:${LOCAL_PORT}" \
  --zone="$ZONE" \
  --project="$PROJECT_ID" \
  >"$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!

echo "→ levantando IAP tunnel a $BASTION_NAME:5432 (local $LOCAL_PORT)…" >&2
TUNNEL_READY=0
for _ in $(seq 1 "$TUNNEL_TIMEOUT_S"); do
  if (echo > /dev/tcp/127.0.0.1/"$LOCAL_PORT") 2>/dev/null; then
    TUNNEL_READY=1
    break
  fi
  if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
    echo "✗ tunnel murió. Log:" >&2
    cat "$TUNNEL_LOG" >&2
    rm -f "$TUNNEL_LOG"
    exit 1
  fi
  sleep 1
done
if [[ "$TUNNEL_READY" -eq 0 ]]; then
  echo "✗ tunnel no quedó listening tras ${TUNNEL_TIMEOUT_S}s. Log:" >&2
  cat "$TUNNEL_LOG" >&2
  rm -f "$TUNNEL_LOG"
  exit 1
fi
rm -f "$TUNNEL_LOG"

# ------------------------------------------------------------------------------
# Fetch DB connection URL desde Secret Manager (vía REST + ADC token)
# ------------------------------------------------------------------------------
ADC_TOKEN=$(<"$TOKEN_FILE")
DB_URL=$(curl -sS -H "Authorization: Bearer $ADC_TOKEN" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT_ID}/secrets/database-url/versions/latest:access" \
  | python3 -c "import sys,json,base64; print(base64.b64decode(json.load(sys.stdin)['payload']['data']).decode())")

CONN_URL=$(python3 -c "
import sys, urllib.parse as u
p = u.urlparse(sys.stdin.read().strip())
new = p._replace(
  netloc=f'{p.username}:{u.quote(u.unquote(p.password), safe=\"\")}@127.0.0.1:${LOCAL_PORT}',
  query='sslmode=disable',
)
print(u.urlunparse(new))
" <<<"$DB_URL")

# ------------------------------------------------------------------------------
# Ejecutar query con statement_timeout
# ------------------------------------------------------------------------------
psql "$CONN_URL" -v ON_ERROR_STOP=1 \
  -c "SET statement_timeout TO '${STATEMENT_TIMEOUT_S}s'" \
  -c "$SQL"
