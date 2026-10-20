#!/usr/bin/env bash
# Sonda: ¿Routes API respeta restricciones de camión en Santiago (Camino La Pirámide)?
#
# Contexto: prod manda `travelMode: DRIVE` fijo (apps/api/src/services/routes-api.ts),
# así que la «ruta eco» ignora prohibiciones de camiones (altura, peso, horario).
# Google ofrece large vehicle routing (`travelMode: TRUCK` + routeModifiers.vehicleInfo)
# con cobertura declarada EE.UU. + Japón. Esta sonda mide qué pasa en Chile.
#
# Par origen→destino Ciudad Empresarial (Huechuraba) → Parque Bicentenario (Vitacura):
# con peajes el auto va por la autopista; con `avoidTolls` la alternativa gratuita es
# Camino La Pirámide, donde un camión tiene restricción. Casos (DRIVE vs TRUCK en
# cada combinación, para aislar el efecto del modo):
#   A  DRIVE                 TRAFFIC_AWARE_OPTIMAL        — lo que manda prod hoy
#   B  TRUCK+vehicleInfo     TRAFFIC_AWARE_OPTIMAL
#   C  DRIVE+vehicleInfo     TRAFFIC_AWARE_OPTIMAL        — ¿ignora dims o rechaza?
#   D  DRIVE                 sin preferencia              — control de E
#   E  TRUCK+vehicleInfo     sin preferencia
#   F  DRIVE                 TRAFFIC_AWARE_OPTIMAL + avoidTolls   — fuerza La Pirámide
#   G  TRUCK+vehicleInfo     TRAFFIC_AWARE_OPTIMAL + avoidTolls   — ¿la evita?
#
# Lectura binaria: si en cada par (A,B), (D,E), (F,G) el hash de polyline coincide,
# TRUCK no cambia nada en Chile. Si F pasa por «Pirámide» y G no, Google conoce la
# restricción y el cambio de código es viable.
#
# Uso: bash scripts/probes/probe-routes-truck-la-piramide.sh [--dry-run]
# Token: GOOGLE_OAUTH_ACCESS_TOKEN en env (GitHub Actions vía WIF) o ADC de gcloud.
set -euo pipefail

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-booster-ai-494222}"
URL='https://routes.googleapis.com/directions/v2:computeRoutes'
OUT="${OUT_DIR:-./probe-out}"
DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1
mkdir -p "$OUT"

ORIGIN='Ciudad Empresarial, Huechuraba, Región Metropolitana, Chile'
DEST='Parque Bicentenario, Vitacura, Región Metropolitana, Chile'

# Camión rígido 3 ejes típico de reparto. int64 → strings (REST).
VEHICLE_INFO='{
  "totalHeightMm": "4000",
  "totalWidthMm": "2600",
  "totalLengthMm": "12000",
  "totalWeightKg": "18000",
  "totalAxleCount": "3"
}'

# Pasos de navegación: permiten detectar «Pirámide» en el texto. travelAdvisory:
# según la doc de LVR, ahí Google marca si ignoró parcialmente restricciones.
FIELD_MASK='routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.steps.navigationInstruction,routes.travelAdvisory,routes.routeLabels'

body() {
  local mode="$1" with_vehicle="$2" pref="$3" avoid_tolls="$4"
  python3 - "$mode" "$with_vehicle" "$pref" "$avoid_tolls" "$ORIGIN" "$DEST" "$VEHICLE_INFO" <<'PY'
import json, sys
mode, with_vehicle, pref, avoid_tolls, origin, dest, vinfo = sys.argv[1:]
b = {
    "origin": {"address": origin},
    "destination": {"address": dest},
    "travelMode": mode,
    "computeAlternativeRoutes": False,
}
if pref:
    b["routingPreference"] = pref
mods = {}
if with_vehicle == "1":
    mods["vehicleInfo"] = json.loads(vinfo)
if avoid_tolls == "1":
    mods["avoidTolls"] = True
if mods:
    b["routeModifiers"] = mods
print(json.dumps(b, ensure_ascii=False))
PY
}

run() {
  local tag="$1" mode="$2" with_vehicle="$3" pref="$4" avoid_tolls="$5"
  local req="$OUT/$tag.req.json" resp="$OUT/$tag.resp.json"
  local label="$mode vehicleInfo=$with_vehicle pref=${pref:-none} avoidTolls=$avoid_tolls"
  body "$mode" "$with_vehicle" "$pref" "$avoid_tolls" > "$req"
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "== $tag ($label) [dry-run] =="; cat "$req"; echo
    return
  fi
  local code
  code=$(curl -sS -o "$resp" -w '%{http_code}' -X POST "$URL" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-Goog-User-Project: $PROJECT_ID" \
    -H "X-Goog-FieldMask: $FIELD_MASK" \
    --data @"$req")
  echo "== $tag ($label) → HTTP $code =="
  python3 - "$resp" "$code" <<'PY'
import hashlib, json, re, sys
path, code = sys.argv[1], sys.argv[2]
try:
    j = json.load(open(path, encoding="utf-8"))
except Exception as e:  # cuerpo vacío o no-JSON
    print(f"  (sin JSON legible: {e})"); sys.exit(0)
if code != "200":
    err = j.get("error", {})
    print(f"  error.status={err.get('status')} message={err.get('message','')[:400]}")
    for d in err.get("details", []):
        print(f"  detail={json.dumps(d, ensure_ascii=False)[:300]}")
    sys.exit(0)
routes = j.get("routes") or []
if not routes:
    print("  sin rutas (respuesta {})"); sys.exit(0)
r = routes[0]
steps = [s.get("navigationInstruction", {}).get("instructions", "").replace("\n", " / ")
         for leg in r.get("legs", []) for s in leg.get("steps", [])]
piramide = [s for s in steps if re.search(r"pir[aá]mide", s, re.I)]
poly = r.get("polyline", {}).get("encodedPolyline", "")
print(f"  distancia={int(r.get('distanceMeters',0))/1000:.2f} km  duracion={r.get('duration')}")
print(f"  travelAdvisory={json.dumps(r.get('travelAdvisory'), ensure_ascii=False)}  routeLabels={r.get('routeLabels')}")
print(f"  polyline_sha1={hashlib.sha1(poly.encode()).hexdigest()[:12]}  pasos={len(steps)}  pasos_con_Piramide={len(piramide)}")
for i, s in enumerate(steps[:40]):
    mark = "★" if re.search(r"pir[aá]mide", s, re.I) else " "
    print(f"   {mark} {i+1:2d}. {s[:140]}")
PY
}

if [[ $DRY_RUN -eq 0 ]]; then
  TOKEN="${GOOGLE_OAUTH_ACCESS_TOKEN:-}"
  if [[ -z "$TOKEN" ]]; then
    TOKEN="$(gcloud auth application-default print-access-token 2>/dev/null || gcloud auth print-access-token)"
  fi
  [[ -n "$TOKEN" ]] || { echo "Sin token: exporta GOOGLE_OAUTH_ACCESS_TOKEN o corre 'gcloud auth application-default login'" >&2; exit 1; }
fi

#   tag                 mode  dims pref                   avoidTolls
run A_drive             DRIVE 0    TRAFFIC_AWARE_OPTIMAL  0
run B_truck             TRUCK 1    TRAFFIC_AWARE_OPTIMAL  0
run C_drive_dims        DRIVE 1    TRAFFIC_AWARE_OPTIMAL  0
run D_drive_nopref      DRIVE 0    ""                     0
run E_truck_nopref      TRUCK 1    ""                     0
run F_drive_notolls     DRIVE 0    TRAFFIC_AWARE_OPTIMAL  1
run G_truck_notolls     TRUCK 1    TRAFFIC_AWARE_OPTIMAL  1

if [[ $DRY_RUN -eq 0 ]]; then
  echo
  echo "Comparación de geometría (mismo hash ⇒ misma ruta):"
  for t in A_drive B_truck C_drive_dims D_drive_nopref E_truck_nopref F_drive_notolls G_truck_notolls; do
    h=$(python3 -c "import json,hashlib,sys; j=json.load(open(sys.argv[1])); r=(j.get('routes') or [{}])[0]; print(hashlib.sha1(r.get('polyline',{}).get('encodedPolyline','').encode()).hexdigest()[:12])" "$OUT/$t.resp.json" 2>/dev/null || echo "n/a")
    printf '  %-18s %s\n' "$t" "$h"
  done
  echo "Respuestas completas en $OUT/*.resp.json"
fi
