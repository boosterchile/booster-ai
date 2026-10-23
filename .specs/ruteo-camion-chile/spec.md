# Spec — Ruteo con perfil de camión para Chile (sonda HERE + OSRM)

| Campo | Valor |
|---|---|
| **Feature slug** | `ruteo-camion-chile` |
| **Fecha** | 2026-10-20 |
| **Estado** | Sonda cerrada el 2026-10-20 (C1–C4 resueltos en [`verify.md`](verify.md)). Decisión en [ADR-084](../../docs/adr/084-ruteo-con-perfil-de-camion-para-chile.md). |
| **Owner (PO)** | Felipe Vicencio — `dev@boosterchile.com` |
| **Origen** | Reporte del PO: la ruta eco-eficiente sugerida al conductor manda camiones por calles con restricción (caso: Camino La Pirámide). |
| **Rama** | `claude/focused-brown-peeabb` · PR #820 |
| **Frente** | Abierto por el PO el 2026-10-20 («abre la línea 2, solución real»). |

---

## 1. Contexto y problema

La ruta eco-eficiente se calcula con Google Routes API en `travelMode: DRIVE` fijo
([`routes-api.ts:165`](../../apps/api/src/services/routes-api.ts)). Los 8 llamadores
(`eco-route-preview`, `eco-routing-tiempo-real`, `get-assignment-eco-route`,
`persist-eco-route-polyline`, `compute-route-eta`, `calcular-metricas-viaje`,
`geocodificar-origen`, `backfill-distancia-adapters`) pasan por esa función. El vehículo
solo aporta `emissionType` para estimar litros; no se envían peso ni dimensiones.

**Sonda cerrada el 2026-10-20** (PR #820, run 39454217739, 7 POST reales): Google acepta
`travelMode: TRUCK` + `routeModifiers.vehicleInfo` en Chile sin error, pero devuelve
geometría byte a byte idéntica a `DRIVE` en los tres pares comparables. Con `avoidTolls`
manda un camión de 18 t por Camino La Pirámide igual que a un auto. Coincide con la
cobertura declarada de *large vehicle routing* (EE.UU. continental + Japón). **Cambiar
`travelMode` no resuelve el problema.**

## 2. Objetivo de esta fase

Determinar, con evidencia ejecutada y no con documentación, si alguno de estos dos
motores conoce las restricciones de camión en Santiago lo bastante como para fundar un
ADR de proveedor de ruteo:

1. **HERE Routing API v8**, `transportMode=truck` con `vehicle[grossWeight|height|width|length|axleCount]`.
2. **OSRM** auto-alojado sobre un recorte OSM de Santiago, con un perfil de camión derivado
   de `car.lua` (`hgv` primero en la jerarquía de acceso; alto 4,0 m, ancho 2,6 m,
   largo 12 m, peso 18 000 kg).

Además, y como dato de gobierno de ambos motores OSM, **qué dice OpenStreetMap** sobre
Camino La Pirámide (`hgv`, `maxweight`, `maxheight`, `access`) y cuántas vías del
recorte de Santiago llevan alguna de esas etiquetas. Sin esa etiqueta en OSM, ningún
motor OSM puede saber la restricción, y la decisión pasa a ser «contribuir el dato a OSM
o mantener una capa propia».

## 3. Entradas

- Par origen → destino: Ciudad Empresarial (Huechuraba) → Parque Bicentenario (Vitacura),
  geocodificado con Nominatim en el job; las mismas coordenadas alimentan a todos los
  motores (se evita comparar geocodificaciones distintas).
- Camión de prueba: rígido, 3 ejes, 18 t, 4,0 m alto, 2,6 m ancho, 12 m largo. Mismo
  vehículo que en la sonda Google.
- Casos por motor: auto / auto sin peajes / camión / camión sin peajes. En la sonda
  Google, «sin peajes» fue el único caso que forzó Camino La Pirámide (F/G).
- Credenciales: `HERE_API_KEY` como secreto de GitHub Actions (lo carga el PO; plan
  Base gratuito de HERE). Si falta, el job de HERE se omite con mensaje explícito y el
  resto corre igual. OSRM no requiere credenciales.

## 4. Salidas

Por motor y caso: HTTP, km, segundos, hash de la polyline o geometría, nombres de vía del
recorrido, `pasa_por_Piramide` (binario), y los avisos de restricción que el motor
devuelva (`notices` en HERE). Para OSM: etiquetas de las vías «Pirámide» y conteo de vías
con `hgv`/`maxweight`/`maxheight` en el recorte. Todo en el log del workflow y como
artefacto `probe-out`.

## 5. Criterios de éxito (binarios, antes del análisis fino)

| # | Criterio | Lectura |
|---|---|---|
| C1 | En HERE, el caso *camión sin peajes* evita Camino La Pirámide mientras *auto sin peajes* la usa, **o** HERE devuelve un `notice` de restricción violada sobre esa vía | HERE conoce la restricción en Chile → candidato viable |
| C2 | OSM tiene `hgv=no`, `maxweight` o `maxheight` en las vías de Camino La Pirámide | Un motor OSM puede saberla sin datos propios |
| C3 | En OSRM con el perfil de camión, *camión sin peajes* evita Camino La Pirámide mientras *auto sin peajes* la usa | El perfil derivado funciona sobre el dato existente |
| C4 | Si C2 falla pero C3 se hace pasar con una etiqueta `hgv=no` inyectada en el recorte (prueba de mecanismo) | El motor funciona; el problema es el dato |

La fase termina cuando C1, C2 y C3 están respondidos con una corrida real. No se escribe
el ADR hasta entonces.

## 6. Fuera de scope de esta fase

- Cambiar `routes-api.ts` o cualquier llamador. Nada llega a `main` ni a prod.
- Restricciones horarias (`hgv:conditional`): OSRM no las modela; HERE sí vía
  `departureTime`. Se anota como criterio del ADR, no de esta sonda.
- Costeo de proveedor y SLA: se hace en el ADR con el resultado en mano.

## 7. Riesgos conocidos

- Recorte OSM de Santiago (bbox −70,85/−33,65 a −70,45/−33,25) desde Geofabrik
  `chile-latest`: ~150–200 MB de descarga, extracción con `osmium`, dos builds de OSRM
  en el runner. Presupuesto: <15 min por corrida.
- El perfil de camión derivado de `car.lua` es de la sonda; no es el perfil de producto.
  Si el ADR elige OSM, el perfil se diseña aparte (o se evalúa Valhalla, que trae
  costing `truck` nativo).
