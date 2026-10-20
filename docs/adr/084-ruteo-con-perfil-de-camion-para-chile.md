# ADR-084 — Ruteo con perfil de camión para Chile: HERE Routing v8 como motor de ruta legal y ETA

**Estado**: Vigente
**Fecha**: 2026-10-20
**Decider**: Felipe Vicencio (Product Owner). Encargos del 2026-10-20: «abre la línea 2, arma la sonda contra HERE y OSRM, solución real» y «ya cargué HERE_API_KEY, relanza y redacta el ADR».
**Supersede a**: nada. [ADR-038](./038-routes-api-adc-migration.md) sigue vigente para la autenticación de Google Routes API en los usos que conserva (§2).
**Relacionado**: [ADR-073](./073-tipologias-flota-configuracion-glec.md) (tipologías de flota: fuente de los atributos del camión), [ADR-021](./021-glec-v3-compliance.md) (GLEC v3.0: combustible y huella se derivan de la distancia, no del proveedor de rutas), [ADR-076](./076-gobernanza-operador-unico.md) (vigencia), `.specs/ruteo-camion-chile/{spec,verify}.md`, PR #820

---

## Contexto

La ruta eco-eficiente que ve el conductor se calcula con Google Routes API en `travelMode: DRIVE` fijo ([`apps/api/src/services/routes-api.ts`](../../apps/api/src/services/routes-api.ts)). Del vehículo solo viaja `emissionType`, para que Google estime litros. Ocho llamadores pasan por esa función: `eco-route-preview`, `eco-routing-tiempo-real`, `get-assignment-eco-route`, `persist-eco-route-polyline`, `compute-route-eta`, `calcular-metricas-viaje`, `geocodificar-origen` y `backfill-distancia-adapters`. El resultado es una ruta de automóvil presentada como ruta de camión: el caso reportado por el PO es Camino La Pirámide, con restricción de tránsito pesado.

Las tablas `vehiculos` y las tipologías de ADR-073 no guardan peso bruto, alto, ancho, largo ni ejes. Sin esos atributos ningún motor puede aplicar restricciones de camión aunque las conozca.

### Evidencia (sondas ejecutadas el 2026-10-20, PR #820)

Par de prueba: Ciudad Empresarial (Huechuraba) → Parque Bicentenario (Vitacura), geocodificado una sola vez con Nominatim (`-33.389802,-70.618360` → `-33.400576,-70.602485`). Camión: rígido, 3 ejes, 18 000 kg, 4,0 × 2,6 × 12 m. En los tres motores, «sin peajes» es el único caso que lleva a un automóvil por Camino La Pirámide; es la condición que discrimina.

| Criterio del spec | Resultado | Evidencia |
|---|---|---|
| Google Routes API, `travelMode: TRUCK` + `vehicleInfo` | **No cambia nada en Chile.** Acepta el modo sin error y devuelve geometría idéntica a `DRIVE` en los tres pares comparables; sin peajes manda al camión por Camino La Pirámide. Coincide con su cobertura declarada (EE.UU. continental, Japón). | run 39454217739, 7 POST |
| C2 — OSM tiene la restricción en Camino La Pirámide | **No.** 0 de 93 vías «Pirámide» con `hgv`, `maxweight`, `maxheight` o `hgv:conditional`. El bbox de Santiago sí tiene 1 276 vías etiquetadas (325 con `hgv=no`). | run 39461320020, Overpass |
| C3 — OSRM con perfil de camión sobre el dato actual | **No.** Camión sin peajes = automóvil sin peajes, 9,68 km por Camino La Pirámide. | run 39461320020 |
| C4 — OSRM con `hgv=no` inyectado en esa vía | **Sí.** 12,01 km por El Salto → Las Torres → Av. Perú → Domínica → Purísima. El motor funciona; falta el dato. | run 39461320020 |
| C1 — HERE Routing v8, `transportMode=truck` + `vehicle[...]` | **Sí, con dato propio.** Automóvil sin peajes: 7,73 km por Camino La Pirámide y Calle La Pirámide. Camión sin peajes: 14,66 km / 2 182 s por El Salto → Las Torres → Av. Perú → Domínica → Purísima → Santa María → Costanera Norte, sin «Pirámide». Con peajes, misma geometría para ambos y duración de camión mayor (642 s vs 490 s). Sin `notices` de restricción violada. | run 39461320020 intento 2 |

Lectura: el problema no era de motor sino de **fuente de restricciones**. Google no la tiene para Chile. OSM tiene el mecanismo pero no el dato en este tramo, y mantenerlo convertiría a Booster en la fuente de verdad de la legalidad de ruta. HERE trae el dato.

Límite de la evidencia: un par origen→destino, en Santiago, un día. Es suficiente para elegir dirección; no para declarar cobertura. La validación (§final) exige ampliarla antes de producción.

## Decisión

### 1. HERE Routing v8 es el motor de toda ruta que un camión va a seguir

Toda llamada que produce una **ruta a seguir** o un **ETA sobre esa ruta** se hace a HERE Routing v8 con `transportMode=truck` y los atributos del vehículo (`vehicle[grossWeight]`, `vehicle[height]`, `vehicle[width]`, `vehicle[length]`, `vehicle[axleCount]`, `vehicle[type]`), con `departureTime` explícito para que apliquen restricciones horarias y tráfico. Alcanza a `eco-route-preview`, `get-assignment-eco-route`, `persist-eco-route-polyline`, `eco-routing-tiempo-real` y `compute-route-eta`.

El cliente HERE vive en `apps/api/src/services/` como función pura con `fetch` inyectable, igual que `routes-api.ts`; la respuesta cruza el límite por un esquema Zod (no por `as`), con timeout duro de 10 s, span OTel y métrica de negocio. `notices` con `severity: critical` o un código de restricción violada se tratan como ruta inválida, no como ruta.

### 2. Google Routes API sale del cálculo de rutas de camión; conserva dos usos

- **Geocodificación del origen** (`geocodificar-origen`), hasta que una tarea aparte la mueva a HERE Geocoding con la misma credencial. No es una decisión de legalidad.
- **Distancia de tramos ya recorridos** (`calcular-metricas-viaje` sobre huecos de telemetría, `backfill-distancia-adapters`). El vehículo ya pasó por ahí; se mide, no se recomienda. Puede migrar después por homogeneidad, no por este ADR.

ADR-038 sigue rigiendo la autenticación de esos usos. Cuando el último llamador de rutas de camión salga de Google, `emissionType` y `FUEL_CONSUMPTION` desaparecen de `routes-api.ts`.

### 3. Los atributos del camión viven en `vehiculos`, con defecto por tipología

Se agregan a `vehiculos`, en migración `expand` ([ADR-066](./066-db-migration-rollback-strategy.md)): `peso_bruto_kg`, `alto_mm`, `ancho_mm`, `largo_mm`, `ejes`, todos nullable. Cuando el transportista no los cargó, se usa un perfil por defecto **por tipología** de ADR-073 (`tipo_unidad` + `tipo_carroceria`; `tipo_vehiculo` para filas legacy), definido como dato canónico en `packages/shared-schemas/src/domain/`, y la respuesta al conductor declara que la ruta se calculó con atributos estimados. Sin vehículo asignado (vista previa de una oferta), se calcula con el perfil del vehículo candidato o, si no hay, con el más restrictivo de la tipología del transportista. Nunca con el perfil de automóvil.

Los contratos de API y de UI del alta de vehículo que capturan estos campos se fijan en el spec de implementación y los aprueba el PO ahí; este ADR fija que existen y de dónde salen los defectos.

### 4. El combustible estimado deja de venir del proveedor de rutas

`fuelL` de Google alimenta hoy `fuelLitersEstimated` (`eco-route-preview`) y `combustibleL` (`eco-routing-tiempo-real`). Pasa a derivarse de la distancia y los factores de consumo por tipología de `carbon-calculator` (ADR-021, ADR-073), la misma base de la huella. Si no hay factor para la tipología, el campo queda `null`; no se rellena con 0.

### 5. Degradación: sin HERE no hay ruta, y se dice

Si HERE no responde (timeout, 5xx, cuota), el sistema **no** presenta una ruta de automóvil como ruta de camión. La vista del conductor muestra «ruta no disponible» con destino y distancia estimada (`estimarDistanciaKm`), las métricas usan esa estimación como hoy, y el evento queda en logs y métrica. La degradación es explícita, nunca silenciosa.

### 6. Credencial

La clave de HERE vive en Secret Manager (`here-api-key` en `local.secret_names`, `infrastructure/security.tf`), montada como `HERE_API_KEY` en `service_api` y validada por Zod en `config.ts`. Se restringe en la consola de HERE a Routing y Geocoding. Si HERE ofrece OAuth 2.0 con credenciales de cliente para el plan contratado, se prefiere a la clave estática, en línea con ADR-001; la sonda usó clave porque es lo que HERE exige en la URL. El secreto `HERE_API_KEY` de GitHub Actions existe solo para las sondas y se retira al cerrar el PR #820.

### 7. OSM con capa propia de restricciones: no perseguido como motor; conservado como contingencia

C4 demostró que OSRM con un perfil de camión y una capa propia de restricciones (`scripts/probes/osm-inject-hgv-no.py`) resuelve Camino La Pirámide. No se adopta porque exigiría mantener la fuente legal de restricciones, no tiene tráfico y hoy el dato no existe en OSM. Se conserva el prototipo en el repo como salida de emergencia documentada. Se reabre solo si la validación de cobertura de HERE falla en un caso real o si el costo por transacción supera lo que el PO fije en el spec de implementación. Contribuir a OSM las restricciones verificadas con fuente normativa es deseable y no es compromiso de este ADR.

### 8. Mitigación inmediata, antes de la migración

Mientras HERE no esté en producción, la tarjeta de ruta eco del conductor declara que la ruta es referencial y no considera restricciones de camión. Es la línea 1 de las propuestas del 2026-10-20 y entra como primera tarea del spec de implementación.

## Alternativas consideradas

| Alternativa | Veredicto | Razón |
|---|---|---|
| Google Routes API, `travelMode: TRUCK` + `vehicleInfo` | Descartada | Evidencia: no cambia la ruta en Chile; cobertura declarada EE.UU. y Japón; acceso por solicitud. |
| OSRM o Valhalla auto-alojados + capa propia de restricciones | No perseguida ahora (§7) | Motor funciona (C4); dato ausente en OSM (C2); sin tráfico; Booster como fuente legal. |
| Lista manual de tramos prohibidos aplicada sobre Google (zonas a evitar / waypoints) | Descartada | Frágil, no escala, no cubre horarios ni dimensiones, y sigue calculando con perfil de automóvil. |
| HERE Routing v8 `truck` | **Elegida** | Conoce la restricción sin dato propio (C1), tráfico y restricciones horarias en el mismo proveedor, perfil de velocidad de camión. |

## Consecuencias

### Positivas

- La ruta sugerida al conductor deja de depender de que el conductor sepa por dónde no puede pasar.
- Un solo proveedor para ruta legal, ETA y, después, geocodificación.
- Los atributos del camión pasan a ser dato de producto, reutilizable por matching y por la huella (ADR-073).
- El combustible estimado y la huella salen de la misma base (GLEC), sin depender de un extra computation de Google.

### Negativas

- **Proveedor y costo nuevos**: HERE cobra por transacción según el plan contratado por el PO; el volumen mensual se dimensiona en el spec de implementación con el conteo real de llamadas de `routes-api.ts` en producción, y se acota con presupuesto y alerta, como con las APIs de Google.
- **Doble proveedor durante la transición** (§2). Es deliberado y acotado a geocodificación y tramos recorridos.
- **Cobertura verificada en un par**. La validación exige ampliarla; hasta entonces, la migración no se despliega.
- **Captura de atributos en el alta de vehículo**: trabajo de UI y API con contrato que el PO aprueba en el spec.
- **Clave estática** si HERE no ofrece OAuth 2.0 en el plan; mitigado por Secret Manager, restricción por servicio y rotación.

## Validación

- [ ] Spec de implementación `.specs/ruteo-camion-here/spec.md` con criterios de salida, contratos de schema (`vehiculos`), API y UI aprobados por el PO.
- [ ] Sonda de cobertura ampliada: al menos 10 pares origen→destino en la Región Metropolitana y 3 en regiones, con restricciones conocidas por el PO o los transportistas, automóvil vs camión, registrada en `.specs/ruteo-camion-chile/verify.md`.
- [ ] Cliente HERE con Zod en el límite, timeout 10 s, span y métrica, y tests con rojo exhibido (dominio crítico: pricing/matching dependen de la distancia).
- [ ] `here-api-key` en Secret Manager y `HERE_API_KEY` en `config.ts`; clave restringida en la consola de HERE; secreto de GitHub Actions retirado.
- [ ] Degradación probada: HERE caído → «ruta no disponible», sin ruta de automóvil.
- [ ] Aviso en la tarjeta de ruta eco desplegado antes que la migración.
- [ ] Workflows de sonda `probe-routes-truck.yml` y `probe-truck-engines.yml` eliminados antes del merge del PR #820.
