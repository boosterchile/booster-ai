# P0-G — Servicios skeleton consumiendo eventos P0 de seguridad física

> ✅ **PREMISA CORREGIDA (2026-06-22)** — el gap P0 que describía este stub **ya
> está cerrado**. La verificación en vivo contra `main` + infra mostró:
>
> - El fan-out de eventos safety-p0 (crash/unplug/jamming) al transportista
>   **está implementado y aplicado en prod**, pero **NO** por notification-service:
>   el consumer es `apps/api` vía **PUSH subscription** → `POST /internal/safety-events`
>   (OIDC). Productor en `telemetry-processor/panic-events.ts` + crash; routing
>   `route-safety-recipients.ts`; dispatch push+WhatsApp `dispatch-safety-notification.ts`.
>   Decisión **del PO** en `.specs/safety-event-fanout/spec.md` ("Consumer en apps/api,
>   no construir notification-service; el skeleton se retira en el cleanup de demo").
>   `SAFETY_EVENTS_TOPIC` (compute.tf:464) + `SAFETY_PUSH_CALLER_SA` (compute.tf:102)
>   cableados; `terraform plan` desde main = No changes → **vivo en prod**. Pendiente
>   solo el leg WhatsApp (template Meta `safety_alert_v2`, ver [[safety-alert-template-2026-06]]);
>   web push ya opera.
> - Las subs PULL "huérfanas" (security-p1, eco-score, trip-transitions → skeletons
>   notification-service/matching-engine/trip-state-machine) **no tienen productor**
>   (`telemetry-processor/config.ts` solo define `SAFETY_EVENTS_TOPIC`) → backlog
>   cero → benignas (infra adelantada a la implementación).
> - **Residual real corregido en esta sesión**: la alerta CRITICAL `safety_p0` en
>   `telemetry-monitoring.tf` documentaba `consumer = "notification-service"` (servicio
>   equivocado) → on-call iría al skeleton en un incidente de seguridad física. Fix:
>   apunta a `apps/api · POST /internal/safety-events`.
>
> **Pendiente (decisión PO, baja urgencia)**: retirar los 3 skeletons
> (notification-service, matching-engine) + cerrar/limpiar las subs huérfanas en el
> cleanup de demo (ver [[demo-subsystem-debt]]). NO urgente: sin productores no hay
> backlog ni costo de mensajes.

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
