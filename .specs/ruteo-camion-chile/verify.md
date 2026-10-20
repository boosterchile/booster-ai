# Verify — Ruteo con perfil de camión para Chile (sonda HERE + OSRM)

| Campo | Valor |
|---|---|
| **Spec** | [`spec.md`](spec.md) |
| **Fecha** | 2026-10-20 |
| **Corridas** | Google: run 39454217739 (PR #820, sonda previa) · OSM + OSRM: run 39461320020 (`22f0c36`) · HERE: run 39461320020 intento 2 (rerun con `HERE_API_KEY` cargado por el PO) |
| **Par de prueba** | Ciudad Empresarial `-33.389802,-70.618360` → Parque Bicentenario `-33.400576,-70.602485` (Nominatim, compartido por todos los motores) |
| **Camión** | rígido 3 ejes, 18 000 kg, 4,0 m alto, 2,6 m ancho, 12 m largo |

## Criterios del spec

| # | Criterio | Resultado | Evidencia |
|---|---|---|---|
| C1 | HERE conoce la restricción en Chile | **Sí** | Automóvil sin peajes: 7,73 km por Camino La Pirámide + Calle La Pirámide. Camión sin peajes: 14,66 km / 2182 s, geometría `0c3a77c5`, sin «Pirámide». Sin `notices` de restricción violada. |
| C2 | OSM tiene `hgv`/`maxweight`/`maxheight` en Camino La Pirámide | **No** | 0/93 vías «Pirámide» con etiqueta de camión. Bbox Santiago: 1 276 vías con alguna (`maxheight` 880, `hgv` 347 —`no` 325—, `hgv:conditional` 57, `maxweight` 19). |
| C3 | OSRM + perfil camión evita La Pirámide sobre el dato actual | **No** | `truck` sin peajes = `car` sin peajes, geometría `e3499945`, pasa por Camino La Pirámide. |
| C4 | Con `hgv=no` inyectado, el perfil camión la evita | **Sí** | `truck_inj` sin peajes: 12,01 km / 1148 s, geometría `2aa767d4`, El Salto → Las Torres → Av. Perú → Dominica → Purísima; 0 vías «Pirámide». |

## Tablas

### Google Routes API (run 39454217739)

| Caso | travelMode | vehicleInfo | preferencia | avoidTolls | km | s | polyline | La Pirámide |
|---|---|---|---|---|---|---|---|---|
| A | DRIVE | – | TRAFFIC_AWARE_OPTIMAL | – | 7,66 | 698 | `f68d1af5` | no |
| B | TRUCK | sí | TRAFFIC_AWARE_OPTIMAL | – | 7,66 | 698 | = A | no |
| C | DRIVE | sí | TRAFFIC_AWARE_OPTIMAL | – | 7,66 | 698 | = A | no |
| D | DRIVE | – | ninguna | – | 6,53 | 678 | `601d75ac` | no |
| E | TRUCK | sí | ninguna | – | 6,53 | 678 | = D | no |
| F | DRIVE | – | TRAFFIC_AWARE_OPTIMAL | sí | 8,00 | 974 | `a8970f6e` | **sí** |
| G | TRUCK | sí | TRAFFIC_AWARE_OPTIMAL | sí | 8,00 | 974 | = F | **sí** |

`TRUCK` + `vehicleInfo` se acepta sin error y no cambia nada en Chile. `travelAdvisory` vacío en los 7 casos.

### OSRM v5.27.1, recorte Santiago (bbox −70,85/−33,65 a −70,45/−33,25), run 39461320020

| Caso | Perfil | exclude=toll | km | s | geometría | La Pirámide |
|---|---|---|---|---|---|---|
| car | car.lua | – | 6,62 | 529 | `22c7ff1a` (Túnel San Cristóbal) | no |
| car | car.lua | sí | 9,68 | 937 | `e3499945` | **sí** |
| truck | truck.lua | – | 6,62 | 529 | = car | no |
| truck | truck.lua | sí | 9,68 | 937 | = car | **sí** |
| truck + hgv=no | truck.lua | – | 6,62 | 529 | = car | no |
| truck + hgv=no | truck.lua | sí | 12,01 | 1148 | `2aa767d4` | no |

Costos de la corrida: descarga + recorte 78 s, inyección 15 s, tres builds 55 s, sonda <1 s. Total del job 2 min 48 s.

### HERE Routing v8 (run 39461320020, intento 2)

| Caso | transportMode | vehicle[…] | avoid tollRoad | km | s | polyline | La Pirámide |
|---|---|---|---|---|---|---|---|
| car | car | – | – | 5,85 | 490 | `856c59cc` (Av. del Parque → Américo Vespucio Oriente → Nueva Costanera) | no |
| car | car | – | sí | 7,73 | 955 | `05a1c065` (Santa Clara → El Salto → **Camino La Pirámide** → **Calle La Pirámide** → Santa Cruz) | **sí** (2 vías) |
| truck | truck | 18 t / 400 / 260 / 1200 cm / 3 ejes / straightTruck | – | 5,85 | 642 | `856c59cc` = car | no |
| truck | truck | ídem | sí | **14,66** | **2182** | **`0c3a77c5`** (Rinconada El Salto → El Salto → Las Torres → Av. Perú → Domínica → Purísima → Santa María → Costanera Norte → Puente Pdte. Riesco → Andrés Bello) | **no** |

Único `notice` en los 4 casos: `mainLanguageNotFound` (severity `info`, por `lang=es-CL`). Ninguno de restricción violada. La duración de camión con peajes (642 s) supera a la de auto (490 s) sobre la misma geometría: perfil de velocidad de camión aplicado.

## Conclusión de la fase

1. Google Routes API no conoce restricciones de camión en Chile (sonda 1). Descartado como motor de legalidad de ruta; sigue siendo la fuente de tráfico y ETA.
2. Un motor OSM funciona en cuanto la restricción existe en el dato (C4). Hoy no existe para Camino La Pirámide (C2, C3).
3. El problema es de **fuente de restricciones**, no de motor. Dos vías compatibles: contribuir a OSM con fuente normativa, y mantener una capa propia de restricciones aplicada al recorte antes del build (`scripts/probes/osm-inject-hgv-no.py` es el prototipo del mecanismo).
4. HERE conoce la restricción de Camino La Pirámide sin dato propio (C1) y aplica perfil de velocidad de camión. Es el único de los tres motores que resuelve el caso reportado sobre su propio dato. Decisión en [ADR-084](../../docs/adr/084-ruteo-con-perfil-de-camion-para-chile.md).

## Abiertos para el ADR

- Cobertura de HERE fuera de este par: un origen→destino en Santiago no es cobertura. Lo exige la validación del ADR-084.
- Tráfico en tiempo real: OSRM no lo tiene. Opciones: híbrido (geometría legal de OSM, ETA de Google sobre esa polyline vía `intermediates`) o HERE.
- Restricciones horarias (`hgv:conditional`): OSRM no las modela; Valhalla sí parcialmente; HERE vía `departureTime`.
- Túnel San Cristóbal: ruta por defecto de auto y camión en OSRM y Google. Verificar si admite el camión de prueba y si OSM lo etiqueta.
- Perfil de producto: `truck.lua` derivado de `car.lua` es de sonda. Si el ADR elige OSM, comparar con Valhalla (costing `truck` nativo con alto, ancho, largo, peso y carga por eje).
