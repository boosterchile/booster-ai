# Spec — `notification-service`: extracción del canal WhatsApp (T10-21, servicio 2 de 3)

**Programa**: TRL 10, fase D. Criterio T10-21 de `.specs/trl10/spec.md`.
**Patrón**: [ADR-083](../../docs/adr/083-staging-gemelo-y-extraccion-con-shadow.md) §2 y `.specs/microservicios-t10-21/spec.md` §3.
**Estado**: aceptada por el PO el 2026-10-08 ("sigue con notification-service").

## Alcance de esta entrega

Se extrae el **canal WhatsApp** (Twilio Content Templates). Todo envío de WhatsApp del api pasa por un único método, `TwilioWhatsAppClient.sendContent`, que usan:

- `notify-offer`
- `notify-tracking-link`
- `chat-whatsapp-fallback`
- `conductor-activacion-whatsapp`
- `internal-safety-events` (vía `dispatch-safety-notification`)

Ese método es el punto de corte. La lógica de "a quién y qué" (queries, destinatarios, `notificado_en`) se queda en el api, y la entrega pasa al servicio.

**Fuera de esta entrega**, y declarado como etapa 2:

- **Web Push** (`web-push.ts`): ante un 410 Gone borra la suscripción en la base. Extraerlo exige que el servicio escriba en Postgres o un evento de vuelta.
- **Email** (`services/notifications/email-sender.ts`).

Para cerrar el criterio T10-21 de `notification-service` basta que el servicio atienda tráfico de prod con imagen propia. El canal WhatsApp cumple con eso.

## Contrato

Topic `notification-events`, ya declarado en `messaging.tf`. El evento es `notificationEventSchema` en `@booster-ai/shared-schemas`:

```
{ version: 1, idempotencyKey: uuid, canal: 'whatsapp_template', modo: 'enviar' | 'sombra',
  destinatario: E.164, contentSid: ^HX…, variables: Record<string,string>,
  hashEsperado?: sha256 hex (obligatorio si modo = 'sombra'), emitidoEn: ISO datetime }
```

`hash` es el sha256 de la forma canónica del request a Twilio, `{From, To, ContentSid, ContentVariables}`, con las claves ordenadas. La calcula `hashTwilioContentForm` en `@booster-ai/whatsapp-client`. Cada lado usa **su propio** `TWILIO_FROM_NUMBER`, así que la sombra detecta divergencias de config (sender, normalización `whatsapp:`) y no solo de código.

## Modos del api (flags)

| `NOTIFICATIONS_VIA_MICROSERVICE` | `NOTIFICATIONS_SHADOW` | Comportamiento de `sendContent` |
|---|---|---|
| false | false | Directo a Twilio (hoy) |
| false | true | Directo a Twilio **y** publica `modo: 'sombra'` con `hashEsperado`, fire-and-forget. Si la publicación falla, se loguea y no afecta el envío real |
| true | (ignorado) | Publica `modo: 'enviar'` y devuelve `sid = pubsub:<messageId>`. Si la publicación falla, lanza, igual que un error de Twilio, y el caller lo maneja como hoy |

La config se rechaza al arrancar si un flag está activo y falta `NOTIFICATION_EVENTS_TOPIC`. El rollback consiste en apagar el flag y redeployar: el código directo nunca se borra durante la ventana de ADR-048 §1.7.

## Servicio

- Consumer pull de `notification-events-sub`, con `enable_exactly_once_delivery`, DLQ tras 5 intentos y retry de 10 a 600 s.
- Por mensaje:
  1. Zod. Si es inválido, ack y log `error`, sin reintento.
  2. `modo = 'sombra'`: arma el form con su config y compara su hash con `hashEsperado`.
     - Si coinciden, log `info` `notificacion sombra coincide`.
     - Si no, log `warn` `notificacion sombra diverge`. Lo cuenta la log-based metric `notification_shadow_divergencias`.
     - En ambos casos hace ack y **nunca envía**.
  3. `modo = 'enviar'`: llama a `sendContent`.
     - Twilio 4xx (número inválido, template rechazado): ack y log `error`. Reintentar no lo arregla.
     - 5xx o red: nack, reintento y DLQ.
- Health en `/health`, `min_instances = 1`, `cpu_idle = false` (consumer pull). No usa base ni Redis: queda como un emisor sin estado que tiene las credenciales de Twilio.

## Criterios de éxito

- [ ] TDD con el rojo exhibido para el enrutador del api y el handler del servicio.
- [ ] Coverage ≥ 80 % en api, notification-service y whatsapp-client.
- [ ] La imagen se construye: smoke `node dist/main.js` falla solo por config.
- [ ] `terraform validate` OK. Los flags quedan en `false` por defecto, así que el apply no cambia el comportamiento.
- [ ] **Post-merge (PO)**:
  1. `terraform apply` y release.
  2. `notifications_shadow = true` durante 3 a 7 días, con `notification_shadow_divergencias = 0` sin explicar.
  3. Drill en staging (`docs/runbooks/service-notification-service.md` §Drill).
  4. `notifications_via_microservice = true`.
  5. Evidencia: `notificacion enviada` en los logs del servicio y subscription `ack_message_count > 0` en Cloud Monitoring.

## Riesgo aceptado

Exactly-once delivery de Pub/Sub evita la redelivery de mensajes confirmados. Si Twilio acepta el envío y el ack falla, el mensaje se reentrega y el destinatario recibe un WhatsApp duplicado. Twilio no ofrece idempotency key para mensajes, así que el riesgo se acepta como raro y se mide con el log `ack fallido tras envío`.
