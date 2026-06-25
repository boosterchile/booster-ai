# Medición de huella sobre el segmento real (F1+F2) — Plan de implementación

> **Para workers agénticos:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para ejecutar tarea por tarea. Los pasos usan checkbox (`- [ ]`). Ejecutable por `/goal` (BUILD) tarea a tarea, en orden.

**Goal:** Medir la huella de carbono de un viaje sobre el segmento real `pickedUpAt → deliveredAt`, con distancia GPS real, abriendo la ventana con un handler de recogida que hoy no existe.

**Architecture:** F1 añade el handler de recogida (espejo del de entrega: CAS atómico idempotente vía `trip-state-machine`) disparado por geofence+tap; F2 reusa el enrutamiento de posición por tipo de vehículo, mide distancia real sobre la ventana y puebla los campos `*Actual` con umbral binario de cobertura y degradación explícita. Plan derivado de `.specs/medicion-huella-segmento/spec.md` (mergeado en #547, `f04a718`).

**Tech Stack:** TypeScript, Hono (api), Drizzle ORM (Postgres), Zod (boundaries), `@booster-ai/logger` + OpenTelemetry, Vitest/node:test, `packages/carbon-calculator` (GLEC v3.0), React PWA (`apps/web`).

## Global Constraints (verbatim del spec / CLAUDE.md — aplican a TODA tarea)

- **Naming bilingüe:** TS identifiers en inglés camelCase ↔ SQL columnas en español snake_case sin tildes. Drizzle: `export const x = pgTable('tabla_es', { campoTs: tipo('campo_es') })`.
- **TDD obligatorio** en dominio crítico: carbono/GLEC, migraciones, máquina de estados. Test-first (rojo → verde → refactor).
- **Degradación explícita, NUNCA `0` ni fallo silencioso** en los 3 cortes (sin geofence, cobertura baja, peso ausente).
- **Zero `any` / `@ts-ignore` / `console.*`**; Zod en boundaries; structured log con `trace_id` + span OTel + métrica de negocio por endpoint nuevo; coverage ≥ 80% en código nuevo.
- **Handler de recogida = espejo** de `confirmar-entrega-viaje.ts:210-245` (CAS, atómico, idempotente, legalidad vía `trip-state-machine`).
- **F2 = enrutamiento por tipo de vehículo** (con Teltonika → `telemetria_puntos`; sin → `posiciones_movil_conductor`), reusando `vehiculos.ts:195-294`. NO merge de streams.
- **Distancia real** sobre `[pickedUpAt, deliveredAt]`; umbral binario ~80% vía `derivarNivelCertificacion`; poblar `distanceKmActual` + `carbonEmissionsKgco2eActual`.
- **Peso declarado** (`cargoWeightKg`); ausente con huella activa → degradar (`*Actual=null` + métrica data-quality + cert degradada), nunca `0`.
- **Radio de geofence default 150 m**, configurable.
- **FUERA de scope:** F3 (ETA bifásico) + F4 (hitos consignee). No se planifican.

---

## Mapa de archivos

| Archivo | Responsabilidad | Tareas |
|---|---|---|
| `apps/api/src/db/schema.ts` | Columnas nuevas (opt-in huella, origen lat/lng) | 1, 2 |
| `apps/api/drizzle/<n>_*.sql` | Migraciones expand-safe | 1, 2 |
| `apps/api/src/services/resolver-opt-in-huella.ts` (nuevo) | Resolver opt-in efectivo (override ?? empresa) | 3 |
| `apps/api/src/services/geocodificar-origen.ts` (nuevo) | Geocodificar+persistir origen vía Routes API | 4 |
| `apps/api/src/routes/trip-requests-v2.ts` | Llamar geocodificación al crear viaje | 4 |
| `apps/api/src/services/routes-api.ts` | Field-mask `legs.startLocation` | 4 |
| `packages/trip-state-machine/src/transiciones.ts` | Guard `esConfirmableRecogida` | 5 |
| `apps/api/src/services/confirmar-recogida-viaje.ts` (nuevo) | Handler de recogida (CAS atómico idempotente) | 6 |
| `apps/api/src/routes/assignments.ts` | Endpoint `PATCH …/confirmar-recogida` | 7 |
| `apps/api/src/services/geofence-origen.ts` (nuevo) | Detector geofence (haversine vs radio) | 8 |
| `packages/config/src/env.ts` | `GEOFENCE_RADIUS_M` (default 150) | 8 |
| `apps/web/src/routes/conductor.tsx` + hook | Disparo híbrido (sugiere + tap) | 9 |
| `apps/api/src/services/posicion-segmento.ts` (nuevo) | Enrutamiento de fuente de posición por vehículo | 10 |
| `apps/api/src/services/calcular-cobertura-telemetria.ts` | Anclar pickup real + retornar `kmCubiertos` | 11 |
| `apps/api/src/services/calcular-metricas-viaje.ts` | Huella real + umbral + degradación peso | 12, 13 |
| `apps/api/src/services/confirmar-entrega-viaje.ts` | Wire del recálculo real post-entrega | 12 |

---

## Tareas (orden de ejecución)

### Task 1 — Migración + schema: flag opt-in de huella
**Objetivo:** Persistir el opt-in de medición de huella a nivel cliente (`empresas`) con override por viaje (`trips`).
**Archivos:** Modify `apps/api/src/db/schema.ts` (empresas + trips); Create `apps/api/drizzle/<n>_opt_in_huella.sql`; Test `apps/api/test/integration/migration-opt-in-huella.integration.test.ts`.
**TDD:** SÍ (migración — dominio crítico).
**Depende de:** —
**Pasos:**
- [ ] Test (rojo): tras aplicar la migración, `empresas.medir_huella` existe (`boolean NOT NULL DEFAULT false`) y `trips.medir_huella_override` existe (`boolean` nullable). Verificar `check-migration-safety` (expand-only, sin `NOT NULL` sin default sobre tabla con datos).
- [ ] Drizzle: `empresas` → `carbonMeasurementEnabled: boolean('medir_huella').notNull().default(false)`; `trips` → `carbonMeasurementOverride: boolean('medir_huella_override')`.
- [ ] Generar migración Drizzle (`pnpm --filter @booster-ai/api db:generate`), revisar SQL expand-safe.
- [ ] Verde: migración aplica en DB local; schema coincide.
- [ ] Commit `feat(carbon): columnas opt-in de huella (empresa + override viaje)`.
**Criterio de hecho:** columnas presentes con tipos exactos; `Migration safety` CI verde.

### Task 2 — Migración + schema: origen geocodificado
**Objetivo:** Columnas para persistir lat/lng del origen del viaje (prerequisito del geofence).
**Archivos:** Modify `apps/api/src/db/schema.ts` (trips); Create `apps/api/drizzle/<n>_origen_latlng.sql`; Test `apps/api/test/integration/migration-origen-latlng.integration.test.ts`.
**TDD:** SÍ (migración).
**Depende de:** —
**Pasos:**
- [ ] Test (rojo): `trips.origen_latitud` y `trips.origen_longitud` existen como `numeric(10,7)` nullable. Expand-safe.
- [ ] Drizzle: `originLatitude: numeric('origen_latitud', { precision: 10, scale: 7 })`, `originLongitude: numeric('origen_longitud', { precision: 10, scale: 7 })` (nullable, igual precisión que `posicionesMovilConductor`).
- [ ] Generar + revisar migración.
- [ ] Verde + commit `feat(api): columnas lat/lng del origen del viaje`.
**Criterio de hecho:** columnas presentes nullable `numeric(10,7)`; CI migración verde.

### Task 3 — Resolver de opt-in efectivo de huella (OR de empresas participantes)
**Objetivo:** Función pura que decide si un viaje mide huella. El **override del viaje** gana; si es null, vale el **OR de las empresas participantes consultables**: generador (`trips.generadorCargaEmpresaId`→`empresas`, [schema.ts:1089](apps/api/src/db/schema.ts:1089), **nullable** en drafts WhatsApp anónimos) Y transportista (`assignments.empresaId`→`empresas`, [schema.ts:1189-1191](apps/api/src/db/schema.ts:1189), post-asignación). El **consignee NO participa**: no es una empresa, solo `consigneeName`/`consigneeWhatsappE164` sin FK ([schema.ts:1115-1116](apps/api/src/db/schema.ts:1115)). Null-safe: empresa ausente → su flag cuenta como `false`.
**Archivos:** Create `apps/api/src/services/resolver-opt-in-huella.ts` + `.test.ts`.
**TDD:** SÍ (función pura, test-first).
**Depende de:** Task 1.
**Pasos:**
- [ ] Test (rojo), 7 casos:
  - `{ tripOverride: true, generadorMedirHuella: false, transportistaMedirHuella: false }` → `true` (override gana)
  - `{ tripOverride: false, generadorMedirHuella: true, transportistaMedirHuella: true }` → `false` (override gana)
  - `{ tripOverride: null, generadorMedirHuella: true, transportistaMedirHuella: false }` → `true` (OR: generador)
  - `{ tripOverride: null, generadorMedirHuella: false, transportistaMedirHuella: true }` → `true` (OR: transportista)
  - `{ tripOverride: null, generadorMedirHuella: false, transportistaMedirHuella: false }` → `false`
  - `{ tripOverride: null, generadorMedirHuella: null, transportistaMedirHuella: true }` → `true` (generador null → false, OR transportista)
  - `{ tripOverride: null, generadorMedirHuella: null, transportistaMedirHuella: null }` → `false` (todo null → false)
- [ ] Implementar: `export function resolverOptInHuella(o: { tripOverride: boolean | null; generadorMedirHuella: boolean | null; transportistaMedirHuella: boolean | null }): boolean { return o.tripOverride ?? ((o.generadorMedirHuella ?? false) || (o.transportistaMedirHuella ?? false)); }`
- [ ] Verde + commit `feat(carbon): resolver opt-in efectivo (override ?? OR generador/transportista)`.
**Criterio de hecho:** 7 casos verdes; sin acceso a DB (pura); consignee excluido por diseño (no es empresa consultable); generador nullable manejado.

### Task 4 — Geocodificar y persistir el origen al crear el viaje
**Objetivo:** Al crear el viaje, obtener lat/lng del origen vía Routes API y persistirlo. Degradar (no bloquear creación) si falla.
**Archivos:** Create `apps/api/src/services/geocodificar-origen.ts` + `.test.ts`; Modify `apps/api/src/services/routes-api.ts` (field-mask `routes.legs.startLocation.latLng`); Modify `apps/api/src/routes/trip-requests-v2.ts` (llamar tras el INSERT del trip).
**TDD:** SÍ (tests required; degradación es crítica).
**Depende de:** Task 2.
**Pasos:**
- [ ] Test (rojo): dado un origen+destino, `geocodificarOrigen` devuelve `{ lat, lng }` desde `routes.legs[0].startLocation.latLng`; persiste en `trips.origen_latitud/longitud`. Si Routes API falla/timeout → devuelve `null`, **loguea métrica data-quality**, NO lanza (el trip se crea igual con lat/lng null).
- [ ] Extender field-mask de `computeRoutes` para incluir `routes.legs.startLocation` (sin romper consumidores actuales — sigue devolviendo `distanceKm/durationS/polyline`).
- [ ] Wire en `trip-requests-v2.ts`: tras crear el trip, geocodificar y `UPDATE trips SET origen_latitud/longitud`. Structured log + span OTel.
- [ ] Verde + commit `feat(api): geocodificar y persistir el origen del viaje (degradable)`.
**Criterio de hecho:** trip nuevo tiene lat/lng del origen; fallo de geocoding no bloquea creación y emite métrica.

### Task 5 — trip-state-machine: guard de recogida
**Objetivo:** Exponer la legalidad de la transición de recogida (`asignado → en_proceso`) como guard semántico.
**Archivos:** Modify `packages/trip-state-machine/src/transiciones.ts` + test.
**TDD:** SÍ (máquina de estados).
**Depende de:** —
**Pasos:**
- [ ] Test (rojo): `esConfirmableRecogida('asignado') === true`; `esConfirmableRecogida('en_proceso') === false`; `esConfirmableRecogida('entregado') === false`. (`asignado: ['en_proceso','entregado']` ya existe en la tabla.)
- [ ] Implementar: `export function esConfirmableRecogida(estado: EstadoViaje): boolean { return puedeTransicionar(estado, 'en_proceso'); }`
- [ ] Verde + commit `feat(trip-state-machine): guard esConfirmableRecogida`.
**Criterio de hecho:** guard derivado de la tabla (no lista paralela); 3 casos verdes.

### Task 6 — Servicio `confirmar-recogida-viaje.ts` (handler de recogida)
**Objetivo:** Handler espejo del de entrega: en una transacción con CAS, mueve `trips asignado→en_proceso` + `assignments asignado→recogido`, setea `pickedUpAt`, inserta evento `recogida_confirmada`. Idempotente.
**Archivos:** Create `apps/api/src/services/confirmar-recogida-viaje.ts` + `.test.ts`.
**TDD:** SÍ (máquina de estados — crítico).
**Depende de:** Task 5.
**Pasos:**
- [ ] Test (rojo) happy path: dado un assignment `asignado`, `confirmarRecogidaViaje({ assignmentId, actor, source, pickedUpAt })` setea `trips.status='en_proceso'` Y `assignments.status='recogido'` Y `assignments.pickedUpAt=<instante>` Y inserta `tripEvents` tipo `recogida_confirmada` (payload con actor/instante/assignment_id) — todo atómico.
- [ ] Test (rojo) idempotencia: segunda llamada con assignment ya `recogido` → retorna `{ ok:true, alreadyPickedUp:true }` sin duplicar evento ni mover estados.
- [ ] Test (rojo) CAS: si `assignments.status ≠ 'asignado'` (ej. `entregado`) → `{ ok:false, code:'invalid_status' }`; el `UPDATE … WHERE status='asignado'` no afecta filas.
- [ ] Implementar el servicio espejando `confirmar-entrega-viaje.ts:210-245` (CAS en el WHERE, `assertTransicion`/`esConfirmableRecogida`, transacción), invirtiendo entrega→recogida.
- [ ] Verde + commit `feat(api): handler confirmar-recogida-viaje (CAS atómico idempotente)`.
**Criterio de hecho:** los 3 tests verdes; sin escritura parcial ante estado inválido.

### Task 7 — Endpoint `PATCH /carrier/assignments/:id/confirmar-recogida`
**Objetivo:** Exponer el handler al conductor, espejo del endpoint de entrega del carrier.
**Archivos:** Modify `apps/api/src/routes/assignments.ts` + test de ruta.
**TDD:** SÍ (boundary del cambio de estado).
**Depende de:** Task 6.
**Pasos:**
- [ ] Test (rojo): `PATCH /carrier/assignments/:id/confirmar-recogida` con el driver asignado → 200, deja `assignments.status='recogido'`; body Zod-validado (`pickedUpAt` ISO opcional, default now); RBAC: 403 si el user no es el driver/carrier del assignment; idempotente (segunda llamada → 200 alreadyPickedUp).
- [ ] Implementar la ruta (zValidator + requireCarrierAuth), llamando `confirmarRecogidaViaje`. Structured log con `trace_id`, span OTel, métrica `recogidas_confirmadas`.
- [ ] Verde + commit `feat(api): endpoint confirmar-recogida (carrier)`.
**Criterio de hecho:** endpoint setea `recogido`; RBAC + idempotencia testeadas; observabilidad presente.

### Task 8 — Detector de geofence + radio configurable
**Objetivo:** Función pura que decide si una posición está dentro del radio del origen (haversine), con radio configurable (default 150 m).
**Archivos:** Create `apps/api/src/services/geofence-origen.ts` + `.test.ts`; Modify `packages/config/src/env.ts` (`GEOFENCE_RADIUS_M`).
**TDD:** SÍ (función pura, test-first).
**Depende de:** Task 2 (origen lat/lng).
**Pasos:**
- [ ] Test (rojo): `dentroDelGeofence({ pos, origen, radioM: 150 })` → `true` para un punto a ~50 m, `false` a ~500 m, `true` en el borde exacto (≤). Usa `haversineKm` (reusar el de `calcular-cobertura-telemetria.ts`).
- [ ] Config: `GEOFENCE_RADIUS_M` en `packages/config` con Zod (`z.coerce.number().int().positive().default(150)`).
- [ ] Implementar la función pura.
- [ ] Verde + commit `feat(api): geofence de origen + GEOFENCE_RADIUS_M`.
**Criterio de hecho:** dentro/fuera/borde verdes; radio leído de config.

### Task 9 — Disparo híbrido en la PWA del conductor
**Objetivo:** El geofence sugiere la recogida; el conductor confirma con un tap → llama el endpoint con `pickedUpAt = instante del cruce`; fallback a tap manual (instante del tap) si no hubo geofence.
**Archivos:** Modify `apps/web/src/routes/conductor.tsx`; Create hook `apps/web/src/hooks/use-confirmar-recogida.ts` + tests de componente.
**TDD:** Tests de componente (no critical-domain backend, pero con cobertura).
**Depende de:** Task 7, Task 8.
**Pasos:**
- [ ] Test (rojo): cuando la posición del conductor entra al geofence del origen, aparece la sugerencia "Confirmar recogida"; al tap, se llama `PATCH …/confirmar-recogida` con `pickedUpAt` = timestamp del cruce. Sin geofence disponible (sin GPS/permiso) → botón manual visible; al tap, `pickedUpAt` = now. La recogida NUNCA se bloquea por falta de señal (degradación corte #1).
- [ ] Implementar hook + UI (reusar `use-driver-position-reporter` para la posición).
- [ ] Verde + commit `feat(web): disparo híbrido de recogida (geofence sugiere + tap)`.
**Criterio de hecho:** sugerencia aparece con geofence; fallback manual; `pickedUpAt` correcto en ambos caminos.

> **=== GATE: F1 COMPLETO Y TESTEADO (Tasks 1–9). Recién aquí arrancan los tests de F2 sobre vehículos browser. ===**

### Task 10 — Enrutamiento de fuente de posición por tipo de vehículo
**Objetivo:** Módulo reusable que, dado un vehículo y una ventana temporal, devuelve sus pings desde la fuente correcta (con Teltonika → `telemetria_puntos`; sin → `posiciones_movil_conductor`), reusando el patrón de `vehiculos.ts:195-294`. NO merge.
**Archivos:** Create `apps/api/src/services/posicion-segmento.ts` + `.test.ts`.
**TDD:** SÍ.
**Depende de:** —
**Pasos:**
- [ ] Test (rojo): vehículo con `teltonika_imei` → lee de `telemetria_puntos` (por vehicle_id) en `[desde, hasta]`; vehículo con `teltonika_imei_espejo` → `telemetria_puntos` por `imei`; vehículo sin device → `posiciones_movil_conductor` por vehicle_id. Cada vehículo usa UNA sola fuente (sin dedup entre streams).
- [ ] Implementar `resolverPosicionesSegmento({ db, vehicle, desde, hasta }): Promise<PingPoint[]>` ordenado ascendente por timestamp.
- [ ] Verde + commit `feat(api): enrutamiento de posición por tipo de vehículo`.
**Criterio de hecho:** 3 ramas de routing verdes; salida ordenada; reusa el criterio de partición existente.

### Task 11 — Distancia real sobre el segmento `[pickedUpAt, deliveredAt]`
**Objetivo:** Adaptar el cálculo de cobertura para (a) anclar la ventana al `pickedUpAt` REAL (no `pickup_window_start`), (b) leer de la fuente ruteada (Task 10), (c) **retornar `kmCubiertos`** (hoy se descarta) además de `coverage_pct`.
**Archivos:** Modify `apps/api/src/services/calcular-cobertura-telemetria.ts` + tests.
**TDD:** SÍ (alimenta carbono).
**Depende de:** Task 6 (handler F1), Task 10.
**⚠️ ANTI-FALSO-VERDE (precondición obligatoria del test browser):** el test sobre un vehículo **sin Teltonika** DEBE primero ejercer el handler de F1 para activar `'recogido'` — secuencia: crear trip → asignar → **llamar `confirmarRecogidaViaje` (Task 6)** → postear posiciones browser dentro de `[pickedUpAt, deliveredAt]` (el guard de `assignments.ts:438` solo las acepta con status ∈ {asignado,recogido}) → `confirmarEntregaViaje` → recién entonces evaluar la distancia. Sin F1, la tabla browser estaría vacía y el test daría FALSO VERDE de "fallback estimado correcto".
**Pasos:**
- [ ] Test (rojo) Teltonika: pings reales en la ventana → `kmCubiertos` = suma haversine de tramos continuos; `coverage_pct` consistente. Ventana anclada a `pickedUpAt`.
- [ ] Test (rojo) browser (con la precondición anti-falso-verde arriba): tras ejercer F1, posiciones browser en el segmento → `kmCubiertos > 0` desde `posiciones_movil_conductor`.
- [ ] Implementar: que `calcularCobertura`/`calcularCoberturaPura` reciba `desde=pickedUpAt`, lea vía `resolverPosicionesSegmento`, y retorne `{ coveragePct, kmCubiertos }`.
- [ ] Verde + commit `feat(api): distancia real (kmCubiertos) sobre el segmento pickup→entrega`.
**Criterio de hecho:** `kmCubiertos` retornado; ventana anclada al pickup real; test browser pasa por F1 primero.

### Task 12 — Cómputo de huella real + umbral binario de cobertura
**Objetivo:** En el post-commit de la entrega, si la huella está activa (Task 3): cobertura ≥ umbral (vía `derivarNivelCertificacion`) → `kmCubiertos` alimenta `calcularEmisionesViaje` → poblar `distanceKmActual` + `carbonEmissionsKgco2eActual` (nivel primario); cobertura < umbral → distancia estimada + nivel **secundario** (degradación corte #2).
**Archivos:** Modify `apps/api/src/services/calcular-metricas-viaje.ts` (`recalcularNivelPostEntrega`), `apps/api/src/services/confirmar-entrega-viaje.ts` (wire post-commit) + tests.
**TDD:** SÍ (carbono/GLEC).
**Depende de:** Task 3, Task 11.
**Pasos:**
- [ ] Cargar los inputs del opt-in y resolver: `trips.medir_huella_override`, flag del generador (`trips.generadorCargaEmpresaId` → `empresas.medir_huella`, null-safe si no hay empresa) y del transportista (`assignments.empresaId` → `empresas.medir_huella`); pasar a `resolverOptInHuella` (Task 3). Si el resultado es false → no medir (no tocar `*Actual`).
- [ ] Test (rojo) cobertura alta: huella activa + cobertura ≥ umbral → `distanceKmActual` = `kmCubiertos`, `carbonEmissionsKgco2eActual` poblado (GLEC), nivel primario.
- [ ] Test (rojo) cobertura baja: huella activa + cobertura < umbral → `*Actual` con distancia estimada, nivel secundario; métrica de degradación emitida.
- [ ] Test (rojo) huella inactiva: opt-in efectivo false → no se computan `*Actual` (siguen null), no se llama carbon-calculator.
- [ ] Implementar el wire en el post-commit (que hoy recalcula nivel) reusando `derivarNivelCertificacion` como fuente única del umbral.
- [ ] Verde + commit `feat(carbon): huella real del segmento con umbral binario de cobertura`.
**Criterio de hecho:** `*Actual` poblado solo con cobertura ≥ umbral y huella activa; degradación a estimada/secundario explícita.

### Task 13 — Peso condicional + degradación nunca-`0`
**Objetivo:** Con huella activa: peso presente → mide normal; peso ausente (`cargoWeightKg` NULL) → **no computar** `carbonEmissionsKgco2eActual` (null) + métrica data-quality + cert degradada, **NUNCA `0`** (degradación corte #3). En el punto de activación, exigir peso cuando la huella esté activa.
**Archivos:** Modify `apps/api/src/services/calcular-metricas-viaje.ts` (reemplazar el `cargaKg = trip.cargoWeightKg ?? 0` del path real por la lógica condicional) + tests.
**TDD:** SÍ (carbono/GLEC).
**Depende de:** Task 3, Task 12.
**Pasos:**
- [ ] Test (rojo): huella activa + peso presente → mide con `cargoWeightKg`. Huella activa + peso NULL → `carbonEmissionsKgco2eActual` queda null, se emite métrica `huella_peso_ausente`, nivel degradado; **assert explícito de que NO es `0`**. Huella inactiva → no aplica.
- [ ] Implementar la rama condicional (no usar `?? 0` en el cómputo real de huella).
- [ ] Verde + commit `feat(carbon): degradación explícita por peso ausente (nunca 0)`.
**Criterio de hecho:** peso ausente con huella activa nunca produce emisiones `0`; métrica emitida.

---

## Columnas nuevas propuestas (requieren tu aprobación antes de implementar)

| Propósito | TS (Drizzle) | SQL (columna) | Tipo | Tabla |
|---|---|---|---|---|
| Opt-in huella (cliente) | `carbonMeasurementEnabled` | `medir_huella` | `boolean NOT NULL DEFAULT false` | `empresas` |
| Override por viaje | `carbonMeasurementOverride` | `medir_huella_override` | `boolean` (nullable; `null` = heredar de empresa) | `trips` |
| Latitud del origen | `originLatitude` | `origen_latitud` | `numeric(10,7)` (nullable) | `trips` |
| Longitud del origen | `originLongitude` | `origen_longitud` | `numeric(10,7)` (nullable) | `trips` |

Justificación de naming: `empresas` ya usa booleanos `es_*`/default false (`isGeneradorCarga`/`es_generador_carga`); `trips` usa `origin*` (TS) ↔ `origen_*` (SQL) para el origen (`originAddressRaw`/`origen_direccion_raw`); `numeric(10,7)` iguala la precisión de `posicionesMovilConductor.latitud/longitud`. **Opt-in efectivo** (Task 3): `tripOverride ?? (generadorEmpresa.medirHuella OR transportistaEmpresa.medirHuella)`. No requiere columna nueva: ambas empresas participantes leen el mismo `empresas.medir_huella` (generador vía `trips.generadorCargaEmpresaId`, transportista vía `assignments.empresaId`); el consignee no aporta (no es empresa).

---

## Orden de ejecución y por qué

1. **Migraciones primero (Tasks 1–2):** todo lo demás depende de las columnas; expand-safe, sin acoplar a lógica.
2. **Prerequisitos como tareas propias (Tasks 3–4):** el resolver de opt-in (3) y la geocodificación del origen (4) NO se diluyen en el handler — son contratos independientes con sus tests, y bloquean a quien depende de ellos (4 antes del geofence; 3 antes del cómputo de F2).
3. **F1 completo y testeado (Tasks 5–9) ANTES de los tests de F2 browser:** es la dependencia causal a nivel de **datos**, no solo de orden. El endpoint browser (`assignments.ts:438`) solo acepta posiciones con `status ∈ {asignado, recogido}`; como `'recogido'` solo lo activa el handler de F1 (Task 6/7), un test de F2 sobre un vehículo sin Teltonika que NO haya pasado por F1 mediría sobre `posiciones_movil_conductor` **vacía** y daría un FALSO VERDE de "fallback estimado correcto". El orden hace ese error imposible, y **Task 11 incluye la precondición explícita** de ejercer `confirmarRecogidaViaje` antes de evaluar distancia.
4. **F2 después (Tasks 10–13):** routing de posición (10) → distancia real sobre el segmento real (11) → huella con umbral (12) → degradación por peso (13). 12 y 13 son TDD carbono/GLEC; ambos gated por el opt-in (Task 3).
5. **Degradación en los 3 cortes** queda dentro de su tarea dueña: sin geofence → Task 9 (fallback tap); cobertura baja → Task 12; peso ausente → Task 13. Ninguna produce `0` ni falla en silencio.

---

## Ubicación del plan y disparo de CI/release

Este `plan.md` vive en **`.specs/medicion-huella-segmento/plan.md`** (convención Booster, junto al `spec.md`). Implicancia:
- **`release.yml` NO se dispara** en el merge — `.specs/**` está en su `paths-ignore` → sin deploy, sin run que cancelar.
- **`ci.yml`/`security.yml` SÍ corren** en el PR (no tienen `paths-ignore`), aunque sea docs-only.

## Self-review (cobertura del spec)

Cada sección del spec mapea a una tarea: F1 handler → 5–7; disparo híbrido + geofence → 8–9; geocodificación → 4; opt-in → 1,3; enrutamiento posición → 10; distancia real/`kmCubiertos`/pickup real → 11; umbral binario/`*Actual` → 12; peso/degradación nunca-0 → 13; columnas nuevas → sección dedicada; dependencia causal F1→F2 → orden + Task 11 anti-falso-verde. F3/F4 excluidos. Sin placeholders: cada tarea tiene archivos, criterio y asserts concretos.
