# W3 — Contexto verificado para telemetría de temperatura (exploración 2026-07-06)

> Exploración read-only. Insumo del brief W3. Depende de W2 (el simulador necesita un IMEI asociado vía el PATCH nuevo).

## Esencial

- **No hay encoder Codec8 de librería**: `scripts/load-test/telemetry-gateway.ts` (392 líneas, `buildImeiHandshake` L82-87, `buildAvlPacket` L94-195 con 14 IOs hardcodeados, `crc16Ibm` local L201-210) y `apps/telemetry-tcp-gateway/scripts/smoke-test.ts` (1 packet, 0 IOs, **default host = IP de PRODUCCIÓN 34.176.126.66**, puerto 5027) construyen buffers a mano y reimplementan CRC16 pese a que `@booster-ai/codec8-parser` exporta `crc16Ibm` (index.ts:29). El parser solo expone encode de ACKs (`encodeImeiAck`/`encodeAvlAck`), no de packets AVL.
- **`scripts/demo/` no existe** — crear desde cero. Sin fixtures GPS La Serena↔Coquimbo en el repo (generar por interpolación).
- **Dallas Temperature (IOs 72-75 FMC150) no existe en el repo** (grep: cero referencias). Crear catálogo en `packages/shared-schemas/src/avl-ids/` con el patrón de `low-priority.ts` + `interpret-low-priority.ts`. **Precedente exacto**: `AVL_ID.BATTERY_CURRENT` (68) — int16 con signo, el parser lee N2 SIEMPRE unsigned (`readUInt16BE`), la conversión `toSignedInt16` va en la capa de interpretación (interpret-low-priority.ts:157-162). Dallas: décimas de °C con signo → int16 en grupo N2, Codec 8 basta (IDs 1 byte).
- **`telemetria_puntos.io_data` (jsonb) se escribe pero NADIE lo lee hoy**: `persist.ts:61-65` vuelca `{String(id): value}` crudo (sin signo ni unidad); ninguno de los 3 endpoints (`/ubicacion` L593-724, `/telemetria` L523-584, `/flota` L175-330 de vehiculos.ts) selecciona `io_data`.
- **Endpoint objetivo**: `GET /vehiculos/:id/ubicacion`. Shape actual: `{vehicle_id, plate, teltonika_imei, teltonika_source, ubicacion:{timestamp_device, timestamp_received_at, latitude, longitude, altitude_m, angle_deg, satellites, speed_kmh, priority[, accuracy_m]}}`. Tres fuentes: Teltonika propio / espejo / fallback `posicionesMovilConductor` (L622-663) — **el fallback browser_gps no tiene sensores → temperatura siempre "sin dato" ahí**.
- **UI**: `apps/web/src/routes/vehiculo-live.tsx` (79 líneas), polling `refetchInterval: 15_000` (no SSE), interfaz `UbicacionResponse` L16-30. Renderiza `LiveTrackingScreen` (components/map/) que ya tiene tarjeta con 3 `Stat` y **slot `bottomExtra?: ReactNode`** (L43/198-200) — punto natural para la temperatura. Test base: `vehiculo-live.test.tsx` (135 líneas).
- **Flujo de tipado**: parser (IoEntry crudo) → `pubsub-publisher.ts:37-61` (`buildWireRecordMessage`) → `telemetryRecordMessageSchema` (shared-schemas/src/events/telemetry-record.ts:24-50, único contrato) → persist. No hay Zod de salida de telemetría; respuestas de vehiculos.ts son TS plano.

## Gotchas

1. **Dedup**: `UNIQUE(imei, timestamp_device)` + `ON CONFLICT DO NOTHING` (persist.ts:91) — el simulador DEBE variar `timestamp_device` por record o los puntos se pisan en silencio.
2. **IMEI sin asociar** = ACK true igual (open enrollment, rate 30/60s/pod) pero los records se **descartan con warn** en persist.ts:41-59. Asociar ANTES de simular (vía W2).
3. **Sin validación de plausibilidad de timestamps** (el diseño del ADR-005 — futuro >5min, saltos, >150km/h — NO está implementado; solo aspiracional).
4. **Pipeline local**: no hay docker-compose ni emulator wiring en el repo. Processor consume `PUBSUB_SUBSCRIPTION_TELEMETRY` (default `telemetry-events-processor-sub`). `@google-cloud/pubsub` respeta `PUBSUB_EMULATOR_HOST` nativamente pero ningún script lo automatiza. E2E local = Postgres local + emulator manual (o GCP real con ADC — ojo memoria: gcloud CLI del usuario tiene token stale; usar ADC).
5. Doc drift: la migración 0005 cita `apps/api/src/services/io-catalog.ts` — no existe; el catálogo real es `shared-schemas/src/avl-ids/`.
6. Batching Pub/Sub 100 msgs/100ms — irrelevante a volumen demo.
