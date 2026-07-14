# Delta — habilitado vs presente vs consumido (Fase E)

**Fecha:** 2026-07-13 · Auditoría READ-ONLY. Verificación de datos vía `scripts/db/agent-query.sh` (SELECT, IAP+ADC, Cloud SQL prod). Sin escrituras.

La Fase E del brief pide dos direcciones ("cero huérfanos"). La verificación en datos reales agregó una **tercera columna decisiva**: qué hay realmente en `io_data`. Las tres no coinciden.

## Verificación de datos (ground truth)

`telemetria_puntos` completa — **2 IMEIs, 260.327 filas, 2026-05-03 → 2026-07-13**:

| IMEI | filas | primero | último | nota |
|---|---|---|---|---|
| `863238075489155` | 260.324 | 2026-05-05 | 2026-07-13 | device real, 2+ meses continuos |
| `999000000000875` | 3 | — | 2026-05-03 | test |

`dispositivos_pendientes`: los **mismos** dos IMEIs, ambos `aprobado`. **No hay un tercer device CAN cuyos datos se descarten** (persist.ts descarta IMEI no-registrado; aquí no hay ninguno).

**TODAS las claves AVL distintas presentes en `io_data` (tabla completa):**
```
16 21 24 66 67 68 69 80 175 181 182 199 200 239 240 241 247 249 250 251 253 254 255 257 317 318 388
```
El publisher pasa **todos** los `io.entries` sin filtrar (`pubsub-publisher.ts:48-55`) → **ausente en `io_data` ⇒ el device no lo emitió** (no se perdió en tránsito).

---

## 🔴 Hallazgos de primer orden — capacidad presente, consumidor ausente (prioridad SOBRE la huella)

Features que **el sistema cree funcionando** y en silencio no funcionan. Más graves que la huella
medida (esa al menos es honesta sobre su ausencia).

### F0-0 · Distancia real descartada; huella calculada con estimación — **EL MÁS GRAVE** → `hallazgo-distancia-medida-vs-estimada.md`
- **Resumen:** hay distancia GPS real en `telemetria_puntos` (260k pings) y en `posiciones_movil_conductor` (app, cableada pero **0 filas en prod**), y el cálculo de huella **no lee ninguna** para la distancia — la toma de Routes API o de una tabla regional hardcodeada. El único lugar que toca los pings reales (cobertura) computa la distancia recorrida y la **descarta**, conservando solo el ratio (`calcular-cobertura-telemetria.ts:105,109`).
- **Prueba definitiva:** existe la columna `distancia_km_real` (`schema.ts:1407`), el certificado la prefiere (`certificates.ts:128`: `distanceKmActual ?? distanceKmEstimated`), pero **nunca se escribe** (0 writes) → todo certificado cae a la estimación, aun con procedencia etiquetada `teltonika_gps`.
- **Distinto de F0-1/F0-2:** no es un dato que falta (el dato **está**); es un dato presente y almacenado sin consumidor. **Detalle completo, corrección del gate backhaul §6.4, y propuestas A (cablear, deuda técnica) / B (observar retorno, decisión de producto) en el documento dedicado.**

### F0-1 · Temperatura de cadena de frío — `temperatura_c` **siempre null**
- **Consumidor:** `apps/api/src/routes/vehiculos.ts:198-206, 1380` lee `io_data['72']` (Dallas Temperature 1) y lo expone como `temperatura_c` en `GET /vehiculos/:id/ubicacion`; el frontend lo muestra (`apps/web/src/routes/vehiculo-live.tsx:36,123`).
- **Dato real:** IO 72 **ausente en 260k filas / 2 meses** → `extractTemperatura` retorna null siempre. Sin error; solo vacío.
- **Gravedad:** si se asume/vende monitoreo de cadena de frío, hoy **no existe** y nadie lo nota.
- **Fix (DECIDIDO con el PO):** el sensor Dallas se instala en días → **habilitar Dallas Temperature 1 (IO 72) en el `.cfg` ahora**, antes de la instalación (principio "habilitar antes que el hardware", ADR punto 11). **NO** retirar `temperatura_c`. El campo seguirá null hasta que IO 72 esté habilitado y el sensor físicamente instalado.

### F0-2 · Crash trace sin acelerómetro — `peakGForce = 0`
- **Consumidor:** `packages/codec8-parser/src/crash-trace.ts:223-246` arma el acelerómetro desde IO 17/18/19; `computePeakGForce` sobre lista vacía → **0**.
- **Dato real:** 17/18/19 **ausentes**; el crash event 247 **sí** llega (42×) → hay crash traces, pero **sin fuerza-G del impacto**, que es el valor de venta (evidencia forense para seguros, `crash-trace.ts:14-19`).
- **Nota:** 17/18/19 eran **convención asumida** (`crash-trace.ts:29-32`); el FMC150 real puede usar otros IDs, o no tenerlos habilitados.
- **Fix (una de dos):**
  - (a) Confirmar los **IDs reales de acelerómetro** del FMC150 y **habilitarlos** en el `.cfg` (+ corregir las constantes si 17/18/19 es incorrecto).
  - (b) No se capturará acelerómetro → **retirar** la extracción + `peakGForce` para no persistir forensics vacíos en BigQuery.

---

## Tabla delta

| AVL ID | Elemento | ¿Habilitado en `.cfg`? (Configurator, PO) | ¿Presente en `io_data`? (DB, verificado) | ¿Consumido? (código) | Veredicto |
|---|---|---|---|---|---|
| **Fuel Consumed (ltr×10)** | CAN combustible | **SÍ** (CAN I/O, Low) | **NO** (0 en 260k filas / 2 meses) | NO | **CONFLICTO — habilitado pero NO llega** |
| **Fuel Consumed counted (ltr×10)** | CAN | **SÍ** | **NO** | NO | **CONFLICTO** |
| **Fuel Level (ltr×10)** | CAN | **SÍ** | **NO** | NO | **CONFLICTO** |
| **Fuel Level (%)** | CAN | **SÍ** | **NO** | NO | **CONFLICTO** |
| **Engine RPM** | CAN | **SÍ** | **NO** | NO | **CONFLICTO** |
| **Total Mileage (m) / counted** | CAN | **SÍ** | **NO** | NO | **CONFLICTO** |
| **Vehicle Speed (CAN)** | CAN | **SÍ** | **NO** | NO | **CONFLICTO** |
| **Acceleration Pedal Position** | CAN | **SÍ** | **NO** | NO | **CONFLICTO** |
| **Engine Load** | CAN | **SÍ** | **NO** | NO | **CONFLICTO** |
| **Engine Worktime** | CAN | **SÍ** | **NO** | NO | **CONFLICTO** |
| **VIN** | CAN | **SÍ** | **NO** | NO | **CONFLICTO** |
| 72 | Dallas Temperature 1 | ? | **NO** | **SÍ** (`vehiculos.ts:204`) | **LECTURA MUERTA** — se consume un ID que el device no emite → `temperatura_c` siempre null |
| 17/18/19 | Acelerómetro X/Y/Z | ? | **NO** | referenciado (`crash-trace.ts:43-47`) | **ASUNCIÓN FALSA** — crash trace sin acelerómetro (peakG=0). Confirma el caveat `crash-trace.ts:29-32` |
| 247 | Crash event | (sí) | **SÍ** (42) | **SÍ** (`persist-crash-trace.ts`) | **VIVO** |
| 253 / 254 | Green Driving type/value | (sí) | **SÍ** (158/158) | **SÍ** (`persist-green-driving.ts`) | **VIVO** |
| 255 | Over-Speeding | (sí) | **SÍ** (1269) | **SÍ** | **VIVO** |
| 16 | Total Odometer | (sí) | **SÍ** (260k) | NO | huérfano at-rest (relevante GLEC, no leído) |
| 24 | Speed (IO) | (sí) | **SÍ** | NO | huérfano at-rest |
| 66 / 67 / 68 | Ext V / Batt V / Batt A | (sí) | **SÍ** | NO | huérfano (66 = detección unplug, no leído) |
| 239 / 240 | Ignition / Movement | (sí) | **SÍ** | NO | huérfano (trip state machine, no leído) |
| 21/69/80/181/182/199/200/241/388 | GSM/GNSS/Sleep/DOP/TripOdo/Operador/NX | (sí) | **SÍ** | NO | huérfano at-rest |
| 175/249/250/251/257/317/318 | AutoGeofence/Jamming/Trip/Idling/…/GNSSJam | (sí) | **SÍ** | NO | huérfano (event-router de `avl-ids/` sin uso prod) |

## Criterio "cero huérfanos" — resultado

- **Dirección 1 (todo lo habilitado se consume):** VIOLADO masivo. De ~27 IDs presentes, solo 4 (247/253/254/255) se consumen; el resto se almacena sin lector.
- **Dirección 2 (todo lo que la huella necesita está habilitado y llega):** VIOLADO. Los 11 parámetros CAN de combustible/motor están **habilitados en el `.cfg`** pero **no llegan a `io_data`** (0 en 2 meses). El modo `exacto_canbus` sigue sin poder alimentarse.

## Reconciliación CAN — RESUELTA con el PO (opción 2)

**El `.cfg` con CAN I/O está cargado y operativo — y aun así 0 elementos CAN.** El device `863238075489155` corre `FMC150_Booster_Wave3_1.cfg` (confirmado por FOTA WEB), que **ya tiene CAN I/O habilitado hace ~2 meses** (Fuel Consumed, Fuel Level, Engine RPM, Total Mileage, Vehicle Speed, Engine Load, Acceleration Pedal Position, Engine Worktime, VIN — todos en Low; las capturas del Configurator son **esta** config, no una en preparación). El bloqueo **NO es de configuración**.

**Causa raíz (probable, NO confirmada):** el bus CAN del Scania no se está decodificando. FOTA WEB muestra `Vehículo de archivos OEM: Scania PRT Range mk2 (2017+)` pero `Paquete de archivos OEM: **Desconocido (ID: 0)**` → sin el archivo OEM, el chip CAN no tiene diccionario para el bus. Config habilitada + chip vivo + **sin diccionario = no emite**. Alternativa: cableado físico (**CAN1H pin 12 / CAN1L pin 6**). Se está recargando el archivo OEM por FOTA. Es un problema de la capa **CAN-hardware/OEM**, no del `.cfg` ni del pipeline.

- **No hay backfill.** Las 260k filas existentes nunca capturaron combustible (sea cual sea la causa). `exacto_canbus` es computable **solo hacia adelante**, desde que el CAN empiece a decodificarse.
- **Send LKV (Last Known Value):** cambio correcto del `.cfg`, pero **forward-only** — evita que un bus CAN caído produzca litros fantasma en los datos futuros. No hay histórico CAN que contaminar. (Recomendación del PO → al ADR.)
- **El backend NO depende del `.cfg`.** La causa raíz se arregla por FOTA (archivo OEM) / hardware, no en el pipeline. Orden correcto: construir **en paralelo AHORA** (a) el catálogo `avl-ids/` con los IDs CAN + (b) el ruteo a `metodo:'exacto_canbus'` en `calcular-metricas-viaje.ts`, para que el pipeline esté **listo** cuando el CAN empiece a llegar. No hay que esperar.
