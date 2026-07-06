# W2 — integration test contra Postgres real para la reconciliación CAS de IMEI

**Dimensión**: api / testing · **Estado**: pendiente (no bloqueó W2 por decisión del review; el unit prueba el throw en el punto correcto).
**Fuente**: review W2a hito-2 (2026-07-06), concern 2 del fix round.

## Problema

La reconciliación del `PATCH /vehiculos/:id/dispositivo` (CAS + throw → rollback) y el `CASE` del upsert de re-enrollment del gateway (`imei-auth.ts:93-96`) se verificaron con unit tests sobre DB stub y revisión estática. Nadie ejecutó contra Postgres real: (a) que el throw dentro de la tx de drizzle produce ROLLBACK efectivo (incluido el UPDATE de `vehiculos` ya aplicado), (b) el comportamiento real de EvalPlanQual del CAS bajo dos conexiones concurrentes, (c) la coerción del literal del CASE al enum.

## Plan de pago

Integration test en `apps/api/test/integration/` (patrón de los existentes, Postgres local): dos clientes concurrentes — uno PATCH asociando IMEI con pending `pendiente`, otro rechazándolo vía panel; asertar que exactamente uno gana, que el perdedor recibe su 409 y que la BD queda consistente (vehículo sin IMEI si perdió, pending en el estado del ganador). Más un caso del gateway: upsert con row `reemplazado` → reabre `pendiente`; con `rechazado` → NO reabre.

## Nota relacionada (mismo review, "for the record")

El check de espejo del PATCH es read-then-act (el UPDATE de vehiculos no re-asserta `teltonika_imei_espejo IS NULL`). Hoy el espejo no tiene write path por API (solo seed demo) — si algún día lo gana, agregar el predicado al WHERE del UPDATE.
