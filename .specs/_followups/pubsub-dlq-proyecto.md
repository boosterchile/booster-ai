# Follow-up: la DLQ de Pub/Sub del proyecto no reenvía ni avisa

**Origen**: PR #823 (ADR-085, document-service a push). Verificado en vivo el 2026-10-21; la evidencia está en `.specs/document-service-push/verify.md` §2.
**Decisión del PO (2026-10-22)**: se arregla en un PR aparte («DLQ en otro PR»).
**Prioridad**: P2. Hoy no hay tráfico que falle, pero un mensaje que falla siempre no llega a ningún lado y nadie se entera.

## Problema

Todas las suscripciones con `dead_letter_policy` apuntan al topic `pubsub-dead-letter` (`infrastructure/messaging.tf`, `crash-traces.tf`). La cadena está rota en tres puntos:

1. **Sin permisos de reenvío.** El service agent `service-469283083998@gcp-sa-pubsub.iam.gserviceaccount.com` solo tiene `roles/pubsub.serviceAgent` en el proyecto. Para reenviar necesita `roles/pubsub.publisher` sobre el topic de la DLQ y `roles/pubsub.subscriber` sobre cada suscripción de origen. Según la documentación de Pub/Sub (*Handling message failures*), sin esa configuración no se cuentan intentos: un mensaje que falla siempre se reintenta hasta vencer, por ejemplo a los 7 días en `telemetry-events-processor-sub`.
2. **El topic `pubsub-dead-letter` no tiene suscripción.** Lo que llegue queda en la retención del topic (30 días) y solo se puede leer creando una suscripción y llevándola atrás con `seek`. `docs/runbooks/service-telemetry-processor.md` nombra una `pubsub-dead-letter-sub` que no existe.
3. **La alerta `pubsub_dlq` (`infrastructure/monitoring.tf`) no puede dispararse.** Mira `topic/num_unacked_messages_by_region` del topic, una métrica que sin suscripción no se mueve.

El PR #823 resuelve solo `document-uploaded-processor-sub`:
- `google_pubsub_topic_iam_member.dlq_publisher_pubsub_agent`: el publisher sobre el topic, compartido;
- `google_pubsub_subscription_iam_member.document_uploaded_dlq_subscriber`: el subscriber de esa suscripción;
- la alerta propia `document_uploaded_dead_lettered`, sobre `subscription/dead_letter_message_count`.

## Acción propuesta

- Dar `roles/pubsub.subscriber` al service agent sobre cada suscripción con DLQ. Reutilizar el publisher del #823; no duplicarlo.
- Crear una suscripción pull de inspección sobre `pubsub-dead-letter`, sin consumidor automático y con retención acorde, y corregir los runbooks que nombran `pubsub-dead-letter-sub`.
- Reparar `pubsub_dlq`: que mire la suscripción nueva, o `dead_letter_message_count` por suscripción de origen.
- Advertencia para el PO: activar el reenvío cambia el comportamiento de telemetry-processor y crash-traces. Un mensaje que falla 5 veces deja de reintentarse y pasa a la DLQ. La spec del PR debe explicarlo y dejar la decisión al PO.

## Criterio de cierre

- [ ] Un PR mergeado con el IAM de reenvío de todas las suscripciones con `dead_letter_policy`, la suscripción de inspección sobre `pubsub-dead-letter` y la alerta `pubsub_dlq` corregida.
- [ ] Plan acotado registrado y apply hecho por el PO.
- [ ] Evidencia posterior al apply:
  - `gcloud pubsub topics get-iam-policy pubsub-dead-letter` y `get-iam-policy` de cada suscripción muestran los bindings del service agent;
  - `gcloud pubsub subscriptions list` muestra la suscripción sobre `pubsub-dead-letter`.
- [ ] Runbooks (`service-telemetry-processor.md`, `service-document-service.md`) sin referencias a suscripciones inexistentes.

## Estado

Abierto. Hay una tarea propuesta («Reparar la DLQ de Pub/Sub del proyecto») en la sesión que preparó el #823.
