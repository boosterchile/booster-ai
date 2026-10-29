#!/usr/bin/env bash
# Sonda HERE Routing v8 (spec .specs/ruteo-camion-chile): auto vs camión, con y sin
# peajes, sobre el par de prueba. Lee coordenadas de $OUT/coords.env (probe-osm-data.sh)
# o de ORIGIN_LAT/ORIGIN_LON/DEST_LAT/DEST_LON en env.
#
# Requiere HERE_API_KEY en env. La clave viaja como parámetro de query (lo exige HERE);
# nunca se imprime: no usar -v ni echo de la URL.
set -euo pipefail

OUT="${OUT_DIR:-./probe-out}"
mkdir -p "$OUT"
DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1
if [[ -f "$OUT/coords.env" ]]; then
  # shellcheck disable=SC1091
  source "$OUT/coords.env"
fi
: "${ORIGIN_LAT:?falta ORIGIN_LAT}" "${ORIGIN_LON:?}" "${DEST_LAT:?}" "${DEST_LON:?}"
if [[ $DRY_RUN -eq 0 ]]; then
  : "${HERE_API_KEY:?falta HERE_API_KEY (secreto de GitHub Actions)}"
fi

URL='https://router.hereapi.com/v8/routes'
# Camión rígido 3 ejes, mismo que la sonda Google. HERE v8: peso en kg, dimensiones en cm.
TRUCK_ARGS=(
  --data-urlencode 'vehicle[grossWeight]=18000'
  --data-urlencode 'vehicle[height]=400'
  --data-urlencode 'vehicle[width]=260'
  --data-urlencode 'vehicle[length]=1200'
  --data-urlencode 'vehicle[axleCount]=3'
  --data-urlencode 'vehicle[type]=straightTruck'
)

run() {
  local tag="$1" mode="$2" avoid_tolls="$3"
  local resp="$OUT/here-$tag.resp.json"
  local args=(
    --get "$URL"
    --data-urlencode "transportMode=$mode"
    --data-urlencode "origin=$ORIGIN_LAT,$ORIGIN_LON"
    --data-urlencode "destination=$DEST_LAT,$DEST_LON"
    --data-urlencode 'return=polyline,summary,actions,instructions'
    --data-urlencode 'spans=names'
    --data-urlencode 'lang=es-CL'
  )
  [[ "$mode" == "truck" ]] && args+=("${TRUCK_ARGS[@]}")
  [[ "$avoid_tolls" == "1" ]] && args+=(--data-urlencode 'avoid[features]=tollRoad')
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "== here-$tag ($mode avoidTolls=$avoid_tolls) [dry-run] =="
    printf '   %s\n' "${args[@]}" | grep -v -- '--data-urlencode$' | grep -v -- '--get$'
    return
  fi
  args+=(--data-urlencode "apiKey=$HERE_API_KEY")
  local code
  code=$(curl -sS -m 30 -o "$resp" -w '%{http_code}' "${args[@]}")
  echo "== here-$tag ($mode avoidTolls=$avoid_tolls) → HTTP $code =="
  python3 - "$resp" "$code" <<'PY'
import hashlib, json, re, sys
path, code = sys.argv[1], sys.argv[2]
try:
    j = json.load(open(path, encoding="utf-8"))
except Exception as e:
    print(f"  (sin JSON legible: {e})"); sys.exit(0)
if code != "200":
    print(f"  error={json.dumps(j, ensure_ascii=False)[:400]}"); sys.exit(0)
routes = j.get("routes") or []
if not routes:
    print(f"  sin rutas. notices={json.dumps(j.get('notices'), ensure_ascii=False)}"); sys.exit(0)
r = routes[0]
secs = r.get("sections", [])
length = sum(s.get("summary", {}).get("length", 0) for s in secs)
dur = sum(s.get("summary", {}).get("duration", 0) for s in secs)
names = []
for s in secs:
    for sp in s.get("spans", []):
        for n in sp.get("names", []):
            v = n.get("value", "")
            if v and (not names or names[-1] != v):
                names.append(v)
poly = "".join(s.get("polyline", "") for s in secs)
notices = [n for s in secs for n in s.get("notices", [])] + list(j.get("notices", []))
pir = [n for n in names if re.search(r"pir[aá]mide", n, re.I)]
print(f"  distancia={length/1000:.2f} km  duracion={dur}s  polyline_sha1={hashlib.sha1(poly.encode()).hexdigest()[:12]}")
print(f"  vias={len(names)}  vias_con_Piramide={len(pir)}  notices={len(notices)}")
for n in notices:
    print(f"    notice: {json.dumps(n, ensure_ascii=False)[:220]}")
for i, n in enumerate(names[:40]):
    mark = "★" if re.search(r"pir[aá]mide", n, re.I) else " "
    print(f"   {mark} {i+1:2d}. {n}")
PY
}

run car_tolls      car   0
run car_notolls    car   1
run truck_tolls    truck 0
run truck_notolls  truck 1
echo "Respuestas en $OUT/here-*.resp.json"
