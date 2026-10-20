#!/usr/bin/env python3
"""Sonda de cobertura de HERE Routing v8 para restricciones de camión (validación del
ADR-084), sin lista manual: el oráculo es OpenStreetMap.

1. Overpass: vías vehiculares con `hgv=no`, `maxheight` < alto del camión o `maxweight`
   < peso del camión, por región (bbox), con geometría.
2. Muestra determinista por región (ordenada por id, vías ≥ LARGO_MIN m).
3. Por vía: origen y destino se construyen prolongando la vía ±EXT m más allá de sus
   extremos, de modo que la vía quede en medio del trayecto más corto.
4. HERE car y HERE truck sobre ese par. Se decodifica la *flexible polyline* y se mide
   si cada ruta pasa a ≤ TOL m de algún nodo de la vía.
   - car no pasa  → par no discriminante (se excluye del denominador)
   - car pasa y truck no, o truck trae notice de restricción → HERE cubre la vía
   - car pasa y truck también sin notice → HERE no cubre la vía
5. Cobertura = cubiertas / discriminantes, por región y total.

Requiere HERE_API_KEY en env. Solo urllib (sin dependencias). Salida: tabla en stdout y
$OUT_DIR/here-coverage.json con el detalle por vía.
"""

from __future__ import annotations

import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass, field

# -I no agrega el directorio del script a sys.path; se agrega explícitamente (es el repo).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from flexpolyline import decodificar as decodificar_flexpolyline  # noqa: E402

HERE_URL = "https://router.hereapi.com/v8/routes"
OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
UA = "booster-ai-probe/1.0 (dev@boosterchile.com)"

# Camión de prueba, el mismo de las sondas anteriores (HERE: kg y cm).
TRUCK = {
    "vehicle[grossWeight]": "18000",
    "vehicle[height]": "400",
    "vehicle[width]": "260",
    "vehicle[length]": "1200",
    "vehicle[axleCount]": "3",
    "vehicle[type]": "straightTruck",
}
TRUCK_HEIGHT_M = 4.0
TRUCK_WEIGHT_T = 18.0

# Regiones: nombre → (sur, oeste, norte, este) en orden Overpass, y cuota de la muestra.
REGIONES = {
    "RM": ("-33.65,-70.85,-33.25,-70.45", 10),
    "Valparaiso": ("-33.10,-71.70,-32.90,-71.40", 3),
    "Biobio": ("-36.90,-73.15,-36.70,-72.95", 3),
}
VEHICULAR = (
    "motorway|trunk|primary|secondary|tertiary|unclassified|residential|"
    "motorway_link|trunk_link|primary_link|secondary_link|tertiary_link"
)
LARGO_MIN_M = 150.0
EXTENSIONES_M = (700.0, 300.0)
TOL_M = 30.0


@dataclass
class Via:
    region: str
    id: int
    nombre: str
    tags: dict[str, str]
    nodos: list[tuple[float, float]]  # (lat, lon)
    largo_m: float = 0.0


@dataclass
class Resultado:
    via: Via
    discriminante: bool
    cubierta: bool | None
    ext_m: float | None
    car_km: float | None
    truck_km: float | None
    notices_truck: list[dict] = field(default_factory=list)
    detalle: str = ""


# ---------- geometría ----------

def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    r = 6371008.8
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def bearing(a: tuple[float, float], b: tuple[float, float]) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    y = math.sin(lo2 - lo1) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(lo2 - lo1)
    return math.atan2(y, x)


def desplazar(p: tuple[float, float], brg: float, dist_m: float) -> tuple[float, float]:
    r = 6371008.8
    la1, lo1 = math.radians(p[0]), math.radians(p[1])
    d = dist_m / r
    la2 = math.asin(math.sin(la1) * math.cos(d) + math.cos(la1) * math.sin(d) * math.cos(brg))
    lo2 = lo1 + math.atan2(math.sin(brg) * math.sin(d) * math.cos(la1), math.cos(d) - math.sin(la1) * math.sin(la2))
    return (math.degrees(la2), math.degrees(lo2))


def largo_via(nodos: list[tuple[float, float]]) -> float:
    return sum(haversine_m(nodos[i], nodos[i + 1]) for i in range(len(nodos) - 1))


def dist_punto_segmento_m(p: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> float:
    """Distancia de p al segmento a–b en metros, con proyección equirrectangular local
    (error despreciable a escala de calle)."""
    k = math.cos(math.radians(p[0])) * 111_320.0
    ax, ay = (a[1] - p[1]) * k, (a[0] - p[0]) * 110_540.0
    bx, by = (b[1] - p[1]) * k, (b[0] - p[0]) * 110_540.0
    dx, dy = bx - ax, by - ay
    l2 = dx * dx + dy * dy
    if l2 == 0.0:
        return math.hypot(ax, ay)
    t = max(0.0, min(1.0, -(ax * dx + ay * dy) / l2))
    return math.hypot(ax + t * dx, ay + t * dy)


def pasa_por(ruta: list[tuple[float, float]], via: Via, tol_m: float) -> bool:
    """True si al menos 2 nodos de la vía quedan a ≤ tol_m de la *línea* de la ruta
    (distancia a segmentos, no a puntos: rectas largas tienen pocos vértices en ambos
    lados). Dos nodos evitan contar un cruce puntual como uso de la vía."""
    if len(ruta) < 2:
        return False
    alcanzados = 0
    for n in via.nodos:
        if any(dist_punto_segmento_m(n, ruta[i], ruta[i + 1]) <= tol_m for i in range(len(ruta) - 1)):
            alcanzados += 1
            if alcanzados >= 2:
                return True
    return False


# ---------- flexible polyline (HERE): scripts/probes/flexpolyline.py ----------

# ---------- red ----------

def overpass(query: str) -> dict:
    data = urllib.parse.urlencode({"data": query}).encode()
    ultimo = ""
    for ep in OVERPASS:
        for intento in (1, 2):
            req = urllib.request.Request(ep, data=data, headers={"User-Agent": UA})
            try:
                with urllib.request.urlopen(req, timeout=180) as r:
                    body = r.read().decode("utf-8")
                return json.loads(body)
            except Exception as e:  # 429/502/504 en HTML, timeouts
                ultimo = f"{ep} intento {intento}: {e}"
                print(f"  overpass {ultimo}", file=sys.stderr)
                time.sleep(5 * intento)
    raise RuntimeError(f"Overpass no disponible: {ultimo}")


def here_route(api_key: str, mode: str, o: tuple[float, float], d: tuple[float, float]) -> dict:
    params = {
        "transportMode": mode,
        "origin": f"{o[0]:.6f},{o[1]:.6f}",
        "destination": f"{d[0]:.6f},{d[1]:.6f}",
        "return": "polyline,summary",
        "lang": "es-CL",
        "apiKey": api_key,
    }
    if mode == "truck":
        params.update(TRUCK)
    url = HERE_URL + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return {"error": e.code, "body": e.read().decode("utf-8", "replace")[:300]}


def ruta_puntos(resp: dict) -> tuple[list[tuple[float, float]], float, list[dict]]:
    routes = resp.get("routes") or []
    if not routes:
        return [], 0.0, list(resp.get("notices", []))
    secs = routes[0].get("sections", [])
    pts: list[tuple[float, float]] = []
    km = 0.0
    notices: list[dict] = []
    for s in secs:
        pts.extend(decodificar_flexpolyline(s.get("polyline", "")))
        km += s.get("summary", {}).get("length", 0) / 1000
        notices.extend(s.get("notices", []))
    notices.extend(resp.get("notices", []))
    return pts, km, notices


# ---------- oráculo OSM ----------

def restringe_camion(tags: dict[str, str]) -> str | None:
    if tags.get("hgv") == "no":
        return "hgv=no"
    try:
        mh = tags.get("maxheight", "")
        if mh and float(mh.replace("m", "").strip()) < TRUCK_HEIGHT_M:
            return f"maxheight={mh}"
    except ValueError:
        pass
    try:
        mw = tags.get("maxweight", "")
        if mw and float(mw.replace("t", "").strip()) < TRUCK_WEIGHT_T:
            return f"maxweight={mw}"
    except ValueError:
        pass
    return None


def vias_region(region: str, bbox: str, cuota: int) -> list[Via]:
    q = (
        f'[out:json][timeout:120];('
        f'way["highway"~"^({VEHICULAR})$"]["hgv"="no"]({bbox});'
        f'way["highway"~"^({VEHICULAR})$"]["maxheight"]({bbox});'
        f'way["highway"~"^({VEHICULAR})$"]["maxweight"]({bbox});'
        f');out geom;'
    )
    j = overpass(q)
    candidatas: list[Via] = []
    for e in j.get("elements", []):
        tags = e.get("tags", {})
        if not restringe_camion(tags):
            continue
        nodos = [(g["lat"], g["lon"]) for g in e.get("geometry", [])]
        if len(nodos) < 2:
            continue
        v = Via(region, e["id"], tags.get("name", ""), tags, nodos, largo_via(nodos))
        if v.largo_m >= LARGO_MIN_M:
            candidatas.append(v)
    candidatas.sort(key=lambda v: v.id)
    print(f"  {region}: {len(j.get('elements', []))} vías etiquetadas, {len(candidatas)} candidatas ≥ {LARGO_MIN_M:.0f} m")
    if not candidatas:
        return []
    paso = max(1, len(candidatas) // cuota)
    return candidatas[::paso][:cuota]


# ---------- sonda ----------

def sondear(api_key: str, via: Via) -> Resultado:
    ini, fin = via.nodos[0], via.nodos[-1]
    b_ini = bearing(via.nodos[1], via.nodos[0])        # hacia afuera por el inicio
    b_fin = bearing(via.nodos[-2], via.nodos[-1])      # hacia afuera por el final
    for ext in EXTENSIONES_M:
        o = desplazar(ini, b_ini, ext)
        d = desplazar(fin, b_fin, ext)
        car = here_route(api_key, "car", o, d)
        if "error" in car:
            return Resultado(via, False, None, ext, None, None, [], f"HERE car HTTP {car['error']}: {car['body']}")
        car_pts, car_km, _ = ruta_puntos(car)
        if not car_pts or not pasa_por(car_pts, via, TOL_M):
            continue  # el auto no usa la vía con esta extensión: probar la corta
        truck = here_route(api_key, "truck", o, d)
        if "error" in truck:
            return Resultado(via, True, None, ext, car_km, None, [], f"HERE truck HTTP {truck['error']}: {truck['body']}")
        truck_pts, truck_km, notices = ruta_puntos(truck)
        viol = [n for n in notices if n.get("code") not in ("mainLanguageNotFound",)]
        truck_pasa = bool(truck_pts) and pasa_por(truck_pts, via, TOL_M)
        cubierta = (not truck_pasa) or any(n.get("severity") == "critical" for n in viol)
        return Resultado(via, True, cubierta, ext, car_km, truck_km, viol,
                         "camión evita la vía" if not truck_pasa else ("camión pasa; notice crítico" if cubierta else "camión pasa sin aviso"))
    return Resultado(via, False, None, None, None, None, [], "auto no usa la vía con ninguna extensión")


def main() -> int:
    api_key = os.environ.get("HERE_API_KEY", "")
    if not api_key:
        print("falta HERE_API_KEY", file=sys.stderr)
        return 2
    out_dir = os.environ.get("OUT_DIR", "./probe-out")
    os.makedirs(out_dir, exist_ok=True)

    print("== Oráculo OSM (Overpass) ==")
    muestra: list[Via] = []
    for region, (bbox, cuota) in REGIONES.items():
        muestra.extend(vias_region(region, bbox, cuota))
        time.sleep(2)
    print(f"  muestra total: {len(muestra)} vías")

    print("== HERE car vs truck por vía ==")
    resultados: list[Resultado] = []
    for v in muestra:
        r = sondear(api_key, v)
        resultados.append(r)
        marca = "·" if not r.discriminante else ("✔" if r.cubierta else "✘")
        print(f"  {marca} [{v.region}] way/{v.id} {v.nombre or '(sin nombre)'} | {restringe_camion(v.tags)} | "
              f"largo={v.largo_m:.0f} m ext={r.ext_m or '-'} car={r.car_km if r.car_km is None else f'{r.car_km:.2f}'} km "
              f"truck={r.truck_km if r.truck_km is None else f'{r.truck_km:.2f}'} km | {r.detalle}")
        time.sleep(0.3)

    print("== Cobertura ==")
    resumen: dict[str, dict[str, int]] = {}
    for r in resultados:
        reg = resumen.setdefault(r.via.region, {"muestra": 0, "discriminantes": 0, "cubiertas": 0, "errores": 0})
        reg["muestra"] += 1
        if r.detalle.startswith("HERE"):
            reg["errores"] += 1
        if r.discriminante and r.cubierta is not None:
            reg["discriminantes"] += 1
            reg["cubiertas"] += int(r.cubierta)
    tot = {"muestra": 0, "discriminantes": 0, "cubiertas": 0, "errores": 0}
    for reg, c in resumen.items():
        for k in tot:
            tot[k] += c[k]
        pct = (100 * c["cubiertas"] / c["discriminantes"]) if c["discriminantes"] else float("nan")
        print(f"  {reg:<11} muestra={c['muestra']:2d} discriminantes={c['discriminantes']:2d} cubiertas={c['cubiertas']:2d} errores={c['errores']} → {pct:.0f}%")
    pct = (100 * tot["cubiertas"] / tot["discriminantes"]) if tot["discriminantes"] else float("nan")
    print(f"  {'TOTAL':<11} muestra={tot['muestra']:2d} discriminantes={tot['discriminantes']:2d} cubiertas={tot['cubiertas']:2d} errores={tot['errores']} → {pct:.0f}%")

    with open(os.path.join(out_dir, "here-coverage.json"), "w", encoding="utf-8") as f:
        json.dump(
            {
                "camion": TRUCK,
                "regiones": REGIONES,
                "resumen": resumen,
                "vias": [
                    {
                        "region": r.via.region, "way": r.via.id, "nombre": r.via.nombre,
                        "restriccion": restringe_camion(r.via.tags), "largo_m": round(r.via.largo_m),
                        "discriminante": r.discriminante, "cubierta": r.cubierta, "ext_m": r.ext_m,
                        "car_km": r.car_km, "truck_km": r.truck_km, "notices_truck": r.notices_truck,
                        "detalle": r.detalle,
                    }
                    for r in resultados
                ],
            },
            f, ensure_ascii=False, indent=1,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
