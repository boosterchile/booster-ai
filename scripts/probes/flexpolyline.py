"""Decodificador de *flexible polyline* (formato de HERE Routing v8). Sin dependencias.
Verificado contra el ejemplo oficial "BFoz5xJ67i1B1B7PzIhaxL7Y" (precisión 5)."""

from __future__ import annotations

_ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
_DECODE = {c: i for i, c in enumerate(_ALFABETO)}


def _varints(s: str):
    val, shift = 0, 0
    for ch in s:
        v = _DECODE[ch]
        val |= (v & 0x1F) << shift
        if v & 0x20:
            shift += 5
        else:
            yield val
            val, shift = 0, 0


def decodificar(s: str) -> list[tuple[float, float]]:
    """Devuelve [(lat, lon), …]. La tercera dimensión, si viene, se descarta."""
    it = _varints(s)
    version = next(it)
    if version != 1:
        raise ValueError(f"flexible polyline versión {version} no soportada")
    header = next(it)
    precision = header & 15
    tercera = (header >> 4) & 7
    factor = 10 ** precision
    puntos: list[tuple[float, float]] = []
    lat = lon = 0
    vals = list(it)
    paso = 3 if tercera else 2
    for i in range(0, len(vals) - paso + 1, paso):
        dlat, dlon = vals[i], vals[i + 1]
        dlat = (dlat >> 1) ^ -(dlat & 1)
        dlon = (dlon >> 1) ^ -(dlon & 1)
        lat += dlat
        lon += dlon
        puntos.append((lat / factor, lon / factor))
    return puntos
