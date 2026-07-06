# W4 — Contexto verificado para tipologías + huella desde inicio (exploración 2026-07-06)

> Exploración read-only. Insumo del diseño W4a/W4c. Decisión D1 (Opción A + 4 condiciones) en `decisiones.md`.

## Hallazgo estructural que ajusta la Opción A

**El vehículo del viaje NO vive en `viajes`**: vive en `assignments.vehicleId` (`vehiculo_id`, NOT NULL, FK restrict; `assignments.tripId` UNIQUE → 1:1 con trips). La FK `unidad_arrastre_id` de la Opción A debería vivir en `assignments` junto a `vehicleId` (la "configuración efectiva del servicio"), no en `viajes` como decía el plan original. **Presentar al PO junto al DDL.**

## 1. Modelo actual

- `vehicleTypeSchema` (shared-schemas/src/domain/vehicle.ts:5-15): 9 valores planos — camioneta, furgon_pequeno, furgon_mediano, camion_pequeno, camion_mediano, camion_pesado, semi_remolque, refrigerado, tanque.
- `capacity_kg: z.number().int().positive()` (L35) y `curb_weight_kg positive` (L45) — bloquean tracto sin carga propia (condición D1.2: relajar con semántica por categoría).
- Tabla `vehiculos` (schema.ts:772-837): `tipo_vehiculo` pgEnum (89-99, mismos 9), `capacidad_kg` NOT NULL sin CHECK, `peso_vacio_kg`, `consumo_l_por_100km_base`. Índices: empresa_estado_capacidad (hot matching), tipo.
- **7 ubicaciones duplican el enum literal** (actualizar juntas): vehiculos.tsx:19-27 + labels 59-68; routes/vehiculos.ts:64 (Zod local con `.max(100_000)` extra, duplicado e independiente); seed-demo.ts; carbon-calculator/src/tipos.ts:225-234 (union literal, package zero-dep sin import de Zod); factor-carga.ts (switch); cargo-request.ts:68 (`required_vehicle_type` del matching).
- Única referencia "articulado": comentario licenciaClaseEnum schema.ts:114-123 (A5 habilita articulado >3.5t con remolque).

## 2. carbon-calculator

- `categoriaVehiculo()` switch exhaustivo SIN default (factor-carga.ts:49-66): agregar valor al enum rompe compilación (protección natural). LDV={camioneta,furgon_pequeno}, MDV={furgon_mediano,camion_pequeno}, HDV={camion_mediano,camion_pesado,semi_remolque,refrigerado,tanque}.
- `ALFA_POR_CATEGORIA={LDV:.05, MDV:.1, HDV:.15}`; `calcularFactorCorreccionPorCarga` cap ratio≤1.5 y **retorna 1 si capacidadKg≤0** (ya tolera capacidad 0).
- `DEFAULTS_POR_TIPO` (defaults-por-tipo.ts): entry por cada tipo (semi_remolque: diesel, 38L/100km, 40000kg).
- **API ya soporta categoría explícita**: `ParametrosModelado`/`ExactoCanbus` no reciben tipoVehiculo; `calcularModeladoConCategoria` acepta `categoria` override (default MDV legado). → La clase-por-configuración se computa en el service (GVW/capacidad agregada motriz+arrastre) y se PASA explícita; no exige romper la API del package.
- Tests: 9 archivos Vitest en packages/carbon-calculator/test/, estilo cálculo-comentado.

## 3. Viajes / estados

- `trips` (schema.ts:1092-1148): `cargoWeightKg` nullable (1109), `carbonMeasurementOverride` (1132, migración 0046 — única task implementada del spec hermano), sin origin lat/lng.
- `assignments` (1193-1260): `vehicleId` NOT NULL (1208-1210), `pickedUpAt`/`deliveredAt` nullable (1219-1220; **solo deliveredAt se popula hoy**), status enum `['asignado','recogido','entregado','cancelado']` — **'recogido' existe y nada lo setea**.
- trip-state-machine: `TRANSICIONES.asignado = ['en_proceso','entregado']` (transiciones.ts:26); guards existentes esCancelablePorShipper/esAceptableOferta/esConfirmableEntrega; **NO existe esConfirmableRecogida**; comentario L14: "pickup... MODELADO pero aún sin flujo que lo dispare". **Grep: NADA dispara asignado→en_proceso en el api.**

## 4. Spec medicion-huella-segmento — estado real

Solo Task 1 de 13 implementada (columnas opt-in, 0046). NO existen: origin lat/lng (T2), resolver-opt-in-huella (T3), geocodificar-origen (T4), esConfirmableRecogida (T5), confirmar-recogida-viaje (T6), endpoint confirmar-recogida (T7), geofence-origen (T8), disparo UI (T9), posicion-segmento (T10), kmCubiertos expuesto (T11 — `calcularCoberturaPura` ya lo acumula internamente y lo descarta, calcular-cobertura-telemetria.ts:88-111), huella real (T12-13). **W4c = implementar UN solo handler de inicio que sirva ambos specs** (timestamp + origen/destino del conductor + configuración efectiva), no dos flujos paralelos.

## 5. Cálculo hoy

- `calcularMetricasEstimadas` (calcular-metricas-viaje.ts:177): al asignar; `cargaKg = cargoWeightKg ?? 0` (bug conocido del spec); modo modelado si fuelType+consumo, sino por_defecto con vehicleType, sino fallback camion_mediano (271); persiste precisionMethod, `routeDataSource='maps_directions'` fijo (294), `coveragePct=0` fijo (295).
- `recalcularNivelPostEntrega` (411): post-commit de confirmar-entrega-viaje.ts:267; sin teltonikaImei → skip silencioso (489-495); con IMEI ancla cobertura a `pickupWindowStart ?? createdAt` (500) — no a pickup real.
- confirmar-entrega-viaje.ts: patrón espejo para el handler de inicio — tx con FOR UPDATE + CAS `WHERE status IN (asignado,en_proceso)` (217), post-commit fire-and-forget (recalcular→matching→scoring→coaching→liquidar→certificado).

## 6. Fallback sin Teltonika

- driver-position.ts (web): `POST /assignments/:id/driver-position`; hook use-driver-position-reporter desde conductor.tsx (botón "Iniciar reporte GPS" siempre visible).
- Guard del endpoint (assignments.ts:438): acepta status asignado|recogido → 409 si no. **Ya acepta 'recogido'.**
- `posicionesMovilConductor` (schema.ts:968-1000): assignmentId, vehicleId, userId, lat/lng numeric(10,7), accuracyM, speedKmh, headingDeg, source='browser'.
- **routes-api.ts `computeRoutes` YA manda `vehicleInfo:{emissionType}` + `extraComputations:['FUEL_CONSUMPTION']`** cuando recibe emissionType (150-153). Falta: field-mask `routes.legs.startLocation` (geocodificar origen) y poblar route_data_source/coverage_pct reales pre-entrega.
- ADR-022: precision_method ∈ {exacto_canbus, modelado, por_defecto}; WTW diesel 3.21. ADR-028: routeDataSource ∈ {teltonika_gps, maps_directions, manual_declared} + coveragePct + matriz certificación 95%/80%; patrón routing-no-merge en vehiculos.ts:195-294.

## 7. Conductor UI

- conductor.tsx (447): dashboard + AssignmentCard (origen/destino/carga/ventana + "Iniciar reporte GPS" + link detalle). **Sin acción de inicio/recogida.**
- asignacion-detalle.tsx (199): DriverAssignmentCard, EcoRouteCard, **DeliveryConfirmCard (único cambio de estado real: PATCH confirmar-entrega, visible en asignado|en_proceso)**, IncidentReport, BehaviorScore, CobraHoy, ChatPanel. **Sin "Iniciar viaje".**

## 8. Guards de migración

- ADR-043: SQL canónico; clases A/B/C de cambio (B = breaking API → flag + doble-emit + sunset).
- ADR-044: test migration-journal-integrity (idx monotónico, tag==prefijo, counts); declarar expand-only + estrategia rollback en comentario (runbook db-migration-rollback).
- Última migración: **0047** → W4a usa **0048**. Plantillas de estilo: 0045 (CHECK constraint + statement-breakpoint + COMMENT) y 0046 (prosa expand-only, dominio opt-in huella).

## 9. copy-guide.md

Sin claim central hoy (secciones: Tono, Tuteo, Glosario prohibidas, Mayúsculas, Tipografía, Empty states, Errores, Revisión). Insertar `## Claim central de marca` tras `## Tono general` con "impacta menos, transporta más" + reglas de uso (minúsculas, sin exclamación, coherente con tono actual).
