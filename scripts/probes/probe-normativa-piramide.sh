#!/usr/bin/env bash
# Fuentes oficiales de la restricción de camiones en La Pirámide (pregunta del PO,
# 2026-10-20: «tal vez hay una solución mejor a través del MTT o Vialidad»).
# Descarga páginas oficiales del MTT y la ficha de Ley Chile (BCN) y extrae los párrafos
# con la norma, el umbral de peso y los horarios. Best-effort: una fuente caída no
# detiene a las demás. Sin credenciales.
set -uo pipefail

OUT="${OUT_DIR:-./probe-out}"
mkdir -p "$OUT"
UA='booster-ai-probe/1.0 (dev@boosterchile.com)'

declare -A FUENTES=(
  [mtt-camaras]='https://mtt.gob.cl/iniciamos-operacion-de-camaras-para-fiscalizar-a-camiones-que-circulan-por-la-piramide/'
  [subtrans-fiscalizacion]='https://usuarios.subtrans.gob.cl/archivos/5484'
  [transporteinforma-faq]='https://www.transporteinforma.cl/centro-de-ayuda/preguntas-frecuentes/restriccion-a-circulacion-de-camiones/'
  [bcn-busqueda-ds18-2001]='https://www.bcn.cl/leychile/consulta/listaresultadosimple?cadena=decreto%2018%202001%20transportes%20camiones'
)

extraer() { # <html> → texto plano con párrafos relevantes y contexto
  python3 - "$1" <<'PY'
import html, re, sys
raw = open(sys.argv[1], encoding="utf-8", errors="replace").read()
raw = re.sub(r"(?is)<(script|style|noscript).*?</\1>", " ", raw)
txt = html.unescape(re.sub(r"(?s)<[^>]+>", " ", raw))
txt = re.sub(r"[ \t\r\f\v]+", " ", txt)
txt = re.sub(r"\s*\n\s*", "\n", txt)
claves = re.compile(r"pir[aá]mide|3\.?860|decreto|resoluci[oó]n|horario|08[:.]00|18[:.]30|peso bruto|anillo|vespucio|ejes", re.I)
lineas = [l.strip() for l in txt.split("\n") if l.strip()]
vistos = set()
n = 0
for i, l in enumerate(lineas):
    if claves.search(l) and len(l) > 40 and l not in vistos:
        vistos.add(l)
        print("  ·", l[:600])
        n += 1
        if n >= 25:
            break
if n == 0:
    print("  (sin párrafos relevantes; primeras líneas:)")
    for l in lineas[:8]:
        print("   ", l[:160])
PY
}

for k in "${!FUENTES[@]}"; do
  u="${FUENTES[$k]}"
  f="$OUT/normativa-$k.html"
  code=$(curl -sSL -m 40 -A "$UA" -o "$f" -w '%{http_code}' "$u" 2>/dev/null || echo 000)
  echo "== $k → HTTP $code  ($u) =="
  if [[ "$code" == "200" ]]; then
    extraer "$f"
  else
    echo "  no disponible"
  fi
  echo
done
