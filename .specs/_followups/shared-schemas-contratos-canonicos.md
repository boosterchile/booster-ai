# Follow-up: consolidar contratos canónicos en shared-schemas (telemetría + estados de viaje)

**Origen**: Auditoría arquitectónica 2026-06-09 (corte transversal de datos + fundaciones), riesgos altos "contrato telemetry-events duplicado" y "domain de trips desalineado".
**Prioridad**: P2.

## Problema

Dos contratos núcleo tienen doble fuente de verdad:

1. **Wire format de `telemetry-events`**: la interface real es `RecordMessage` en `apps/telemetry-tcp-gateway/src/pubsub-publisher.ts:21-26` con espejo Zod copiado a mano en `apps/telemetry-processor/src/persist.ts:13-39`. El schema "canónico" `telemetryEventSchema` (`packages/shared-schemas/src/domain/telemetry.ts`) tiene OTRA forma y nadie lo usa en el wire. Un cambio en el publisher sin actualizar el espejo = descarte silencioso de mensajes (ack de malformados).
2. **Estados de viaje**: `tripStateSchema` define 17 estados en inglés (ADR-004) sin consumidores; el enum vivo `estado_viaje` tiene 9 en español (`apps/api/src/db/schema.ts:211-221`). `tripStateChangedEventSchema` referencia los estados muertos. ~18 de 38 tablas no tienen schema domain (regla CLAUDE.md incumplida).

## Acción propuesta

- Mover `recordMessageSchema` (el wire REAL) a `packages/shared-schemas/src/events/` e importarlo desde gateway (tipo) y processor (validación). Eliminar el espejo.
- Decidir el destino de `domain/telemetry.ts` y `tripStateSchema`: actualizarlos a la realidad o eliminarlos con nota (ADR corto si se abandona el vocabulario ADR-004).
- Coordinar con el refactor trip-state-machine (`.specs/arch-trip-state-machine-refactor/`) — la tabla de transiciones del package nuevo debe derivar del enum REAL, no del domain muerto.
- Cerrar el gap de las ~18 tablas sin schema domain o ajustar la regla del CLAUDE.md a la realidad deliberada.

## Estado

Pendiente. Sin asignar a ciclo.
