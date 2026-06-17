# P0-G — Servicios skeleton consumiendo eventos P0 de seguridad física

**Dimensión**: sre / tech-debt · **Esfuerzo**: M · **Requiere decisión PO**
**Fuente**: audit 2026-06-14

## Problema
`apps/notification-service`, `apps/matching-engine`, `apps/document-service` son `logger.info('starting (skeleton)')` (sin implementación). Sin embargo `messaging.tf` tiene la subscription `telemetry-events-safety-p0-notification-sub` (crash/unplug/jamming) apuntando a `notification-service`. Los eventos safety SÍ se loguean en `panic-events.ts` (telemetry-processor) pero **la notificación al transportista nunca ocurre** (no hay consumer). El topic `document-events` no tiene subscription (ver P1-F).

## Impacto
Eventos P0 de seguridad física (crash/jamming/unplug) encolados sin consumidor → la alerta al transportista no se entrega. Discrepancia de clasificación: tech-debt lo veía P2 ("stub inofensivo"), pero el contexto operacional (subscriptions safety apuntándole) lo eleva a **P0**.

## Plan de pago (decisión PO requerida)
Opción A: implementar consumidor mínimo de `notification-service` para eventos safety-p0 (fan-out real al transportista).
Opción B: eliminar los skeletons de Cloud Run + cerrar/redirigir las subscriptions + añadir alertas de backlog (`oldest_unacked_message_age`, ver P1-A) para detectar mensajes sin consumir.
Mitigación inmediata sin decidir A/B: **P1-A** (alertas de backlog en las 4 subs Wave 2) da visibilidad ya.
Probable ADR (decisión arquitectónica de qué servicios son productivos vs placeholders).

## NO ejecutar ahora
Requiere decisión de producto/arquitectura antes de tocar. Diagnóstico.
