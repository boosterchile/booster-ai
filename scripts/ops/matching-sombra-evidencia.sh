#!/usr/bin/env bash
# =============================================================================
# Evidencia matching sombra → decisión (solo lectura)
# =============================================================================
# Recoge flag Cloud Run, logs de comparación elegibilidad y (si existe) el
# descriptor de la métrica OTel. No cambia env ni Terraform.
#
# Uso:
#   bash scripts/ops/matching-sombra-evidencia.sh
#   bash scripts/ops/matching-sombra-evidencia.sh --days 14
#   bash scripts/ops/matching-sombra-evidencia.sh --json /tmp/out.json
#
# Requisitos: gcloud autenticado (ADC o user) con logging.viewer + run.viewer
# en booster-ai-494222. SQL opcional: --sql (necesita agent-query / IAP).
# =============================================================================

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-booster-ai-494222}"
REGION="${REGION:-southamerica-west1}"
SERVICE="${SERVICE:-booster-ai-api}"
DAYS=30
OUT_JSON=""
RUN_SQL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --days) DAYS="$2"; shift 2 ;;
    --json) OUT_JSON="$2"; shift 2 ;;
    --sql) RUN_SQL=1; shift ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "Flag desconocido: $1" >&2; exit 1 ;;
  esac
done

if ! command -v gcloud >/dev/null 2>&1; then
  echo "✗ gcloud no está en PATH" >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "✗ python3 requerido" >&2
  exit 1
fi

FRESHNESS="${DAYS}d"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

echo "== Matching sombra evidencia =="
echo "project=$PROJECT_ID service=$SERVICE region=$REGION days=$DAYS"
echo

echo "-- Flag Cloud Run (revisión lista) --"
gcloud run services describe "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='yaml(status.latestReadyRevisionName,spec.template.spec.containers[0].env)' \
  | python3 -c "
import sys, re
text = sys.stdin.read()
modo = None
rutas = None
rev = None
for line in text.splitlines():
    if 'latestReadyRevisionName' in line:
        rev = line.split(':',1)[-1].strip()
    if 'MATCHING_ELEGIBILIDAD_MODO' in line:
        modo = 'pending'
    elif modo == 'pending' and 'value:' in line:
        modo = line.split(':',1)[-1].strip()
    if 'RUTAS_API_ACTIVADA' in line:
        rutas = 'pending'
    elif rutas == 'pending' and 'value:' in line:
        rutas = line.split(':',1)[-1].strip()
print(f'latestReadyRevision={rev or \"?\"}')
print(f'MATCHING_ELEGIBILIDAD_MODO={modo if modo not in (None, \"pending\") else \"AUSENTE(=vigente en código)\"}')
print(f'RUTAS_API_ACTIVADA={rutas if rutas not in (None, \"pending\") else \"AUSENTE(=falsa)\"}')
"

echo
echo "-- Logs: matching: elegibilidad por carga --"
ELEG_FILE=$(mktemp)
gcloud logging read \
  "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${SERVICE}\" AND jsonPayload.message=\"matching: elegibilidad por carga\"" \
  --project="$PROJECT_ID" \
  --freshness="$FRESHNESS" \
  --limit=200 \
  --format=json >"$ELEG_FILE"

ERR_FILE=$(mktemp)
gcloud logging read \
  "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${SERVICE}\" AND jsonPayload.message=\"matching: falló la elegibilidad por carga en sombra\"" \
  --project="$PROJECT_ID" \
  --freshness="$FRESHNESS" \
  --limit=50 \
  --format=json >"$ERR_FILE"

MATCH_FILE=$(mktemp)
gcloud logging read \
  "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${SERVICE}\" AND jsonPayload.message=\"matching complete\"" \
  --project="$PROJECT_ID" \
  --freshness="$FRESHNESS" \
  --limit=200 \
  --format=json >"$MATCH_FILE"

python3 - "$ELEG_FILE" "$ERR_FILE" "$MATCH_FILE" "$OUT_JSON" <<'PY'
import json, sys, collections
eleg_path, err_path, match_path, out_json = sys.argv[1:5]

def load(p):
    raw = open(p).read().strip()
    return json.loads(raw) if raw else []

eleg = load(eleg_path)
errs = load(err_path)
matches = load(match_path)

res = collections.Counter()
solo_v = collections.Counter()
solo_c = collections.Counter()
veh_d = collections.Counter()
vol = collections.Counter()
tipos = collections.Counter()
samples = []

for e in eleg:
    jp = e.get("jsonPayload") or {}
    coinciden = bool(jp.get("coinciden"))
    res["coincide" if coinciden else "difiere"] += 1
    tipos[str(jp.get("cargoType"))] += 1
    for x in jp.get("soloVigente") or []:
        solo_v[str(x)] += 1
    for x in jp.get("soloPorCarga") or []:
        solo_c[str(x)] += 1
    for x in jp.get("vehiculoDistinto") or []:
        veh_d[str(x)] += 1
    for x in jp.get("volumenInsuficiente") or []:
        vol[str(x)] += 1
    if len(samples) < 5:
        samples.append({
            "timestamp": e.get("timestamp"),
            "tripId": jp.get("tripId"),
            "modo": jp.get("modo"),
            "cargoType": jp.get("cargoType"),
            "coinciden": coinciden,
            "candidatasVigente": jp.get("candidatasVigente"),
            "candidatasPorCarga": jp.get("candidatasPorCarga"),
            "soloVigente": jp.get("soloVigente"),
            "soloPorCarga": jp.get("soloPorCarga"),
            "vehiculoDistinto": jp.get("vehiculoDistinto"),
            "volumenInsuficiente": jp.get("volumenInsuficiente"),
        })

summary = {
    "matching_complete": len(matches),
    "comparaciones_total": len(eleg),
    "coincide": res["coincide"],
    "difiere": res["difiere"],
    "errores_sombra": len(errs),
    "por_tipo_carga": dict(tipos),
    "top_soloVigente": solo_v.most_common(10),
    "top_soloPorCarga": solo_c.most_common(10),
    "top_vehiculoDistinto": veh_d.most_common(10),
    "top_volumenInsuficiente": vol.most_common(10),
    "muestras": samples,
}

print(f"matching_complete={summary['matching_complete']}")
print(f"comparaciones_total={summary['comparaciones_total']}")
print(f"coincide={summary['coincide']} difiere={summary['difiere']} errores_sombra={summary['errores_sombra']}")
print(f"por_tipo_carga={summary['por_tipo_carga']}")
print(f"top_soloVigente={summary['top_soloVigente']}")
print(f"top_soloPorCarga={summary['top_soloPorCarga']}")
print(f"top_vehiculoDistinto={summary['top_vehiculoDistinto']}")
print(f"top_volumenInsuficiente={summary['top_volumenInsuficiente']}")
if samples:
    print("muestras (hasta 5):")
    for s in samples:
        print(" ", json.dumps(s, ensure_ascii=False))
else:
    print("muestras: (ninguna — sin matching en sombra en la ventana)")

if out_json:
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print(f"json={out_json}")
PY

rm -f "$ELEG_FILE" "$ERR_FILE" "$MATCH_FILE"

echo
echo "-- Métrica Cloud Monitoring (descriptor) --"
TOKEN=$(gcloud auth print-access-token)
curl -sS -H "Authorization: Bearer $TOKEN" \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT_ID}/metricDescriptors?filter=metric.type%3D%22workload.googleapis.com%2Fmatching_elegibilidad_comparaciones_total%22" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
if 'error' in d:
    print('error:', d['error'].get('message', d['error']))
else:
    ms = d.get('metricDescriptors') or []
    if not ms:
        print('descriptor=AUSENTE (aún no se exportó el contador en prod)')
    else:
        for m in ms:
            print('descriptor=', m.get('type'))
            print('labels=', [l.get('key') for l in m.get('labels') or []])
"

if [[ "$RUN_SQL" -eq 1 ]]; then
  echo
  echo "-- Baseline SQL (agent-query) --"
  if [[ -x "$ROOT/scripts/db/agent-query.sh" ]] || [[ -f "$ROOT/scripts/db/agent-query.sh" ]]; then
    bash "$ROOT/scripts/db/agent-query.sh" -f "$ROOT/scripts/sql/matching-sombra-baseline.sql" || {
      echo "SQL falló (IAP/SM). Usar scripts/db/connect.sh como operador." >&2
    }
  else
    echo "agent-query.sh no encontrado" >&2
  fi
fi

echo
echo "Listo. Pegar el resumen en docs/handoff/2026-11-16-evidencia-matching-sombra.md (plantilla)."
