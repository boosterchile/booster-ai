#!/usr/bin/env bash
# Sonda: ¿Routes API respeta restricciones de camión en Santiago (Camino La Pirámide)?
#
# Contexto: prod manda `travelMode: DRIVE` fijo (apps/api/src/services/routes-api.ts),
# así que la «ruta eco» ignora prohibiciones de camiones (altura, peso, horario).
# Google ofrece large vehicle routing (`travelMode: TRUCK` + routeModifiers.vehicleInfo)
# con cobertura declarada EE.UU. + Japón. Esta sonda mide qué pasa en Chile.
#
# Cuatro requests sobre el mismo par origen→destino, elegido para que un auto cruce
# el Parque Metropolitano por Camino La Pirámide:
#   A) DRIVE                       — lo que manda prod hoy
#   B) TRUCK + vehicleInfo, TRAFFIC_AWARE_OPTIMAL
#   B2) TRUCK + vehicleInfo, sin routingPreference (por si B falla por la combinación)
#   C) DRIVE + vehicleInfo         — control: ¿ignora las dimensiones o rechaza?
#
# Lectura binaria:
#   - B y B2 → 400/403: LVR no habilitado para el proyecto o la región. Fin.
#   - B → 200 con polyline IDÉNTICA a A: acepta el modo, sin restricciones para Chile.
#   - B → 200, polyline DISTINTA, A pasa por «Pirámide» y B no: Google conoce la
#     restricción; el cambio de código es viable.
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

# Hitos inequívocos a cada lado del cerro. Routes API los geocodifica (mismo camino
# que prod, que manda direcciones textuales).
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
  local mode="$1" with_vehicle="$2" pref="$3"
  python3 - "$mode" "$with_vehicle" "$pref" "$ORIGIN" "$DEST" "$VEHICLE_INFO" <<'PY'
import json, sys
mode, with_vehicle, pref, origin, dest, vinfo = sys.argv[1:]
b = {
    "origin": {"address": origin},
    "destination": {"address": dest},
    "travelMode": mode,
    "computeAlternativeRoutes": False,
}
if pref:
    b["routingPreference"] = pref
if with_vehicle == "1":
    b["routeModifiers"] = {"vehicleInfo": json.loads(vinfo)}
print(json.dumps(b, ensure_ascii=False))
PY
}

run() {
  local tag="$1" mode="$2" with_vehicle="$3" pref="$4"
  local req="$OUT/$tag.req.json" resp="$OUT/$tag.resp.json"
  body "$mode" "$with_vehicle" "$pref" > "$req"
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "== $tag ($mode, vehicleInfo=$with_vehicle, pref=${pref:-none}) [dry-run] =="; cat "$req"; echo
    return
  fi
  local code
  code=$(curl -sS -o "$resp" -w '%{http_code}' -X POST "$URL" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-Goog-User-Project: $PROJECT_ID" \
    -H "X-Goog-FieldMask: $FIELD_MASK" \
    --data @"$req")
  echo "== $tag ($mode, vehicleInfo=$with_vehicle, pref=${pref:-none}) → HTTP $code =="
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

run A_drive          DRIVE 0 TRAFFIC_AWARE_OPTIMAL
run B_truck_vehicle  TRUCK 1 TRAFFIC_AWARE_OPTIMAL
run B2_truck_nopref  TRUCK 1 ""
run C_drive_vehicle  DRIVE 1 TRAFFIC_AWARE_OPTIMAL

if [[ $DRY_RUN -eq 0 ]]; then
  echo
  echo "Comparación de geometría (mismo hash ⇒ misma ruta):"
  for t in A_drive B_truck_vehicle B2_truck_nopref C_drive_vehicle; do
    h=$(python3 -c "import json,hashlib,sys; j=json.load(open(sys.argv[1])); r=(j.get('routes') or [{}])[0]; print(hashlib.sha1(r.get('polyline',{}).get('encodedPolyline','').encode()).hexdigest()[:12])" "$OUT/$t.resp.json" 2>/dev/null || echo "n/a")
    printf '  %-18s %s\n' "$t" "$h"
  done
  echo "Respuestas completas en $OUT/*.resp.json"
fi
