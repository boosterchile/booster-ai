#!/usr/bin/env bash
# =============================================================================
# Booster AI — IAP tunnel persistente para Cloud SQL (ADR-014)
# =============================================================================
# Mantiene un IAP TCP tunnel de la laptop al bastion, exponiendo el proxy
# del bastion (cloud-sql-proxy --auto-iam-authn) en 127.0.0.1:5432 local.
#
# Uso:
#   bash scripts/db/connect-local.sh                # solo asegura tunel arriba
#   bash scripts/db/connect-local.sh psql           # tunel + abre psql
#   bash scripts/db/connect-local.sh -c "SELECT 1"  # tunel + ejecuta query
#   bash scripts/db/connect-local.sh status         # estado del tunel
#   bash scripts/db/connect-local.sh stop           # mata tunel temporal
#
# Recomendado: cargar el LaunchAgent (scripts/db/iap-tunnel.plist.template)
# para que el tunel arranque al boot del Mac y reviva si muere. En ese caso
# este script solo verifica que el LaunchAgent esta vivo.
#
# Connection string para tooling local (MCP postgres, DBeaver, drizzle-kit):
#   postgresql://db-bastion-sa%40booster-ai-494222.iam:dummy@127.0.0.1:5432/booster_ai?sslmode=disable
#
# El `dummy` password se ignora — cloud-sql-proxy en bastion lo reemplaza por
# el access token del SA. sslmode=disable porque IAP TCP cifra el segmento
# laptop↔bastion y el proxy cifra bastion↔Cloud SQL.

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-booster-ai-494222}"
ZONE="${ZONE:-southamerica-west1-a}"
BASTION_NAME="${BASTION_NAME:-db-bastion}"
LOCAL_PORT="${LOCAL_PORT:-5432}"
DB_NAME="${DB_NAME:-booster_ai}"
SA_USER="db-bastion-sa@booster-ai-494222.iam"
PID_FILE="${TMPDIR:-/tmp}/booster-iap-tunnel.pid"
LOG_FILE="${TMPDIR:-/tmp}/booster-iap-tunnel.log"

# ------------------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------------------
tunnel_listening() {
  (echo > "/dev/tcp/127.0.0.1/${LOCAL_PORT}") 2>/dev/null
}

tunnel_pid_alive() {
  [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

start_tunnel() {
  if tunnel_listening; then
    echo "→ tunel ya activo en 127.0.0.1:${LOCAL_PORT} (probablemente LaunchAgent)"
    return 0
  fi

  if ! command -v gcloud >/dev/null 2>&1; then
    echo "✗ gcloud no instalado." >&2
    exit 1
  fi

  if [[ -z "$(gcloud config get-value account 2>/dev/null || echo)" ]]; then
    echo "✗ No hay gcloud auth activa. Corré: gcloud auth login" >&2
    exit 1
  fi

  echo "→ levantando IAP tunnel a ${BASTION_NAME} (${ZONE})…"
  nohup gcloud compute start-iap-tunnel "$BASTION_NAME" 5432 \
    --local-host-port="127.0.0.1:${LOCAL_PORT}" \
    --zone="$ZONE" \
    --project="$PROJECT_ID" \
    >"$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"

  for _ in $(seq 1 30); do
    if tunnel_listening; then
      echo "  tunel listo (pid $(cat "$PID_FILE"))"
      return 0
    fi
    if ! tunnel_pid_alive; then
      echo "✗ tunel murio. Log:" >&2
      cat "$LOG_FILE" >&2
      rm -f "$PID_FILE"
      exit 1
    fi
    sleep 1
  done
  echo "✗ tunel no quedo listening tras 30s. Log:" >&2
  cat "$LOG_FILE" >&2
  exit 1
}

stop_tunnel() {
  if tunnel_pid_alive; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    wait "$(cat "$PID_FILE")" 2>/dev/null || true
    rm -f "$PID_FILE"
    echo "→ tunel temporal detenido"
  else
    echo "→ no hay tunel temporal corriendo (¿LaunchAgent activo?)"
  fi
}

status() {
  if tunnel_listening; then
    if tunnel_pid_alive; then
      echo "✓ tunel temporal activo (pid $(cat "$PID_FILE")) en 127.0.0.1:${LOCAL_PORT}"
    else
      echo "✓ tunel activo en 127.0.0.1:${LOCAL_PORT} (no manejado por este script — probablemente LaunchAgent)"
    fi
  else
    echo "✗ no hay tunel listening en 127.0.0.1:${LOCAL_PORT}"
    exit 1
  fi
}

# ------------------------------------------------------------------------------
# Main
# ------------------------------------------------------------------------------
case "${1:-up}" in
  up)
    start_tunnel
    echo
    echo "Connection string:"
    echo "  postgresql://${SA_USER//@/%40}:dummy@127.0.0.1:${LOCAL_PORT}/${DB_NAME}?sslmode=disable"
    ;;
  status)
    status
    ;;
  stop)
    stop_tunnel
    ;;
  psql)
    start_tunnel
    if ! command -v psql >/dev/null 2>&1; then
      echo "✗ psql no encontrado. brew install libpq && brew link --force libpq" >&2
      exit 1
    fi
    PGPASSWORD=dummy psql -h 127.0.0.1 -p "$LOCAL_PORT" -U "$SA_USER" -d "$DB_NAME"
    ;;
  -c|-f)
    start_tunnel
    PGPASSWORD=dummy psql -h 127.0.0.1 -p "$LOCAL_PORT" -U "$SA_USER" -d "$DB_NAME" "$@"
    ;;
  -h|--help|help)
    sed -n '2,30p' "$0"
    ;;
  *)
    echo "uso: $0 [up|status|stop|psql|-c '<query>'|-f <file.sql>|help]" >&2
    exit 1
    ;;
esac
