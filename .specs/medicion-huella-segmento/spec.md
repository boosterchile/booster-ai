# Spec — Medición de huella de carbono sobre el segmento real (recogida → entrega)

| Campo | Valor |
|---|---|
| **Feature slug** | `medicion-huella-segmento` |
| **Fecha** | 2026-06-24 |
| **Estado** | Diseño aprobado por el PO (pendiente de plan) |
| **Owner (PO)** | Felipe Vicencio — `dev@boosterchile.com` |
| **Origen** | Brainstorming `superpowers:brainstorming` sobre 7 decisiones de diseño, fundado en reconocimiento read-only del 2026-06-24 |
| **Rama** | `feat/medicion-huella-segmento` |

---

## 1. Contexto y problema

Booster mide la huella de carbono de un viaje **estilo Uber**: sobre el **segmento** delimitado por dos eventos del conductor — recogida de carga (abre la ventana) y entrega (cierra la ventana) — ponderado por el peso de la carga y medido sobre el recorrido real.

El reconocimiento del código vivo (2026-06-24) estableció el estado actual:

- **Extremo de ENTREGA: modelado y con handler.** [`confirmar-entrega-viaje.ts:214-245`](apps/api/src/services/confirmar-entrega-viaje.ts:214) setea `trips.status='entregado'` + `assignments.status='entregado'` + `deliveredAt` + evento `entrega_confirmada`, atómico con CAS. En producción.
- **Extremo de RECOGIDA: modelado SIN handler.** Existen en schema `assignments.status='recogido'` ([schema.ts:240](apps/api/src/db/schema.ts:240)), `assignments.pickedUpAt` (`recogido_en`, [schema.ts:1203](apps/api/src/db/schema.ts:1203)), `assignments.pickupEvidenceUrl` ([schema.ts:1198](apps/api/src/db/schema.ts:1198)), `trips.status='en_proceso'` ([schema.ts:218](apps/api/src/db/schema.ts:218)) y evento `recogida_confirmada` ([schema.ts:268](apps/api/src/db/schema.ts:268)) — pero **ningún punto del código los setea**. [`transiciones.ts:14`](packages/trip-state-machine/src/transiciones.ts:14) lo dice textual: *"pickup (PoD-geofence, MODELADO pero aún sin flujo que lo dispare): asignado → en_proceso"*. Hay consumidores corriente-abajo que ya filtran por `status='recogido'` (transport-documents, route-safety, asignar-conductor) esperando que exista.
- **Peso de carga:** la fuente persistida es `trips.cargoWeightKg` (`carga_peso_kg`, **nullable**, [schema.ts:1100](apps/api/src/db/schema.ts:1100)), alimentada por un DTO que lo exige `>0` ([trip-request-create.ts:56](packages/shared-schemas/src/trip-request-create.ts:56)). Cuando es NULL (WhatsApp anónimo, legacy, insert directo), tres servicios productivos lo silencian a `0` con `?? 0`: [matching.ts:195](apps/api/src/services/matching.ts:195), [eco-route-preview.ts:158](apps/api/src/services/eco-route-preview.ts:158), [calcular-metricas-viaje.ts:235](apps/api/src/services/calcular-metricas-viaje.ts:235) — contaminando emisiones y matching sin alerta.
- **Distancia del cálculo de CO2: ESTIMADA.** [`calcular-metricas-viaje.ts:244-272`](apps/api/src/services/calcular-metricas-viaje.ts:244) alimenta `calcularEmisionesViaje` con `distanciaKm` estimada (Routes API o tabla Chile). Los campos para datos reales `tripMetrics.distanceKmActual` (`distancia_km_real`) y `carbonEmissionsKgco2eActual` (`emisiones_kgco2e_reales`) ([schema.ts:1286,1291](apps/api/src/db/schema.ts:1286)) **existen pero ningún `.set()` los popula**.
- **Telemetría GPS: a un paso.** El pipeline Teltonika persiste pings en `telemetria_puntos`. [`calcularCoberturaPura`](apps/api/src/services/calcular-cobertura-telemetria.ts:88) ya **acumula distancia real** (`kmCubiertos += haversineKm(...)`) sobre la ventana, pero **descarta** ese valor (retorna solo `coverage_pct`) y ancla la ventana a `pickup_window_start` planificado, no al pickup real.
- **Posición dual ya existe y se popula (verificado).** Además de Teltonika, el browser del conductor reporta posición vía `navigator.geolocation.watchPosition` → `postDriverPosition` ([driver-position.ts](apps/web/src/services/driver-position.ts), [use-driver-position-reporter.ts](apps/web/src/hooks/use-driver-position-reporter.ts)) → **`POST /assignments/:id/driver-position`**, cuyo handler hace `insert(posicionesMovilConductor)` con `source:'browser'` ([assignments.ts:442](apps/api/src/routes/assignments.ts:442)) sobre la tabla `posiciones_movil_conductor` (con `assignmentId`, [schema.ts:959](apps/api/src/db/schema.ts:959)). **Hay productor real en producción** — la tabla no está vacía por diseño. Los endpoints lectores `/vehiculos/flota` y `/vehiculos/:id/ubicacion` **no mergean** los streams: **enrutan por tipo de vehículo** (con Teltonika → `telemetria_puntos`; sin Teltonika → `posiciones_movil_conductor`), [vehiculos.ts:195-294](apps/api/src/routes/vehiculos.ts:195). En cambio `get-public-tracking` y `calcular-cobertura-telemetria` leen **solo Teltonika**.

**Problema a resolver:** falta el handler de recogida (apertura de ventana) y la conexión telemetría→huella, para medir la huella sobre el segmento real con distancia GPS real, sobre cualquiera de las dos fuentes de posición.

---

## 2. Objetivo y scope

Entregar la **medición de huella sobre el segmento real**: abrir la ventana en la recogida, cerrarla en la entrega (ya existe), y calcular la huella sobre el recorrido GPS real (de Teltonika o del browser del conductor), ponderado por el peso declarado.

### Dentro de scope (este spec) — F1 + F2

- **F1 — Apertura de ventana:** handler de recogida híbrido (geofence sugiere + tap confirma) que setea `en_proceso` + `recogido` + `pickedUpAt` + evento `recogida_confirmada`.
- **F2 — Huella real:** enrutamiento de fuente de posición por tipo de vehículo (Teltonika o browser), distancia GPS real sobre el segmento, persistencia en campos `*Actual`, manejo de cobertura parcial, huella opt-in y degradación por peso ausente.

### Fuera de scope (spec hermano "tracking Uber", depende de F1)

- **F3 — ETA bifásico** (al origen pre-recogida / al destino post-recogida).
- **F4 — Hitos al consignee** (notificaciones; con lead-time de revisión Meta de plantillas WhatsApp).

> El tracking en vivo + ETA al destino **ya existe** (`GET /public/tracking/:token`, [get-public-tracking.ts](apps/api/src/services/get-public-tracking.ts), [compute-route-eta.ts](apps/api/src/services/compute-route-eta.ts)). F1 ya lo mejora implícitamente al activar el estado `en_proceso` que el auto-poll del hook ya distingue ([use-public-tracking.ts:52](apps/web/src/hooks/use-public-tracking.ts:52)).

---

## 3. Decisiones de diseño

| # | Decisión | Resolución | Justificación |
|---|---|---|---|
| Madre | Fidelidad v1 | Segmento real **+ distancia GPS real** (F1+F2) | El handler de recogida es prerequisito de todo; la distancia real es lo que distingue a Uber y la infra ya existe |
| Q1 | Peso | **Declarado** (`cargoWeightKg`) | No hay fuente de peso pesado/confirmado; capturarla es un flujo operacional nuevo de bajo retorno marginal |
| Q2 | Peso faltante | Huella **opt-in por cliente**; si activa → peso obligatorio; si falta → **degradar explícito** (Actual=null + métrica data-quality + cert degradada), **nunca 0** | Coherente con el downgrade por cobertura ya existente; una métrica ESG no debe contener un 0 silencioso |
| Q3 | Disparo recogida | **Híbrido**: geofence sugiere + tap confirma. `pickedUpAt` = instante del geofence; fallback al tap | Determinismo del tap probado (espejo de confirmar-entrega) + precisión del geofence; nunca bloquear por falta de GPS |
| Q4 | Estado apertura | **Ambos**: `trips→en_proceso` + `assignments→recogido`, atómico/CAS, + evento | Espejo de confirmar-entrega; satisface a los consumidores de ambas máquinas; habilita seguimiento shipper/consignee |
| Q5 | Distancia + cobertura | **Real GPS**; cobertura parcial → **umbral binario ~80%** (real si ≥, estimada si <) | Reusa el umbral de certificación existente; simple y auditable para un certificado ESG |
| Q6 | Anclaje ventana | **Pickup real** (`pickedUpAt`) | "Estilo Uber" mide sobre el evento real, no la ventana planificada |
| Q7 | Persistencia | Reusar `distanceKmActual` / `carbonEmissionsKgco2eActual` | Los campos ya existen para esto; coexisten con los `*Estimated` (estimada pre-entrega + real post-entrega) |

### Micro-decisiones (defaults aprobados con el diseño)

1. **Flag opt-in de huella:** a **nivel cliente/empresa** (default heredado por viaje) con **override opcional por viaje**.
2. **Geocodificación del origen:** geocodificar y **persistir lat/lng al crear/asignar** el viaje (Routes API ya disponible), no al vuelo.
3. **Radio del geofence de origen:** parámetro configurable, **default 150 m**.

---

## 4. Arquitectura F1 — Apertura de ventana

### Componentes

- **Nuevo servicio `apps/api/src/services/confirmar-recogida-viaje.ts`** — espejo de [`confirmar-entrega-viaje.ts`](apps/api/src/services/confirmar-entrega-viaje.ts):
  - Transacción con CAS: `UPDATE trips SET status='en_proceso' WHERE id=? AND status='asignado'` y `UPDATE assignments SET status='recogido', pickedUpAt=? WHERE id=? AND tripId=? AND status='asignado'`.
  - Inserta evento `recogida_confirmada` en `trip_events` con payload (actor, instante, fuente, assignment_id).
  - Idempotente: si ya está `recogido`/`en_proceso`, retorno idempotente (mismo patrón que `alreadyDelivered`).
  - Validación de legalidad vía `trip-state-machine` (`assertTransicion('asignado','en_proceso')`).
- **Nuevo endpoint `PATCH /carrier/assignments/:id/confirmar-recogida`** ([apps/api/src/routes/assignments.ts](apps/api/src/routes/assignments.ts)) — espejo del de entrega; Zod en boundary; RBAC carrier.
- **PWA conductor** ([apps/web/src/routes/conductor.tsx](apps/web/src/routes/conductor.tsx)): UI de confirmación de recogida sugerida por geofence.

### Disparo híbrido

1. El conductor en ruta al origen reporta posición (Teltonika y/o browser).
2. Un **detector de geofence** evalúa la posición del vehículo (de su fuente según routing: Teltonika o browser) contra el polígono del origen (radio default 150 m).
3. Al entrar al radio, la PWA **sugiere** confirmar la recogida (instante candidato = timestamp del cruce).
4. El conductor **confirma con un tap** → `pickedUpAt` = instante candidato del geofence.
5. **Fallback:** si no hubo geofence (sin GPS, vehículo sin device ni permiso de browser), el tap manual puro setea `pickedUpAt` = instante del tap. La recogida **nunca se bloquea** por falta de señal.

### Prerequisito de datos

- **Geocodificar el origen** a lat/lng y persistirlo (ver §6 modelo de datos) para construir el polígono del geofence. Hoy `trips.originAddressRaw` + región/comuna no traen coordenadas.

---

## 5. Arquitectura F2 — Medición sobre el segmento

### Fuente de posición por tipo de vehículo (routing, no merge)

- La lectura de posición **no une** los dos streams: **enruta por tipo de vehículo**, reusando el patrón ya existente en [vehiculos.ts:195-294](apps/api/src/routes/vehiculos.ts:195), que particiona los vehículos en tres grupos y cada uno consulta **una sola** fuente determinísticamente:
  - `withOwnDevice` (tiene `teltonika_imei`) → `telemetryPoints` (`telemetria_puntos`).
  - `withMirrorImei` (solo espejo) → `telemetryPoints` por `imei`.
  - `withoutDevice` (sin Teltonika) → `posicionesMovilConductor` (`posiciones_movil_conductor`, browser).
- **F2 reusa ese routing**, no construye un módulo de merge. Esto lo **simplifica**: como un viaje nunca usa ambas fuentes a la vez, **no hay dedup ni resolución de conflictos** entre streams — basta resolver la fuente del vehículo y leer de la tabla correspondiente.
- Consumidores que adoptan este routing para el segmento: la cobertura/distancia (F2) y —en el spec hermano— el tracking público (que hoy lee solo Teltonika).

### Distancia real

- Adaptar [`calcularCoberturaPura`](apps/api/src/services/calcular-cobertura-telemetria.ts:88) (o un servicio derivado) para:
  - (a) anclar la ventana a `pickedUpAt` **real** (no `pickup_window_start`),
  - (b) leer de la **fuente del vehículo según routing** (Teltonika o browser), no solo Teltonika,
  - (c) **retornar `kmCubiertos`** (distancia real acumulada) además de `coverage_pct`.

### Cómputo de huella sobre el segmento (umbral binario ~80%)

- El nivel de certificación por cobertura ya se deriva con [`derivarNivelCertificacion({ coveragePct, ... })`](apps/api/src/services/calcular-metricas-viaje.ts:296) (umbral encapsulado, ADR-028 §5); **reusar esa función** como fuente única del umbral binario en vez de re-hardcodear ~80%.
- **Si `coverage_pct ≥ umbral`**: `kmCubiertos` alimenta `calcularEmisionesViaje` (modo según perfil de vehículo) → poblar `distanceKmActual` + `carbonEmissionsKgco2eActual` + `fuelConsumedLActual` si aplica; nivel primario.
- **Si `coverage_pct < umbral`**: usar distancia estimada, nivel **secundario** vía `derivarNivelCertificacion` (reusar [`recalcularNivelPostEntrega`](apps/api/src/services/calcular-metricas-viaje.ts:411)).
- **Disparo:** la cobertura real se computa al cerrar el trip (hoy `coveragePct=0` en la fase pre-entrega, [calcular-metricas-viaje.ts:295](apps/api/src/services/calcular-metricas-viaje.ts:295)); extender el post-commit de `confirmar-entrega-viaje` para computar y persistir la huella real del segmento sobre la ventana `[pickedUpAt, deliveredAt]`.

### Peso: opt-in y degradación

- **Huella opt-in por cliente/empresa** (flag nuevo, override por viaje). Si **inactiva** → no se computan métricas de huella para ese viaje.
- **Activa + peso presente** → mide normalmente con `cargoWeightKg`.
- **Activa + peso ausente (NULL)** → **no computar** `carbonEmissionsKgco2eActual` (queda null), emitir métrica de data-quality, degradar nivel de certificación. **Nunca `0`.** En el punto de activación/creación, exigir el peso cuando la huella esté activa.

### Dependencia causal F1 → F2 (hecho de datos, no solo orden de implementación)

La captura de posición browser está **gated por estado**: el handler `POST /assignments/:id/driver-position` solo acepta posiciones cuando `assignment.status ∈ {'asignado','recogido'}` ([assignments.ts:438](apps/api/src/routes/assignments.ts:438)).

- Como **`'recogido'` nunca se setea hoy** (es exactamente el gap que F1 cierra), la captura browser **hoy solo cubre el tramo camino-al-origen** (`status='asignado'`), **no** el segmento recogida→entrega que F2 mide.
- El allowlist **ya incluye `'recogido'`**, así que cuando F1 active ese estado, la captura browser cubrirá el segmento de medición **sin tocar el endpoint**.
- **Implicación:** F1 no es solo un prerequisito de orden — es lo que **genera los datos** sobre los que F2 mide para vehículos **sin Teltonika**. Sin F1, esos viajes no tienen filas browser dentro de la ventana `[pickedUpAt, deliveredAt]`.

---

## 6. Modelo de datos / cambios de schema

> Migraciones = dominio crítico → TDD obligatorio (`tdd-dominio-critico`).

1. **Flag opt-in de huella:**
   - A nivel empresa/cliente: columna booleana (p. ej. `empresas.medir_huella` / `carbon_measurement_enabled`).
   - Override por viaje: columna nullable en `trips` (p. ej. `medir_huella_override`) que, si no es null, gana sobre el default de la empresa.
2. **Origen geocodificado:** columnas lat/lng en `trips` (p. ej. `origen_latitud` / `origen_longitud`, numeric 10,7) pobladas al crear/asignar. (Evaluar si conviene también destino para el spec hermano de ETA — no requerido aquí.)
3. **Parámetro de radio de geofence:** configurable (env/config), default 150 m. Sin schema change si vive en `packages/config`.
4. **Reutilizados (sin cambio):** `assignments.pickedUpAt`, `assignments.status`, `trips.status`, `tripMetrics.distanceKmActual`, `tripMetrics.carbonEmissionsKgco2eActual`, evento `recogida_confirmada`.

> Confirmar nombres exactos de columnas en la fase de plan, respetando naming bilingüe (SQL español snake_case sin tildes).

---

## 7. Manejo de errores y degradación

Tres cortes, todos con **degradación explícita** (nunca fallo silencioso ni `0`):

| Situación | Comportamiento |
|---|---|
| Sin geofence (sin GPS / sin permiso browser / vehículo sin device) | Fallback a tap manual; `pickedUpAt` = instante del tap. La recogida no se bloquea. |
| Cobertura GPS < umbral | Distancia estimada + nivel de certificación secundario + métrica. |
| Peso ausente con huella activa | `carbonEmissionsKgco2eActual` = null + métrica data-quality + nivel degradado. |

---

## 8. Observabilidad (`booster-stack-conventions`)

- Logs estructurados con `trace_id` + span OTel en el nuevo endpoint y servicio de recogida.
- Métricas de negocio: recogidas confirmadas (geofence vs manual), cobertura por viaje, viajes con peso ausente bajo huella activa, viajes degradados a estimada.
- Cero `console.*`; usar `@booster-ai/logger`. Cada `catch` loguea con contexto + recovery explícito.

---

## 9. Testing (TDD — dominio crítico)

Caminos críticos (carbono/GLEC, máquina de estados, migraciones) → **TDD obligatorio** (`tdd-dominio-critico`, `superpowers:test-driven-development`). Cobertura ≥ 80% en código nuevo.

- **Handler de recogida:** transición legal/ilegal, CAS bajo concurrencia, idempotencia, emisión de evento, fallback manual.
- **Routing de fuente de posición:** resolución de fuente por tipo de vehículo (Teltonika vs browser), orden temporal, ventana `[pickedUpAt, deliveredAt]`. (No hay merge → no se testea dedup entre streams.)
- **Dependencia F1→F2 en datos (anti-falso-verde):** un test de F2 sobre un vehículo **browser** que **no** haya pasado por el handler de recogida de F1 mediría sobre **cero filas** dentro de la ventana y daría un **FALSO VERDE** de "fallback a estimada correcto". Por tanto, los tests de F2 sobre vehículos **sin Teltonika** deben **ejercer primero el handler de F1** (activar `'recogido'`) y reportar posiciones browser dentro del segmento **antes** de evaluar la distancia real.
- **Distancia real:** haversine sobre ventana, retorno de `kmCubiertos`, umbral binario (≥ y <), anclaje al pickup real.
- **Peso opt-in/degradación:** huella inactiva (no mide), activa+peso, activa+NULL (degrada, no 0).
- **Persistencia:** poblar `*Actual` solo cuando corresponde; coexistencia con `*Estimated`.

---

## 10. Definición de Terminado (`definicion-de-terminado`)

- Handler de recogida en producción seteando `en_proceso`+`recogido`+`pickedUpAt`+evento, con disparo híbrido y fallback manual.
- Huella real del segmento poblando `*Actual` cuando cobertura ≥ umbral; degradación explícita en los 3 cortes.
- Fuente de posición enrutada por tipo de vehículo (Teltonika o browser) alimentando la medición.
- Opt-in de huella respetado; peso ausente nunca produce `0`.
- Tests (TDD) verdes + cobertura ≥ 80% + lint + typecheck + build. Sección `## Evidencia` en el PR.
- Sin deuda silenciosa: cualquier corte se declara explícito con plan/issue.

---

## 11. Riesgos y dependencias

- **Precisión del geofence** depende de cobertura GPS y de la geocodificación del origen → mitigado con fallback manual.
- **Cobertura GPS variable** con la flota Teltonika recién desplegándose (go-live carriers reales) → mitigado con umbral binario + degradación.
- **El bug latente `matching.ts:195` (`cargaKg ?? 0`)** queda fuera de scope estricto pero relacionado; registrar como follow-up (no arreglar en silencio aquí).

---

## 12. Follow-ups

- **Spec hermano "tracking Uber"** (F3 ETA bifásico + F4 hitos al consignee) — depende de F1; F4 con lead-time de revisión Meta de plantillas WhatsApp.
- **Bug `matching.ts:195`** — el filtro de capacidad usa `cargoWeightKg ?? 0`, incluyendo vehículos inapropiados cuando el peso es NULL.

---

## 13. Referencias de código (reconocimiento 2026-06-24, verificadas de primera mano)

- Entrega con handler: [`confirmar-entrega-viaje.ts:214-245`](apps/api/src/services/confirmar-entrega-viaje.ts:214)
- Recogida modelada sin handler: [`transiciones.ts:14`](packages/trip-state-machine/src/transiciones.ts:14), [schema.ts:240](apps/api/src/db/schema.ts:240), [schema.ts:1203](apps/api/src/db/schema.ts:1203), [schema.ts:268](apps/api/src/db/schema.ts:268)
- Peso: [schema.ts:1100](apps/api/src/db/schema.ts:1100), [trip-request-create.ts:56](packages/shared-schemas/src/trip-request-create.ts:56), hardcodeos `?? 0` en [matching.ts:195](apps/api/src/services/matching.ts:195) / [eco-route-preview.ts:158](apps/api/src/services/eco-route-preview.ts:158) / [calcular-metricas-viaje.ts:235](apps/api/src/services/calcular-metricas-viaje.ts:235)
- Distancia: cómputo estimado [`calcular-metricas-viaje.ts:244-272`](apps/api/src/services/calcular-metricas-viaje.ts:244); campos `*Actual` vacíos [schema.ts:1286,1291](apps/api/src/db/schema.ts:1286); haversine que descarta `kmCubiertos` [`calcular-cobertura-telemetria.ts:88-110`](apps/api/src/services/calcular-cobertura-telemetria.ts:88)
- Posición browser — **productor real**: `POST /assignments/:id/driver-position` → `insert(posicionesMovilConductor)` [assignments.ts:442](apps/api/src/routes/assignments.ts:442), con guard de estado `{'asignado','recogido'}` en [assignments.ts:438](apps/api/src/routes/assignments.ts:438); cliente [`driver-position.ts`](apps/web/src/services/driver-position.ts) / [`use-driver-position-reporter.ts`](apps/web/src/hooks/use-driver-position-reporter.ts); tabla `posicionesMovilConductor` [schema.ts:959](apps/api/src/db/schema.ts:959). **Lectura por routing** (no merge): [vehiculos.ts:195-294](apps/api/src/routes/vehiculos.ts:195)
- Tracking + ETA existentes: [get-public-tracking.ts](apps/api/src/services/get-public-tracking.ts), [compute-route-eta.ts](apps/api/src/services/compute-route-eta.ts), [use-public-tracking.ts:52](apps/web/src/hooks/use-public-tracking.ts:52)
