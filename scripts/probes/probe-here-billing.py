#!/usr/bin/env python3
"""Experimento de facturación HERE (pregunta del PO, 2026-10-20): ¿una ruta de camión
sin `departureTime=any` se cobra dos veces (Routing Truck + Time Aware Routing)?

Hace un número exacto y conocido de llamadas en un día limpio (UTC) para contrastar con
Usage del portal (retraso de hasta 2 días):
  - TRUCK_ANY  llamadas truck con departureTime=any   → esperado: Truck +N, Time Aware +0
  - TRUCK_TIME llamadas truck con departureTime ISO    → esperado: Truck +M, Time Aware +M
  - CAR_ANY    llamadas car   con departureTime=any   → esperado: Car +K, Time Aware +0
Cada llamada usa un par origen→destino distinto (jitter de ~100 m) para que ninguna
quede deduplicada. Imprime el conteo de 200 por grupo, que es el número a comparar.
Requiere HERE_API_KEY. Solo urllib.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request

HERE_URL = "https://router.hereapi.com/v8/routes"
UA = "booster-ai-probe/1.0 (dev@boosterchile.com)"
TRUCK = {
    "vehicle[grossWeight]": "18000", "vehicle[height]": "400", "vehicle[width]": "260",
    "vehicle[length]": "1200", "vehicle[axleCount]": "3", "vehicle[type]": "straightTruck",
}
# Mismo par de todas las sondas (Ciudad Empresarial → Parque Bicentenario)
O = (-33.389802, -70.618360)
D = (-33.400576, -70.602485)


def llamar(api_key: str, mode: str, departure: str, i: int) -> int:
    jitter = 0.0009 * (i + 1)  # ~100 m por llamada
    params = {
        "transportMode": mode,
        "origin": f"{O[0] + jitter:.6f},{O[1]:.6f}",
        "destination": f"{D[0]:.6f},{D[1] - jitter:.6f}",
        "return": "summary",
        "departureTime": departure,
        "apiKey": api_key,
    }
    if mode == "truck":
        params.update(TRUCK)
    req = urllib.request.Request(HERE_URL + "?" + urllib.parse.urlencode(params), headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = json.loads(r.read().decode("utf-8"))
            return r.status if body.get("routes") else 204
    except urllib.error.HTTPError as e:
        return e.code


def main() -> int:
    api_key = os.environ.get("HERE_API_KEY", "")
    if not api_key:
        print("falta HERE_API_KEY", file=sys.stderr)
        return 2
    grupos = (
        ("TRUCK_ANY", "truck", "any", int(os.environ.get("TRUCK_ANY", "7"))),
        ("TRUCK_TIME", "truck", os.environ.get("DEPARTURE_ISO", "2026-10-22T10:00:00-03:00"), int(os.environ.get("TRUCK_TIME", "5"))),
        ("CAR_ANY", "car", "any", int(os.environ.get("CAR_ANY", "3"))),
    )
    print(f"== experimento de facturación HERE, {os.environ.get('GITHUB_RUN_ID', 'local')} ==")
    ok_total = 0
    for nombre, mode, dep, n in grupos:
        codigos = [llamar(api_key, mode, dep, i) for i in range(n)]
        ok = sum(1 for c in codigos if c == 200)
        ok_total += ok
        print(f"  {nombre:<10} mode={mode:<5} departureTime={dep:<28} pedidas={n} con_ruta_200={ok} códigos={codigos}")
    print(f"  total con ruta: {ok_total}")
    print("  esperado en Usage (si la hipótesis es cierta): Routing Truck = TRUCK_ANY+TRUCK_TIME; "
          "Time Aware Routing = TRUCK_TIME; Routing Car = CAR_ANY")
    return 0


if __name__ == "__main__":
    sys.exit(main())
