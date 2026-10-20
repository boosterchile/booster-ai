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

# Jerarquía de acceso: línea exacta "'motorcar'," dentro de access_tags_hierarchy.
n=$(grep -cE "^\s*'motorcar',\s*$" "$DST" || true)
[[ "$n" == "1" ]] || { echo "ERROR: esperaba 1 línea \"'motorcar',\" (access_tags_hierarchy), hay $n" >&2; exit 1; }
sed -i -E "s/^(\s*)'motorcar',\s*$/\1'hgv',\n\1'motorcar',/" "$DST"

echo "truck.lua generado:"
grep -nE "vehicle_(height|width|length|weight)\s*=|^\s*'hgv',|^\s*'motorcar'," "$DST"
