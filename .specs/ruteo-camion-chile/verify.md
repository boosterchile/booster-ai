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
| C1 | HERE conoce la restricción en Chile | **No** (corregido 2026-10-20 18:35 UTC) | HERE desvía al camión (14,66 km sin La Pirámide vs 7,73 km del auto), pero al forzarlo por la vía responde `truckAttributes: ["open"]` y ningún notice, a las 15:32 y con `departureTime` 08:30 / 15:00 / 19:00 (run 39476030415). No modela el D.S. 18/2001; el desvío es costo del perfil de camión. Cobertura sobre vías `hgv=no` de OSM: 43 % (3/7, run 39475241512). |
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

### Causa del desvío y ventana horaria (runs 39475241512 y 39476030415)

Camión forzado por `via=-33.377440,-70.617130` (punto medio del span «Camino La Pirámide» de la ruta de auto sin peajes), `spans=names,truckAttributes`:

| departureTime (Chile) | Ventana D.S. 18/2001 | span Camino La Pirámide | notices | camión libre sin peajes |
|---|---|---|---|---|
| sin indicar (15:32) | fuera | `["open"]` | ninguno de restricción | 14,66 km, evita La Pirámide |
| 2026-10-21 08:30 | **dentro (AM, ambos sentidos)** | `["open"]` | ninguno | 12,65 km, evita La Pirámide |
| 2026-10-21 15:00 | fuera | `["open"]` | ninguno | 14,66 km, evita La Pirámide |
| 2026-10-21 19:00 | dentro (PM, poniente→oriente) | `["open"]` | ninguno | 14,66 km, evita La Pirámide |

Conclusión: HERE no modela el decreto; el desvío del camión es costo de su perfil (la ruta libre cambia con el tráfico: 12,65 km a las 08:30), no una restricción.

### Cobertura de HERE con oráculo OSM (run 39475241512)

Muestra: vías vehiculares con `hgv=no` / `maxheight` < 4 m / `maxweight` < 18 t, ≥ 150 m, determinista por id. Par por vía: extremos prolongados 700 m (o 300 m) más allá de la vía. Pertenencia por distancia nodo→segmento ≤ 30 m sobre la *flexible polyline* decodificada.

| Región | muestra | discriminantes (auto usa la vía) | camión la evita | cobertura |
|---|---|---|---|---|
| RM | 10 | 6 | 3 (Europa, Av. Príncipe de Gales, Los Loros) | 50 % |
| Valparaíso | 3 | 0 | – | sin dato |
| Biobío | 3 | 1 | 0 (Eugenio Orrego Vicuña) | 0 % |
| **Total** | 16 | 7 | 3 | **43 %** |

Caveats: muestra chica; el oráculo OSM tiene calidad desconocida; 9 pares no fueron discriminantes (el auto tampoco usó la vía con las prolongaciones probadas).

### Fuente oficial (run 39475723418)

Transporte Informa (Seremitt RM), con remisión al D.S. 18/2001 del MTT: La Pirámide (Vespucio entre El Salto y Santa María) prohibida a camiones L–V 08:00–09:30 ambos sentidos y 18:30–20:00 poniente→oriente. Interior del anillo Vespucio: camiones > 2 ejes y/o PBV > 18 000 kg, L–V 07:30–10:00 y 18:00–20:30, salvo zonas industriales exclusivas (Cerro Navia, Conchalí, Pudahuel, Quilicura, Renca) y las autopistas Ruta 5 Norte/Sur y el eje Cerrillos–General Velázquez–Walker Martínez–Apóstol Santiago; además PBV > 3 860 kg con más de 12 años. MTT (nota de prensa, cámaras OCR): PBV ≥ 3 860 kg. Ley Chile: timeout. Subtrans: no disponible. No existe dataset abierto (datos.gob.cl, UOCT); Vialidad sin listado de gálibos/pesos.

## Conclusión de la fase

1. Google Routes API no conoce restricciones de camión en Chile (sonda 1). Descartado como motor de legalidad de ruta; sigue siendo la fuente de tráfico y ETA.
2. Un motor OSM funciona en cuanto la restricción existe en el dato (C4). Hoy no existe para Camino La Pirámide (C2, C3).
3. El problema es de **fuente de restricciones**, no de motor. Dos vías compatibles: contribuir a OSM con fuente normativa, y mantener una capa propia de restricciones aplicada al recorte antes del build (`scripts/probes/osm-inject-hgv-no.py` es el prototipo del mecanismo).
4. HERE **no** modela el D.S. 18/2001 (C1 corregido) y cubre 43 % de una muestra de vías `hgv=no`. Ninguno de los tres motores es fuente de la legalidad de ruta en Chile; la fuente es la norma (Seremitt/MTT), que existe como un puñado de reglas horarias y por clase de vehículo. Decisión en [ADR-084](../../docs/adr/084-ruteo-con-perfil-de-camion-para-chile.md): capa normativa propia como autoridad, validador de rutas, motor intercambiable con HERE como primer adaptador.

## Abiertos para el ADR

- Cobertura de HERE: 43 % sobre OSM `hgv=no` (muestra de 16). Con la capa normativa propia, la cobertura del motor deja de ser el criterio de legalidad.
- Tráfico en tiempo real: OSRM no lo tiene. Opciones: híbrido (geometría legal de OSM, ETA de Google sobre esa polyline vía `intermediates`) o HERE.
- Restricciones horarias (`hgv:conditional`): OSRM no las modela; Valhalla sí parcialmente; HERE vía `departureTime`.
- Túnel San Cristóbal: ruta por defecto de auto y camión en OSRM y Google. Verificar si admite el camión de prueba y si OSM lo etiqueta.
- Perfil de producto: `truck.lua` derivado de `car.lua` es de sonda. Si el ADR elige OSM, comparar con Valhalla (costing `truck` nativo con alto, ancho, largo, peso y carga por eje).
