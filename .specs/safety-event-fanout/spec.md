# Spec — Safety event fan-out (P0-G)

**Fecha**: 2026-06-14
**Estado**: DISEÑO (pendiente aprobación PO)
**Origen**: auditoría 2026-06-14 hallazgo P0-G; go-live de 10 Teltonika en carriers reales (sem. del 2026-06-15 + siguiente).
**Dominio crítico**: sí (seguridad física) → TDD obligatorio (`booster-skills:tdd-dominio-critico`).

---

## 1. Objetivo

Cuando un Teltonika real reporta un evento de **seguridad física** (crash, unplug/tamper, jamming GNSS), el **transportista dueño del camión** recibe una notificación (push + WhatsApp). Hoy esos eventos solo disparan alertas a on-call; **nadie del lado del cliente se entera**. Con camiones reales en ruta, ese gap es inaceptable.

Éxito = un evento panic de un vehículo real produce, en < ~30 s, una notificación entregada al dueño del transportista, de forma idempotente (sin spam) y auditable.

## 2. Decisiones fijadas (confirmadas por el PO)

1. **Consumer en `apps/api`** (no construir `notification-service`). Reusa `web-push`, `whatsapp-client`, el patrón `notify-incident-shipper`. El skeleton `notification-service` se retira en el cleanup de demo (spec aparte).
2. **Eventos**: crash + unplug + jamming. **Destinatario**: transportista (dueño del camión). Generador de carga = fase 2 (fuera de scope).
3. **Canal**: push (PWA) primario + WhatsApp fallback (mismo patrón que el chat). ⚠️ El template WhatsApp requiere aprobación de Meta (24-48 h) → **iniciar hoy**.

**Decisión derivada**: transporte del consumer = **Pub/Sub push subscription → endpoint HTTP en `apps/api`**, autenticado por OIDC del SA (patrón `INTERNAL_CRON_CALLER_SA` ya existente). Evita un worker pull nuevo.

## 3. Arquitectura y data flow

```
telemetry-processor                     apps/api
┌────────────────────────┐             ┌─────────────────────────────────────┐
│ CONSUMER 1 (telemetry) │             │ POST /internal/safety-events        │
│  logPanicEvents()      │  publish    │  (OIDC SA auth + Zod)               │
│   detecta Unplug/Jam ──┼──► topic ──►│   1. routeSafetyRecipients(vehId)   │
│                        │ safety-p0   │      → asignación activa | vehículo  │
│ CONSUMER 2 (crash)     │  (push sub) │      → empresa transportista        │
│  persistCrashTrace ────┼──► topic ──►│      → memberships dueno/activa      │
└────────────────────────┘             │   2. dedupe (vehId+tipo, ventana)   │
                                        │   3. fan-out:                        │
                                        │      sendPushToUser (web-push)       │
                                        │      + WhatsApp (CONTENT_SID safety) │
                                        │   4. log estructurado + métrica      │
                                        └─────────────────────────────────────┘
                                                   │ falla → DLQ (existente)
```

**Routing (núcleo)**: dado `vehicleId` (o `imei`):
1. Buscar **asignación activa** del vehículo (`asignaciones` en estado en-curso) → da contexto de viaje (tracking_code, origen/destino) para el mensaje.
2. **Fallback sin viaje**: si no hay asignación activa (camión parado/tamper fuera de ruta), resolver la empresa por `vehicles.empresaId` directo. Un crash/unplug debe avisar igual.
3. Empresa transportista → `memberships` con `role='dueno'` y `status='activa'` → `users` → push subscriptions + teléfono E.164.

## 4. Componentes (archivos)

| # | Componente | Archivo | Qué hace |
|---|---|---|---|
| 1 | **Schema del evento** | `packages/shared-schemas/src/domain/safety-event.ts` (nuevo) | Zod `safetyEventSchema`: `{ eventType: 'crash'|'unplug'|'jamming', imei, vehicleId?, occurredAt, rawValue?, severity }`. `z.infer` para el tipo. Export en index. |
| 2 | **Producer unplug/jamming** | `apps/telemetry-processor/src/panic-events.ts` | Añadir `publishSafetyEvents()` (junto a `logPanicEvents`, no en vez de): publica cada PanicEvent al topic safety-p0 vía `@google-cloud/pubsub` (patrón `chat-pubsub.ts`). Fire-and-forget, nunca bloquea el ack del record. Gated por env (topic configurable). |
| 3 | **Producer crash** | `apps/telemetry-processor/src/persist-crash-trace.ts` (o el adapter) | Tras persistir el crash trace, publicar un safety-event `crash` al mismo topic. |
| 4 | **Infra: push subscription** | `infrastructure/messaging.tf` | Cambiar `telemetry-events-safety-p0-notification-sub` de pull(notification-service) a **push** → `https://<api>/internal/safety-events` con OIDC (`push_config.oidc_token`, SA dedicado). Mantener DLQ + retry ya configurados. |
| 5 | **Endpoint consumer** | `apps/api/src/routes/internal-safety-events.ts` (nuevo) | `POST /internal/safety-events`. Auth: OIDC del SA de push (mismo patrón que `/admin/jobs/*` con `INTERNAL_CRON_CALLER_SA`). Valida el envelope Pub/Sub + el `safetyEventSchema` con Zod. Llama al service. 200 = ack; 5xx = nack→retry→DLQ. |
| 6 | **Routing** | `apps/api/src/services/route-safety-recipients.ts` (nuevo) | `vehicleId/imei → recipients[]` (users dueño + sus push subs + teléfono). Función pura sobre la query; testeable. Maneja el fallback sin viaje. |
| 7 | **Fan-out** | `apps/api/src/services/dispatch-safety-notification.ts` (nuevo) | Orquesta: dedupe (tag `safety-${vehId}-${tipo}`, ventana configurable, Redis como el chat) → `sendPushToUser` (web-push existente) + WhatsApp (`whatsapp-client` + `CONTENT_SID_SAFETY_ALERT`). Cada canal best-effort, loguea y sigue (no swallow silencioso: log + métrica). |
| 8 | **WhatsApp template** | (Twilio Content Editor + Meta) | Nuevo template `safety_alert_v1` (categoría UTILITY, es). Variables: {{1}} patente/alias del vehículo, {{2}} tipo de evento, {{3}} hora local, {{4}} tracking_code o "Sin viaje activo". Contenido en `.specs/safety-event-fanout/whatsapp-template.md`. **Submit a Meta hoy** (24-48h). Env `CONTENT_SID_SAFETY_ALERT` (optional hasta aprobación; sin él, WhatsApp se skipea y push igual sale). |
| 9 | **Config** | `apps/api/src/config.ts`, `telemetry-processor/src/config.ts` | `SAFETY_EVENTS_TOPIC`, `CONTENT_SID_SAFETY_ALERT` (optional), SA de push permitido en el endpoint. Zod en boundary. |
| 10 | **Métrica + OTel** | en el endpoint/service | `safety_notifications_total{event_type,channel,outcome}`, span OTel, log con `trace_id`, `vehicle_id`, `empresa_id`, `event_type`. |

## 5. Manejo de errores

- **Idempotencia/dedupe**: jamming sostenido emite muchos records → dedupe por `(vehicleId, eventType)` en ventana (ej. 10 min) vía Redis SET NX EX. Sin esto, spam al transportista.
- **Sin destinatario** (empresa sin dueño activo / sin push sub / sin teléfono): log WARN + métrica `outcome=no_recipient`, ack igual (no reintentar — no es transitorio).
- **Falla de canal**: push o WhatsApp fallan → log + métrica `outcome=channel_error`, **no** re-throw si el otro canal salió; si ambos fallan, 5xx → Pub/Sub reintenta → DLQ tras max-attempts (ya configurado, 5).
- **Producer**: el publish nunca bloquea ni lanza en el path de telemetría (fire-and-forget; el evento ya se logueó para on-call aunque el publish falle).
- **Auth del endpoint**: rechaza si el OIDC no es del SA de push (403). Nunca procesa un POST no autenticado.

## 6. Testing (TDD obligatorio — dominio safety)

Tests escritos **antes** del código (red→green):
- **`route-safety-recipients`** (unit): con viaje activo; sin viaje (fallback a `vehicles.empresaId`); empresa sin dueño; múltiples dueños.
- **`dispatch-safety-notification`** (unit): dedupe dentro de ventana (segundo evento no notifica); push ok + WhatsApp skip (sin CONTENT_SID); ambos canales fallan → propaga para nack; un canal falla → ack.
- **`panic-events` publish** (unit): publica N eventos; no lanza si el publisher falla.
- **endpoint** (integration): envelope Pub/Sub válido → 200 + notificación; OIDC inválido → 403; payload malformado → 400; evento duplicado → 200 sin segunda notif.
- Coverage ≥ 80% líneas / ≥ 75% branches en lo nuevo.

## 7. Fuera de scope (specs/fases aparte)

- **Gateway hardening** (rate-limit + IP allowlist de IMEIs, P1-3) — spec separada, también go-live-blocking, se diseña después de esta.
- **Generador de carga** como segundo destinatario — fase 2.
- **Retiro del subsistema demo** (incl. `notification-service` skeleton, mirror, middlewares) — proyecto en fases aparte.
- **De-demo del device 863…** — operativo y trivial (asignar `teltonika_imei` al vehículo real vía `/admin/dispositivos-pendientes`); no requiere código nuevo.

## 8. Riesgos y dependencias

- **WhatsApp/Meta lead-time (24-48h)**: el template `safety_alert_v1` debe submitearse hoy o el canal WhatsApp no estará para la instalación. Push no depende de Meta → la feature funciona con push aunque el template no esté aprobado aún.
- **Push requiere PWA instalada + suscripción**: los dueños de los carriers reales deben tener la PWA y haber aceptado push. Acción operativa de onboarding (verificar al instalar los devices).
- **Cambiar la subscription a push**: toca `messaging.tf` (infra) + requiere el SA de push con permiso de invocar el endpoint. Apply gateado (revisar plan, como el resto de infra).
- **El endpoint es internet-facing** (Pub/Sub push llega por HTTPS): la auth OIDC del SA es la única barrera → test de auth es P0.

## 9. Criterio de terminado

- Un evento panic real (o simulado en test) de un vehículo con dueño activo → push entregado (+ WhatsApp si template aprobado), deduplicado, con métrica y log con `trace_id`.
- TDD verde, coverage en umbral, `pnpm ci` ok.
- Infra: subscription push aplicada con plan revisado; endpoint rechaza no-OIDC.
- PR con sección Evidencia (tests + trace del endpoint + plan de infra).
