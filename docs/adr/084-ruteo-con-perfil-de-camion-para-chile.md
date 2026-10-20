# ADR-084 — Ruteo legal de camiones en Chile: capa normativa propia como autoridad y motor de ruteo intercambiable (HERE como primer adaptador)

**Estado**: Vigente
**Fecha**: 2026-10-20
**Decider**: Felipe Vicencio (Product Owner). Encargos del 2026-10-20: «abre la línea 2, arma la sonda contra HERE y OSRM, solución real»; «ya cargué HERE_API_KEY, relanza y redacta el ADR»; «tal vez hay una solución mejor a través de la página web del Ministerio de Transportes de Chile o de Vialidad».
**Supersede a**: nada. [ADR-038](./038-routes-api-adc-migration.md) sigue vigente para la autenticación de Google Routes API en los usos que conserva (§4).
**Relacionado**: [ADR-073](./073-tipologias-flota-configuracion-glec.md) (tipologías: fuente de los atributos del camión), [ADR-021](./021-glec-v3-compliance.md) (GLEC: combustible y huella desde la distancia), [ADR-076](./076-gobernanza-operador-unico.md) (vigencia), `.specs/ruteo-camion-chile/{spec,verify}.md`, PR #820

---

## Contexto

La ruta eco-eficiente que ve el conductor se calcula con Google Routes API en `travelMode: DRIVE` fijo ([`apps/api/src/services/routes-api.ts`](../../apps/api/src/services/routes-api.ts)); del vehículo solo viaja `emissionType`. Ocho llamadores pasan por esa función (`eco-route-preview`, `eco-routing-tiempo-real`, `get-assignment-eco-route`, `persist-eco-route-polyline`, `compute-route-eta`, `calcular-metricas-viaje`, `geocodificar-origen`, `backfill-distancia-adapters`). El resultado es una ruta de automóvil presentada como ruta de camión; el caso reportado por el PO es Camino La Pirámide.

`vehiculos` y las tipologías de ADR-073 no guardan peso bruto, ejes, dimensiones ni año de fabricación. Sin esos atributos ninguna regla de camión puede aplicarse.

### La norma

La restricción de La Pirámide no es una prohibición total sino **horaria y por clase de vehículo**. Transporte Informa (Seremitt RM) y el MTT la publican con remisión al **D.S. N°18/2001 del MTT**: camiones de PBV ≥ 3 860 kg no pueden circular por Américo Vespucio entre El Salto y Av. Santa María de lunes a viernes, 08:00–09:30 en ambos sentidos y 18:30–20:00 en sentido poniente→oriente; el MTT la fiscaliza con cámaras OCR. La misma fuente publica la restricción del interior del anillo Américo Vespucio: camiones de más de 2 ejes y/o PBV > 18 000 kg, lunes a viernes 07:30–10:00 y 18:00–20:30, salvo zonas industriales exclusivas y ciertas autopistas; y camiones de PBV > 3 860 kg con más de 12 años de antigüedad. A eso se suman resoluciones exentas puntuales de la Seremitt (Ruta 68; obras del Puente Lo Saldes) y los episodios ambientales por dígito. **No existe como dataset**: ni datos.gob.cl ni la UOCT publican un mapa; Ley Chile respondió por timeout en la sonda. Existe como un puñado de reglas en texto, con cita legal, estables en el tiempo. Vialidad (MOP) no publica un listado de gálibos ni de pesos por tramo; hay prohibiciones puntuales en puentes (Juan Pablo II, Concepción, Res. Ex. 247/2010).

### Evidencia ejecutada (2026-10-20, PR #820)

Par de prueba: Ciudad Empresarial (Huechuraba) → Parque Bicentenario (Vitacura), geocodificado una sola vez con Nominatim y compartido por los tres motores. Camión: 3 ejes, 18 000 kg, 4,0 × 2,6 × 12 m. «Sin peajes» es el caso que lleva a un automóvil por Camino La Pirámide.

| Pregunta | Resultado | Evidencia |
|---|---|---|
| ¿Google Routes API aplica `TRUCK` + `vehicleInfo` en Chile? | **No.** Geometría idéntica a `DRIVE`; sin peajes manda al camión por La Pirámide. Coincide con su cobertura declarada (EE.UU., Japón). | run 39454217739 |
| ¿OSM tiene la restricción en Camino La Pirámide? | **No.** 0/93 vías «Pirámide» con etiqueta de camión; el bbox de Santiago sí tiene 1 276 vías etiquetadas (325 `hgv=no`). | run 39461320020 |
| ¿Un motor OSM la respeta si el dato existe? | **Sí.** OSRM con perfil de camión y `hgv=no` inyectado evita la vía (12,01 km vs 9,68 km). El mecanismo funciona; falta el dato. | run 39461320020 |
| ¿HERE desvía al camión? | Sí: 14,66 km sin La Pirámide frente a 7,73 km del automóvil. | run 39461320020 intento 2 |
| ¿Por qué? ¿HERE modela el D.S. 18/2001? | **No.** Forzando al camión por la vía con `via`, HERE responde `truckAttributes: ["open"]` y ningún aviso de restricción, a las 15:32 y también con `departureTime` a las **08:30** (dentro de la ventana), 15:00 y 19:00. El desvío es costo del perfil de camión, no legalidad. | runs 39475241512 y 39476030415 |
| ¿Qué cobertura tiene HERE sobre las vías `hgv=no` de OSM? | **43 %** de las vías discriminantes (3 de 7; RM 3/6, Biobío 0/1; muestra de 16). | run 39475241512 |

Lectura: **ninguno de los tres motores es fuente de la legalidad de ruta en Chile.** Google no tiene el dato; OSM lo tiene a medias y no en el caso reportado; HERE lo tiene a medias y no modela el decreto del caso reportado. Los motores sí hacen bien lo suyo: dada una restricción explícita, la respetan (OSRM con la etiqueta; HERE con áreas a evitar en la petición). La fuente de las restricciones tiene que ser nuestra, y la fuente de esa fuente es la norma.

## Decisión

### 1. La autoridad sobre legalidad de ruta es una capa normativa propia, pequeña y versionada

Se crea el dominio canónico `restriccion-camion` en `packages/shared-schemas/src/domain/` y el algoritmo puro en un paquete `packages/ruteo-normativo/` (regla de CLAUDE.md: algoritmos en `packages/`, nada inline en services). Cada regla declara:

- **tramo o zona**: segmentos o polígono (WGS84), con sentido cuando aplica;
- **ventana**: días y horas en hora de Chile, con excepciones (feriados);
- **clase de vehículo alcanzada**: PBV mínimo, ejes, antigüedad, tipo; y exenciones (zonas industriales exclusivas, autopistas excluidas);
- **cita**: norma, artículo, URL oficial, fecha de verificación por el PO, vigencia.

Las primeras reglas son las tres de la Región Metropolitana publicadas por la Seremitt (La Pirámide, interior del anillo Vespucio, antigüedad > 12 años) más las resoluciones exentas vigentes que el PO confirme. El PO es el responsable de cada regla; se revisan al menos trimestralmente y cuando aparece una resolución nueva en el Diario Oficial. Contribuir a OSM las reglas verificadas es deseable y no es compromiso de este ADR.

### 2. El motor de ruteo es un adaptador intercambiable detrás de un contrato

Un puerto `RoutingEngine` en `apps/api/src/services/` con una obligación no negociable: **aceptar áreas o segmentos a evitar en tiempo de petición** y una hora de salida. Los motores que lo cumplen hoy son HERE Routing v8 (`avoid[areas]`, `departureTime`) y Valhalla (`exclude_polygons`, `date_time`). Google Routes no admite áreas a evitar, y OSRM solo excluye clases fijadas al construir el grafo: ninguno de los dos puede ser el motor de rutas de camión.

**HERE Routing v8 es el primer adaptador.** Razones: no exige infraestructura, trae tráfico y perfil de velocidad de camión, cubre parcialmente restricciones que la capa propia no tendrá al inicio (43 % sobre la muestra OSM), y geocodifica con la misma credencial. Valhalla auto-alojado es la alternativa documentada; se adopta si el costo por transacción de HERE supera el umbral que el PO fije en el spec de implementación o si una necesidad de control del grafo lo justifica. El cambio de motor no toca la capa normativa ni el validador.

### 3. Flujo de cálculo

1. Se determinan las reglas activas para la hora de salida del viaje y el vehículo (`reglasActivas(fechaHora, vehiculo)`).
2. Se llama al motor con los atributos del vehículo, `departureTime` y las zonas de las reglas activas como áreas a evitar.
3. **Toda ruta devuelta se valida** contra la capa (`validarRuta(polyline, reglasActivas)`), venga del motor que venga. Si viola una regla, se recalcula con el área bloqueada; si sigue violando, no hay ruta (§6).
4. Fuera de la ventana de una regla, la vía es legal y el motor puede usarla; no se prohíbe de más.

### 4. Google Routes API conserva dos usos y sale del resto

Geocodificación del origen (`geocodificar-origen`) hasta migrar a HERE Geocoding, y distancia de tramos ya recorridos (`calcular-metricas-viaje` sobre huecos de telemetría, `backfill-distancia-adapters`), donde se mide, no se recomienda. ADR-038 rige esa autenticación. `emissionType` y `FUEL_CONSUMPTION` desaparecen de `routes-api.ts` cuando salga el último llamador de rutas.

### 5. Atributos del camión en `vehiculos`, con defecto por tipología

Migración `expand` ([ADR-066](./066-db-migration-rollback-strategy.md)) con columnas nullable `peso_bruto_kg`, `ejes`, `alto_mm`, `ancho_mm`, `largo_mm`, `anio_fabricacion`. El año es obligatorio para la regla de antigüedad del anillo. Cuando faltan, se usa el perfil por defecto por tipología de ADR-073 definido en `packages/shared-schemas/src/domain/`, y la respuesta al conductor declara «atributos estimados». Sin vehículo asignado se usa el del candidato o el más restrictivo de la tipología del transportista. Nunca el perfil de automóvil. Los contratos de API y UI del alta de vehículo se fijan en el spec de implementación y los aprueba el PO ahí.

### 6. Degradación explícita

Si el motor no responde o no existe ruta que cumpla las reglas activas, el sistema **no** muestra una ruta de automóvil como ruta de camión: la vista del conductor dice «ruta no disponible» con destino y distancia estimada (`estimarDistanciaKm`), y el evento queda en logs y métrica.

### 7. Combustible estimado desde GLEC

`fuelL` del proveedor deja de usarse (`fuelLitersEstimated`, `combustibleL`). Se deriva de la distancia y los factores por tipología de `carbon-calculator` (ADR-021, ADR-073). Sin factor, `null`; nunca 0.

### 8. Credencial

`here-api-key` en Secret Manager (`local.secret_names`, `infrastructure/security.tf`), montada como `HERE_API_KEY` en `service_api`, validada por Zod en `config.ts`, restringida en la consola de HERE a Routing y Geocoding; OAuth 2.0 con credenciales de cliente si el plan lo ofrece. El secreto de GitHub Actions existe solo para las sondas y se retira al cerrar el PR #820.

### 9. Mitigación inmediata

Mientras la capa normativa y el adaptador no estén en producción, la tarjeta de ruta eco del conductor declara que la ruta es referencial y no considera restricciones de camión. Es la primera tarea del spec de implementación.

## Alternativas consideradas

| Alternativa | Veredicto | Razón |
|---|---|---|
| Confiar la legalidad al proveedor (Google `TRUCK`, HERE `truck`, OSM) | Descartada | Ninguno modela el D.S. 18/2001; coberturas parciales medidas (OSM 0/93 en La Pirámide, HERE 43 % sobre OSM). |
| Capa normativa propia aplicada dentro del grafo de OSRM (inyección al construir) | No perseguida | Funciona (C4) pero no admite ventanas horarias ni cambios sin rebuild; la capa en tiempo de petición lo resuelve con cualquier motor que acepte áreas a evitar. |
| Lista manual de tramos sobre Google (waypoints) | Descartada | Google no admite áreas a evitar; frágil y sin horarios. |
| Valhalla auto-alojado como primer motor | Alternativa vigente | Equivalente en capacidad (polígonos a evitar, fecha-hora, costing truck); sin tráfico propio y con infraestructura y rebuild de tiles a cargo nuestro. Se adopta por costo o control. |
| HERE como primer adaptador detrás de capa normativa propia | **Elegida** | Tráfico y perfil de camión sin infraestructura; áreas a evitar y `departureTime` en la petición; cobertura parcial adicional. |

## Consecuencias

### Positivas

- La legalidad de la ruta deja de depender de un proveedor y pasa a citar la norma; cada regla es auditable.
- El motor es reemplazable sin tocar reglas ni validador.
- Fuera de ventana, la vía se usa: no se penaliza de más al transportista.
- Los atributos del camión pasan a ser dato de producto, reutilizable por matching y huella.

### Negativas

- **Booster mantiene reglas legales.** Es un puñado, con cita y revisión trimestral, pero es una responsabilidad nueva del PO; una regla desactualizada es un error nuestro, no del proveedor.
- **Proveedor y costo nuevos** (HERE por transacción, según plan); se dimensiona con el conteo real de llamadas de `routes-api.ts` y se acota con presupuesto y alerta.
- **Captura de atributos en el alta de vehículo**, incluido el año, con contrato de UI y API que el PO aprueba en el spec.
- **Doble proveedor durante la transición** (§4), deliberado y acotado.
- La capa normativa nace con la Región Metropolitana; regiones entran a medida que el PO confirme sus resoluciones.

## Validación

- [ ] Spec de implementación `.specs/ruteo-camion-normativo/spec.md` con criterios de salida y contratos (schema `vehiculos`, API, UI) aprobados por el PO.
- [ ] Capa normativa con las tres reglas de la RM, cada una con cita, URL oficial y fecha de verificación del PO; tests con rojo exhibido para `reglasActivas` y `validarRuta` (dominio crítico).
- [ ] Sonda sobre el par de La Pirámide con la capa activa: a las 08:30 la ruta de camión evita el tramo y la validación pasa; a las 15:00 la validación acepta una ruta que lo use.
- [ ] Adaptador HERE con Zod en el límite, timeout 10 s, span y métrica; áreas a evitar y `departureTime` en cada petición.
- [ ] `here-api-key` en Secret Manager y `HERE_API_KEY` en `config.ts`; clave restringida; secreto de GitHub Actions retirado.
- [ ] Degradación probada: motor caído o ruta imposible → «ruta no disponible», sin ruta de automóvil.
- [ ] Aviso en la tarjeta de ruta eco desplegado antes que la migración.
- [ ] Workflows de sonda (`probe-routes-truck.yml`, `probe-truck-engines.yml`, `probe-here-why.yml`, `probe-normativa.yml`) eliminados antes del merge del PR #820.
