#!/usr/bin/env bash
# Sonda OSM (spec .specs/ruteo-camion-chile): geocodifica el par de prueba con Nominatim
# y consulta en Overpass qué etiquetas de restricción de camión tiene Camino La Pirámide
# y cuántas vías del recorte de Santiago llevan alguna (hgv / maxweight / maxheight).
#
# Salidas:
#   $OUT/coords.env       ORIGIN_LAT/ORIGIN_LON/DEST_LAT/DEST_LON (fuente única para
#                         HERE y OSRM, así los motores comparan sobre el mismo par)
#   $OUT/overpass-piramide.json, $OUT/overpass-conteo.json
#   $GITHUB_OUTPUT (si existe): origin_lat, origin_lon, dest_lat, dest_lon
set -euo pipefail

OUT="${OUT_DIR:-./probe-out}"
mkdir -p "$OUT"
UA='booster-ai-probe/1.0 (dev@boosterchile.com)'
ORIGIN_Q='Ciudad Empresarial, Huechuraba, Chile'
DEST_Q='Parque Bicentenario, Vitacura, Chile'
# bbox Santiago: sur,oeste,norte,este (orden Overpass)
BBOX='-33.65,-70.85,-33.25,-70.45'

geocode() {
  local q="$1" tag="$2"
  curl -sS -m 30 -A "$UA" --get 'https://nominatim.openstreetmap.org/search' \
    --data-urlencode "q=$q" --data-urlencode 'format=json' --data-urlencode 'limit=1' \
    -o "$OUT/nominatim-$tag.json"
  python3 - "$OUT/nominatim-$tag.json" <<'PY'
import json, sys
j = json.load(open(sys.argv[1], encoding="utf-8"))
if not j:
    print("ERROR sin resultado", file=sys.stderr); sys.exit(1)
print(f"{float(j[0]['lat']):.6f} {float(j[0]['lon']):.6f} {j[0].get('display_name','')[:90]}")
PY
  sleep 1 # política de uso de Nominatim: ≤1 req/s
}

echo "== Nominatim =="
read -r OLAT OLON ONAME <<<"$(geocode "$ORIGIN_Q" origin)"
read -r DLAT DLON DNAME <<<"$(geocode "$DEST_Q" dest)"
echo "  origen : $OLAT,$OLON  $ONAME"
echo "  destino: $DLAT,$DLON  $DNAME"
cat > "$OUT/coords.env" <<ENV
ORIGIN_LAT=$OLAT
ORIGIN_LON=$OLON
DEST_LAT=$DLAT
DEST_LON=$DLON
ENV
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  { echo "origin_lat=$OLAT"; echo "origin_lon=$OLON"; echo "dest_lat=$DLAT"; echo "dest_lon=$DLON"; } >> "$GITHUB_OUTPUT"
fi

echo "== Overpass: vías 'Pirámide' en Santiago y sus etiquetas de restricción =="
curl -sS -m 90 -A "$UA" 'https://overpass-api.de/api/interpreter' \
  --data-urlencode "data=[out:json][timeout:60];way[\"highway\"][\"name\"~\"Pir[áa]mide\",i]($BBOX);out tags;" \
  -o "$OUT/overpass-piramide.json"
python3 - "$OUT/overpass-piramide.json" <<'PY'
import json, sys
j = json.load(open(sys.argv[1], encoding="utf-8"))
keys = ("name","highway","hgv","hgv:conditional","maxweight","maxweight:hgv","maxheight",
        "maxaxleload","maxlength","access","motor_vehicle","toll","oneway")
els = j.get("elements", [])
print(f"  vías encontradas: {len(els)}")
con_restriccion = 0
for e in els:
    t = e.get("tags", {})
    sel = {k: t[k] for k in keys if k in t}
    if any(k in t for k in ("hgv","hgv:conditional","maxweight","maxweight:hgv","maxheight","maxaxleload")):
        con_restriccion += 1
    print(f"  way/{e['id']}: {json.dumps(sel, ensure_ascii=False)}")
print(f"  vías Pirámide con etiqueta de restricción de camión: {con_restriccion}/{len(els)}")
PY

echo "== Overpass: cobertura de etiquetas de camión en el recorte de Santiago =="
curl -sS -m 120 -A "$UA" 'https://overpass-api.de/api/interpreter' \
  --data-urlencode "data=[out:json][timeout:90];(way[\"highway\"][\"hgv\"]($BBOX);way[\"highway\"][\"maxweight\"]($BBOX);way[\"highway\"][\"maxheight\"]($BBOX);way[\"highway\"][\"hgv:conditional\"]($BBOX););out tags;" \
  -o "$OUT/overpass-conteo.json"
python3 - "$OUT/overpass-conteo.json" <<'PY'
import collections, json, sys
j = json.load(open(sys.argv[1], encoding="utf-8"))
els = j.get("elements", [])
c = collections.Counter()
for e in els:
    t = e.get("tags", {})
    for k in ("hgv","hgv:conditional","maxweight","maxheight"):
        if k in t:
            c[k] += 1
print(f"  vías con alguna etiqueta de camión en el bbox: {len(els)}")
for k, n in c.most_common():
    print(f"    {k}: {n}")
vals = collections.Counter(t for e in els for k, t in e.get("tags", {}).items() if k == "hgv")
print(f"  valores de hgv: {dict(vals)}")
PY
echo "Salidas en $OUT/"
