#!/usr/bin/env python3
"""Inyecta `hgv=no` en las vías de OSM cuyo nombre coincide con un patrón (C4 del spec
.specs/ruteo-camion-chile): prueba de mecanismo. Si OSRM con perfil de camión evita la
vía inyectada y el perfil de auto no, el motor funciona y lo que falta es el dato en OSM.

Uso: osm-inject-hgv-no.py <entrada.osm.pbf> <salida.osm.pbf> <regex-nombre>
Solo toca vías con highway vehicular (no ciclovías ni peatonales). Imprime cuántas tocó
y falla si no tocó ninguna: una inyección vacía haría pasar C4 por omisión.
"""

import re
import sys

import osmium

VEHICULAR = {
    "motorway", "trunk", "primary", "secondary", "tertiary", "unclassified",
    "residential", "motorway_link", "trunk_link", "primary_link", "secondary_link",
    "tertiary_link", "living_street", "service",
}


class Inyector(osmium.SimpleHandler):
    def __init__(self, writer: osmium.SimpleWriter, patron: str) -> None:
        super().__init__()
        self.writer = writer
        self.patron = re.compile(patron, re.IGNORECASE)
        self.tocadas: list[int] = []

    def node(self, n: osmium.osm.Node) -> None:
        self.writer.add_node(n)

    def way(self, w: osmium.osm.Way) -> None:
        nombre = w.tags.get("name", "")
        if (
            nombre
            and self.patron.search(nombre)
            and w.tags.get("highway") in VEHICULAR
        ):
            tags = dict(w.tags)
            tags["hgv"] = "no"
            self.writer.add_way(w.replace(tags=tags))
            self.tocadas.append(w.id)
        else:
            self.writer.add_way(w)

    def relation(self, r: osmium.osm.Relation) -> None:
        self.writer.add_relation(r)


def main() -> int:
    if len(sys.argv) != 4:
        print(__doc__, file=sys.stderr)
        return 2
    entrada, salida, patron = sys.argv[1:4]
    writer = osmium.SimpleWriter(salida)
    handler = Inyector(writer, patron)
    try:
        handler.apply_file(entrada)
    finally:
        writer.close()
    print(f"vías con hgv=no inyectado: {len(handler.tocadas)}")
    for wid in handler.tocadas[:30]:
        print(f"  way/{wid}")
    if not handler.tocadas:
        print(f"ERROR: ninguna vía vehicular coincide con /{patron}/", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
