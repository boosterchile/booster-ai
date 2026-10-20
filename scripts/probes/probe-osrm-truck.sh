#!/usr/bin/env bash
# Sonda OSRM (spec .specs/ruteo-camion-chile): auto vs camión, con y sin peajes, contra
# dos osrm-routed locales (perfil car.lua y truck.lua) sobre el recorte de Santiago.
# Lee coordenadas de $OUT/coords.env o de ORIGIN_LAT/ORIGIN_LON/DEST_LAT/DEST_LON.
# Env: OSRM_CAR_URL (default http://localhost:5000), OSRM_TRUCK_URL (http://localhost:5001)
set -euo pipefail

OUT="${OUT_DIR:-./probe-out}"
mkdir -p "$OUT"
if [[ -f "$OUT/coords.env" ]]; then
  # shellcheck disable=SC1091
  source "$OUT/coords.env"
fi
: "${ORIGIN_LAT:?falta ORIGIN_LAT}" "${ORIGIN_LON:?}" "${DEST_LAT:?}" "${DEST_LON:?}"
CAR_URL="${OSRM_CAR_URL:-http://localhost:5000}"
TRUCK_URL="${OSRM_TRUCK_URL:-http://localhost:5001}"

run() {
  local tag="$1" base="$2" exclude="$3"
  local resp="$OUT/osrm-$tag.resp.json"
  local url="$base/route/v1/driving/$ORIGIN_LON,$ORIGIN_LAT;$DEST_LON,$DEST_LAT?overview=full&steps=true&alternatives=false"
  [[ -n "$exclude" ]] && url="$url&exclude=$exclude"
  local code
  code=$(curl -sS -m 30 -o "$resp" -w '%{http_code}' "$url")
  echo "== osrm-$tag (exclude=${exclude:-none}) → HTTP $code =="
  python3 - "$resp" "$code" <<'PY'
import hashlib, json, re, sys
path, code = sys.argv[1], sys.argv[2]
try:
    j = json.load(open(path, encoding="utf-8"))
except Exception as e:
    print(f"  (sin JSON legible: {e})"); sys.exit(0)
if code != "200" or j.get("code") != "Ok":
    print(f"  error={json.dumps(j, ensure_ascii=False)[:300]}"); sys.exit(0)
r = j["routes"][0]
names = []
for leg in r.get("legs", []):
    for st in leg.get("steps", []):
        n = st.get("name", "") or st.get("ref", "")
        if n and (not names or names[-1] != n):
            names.append(n)
pir = [n for n in names if re.search(r"pir[aá]mide", n, re.I)]
poly = r.get("geometry", "")
print(f"  distancia={r.get('distance',0)/1000:.2f} km  duracion={int(r.get('duration',0))}s  geometry_sha1={hashlib.sha1(poly.encode()).hexdigest()[:12]}")
print(f"  vias={len(names)}  vias_con_Piramide={len(pir)}")
for i, n in enumerate(names[:40]):
    mark = "★" if re.search(r"pir[aá]mide", n, re.I) else " "
    print(f"   {mark} {i+1:2d}. {n}")
PY
}

run car_tolls     "$CAR_URL"   ""
run car_notolls   "$CAR_URL"   toll
run truck_tolls   "$TRUCK_URL" ""
run truck_notolls "$TRUCK_URL" toll
echo "Respuestas en $OUT/osrm-*.resp.json"
