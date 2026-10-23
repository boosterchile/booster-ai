#!/usr/bin/env bash
# Genera truck.lua a partir del car.lua de OSRM (spec .specs/ruteo-camion-chile):
#   - 'hgv' primero en access_tags_hierarchy → hgv=no excluye la vía para el camión
#   - dimensiones y peso del camión de prueba → maxheight/maxwidth/maxlength/maxweight
#     de OSM se aplican (WayHandlers.handle_height/width/length/weight de car.lua)
# Cada sustitución se verifica: si car.lua cambió de forma, el script falla, no
# produce un perfil silenciosamente igual al de auto.
# Uso: osrm-truck-profile.sh <car.lua> <truck.lua>
set -euo pipefail
SRC="$1"; DST="$2"
cp "$SRC" "$DST"

patch_num() { # clave valor
  local key="$1" val="$2"
  local n
  n=$(grep -cE "^\s*${key}\s*=\s*[0-9.]+" "$DST" || true)
  [[ "$n" == "1" ]] || { echo "ERROR: esperaba 1 línea '${key} = <num>' en car.lua, hay $n" >&2; exit 1; }
  sed -i -E "s/^(\s*${key}\s*=\s*)[0-9.]+/\1${val}/" "$DST"
}
patch_num vehicle_height 4.0
patch_num vehicle_width  2.6
patch_num vehicle_length 12.0
patch_num vehicle_weight 18000

# Jerarquía de acceso: 'hgv' como primer elemento del bloque access_tags_hierarchy.
# Se localiza el bloque, no la línea "'motorcar'," (aparece también en las listas Set
# multilínea de car.lua v5.27: 3 veces, verificado en la corrida 39460619831).
python3 - "$DST" <<'PY2'
import re, sys
path = sys.argv[1]
s = open(path, encoding="utf-8").read()
ms = list(re.finditer(r"access_tags_hierarchy\s*=\s*Sequence\s*\{\s*\n(\s*)", s))
if len(ms) != 1:
    print(f"ERROR: esperaba 1 bloque access_tags_hierarchy, hay {len(ms)}", file=sys.stderr); sys.exit(1)
m = ms[0]
indent = m.group(1)
s = s[:m.end()] + "'hgv',\n" + indent + s[m.end():]
bloque = s[m.start():s.index("}", m.start())]
if not re.search(r"\{\s*\n\s*'hgv',\s*\n\s*'motorcar',", bloque):
    print("ERROR: la jerarquía no quedó como {'hgv','motorcar',...}:\n" + bloque, file=sys.stderr); sys.exit(1)
open(path, "w", encoding="utf-8").write(s)
PY2

echo "truck.lua generado:"
grep -nE "vehicle_(height|width|length|weight)\s*=|^\s*'hgv'," "$DST"
awk '/access_tags_hierarchy/,/\}/' "$DST"
