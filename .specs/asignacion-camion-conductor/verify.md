# Verificación

Corrido el 2026-10-20 en Node 22 (el repo pide Node 24; `tsc` y vitest pasaron igual).

## Rojo, antes de implementar

API (`asignar-conductor-a-assignment` + `assignments-route`): 7 failed, 56 passed.

- `driverPending` era `undefined` (el servicio no marcaba al pendiente).
- `newVehicleId` era `undefined` (el servicio ignoraba `vehiculo_id`).
- Vehículo de otra empresa, retirado o de arrastre: la promesa resolvía en vez de rechazar.
- `GET /assignments/:id` no devolvía `driver_user_id`.
- `vehiculo_id` inválido no respondía 400 (el body lo descartaba).

Web (`DriverAssignmentCard` + `asignacion-detalle`): 7 failed, 7 passed.

- El conductor con `is_pending` no estaba en el selector.
- No existía el selector de camión.
- Con viaje `asignado` y sin conductor, la pantalla seguía montando entrega, chat y documentos.

## Verde

- `@booster-ai/api`: 66 passed (2 files).
- `@booster-ai/web`: 15 passed (2 files).
- `tsc --noEmit` en `@booster-ai/api` y `@booster-ai/web`: exit 0.

Sin migración. `asignaciones.vehiculo_id` ya existía.
