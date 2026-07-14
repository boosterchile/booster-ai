# Mapa AVL — trazabilidad elemento → consumidor (Fase D)

**Fecha:** 2026-07-13 · Auditoría READ-ONLY · Evidencia literal `archivo:línea`.
Este documento es el **legible y diffeable** que debe acompañar al `.cfg` binario del FMC150.

## Cómo leer este mapa: hay TRES rutas de datos (no confundir)

1. **GPS / estructural** — campos fijos del record (no son IO IDs). Van a **columnas dedicadas** de `telemetria_puntos`.
2. **In-flight** — decodificado sobre el `AvlPacket` parseado en el gateway/processor, **antes/independiente** del blob `io_data`. Es la ruta de crash-trace y green-driving.
3. **At-rest** — leído desde la columna `io_data` (jsonb `{ "<id>": value }`) de `telemetria_puntos`. **Único lector de producción: IO 72 (temperatura).**

`telemetria_puntos` (14 columnas): `apps/api/drizzle/0005_dispositivos_telemetria.sql:61-77` y `apps/api/src/db/schema.ts:1713-1743`.
Escritura: `apps/telemetry-processor/src/persist.ts:72-90` — GPS→columnas, IO→`io_data` blob crudo, `event_io_id`→columna.

---

## Tabla maestra

| AVL ID | Nombre | Ruta | Reconocido en (archivo:línea) | Destino / columna | Consumidor de PRODUCCIÓN (archivo:línea) | Veredicto |
|---|---|---|---|---|---|---|
| — | longitude/latitude | GPS | `avl-packet.ts:137-152` | `longitud`,`latitud` | `calcular-cobertura-telemetria.ts:139-169` (cobertura) → cert `calcular-metricas-viaje.ts:506` | **CONSUMIDO** (cobertura/cert) |
| — | altitude/angle/satellites/speedKmh | GPS | `avl-packet.ts:137-152` | `altitud_m`,`rumbo_deg`,`satelites`,`velocidad_kmh` | Devueltos crudos en `GET /vehiculos/:id/telemetria` (`vehiculos.ts:1196-1233`) | **CONSUMIDO parcial** (trail UI; no alimentan el cálculo) |
| — | priority | estructural | `avl-packet.ts:122-129` | `prioridad` | crash: `priority===2` (`crash-trace.ts:122`) | **CONSUMIDO** |
| — | eventIoId | estructural | `avl-packet.ts:157` | `event_io_id` | crash `eventIoId===247`; trail crudo | **CONSUMIDO parcial** (no decodificado como semántica) |
| **72** | Dallas Temperature 1 | at-rest | catálogo `dallas-temperature.ts:39-44` | `io_data['72']` | `vehiculos.ts:198-206, 1332, 1380` (`interpretDallasTemperature`) → `temperatura_c` | **CONSUMIDO** (único lector de `io_data`) |
| **253** | Green Driving Type | in-flight | `green-driving.ts:53` | tabla aparte | `persist-green-driving.ts:88,107` → `eventos_conduccion_verde` | **CONSUMIDO** |
| **254** | Green Driving Value | in-flight | `green-driving.ts:56` | tabla aparte | `persist-green-driving.ts:88` (severidad) | **CONSUMIDO** |
| **255** | Over-Speeding | in-flight | `green-driving.ts:59` | tabla aparte | `persist-green-driving.ts:88,107` | **CONSUMIDO** |
| **247** | Crash event | in-flight | `crash-trace.ts:40` | GCS + BigQuery | `telemetry-processor/src/main.ts:205` → `persist-crash-trace.ts:130,183` | **CONSUMIDO** |
| **17/18/19** | Acelerómetro X/Y/Z | in-flight | `crash-trace.ts:43-47` | dentro del crash trace | `crash-trace.ts:223-246` (extractCrashTrace) | **CONSUMIDO** — pero IDs **NO VERIFICADOS** vs device real (`crash-trace.ts:29-32`) |
| **239** | Ignition | (catálogo) | `low-priority.ts:40` | — | **ninguno** (solo tests) | **HUÉRFANO** (catálogo muerto) |
| **240** | Movement | (catálogo) | `low-priority.ts:41` | — | **ninguno** | **HUÉRFANO** |
| **16** | Total Odometer | (catálogo) | `low-priority.ts:51` (doc: "GLEC distance") | — | **ninguno** | **HUÉRFANO** (¡lo relevante para GLEC!) |
| **199** | Trip Odometer | (catálogo) | `low-priority.ts:52` | — | **ninguno** | **HUÉRFANO** |
| **24** | Speed (IO) | (catálogo) | `low-priority.ts:50` (doc: "GLEC") | — | **ninguno** | **HUÉRFANO** |
| **66** | External Voltage | (catálogo) | `low-priority.ts:47` (doc: "unplug") | — | **ninguno** | **HUÉRFANO** |
| **67/68** | Battery V / Current | (catálogo) | `low-priority.ts:48-49` | — | **ninguno** | **HUÉRFANO** |
| **200/21/69/181/182/80** | Sleep/GSM/GNSS status/PDOP/HDOP/DataMode | (catálogo) | `low-priority.ts:42-49,53` | — | **ninguno** | **HUÉRFANO** |
| **252** | Unplug | (catálogo) | `high-panic.ts` | — | **ninguno** (`routeEvent` sin uso prod) | **HUÉRFANO** |
| **318/246/175/251/250/155** | Jamming/Towing/AutoGeofence/Idling/Trip/GeofenceZone | (catálogo) | `high-panic.ts:31-42` | — | **ninguno** | **HUÉRFANO** |
| **73/74/75** | Dallas Temp 2/3/4 | (catálogo) | `dallas-temperature.ts:39-44` | — | **ninguno** (solo 72) | **HUÉRFANO** |
| **CAN** | **Combustible/RPM/EngineLoad/VIN/etc.** | at-rest (si llegara) | **habilitado en `.cfg` (Configurator, PO); NO en catálogo `avl-ids/`** | — | **ninguno** | **AUSENTE en datos** — 0 en 260k filas/2 meses (`delta.md`); habilitado pero no llega |

Barrido de consumidores del catálogo `avl-ids/` (prod, sin tests/dist): solo `interpretDallasTemperature` en `vehiculos.ts:11,204`. `interpretLowPriority` y `routeEvent` → **cero imports de producción** (solo `packages/shared-schemas/test/…`). Los IDs de crash/green driving se consumen por la vía `codec8-parser`, **no** por el `event-router` de `avl-ids/` → hay **doble implementación** (una viva, otra muerta).

---

## Respuestas a las 5 preguntas de la Fase D

### 1. ¿Qué elementos AVL consume HOY el pipeline?
Solo estos tienen consumidor de producción: **GPS** (cobertura/cert + trail), **priority/eventIoId** (routing crash), **IO 72** (temperatura → endpoint ubicación), **IO 253/254/255** (green driving → `eventos_conduccion_verde`), **IO 247+17/18/19** (crash → BigQuery). **Todo lo demás en `io_data` se almacena y no lo lee nadie.**

### 2. ¿Qué campos exige el cálculo de huella, y de qué elemento AVL vendrían?
**El cálculo de huella hoy NO consume NINGÚN elemento AVL para el número de emisiones.** Usa: perfil declarado del vehículo (`fuelType`, `consumption_l_por_100km`) + `cargoKg` declarado + distancia de `routes_api`/`estimarDistanciaKm` (`calcular-metricas-viaje.ts:141,234-273,325`). El único vínculo telemetría→ESG es **GPS→cobertura%**, que solo modula el **nivel de certificado** (ADR-028 §5), no el número.
El modo de máxima precisión `exacto_canbus` (`carbon-calculator/src/modos/exacto-canbus.ts`) **necesitaría**: `combustibleConsumido` (elemento **CAN de combustible**) + distancia GPS real. Ninguno está cableado.

### 3. Elementos que el parser reconoce pero NADIE consume → candidatos a deshabilitar en el `.cfg`
Todo el catálogo Low Priority (**239, 240, 200, 21, 69, 181, 182, 66, 67, 68, 24, 16, 199, 80**), la mayoría de High-Panic (**252, 318, 246, 175, 251, 250, 155**) y Dallas **73/74/75**. Están definidos y testeados pero sin consumidor.
**Cautela (no podar a ciegas):** varios son de valor inminente y su desactivación cortaría una serie: **16/24** (distancia GLEC medida), **66** (detección unplug), **239/240** (trip state machine), **72** (ya consumido, mantener). La decisión de deshabilitar debe cruzarse con la intención de producto, no solo con "quién lo lee hoy".

### 4. Campos que la huella NECESITA → **CORREGIDO con verificación en datos (ver `delta.md`)**
**Combustible real vía CAN-BUS.** Corrijo el framing previo ("sin elemento / sin ruta"): el `.cfg` **operativo** (`FMC150_Booster_Wave3_1.cfg`, cargado hace ~2 meses) **SÍ habilita** los parámetros CAN (Fuel Consumed, Fuel Level ltr/%, Engine RPM, Engine Load, VIN, etc., Configurator → CAN I/O, Low), y la **ruta de almacenamiento existe** (`io_data` guarda cualquier ID crudo). Los tres huecos reales, verificados:
1. **El dato NO llega** pese a estar habilitado: 0 elementos CAN en `io_data` en **260k filas / 2 meses** (`delta.md`). El publisher no filtra (`pubsub-publisher.ts:48-55`) → causa raíz en la capa **CAN-hardware/OEM** (archivo OEM `Desconocido ID:0` sin diccionario del bus Scania, o cableado CAN1H pin12 / CAN1L pin6), **no** en la config (opción 2). Se recarga por FOTA.
2. **El catálogo `avl-ids/` no tiene esos IDs** (no hay `AVL_ID.FUEL_*`).
3. **Nadie construye `metodo:'exacto_canbus'`** (`calcular-metricas-viaje.ts:26-27`).
Consecuencia: para las filas existentes **no hay backfill** (el dato nunca se capturó); `exacto_canbus` será computable **hacia adelante**, desde que el CAN se decodifique. El backend (huecos 2 y 3: catálogo + ruteo) **no depende del `.cfg`** → se construye **en paralelo ahora** para estar listo cuando el CAN empiece a llegar. Secundariamente: **odómetro 16** (distancia GLEC medida) llega pero tampoco se consume.

### 5. ¿El esquema distingue procedencia (can/gnss_estimate/distance_model)?
**SÍ, y ricamente (ADR-028).** Dos ejes ortogonales + nivel derivado anti-greenwashing:
- `MetodoPrecision` (`carbon-calculator/src/tipos.ts:50`): `exacto_canbus` | `modelado` | `por_defecto`.
- `RouteDataSource` (`tipos.ts:69`): `teltonika_gps` | `maps_directions` | `manual_declared`.
- `NivelCertificacion` **derivado** (`tipos.ts:84`, `derivarNivelCertificacion`), no self-declarado.
Un "litro medido" (`exacto_canbus`) es arquitectónicamente distinto de un "litro estimado" (`modelado`/`por_defecto`) → **el esquema es auditable**. **Pero** hoy se fija `routeDataSource='maps_directions'` y `coveragePct=0` pre-entrega (`calcular-metricas-viaje.ts:294-295`) y nunca se usa `exacto_canbus` → **ningún certificado alcanza `primario_verificable`**; el path post-entrega (`recalcularNivelPostEntrega`, `:411-555`) promueve a `teltonika_gps` + cobertura real, pero sin `exacto_canbus` el techo queda en `secundario_modeled`.

---

## Criterio "cero huérfanos en ambas direcciones" — estado actual

| Dirección | Estado | Detalle |
|---|---|---|
| Todo elemento habilitado en el `.cfg` tiene consumidor demostrable | **VIOLADO (masivo)** | Casi nada del catálogo se consume; el `.cfg` (Codec 8E, muchos IO) alimenta un `io_data` que solo se lee para IO 72 |
| Todo campo que la huella necesita tiene un AVL habilitado que lo provee | **VIOLADO** | Combustible CAN (para `exacto_canbus`): sin elemento y sin ruta |

### Implicación directa para el `.cfg` (lo que pediste que este mapa determine)
- **Mantener habilitados:** los que hoy sí sirven — **72** (temp), **253/254/255** (green driving), **247 + acelerómetro** (crash; **confirmar los IDs reales de acelerómetro** primero, hoy asumidos 17/18/19), y el GPS.
- **Habilitar y CABLEAR (hueco de producto):** un **elemento CAN de combustible** (+ **16/24** para distancia/velocidad medidas) si el objetivo es certificado `primario_verificable`. Requiere: (a) elegir el/los AVL ID de combustible del FMC150 (CAN adapter), (b) agregarlo al catálogo `avl-ids/`, (c) construir `metodo:'exacto_canbus'` en `calcular-metricas-viaje.ts`.
- **Candidatos a deshabilitar** (pagan MB, no sirven a nadie hoy): el resto del catálogo Low Priority/High-Panic sin consumidor — **sujeto a revisión de intención de producto** (§3), no automático.

---

## NO VERIFICADO / falta
1. **Lista real de elementos habilitados en el `.cfg`** — el archivo es binario (`~/Downloads/FMC150_Truphone_Google.cfg`, no parseado; prohibido editar). Sin esa lista no se puede computar el **delta real** (Fase E): qué IDs están **habilitados** vs **consumidos**. Falta: extraer la lista de IO permanentes/eventuales del `.cfg` (Configurator o parser del binario).
2. **AVL IDs de acelerómetro 17/18/19** — convención asumida, no confirmada contra el FMC150 real (`crash-trace.ts:29-32`).
3. **Referencia rota:** la migración `apps/api/drizzle/0005_dispositivos_telemetria.sql:58-60` apunta a `apps/api/src/services/io-catalog.ts` que **no existe**; el catálogo real vive en `packages/shared-schemas/src/avl-ids/`.
