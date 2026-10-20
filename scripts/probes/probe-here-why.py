#!/usr/bin/env python3
"""¿Por qué HERE evita Camino La Pirámide para el camión? Pregunta del PO (2026-10-20).

La sonda anterior midió el efecto; esta pide la causa:
1. Toma la ruta de auto sin peajes (here-car_notolls.resp.json, con spans=names) y ubica
   el tramo «Pirámide» en la polilínea → punto `via` sobre esa vía.
2. Pide a HERE la ruta de CAMIÓN forzada por ese `via`, con spans=names,truckAttributes.
   HERE responde con `notices` de restricción violada (con detalle) y, en los spans,
   los atributos de camión del tramo. Se imprimen crudos: la causa es lo que HERE diga,
   no una inferencia nuestra.
3. Control: misma petición con transportMode=car (no debería traer notices de camión).

Requiere HERE_API_KEY y $OUT_DIR/here-car_notolls.resp.json (probe-here-truck.sh).
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from flexpolyline import decodificar  # noqa: E402

HERE_URL = "https://router.hereapi.com/v8/routes"
UA = "booster-ai-probe/1.0 (dev@boosterchile.com)"
TRUCK = {
    "vehicle[grossWeight]": "18000",
    "vehicle[height]": "400",
    "vehicle[width]": "260",
    "vehicle[length]": "1200",
    "vehicle[axleCount]": "3",
    "vehicle[type]": "straightTruck",
}
PATRON = re.compile(r"pir[aá]mide", re.I)


def pedir(api_key: str, mode: str, o: str, d: str, via: str, spans: str) -> tuple[int, dict]:
    params = {
        "transportMode": mode, "origin": o, "destination": d, "via": via,
        "return": "polyline,summary", "spans": spans, "lang": "es-CL", "apiKey": api_key,
    }
    if mode == "truck":
        params.update(TRUCK)
    req = urllib.request.Request(HERE_URL + "?" + urllib.parse.urlencode(params), headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8", "replace"))
        except Exception:
            return e.code, {"raw": "sin JSON"}


def punto_via(resp_car: dict) -> tuple[str, str]:
    """Punto medio del primer span «Pirámide» de la ruta de auto, y el nombre del span."""
    for sec in resp_car.get("routes", [{}])[0].get("sections", []):
        pts = decodificar(sec.get("polyline", ""))
        spans = sec.get("spans", [])
        for i, sp in enumerate(spans):
            nombres = [n.get("value", "") for n in sp.get("names", [])]
            if any(PATRON.search(n) for n in nombres):
                a = sp.get("offset", 0)
                b = spans[i + 1].get("offset", len(pts) - 1) if i + 1 < len(spans) else len(pts) - 1
                m = pts[(a + b) // 2]
                return f"{m[0]:.6f},{m[1]:.6f}", " / ".join(nombres)
    raise SystemExit("la ruta de auto sin peajes no tiene un span «Pirámide»; nada que explicar")


def main() -> int:
    api_key = os.environ.get("HERE_API_KEY", "")
    if not api_key:
        print("falta HERE_API_KEY", file=sys.stderr)
        return 2
    out = os.environ.get("OUT_DIR", "./probe-out")
    with open(os.path.join(out, "here-car_notolls.resp.json"), encoding="utf-8") as f:
        car = json.load(f)
    o = f"{os.environ['ORIGIN_LAT']},{os.environ['ORIGIN_LON']}"
    d = f"{os.environ['DEST_LAT']},{os.environ['DEST_LON']}"
    via, nombre = punto_via(car)
    print(f"== via sobre «{nombre}»: {via} ==")

    for mode in ("truck", "car"):
        for spans in ("names,truckAttributes", "names"):
            code, resp = pedir(api_key, mode, o, d, via, spans)
            print(f"== {mode} forzado por via, spans={spans} → HTTP {code} ==")
            if code != 200:
                print("  error:", json.dumps(resp, ensure_ascii=False)[:600])
                continue  # con truckAttributes rechazado, se reintenta solo con names
            with open(os.path.join(out, f"here-why-{mode}-{spans.replace(',', '_')}.resp.json"), "w", encoding="utf-8") as f:
                json.dump(resp, f, ensure_ascii=False, indent=1)
            routes = resp.get("routes") or []
            notices = list(resp.get("notices", []))
            if routes:
                for sec in routes[0].get("sections", []):
                    notices.extend(sec.get("notices", []))
                    km = sec.get("summary", {}).get("length", 0) / 1000
                    print(f"  sección: {km:.2f} km, {sec.get('summary', {}).get('duration')} s")
                    for sp in sec.get("spans", []):
                        nombres = [n.get("value", "") for n in sp.get("names", [])]
                        if any(PATRON.search(n) for n in nombres):
                            print(f"  span «{' / '.join(nombres)}»: {json.dumps({k: v for k, v in sp.items() if k != 'names'}, ensure_ascii=False)}")
            else:
                print("  sin rutas")
            print(f"  notices ({len(notices)}):")
            for n in notices:
                print("   ", json.dumps(n, ensure_ascii=False))
            break
    return 0


if __name__ == "__main__":
    sys.exit(main())
