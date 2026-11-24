#!/usr/bin/env bash
# =============================================================================
# Booster AI — siembra de los usuarios de prueba del E2E en STAGING
# =============================================================================
# Corre `apps/api/scripts/seed-staging-e2e.ts` contra la base de staging por el
# túnel IAP del bastion, y deja en GitHub los valores que lee `e2e-staging.yml`.
# Ver .specs/e2e-staging.
#
# Las dos claves numéricas se generan aquí al azar y nunca se muestran: van a
# la siembra por variable de entorno y a GitHub como secretos. Para iniciar
# sesión a mano con esos usuarios, vuelve a correr el script con tus claves:
#
#   SEED_E2E_CLAVE_TRANSPORTISTA=... SEED_E2E_CLAVE_GENERADOR=... scripts/db/seed-staging-e2e.sh
#
# Solo escribe en staging: el proyecto está fijo y la siembra aborta si el
# destino no es staging o si la base parece la de prod.
#
# Uso:
#   scripts/db/seed-staging-e2e.sh                # siembra y configura GitHub
#   scripts/db/seed-staging-e2e.sh --sin-github   # solo siembra
#
# Requiere: gcloud con ADC (`gcloud auth application-default login`), python3,
# pnpm y, salvo con --sin-github, `gh` con acceso de escritura al repo.
# =============================================================================
set -euo pipefail

PROJECT_ID="booster-ai-stg-494222"
ZONE="${ZONE:-southamerica-west1-a}"
BASTION_NAME="${BASTION_NAME:-db-bastion}"
# 5433 y 5436 son los puertos de los túneles a prod: no usarlos aquí.
LOCAL_PORT="${LOCAL_PORT:-5450}"
TUNNEL_TIMEOUT_S="${TUNNEL_TIMEOUT_S:-30}"
REPO_GH="${REPO_GH:-boosterchile/booster-ai}"
CONFIGURAR_GITHUB=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --sin-github) CONFIGURAR_GITHUB=0; shift ;;
    -h|--help) sed -n '2,24p' "$0" >&2; exit 0 ;;
    *) echo "✗ Opción desconocida: $1" >&2; exit 1 ;;
  esac
done

for cmd in gcloud python3 pnpm curl; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "✗ Falta $cmd." >&2; exit 1; }
done
if [[ "$CONFIGURAR_GITHUB" -eq 1 ]]; then
  command -v gh >/dev/null 2>&1 || { echo "✗ Falta gh (o usa --sin-github)." >&2; exit 1; }
fi
if [[ "$LOCAL_PORT" == "5433" || "$LOCAL_PORT" == "5436" ]]; then
  echo "✗ El puerto $LOCAL_PORT está reservado para los túneles a prod." >&2
  exit 1
fi
if lsof -iTCP:"$LOCAL_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "✗ El puerto $LOCAL_PORT ya está en uso. Prueba con LOCAL_PORT=5451." >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

TOKEN_FILE="$(mktemp -t gcloud-adc-token.XXXXXX)"
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
  echo "✗ No hay credenciales ADC válidas. Corre: gcloud auth application-default login" >&2
  exit 1
fi

# Clave de seis dígitos al azar, que no sea trivial; la siembra vuelve a
# validarla y rechaza además las publicadas en el repo.
clave_al_azar() {
  python3 - <<'PY'
import secrets
while True:
    c = f"{secrets.randbelow(10**6):06d}"
    d = [int(x) for x in c]
    sube = all(d[i] == d[i - 1] + 1 for i in range(1, 6))
    baja = all(d[i] == d[i - 1] - 1 for i in range(1, 6))
    if len(set(c)) >= 4 and not sube and not baja:
        print(c)
        break
PY
}
CLAVE_TRANSPORTISTA="${SEED_E2E_CLAVE_TRANSPORTISTA:-$(clave_al_azar)}"
CLAVE_GENERADOR="${SEED_E2E_CLAVE_GENERADOR:-$(clave_al_azar)}"

TUNNEL_LOG="$(mktemp -t iap-tunnel.XXXXXX)"
gcloud --access-token-file="$TOKEN_FILE" compute start-iap-tunnel "$BASTION_NAME" 5432 \
  --local-host-port="127.0.0.1:${LOCAL_PORT}" \
  --zone="$ZONE" \
  --project="$PROJECT_ID" \
  >"$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!

echo "→ abriendo el túnel IAP a $BASTION_NAME de $PROJECT_ID (puerto local $LOCAL_PORT)…" >&2
TUNNEL_READY=0
for _ in $(seq 1 "$TUNNEL_TIMEOUT_S"); do
  if (echo > /dev/tcp/127.0.0.1/"$LOCAL_PORT") 2>/dev/null; then
    TUNNEL_READY=1
    break
  fi
  if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
    echo "✗ El túnel se cerró. Log:" >&2
    cat "$TUNNEL_LOG" >&2
    rm -f "$TUNNEL_LOG"
    exit 1
  fi
  sleep 1
done
if [[ "$TUNNEL_READY" -eq 0 ]]; then
  echo "✗ El túnel no quedó escuchando tras ${TUNNEL_TIMEOUT_S}s. Log:" >&2
  cat "$TUNNEL_LOG" >&2
  rm -f "$TUNNEL_LOG"
  exit 1
fi
rm -f "$TUNNEL_LOG"

# URL de la base desde Secret Manager, reescrita al túnel. Nunca se imprime.
ADC_TOKEN="$(<"$TOKEN_FILE")"
DB_URL="$(curl -sS -H "Authorization: Bearer $ADC_TOKEN" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT_ID}/secrets/database-url/versions/latest:access" \
  | python3 -c "import sys,json,base64; print(base64.b64decode(json.load(sys.stdin)['payload']['data']).decode())")"
CONN_URL="$(python3 -c "
import sys, urllib.parse as u
p = u.urlparse(sys.stdin.read().strip())
new = p._replace(
  netloc=f'{p.username}:{u.quote(u.unquote(p.password), safe=\"\")}@127.0.0.1:${LOCAL_PORT}',
  query='sslmode=disable',
)
print(u.urlunparse(new))
" <<<"$DB_URL")"

echo "→ sembrando las dos empresas de prueba en staging…" >&2
(
  cd "$REPO_ROOT"
  env -u FIREBASE_AUTH_EMULATOR_HOST \
    SEED_E2E_DESTINO=staging \
    GOOGLE_CLOUD_PROJECT="$PROJECT_ID" \
    DATABASE_URL="$CONN_URL" \
    SEED_E2E_CLAVE_TRANSPORTISTA="$CLAVE_TRANSPORTISTA" \
    SEED_E2E_CLAVE_GENERADOR="$CLAVE_GENERADOR" \
    pnpm --filter @booster-ai/api seed:staging-e2e
)

if [[ "$CONFIGURAR_GITHUB" -eq 0 ]]; then
  echo "✓ Siembra lista. GitHub sin tocar (--sin-github)." >&2
  exit 0
fi

echo "→ dejando en GitHub los valores que lee e2e-staging.yml…" >&2
# Los RUT son ficticios y no son secretos: variables. Las claves: secretos, por stdin.
gh variable set STAGING_E2E_TRANSPORTISTA_RUT --repo "$REPO_GH" --body "19900001-2" >/dev/null
gh variable set STAGING_E2E_GENERADOR_RUT --repo "$REPO_GH" --body "19900002-0" >/dev/null
printf '%s' "$CLAVE_TRANSPORTISTA" | gh secret set STAGING_E2E_TRANSPORTISTA_CLAVE --repo "$REPO_GH" >/dev/null
printf '%s' "$CLAVE_GENERADOR" | gh secret set STAGING_E2E_GENERADOR_CLAVE --repo "$REPO_GH" >/dev/null

echo "✓ Siembra lista y GitHub configurado: 2 variables y 2 secretos STAGING_E2E_*." >&2
