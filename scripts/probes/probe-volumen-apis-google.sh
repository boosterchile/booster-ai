#!/usr/bin/env bash
# Volumen real de llamadas a las APIs de Google Maps Platform del proyecto (pregunta del
# PO, 2026-10-20: «antes de cualquier implementación necesito saber el costo asociado»).
# Lee Cloud Monitoring (serviceruntime.googleapis.com/api/request_count) por servicio y
# por mes, últimos 6 meses. Solo lectura; la credencial llega por WIF (SA terraform-drift,
# roles/viewer) como GOOGLE_OAUTH_ACCESS_TOKEN. Sin fallback silencioso: un HTTP ≠ 200 se
# imprime con su cuerpo y el servicio queda marcado «sin dato».
set -euo pipefail

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-booster-ai-494222}"
TOKEN="${GOOGLE_OAUTH_ACCESS_TOKEN:?falta GOOGLE_OAUTH_ACCESS_TOKEN}"
OUT="${OUT_DIR:-./probe-out}"
mkdir -p "$OUT"
MESES="${MESES:-6}"

END=$(date -u +%Y-%m-%dT%H:%M:%SZ)
START=$(date -u -d "-$((MESES * 30)) days" +%Y-%m-%dT%H:%M:%SZ)
echo "proyecto=$PROJECT_ID  ventana=$START → $END  (alineación 30 d, suma)"

SERVICIOS=(
  routes.googleapis.com
  geocoding-backend.googleapis.com
  addressvalidation.googleapis.com
  maps-backend.googleapis.com
  places-backend.googleapis.com
)

for svc in "${SERVICIOS[@]}"; do
  f="$OUT/monitoring-$svc.json"
  code=$(curl -sS -m 60 -o "$f" -w '%{http_code}' --get \
    "https://monitoring.googleapis.com/v3/projects/$PROJECT_ID/timeSeries" \
    -H "Authorization: Bearer $TOKEN" \
    --data-urlencode "filter=metric.type=\"serviceruntime.googleapis.com/api/request_count\" AND resource.type=\"consumed_api\" AND resource.labels.service=\"$svc\"" \
    --data-urlencode "interval.startTime=$START" \
    --data-urlencode "interval.endTime=$END" \
    --data-urlencode "aggregation.alignmentPeriod=2592000s" \
    --data-urlencode "aggregation.perSeriesAligner=ALIGN_SUM" \
    --data-urlencode "aggregation.crossSeriesReducer=REDUCE_SUM" \
    --data-urlencode "aggregation.groupByFields=metric.labels.method" \
    --data-urlencode "aggregation.groupByFields=metric.labels.response_code_class")
  echo "== $svc → HTTP $code =="
  if [[ "$code" != "200" ]]; then
    echo "  sin dato: $(head -c 300 "$f")"
    continue
  fi
  python3 - "$f" <<'PY'
import collections, json, sys
j = json.load(open(sys.argv[1], encoding="utf-8"))
series = j.get("timeSeries", [])
if not series:
    print("  sin series (0 llamadas en la ventana)"); sys.exit(0)
por_mes = collections.defaultdict(lambda: collections.Counter())
total = collections.Counter()
for ts in series:
    lab = ts.get("metric", {}).get("labels", {})
    metodo = lab.get("method", "?")
    clase = lab.get("response_code_class", "?")
    for p in ts.get("points", []):
        fin = p["interval"]["endTime"][:10]
        v = int(p["value"].get("int64Value", 0))
        por_mes[fin][(metodo, clase)] += v
        total[(metodo, clase)] += v
for fin in sorted(por_mes):
    suma = sum(por_mes[fin].values())
    print(f"  periodo que termina {fin}: {suma:>8,} llamadas")
    for (m, c), v in sorted(por_mes[fin].items(), key=lambda kv: -kv[1])[:6]:
        print(f"      {v:>8,}  {m}  {c}")
n = len(por_mes)
if n:
    print(f"  promedio mensual (sobre {n} periodos de 30 d): {sum(sum(c.values()) for c in por_mes.values()) / n:,.0f}")
PY
done
