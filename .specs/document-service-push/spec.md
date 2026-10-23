# Spec: document-service-push

- Author: Felipe Vicencio (con Claude)
- Date: 2026-10-21
- Status: Aprobada por el PO el 2026-10-22, junto con ADR-085 (Aceptado). Las tres preguntas de §11 tienen respuesta.
- Origen: auditoría de costos GCP del 2026-10-21. Es el servicio que el PR #822 (`.specs/microservicios-min-segun-flags/`) dejó fuera de alcance, porque pedía un ADR.
- Relacionado: [ADR-085](../../docs/adr/085-document-service-consumidor-push.md), ADR-063 (ingress), ADR-083 (extracción T10-21), `.specs/document-service-t10-21/`, runbook `docs/runbooks/service-document-service.md`.
- El `terraform apply` lo ejecuta el PO. Este PR no aplica nada.

## 1. Objective

Que `document-service` deje de pagar una instancia encendida las 24 horas sin dejar un solo `document.uploaded` sin procesar. Pasa de consumidor pull a suscripción push.

| Hoy | Después de encender `document_service_push` |
|---|---|
| StreamingPull, `min_instances=1`, CPU siempre asignada | Pub/Sub hace POST al servicio, `min_instances=0`, CPU solo en requests |
| USD 2,07/día (~USD 63/mes) con 0 mensajes en 30 días | Costo por documento; ~0 al volumen actual |

## 2. Why now

El gasto está en ~USD 700/mes y el techo realista de ahorro es ~USD 340/mes. Este servicio son ~USD 63/mes de ese techo, sin trabajo:

- 0 publicaciones en `document.uploaded` en 30 días;
- el costo empezó el 2026-10-12, con la revisión `00008` (PR #763), la primera con `minScale: 1`.

`min=0` con pull no sirve: el api publica en cada subida sin flag, y nada despierta la instancia (`verify.md` §1).

## 3. Success criteria

- [ ] SC-1: con `document_service_push=false` (default de este PR), un apply no cambia el comportamiento. La suscripción sigue en pull y el servicio en `min=1` con CPU siempre asignada. Solo se suman el SA, los bindings, dos alertas, tres env (`DOCUMENT_CONSUMER_MODE=pull`, `PUSH_CALLER_SA`, `PUSH_OIDC_AUDIENCE`), la custom audience, la concurrencia 4 y el ack deadline de 300 s (igual al timeout del request; en pull no cambia nada porque el cliente extiende el lease).
- [ ] SC-2: con `document_service_push=true`, el mismo apply pone la suscripción en push hacia `<url run.app>/pubsub/document-uploaded`, con OIDC de `document-push-invoker@` y `audience` igual a la URL run.app determinista (`local.cloud_run_document_url`). El servicio queda en `min=0`, `cpu_idle=true` y `DOCUMENT_CONSUMER_MODE=push`.
- [ ] SC-3: el worker atiende el push con la misma decisión ack/nack que el pull (`src/handle-document-uploaded.ts`): 204 = ack, 500 = nack, 401 = token rechazado. Un sobre o un mensaje fuera de contrato se confirma y se registra como error.
- [ ] SC-4: el endpoint push solo acepta un OIDC firmado por Google, con `aud` = `PUSH_OIDC_AUDIENCE`, `email` = `PUSH_CALLER_SA` y `email_verified`. Cloud Run IAM exige además una audience aceptada (la del push está declarada como custom audience) y `run.invoker`, que solo tiene el SA del push.
- [ ] SC-5: el ingress sigue en `INTERNAL_ONLY` (ADR-063).
- [ ] SC-6: `cloudbuild.production.yaml` deja de fijar `--min-instances=1` y `--no-cpu-throttling` en `deploy-document-service`.
- [ ] SC-7: el service agent de Pub/Sub puede reenviar a la DLQ desde esta suscripción: publisher sobre `pubsub-dead-letter` y subscriber sobre la suscripción.
- [ ] SC-8: dos alertas propias en `document-service.tf`, con el runbook del servicio: mensaje reenviado a la DLQ (> 0), y mensaje sin confirmar por más de 30 min.
- [ ] SC-8b: métrica de negocio `documentos_entregas_total{transporte, resultado}`, exportada por `otel-bootstrap` (meter `/business`). Cubre cada resultado de una entrega, en pull y en push (comentario de Codex en el PR).
- [ ] SC-9: tests del worker con cobertura ≥ 80/80/80/80. Typecheck, Biome, build y `terraform validate` OK.
- [ ] SC-10 (PO): después del encendido, la prueba de humo del runbook da `document.uploaded malformado, ack para descartar`, y a las 48 h el costo diario del servicio está en ~0.
- [ ] SC-11: este PR no ejecuta `terraform apply`, `gcloud` con efectos ni deploys.

## 4. User-visible behaviour

Ninguno mientras el flag esté apagado. Con el flag encendido, el primer documento después de un rato sin uso tarda unos segundos más en pasar de `pendiente` a `decodificado` (arranque en frío). La subida responde 202 igual que antes: el decode siempre fue asíncrono.

## 5. Out of scope

- **La DLQ del resto del proyecto.** El topic `pubsub-dead-letter` no tiene suscripción. La alerta `pubsub_dlq` mira `num_unacked_messages_by_region` del topic, que sin suscripción no se mueve, y el service agent no tiene permisos de reenvío para ninguna suscripción. Este PR solo habilita el reenvío de `document-uploaded-processor-sub` y le da una alerta propia. El resto va en otro PR (decisión del PO, §11.2): `.specs/_followups/pubsub-dlq-proyecto.md`.
- **Unificar la variable `concurrency` del módulo**, que nunca estuvo conectada (telemetry-processor declara 10 y corre con 160). Se documenta en `variables.tf` y no se toca.
- **Retirar el modo pull**: va en un commit aparte cuando el push lleve dos semanas estable (ADR-085 §6).
- `telemetry-processor` sigue en pull: tiene tráfico real.
- **Dos riesgos previos del worker**, que el push no crea ni resuelve (follow-up aparte; los encontró la revisión de seguridad, `review.md`):
  - sharp sin `limitInputPixels` propio: una imagen hostil de 1,5 MB tumba la instancia por OOM;
  - el claim atado solo a `documentId`.

## 6. Constraints

1. ADR-063: ingress `INTERNAL_ONLY`. Cloud Run trata como interno el push de una suscripción del mismo proyecto que apunta a la URL `run.app` por defecto. Por eso el endpoint no puede ser un dominio propio.
2. CLAUDE.md: los ADR no se editan. ADR-063 y ADR-083 quedan como están; ADR-085 registra la desviación.
3. Los flags se cambian con `terraform apply`, nunca con `gcloud run services update` (mismo criterio que el PR #822).
4. Quien aplique el `push_config` necesita `iam.serviceAccounts.actAs` sobre `document-push-invoker@` (lo exige `subscriptions.patch`). El PO, como owner, lo tiene.
5. Staging no existe todavía (el proyecto `booster-ai-stg-494222` no es accesible). La validación en vivo es la prueba de humo en prod, que no toca la base ni GCS.

## 7. Approach

**Worker (`apps/document-service`)**
- `src/config.ts`: `DOCUMENT_CONSUMER_MODE` (`pull` por defecto) y `PUSH_CALLER_SA`, obligatorio en push.
- `src/handle-document-uploaded.ts`: la decisión ack/nack sale de `main.ts` y la comparten los dos transportes. También corrige un caso: un JSON inválido ahora se descarta (antes se reintentaba).
- `src/http-server.ts`: `/health` y `POST /pubsub/document-uploaded`. Autentica antes de leer el body, valida el sobre con Zod y lee hasta 64 KiB.
- `src/push-auth.ts`: verificación del OIDC (`google-auth-library`, igual que matching-engine): firma, `aud`, emisor y `email_verified`. Los rechazos se registran como `error`.
- `src/main.ts`: StreamingPull solo en modo pull. El HTTP corre siempre. Al apagarse espera hasta 8 s a los mensajes en curso, push o pull.

**Infra**
- `modules/cloud-run-service`: variables `max_instance_request_concurrency` y `custom_audiences` (`null` = sin gestionar).
- `compute.tf`: `local.cloud_run_document_url`. En `service_document`: `min_instances`, `cpu_idle` y `DOCUMENT_CONSUMER_MODE` derivados de `var.document_service_push`; `PUSH_CALLER_SA`, `PUSH_OIDC_AUDIENCE` y la custom audience; concurrencia 4.
- `messaging.tf`:
  - `push_config` dinámico en `document_uploaded_processor`;
  - SA `document_push_invoker`, OpenID Token Creator del service agent y `run.invoker` sobre el servicio;
  - publisher y subscriber para la DLQ.
- `variables.tf`: `document_service_push` (default `false`).
- `document-service.tf`: alertas `document_uploaded_dead_lettered` y `document_uploaded_stalled`. Son propias para que apunten al runbook del servicio, y así no se toca el mapa `wave2_stall_alerts` que también edita el #822.
- `cloudbuild.production.yaml`: sin `--min-instances` ni `--no-cpu-throttling` en `deploy-document-service`.

**Docs**: ADR-085; runbooks `service-document-service.md` (modos, diagnóstico del push, prueba de humo, DLQ real y rollback del modo), `README.md` y `rollback-drill-microservicios.md`; README del worker.

## 8. Alternatives considered

Ver ADR-085 §Alternativas: dejarlo como está, pull con `min=0`, push (elegida) y Eventarc. Dos variantes de la elegida, también descartadas:

- **Imagen solo push (sin modo pull)**: menos código, pero el rollback exigiría volver a la imagen anterior y a la vez revertir Terraform. Con los dos modos, el rollback es un apply.
- **Flag encendido por defecto en este PR**: un solo apply en vez de dos. Pero un apply completo antes del release (por ejemplo, el del #821 o el #822) mandaría el push a una imagen sin endpoint. Descartada por el PO (§11.1).

## 9. Risks and mitigations

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| El flag se enciende antes de que el release traiga el endpoint: la revisión vieja responde 404 | B | M | Default `false`; el runbook exige release primero. Si pasa, los mensajes van a la DLQ en minutos (alerta), los documentos quedan en `pendiente` y el cron los republica cuando el endpoint exista. No se pierde ningún documento |
| Cloud Run no deja la firma del `Authorization` intacta y el OIDC falla en la app: todo da 401 | B | M | La documentación de Cloud Run describe quitar la firma solo para `X-Serverless-Authorization`, y Pub/Sub usa `Authorization`. matching-engine usa la misma verificación. La prueba de humo lo detecta en ~1 min y el rollback no exige redeploy |
| En el rollback, el StreamingPull de la revisión pull arranca mientras la suscripción sigue en push y Pub/Sub lo rechaza con un código que el cliente no reintenta: el pull queda muerto | B | M | No hay documentación de qué hace Pub/Sub. El rollback va en dos pasos: primero la suscripción a pull (`modify-push-config`), después el apply. Luego se verifica `open_streaming_pulls > 0` y la prueba de humo |
| El push no entra por `INTERNAL_ONLY` | MB | M | La documentación lo admite para el mismo proyecto con la URL `run.app`, que es la que usa Terraform. La prueba de humo lo detecta |
| Un request llega al timeout de 300 s, Cloud Run responde 504, el reintento ve `procesando` y se confirma, y el trabajo original falla después en segundo plano | MB | B | El ack deadline es igual al timeout del request (300 s), así que Pub/Sub no reentrega mientras el original corre (comentario de Codex en el PR). Medido: 0,05–0,2 s por documento. Si pasara, el documento queda en `fallido`, conservado y con ingreso manual |
| OOM con varios documentos grandes en una instancia | B | B | Concurrencia 4 (pico medido ~670 MB con fotos normales de 12 MP). Un OOM deja la fila en `procesando`; el cron la libera a los 30 min. Una imagen **hostil** (16000×16000 en 1,5 MB) sí tumba la instancia: es un riesgo previo, que existe igual en pull (§5, follow-up) |
| Un mensaje que falla siempre despierta instancias en cada reintento | B | B | 5 intentos y DLQ (SC-7), más la alerta |
| Arranque en frío en el primer documento | A | B | El decode es asíncrono; la subida no espera |
| Un release vuelve a fijar el mínimo | MB | B | SC-6; ningún otro pipeline despliega este servicio (verificado) |

## 10. Rollout (PO)

1. **Mergear.** El release que sale del merge trae la imagen con los dos modos. Sin `DOCUMENT_CONSUMER_MODE`, la imagen se comporta igual que hoy (pull), y el release ya no toca el mínimo ni la CPU.
2. **Apply con el flag apagado**, antes o después del release: la imagen vieja ignora las env nuevas (su schema Zod no es estricto) y sigue en pull. Debe dar **7 to add, 2 to change, 0 to destroy**: en el servicio, solo las tres env, la custom audience y `max_instance_request_concurrency: 80 -> 4`; en la suscripción, solo `ack_deadline_seconds: 120 -> 300` (sigue en pull).
   ```bash
   terraform plan \
     -target=module.service_document \
     -target=google_pubsub_subscription.document_uploaded_processor \
     -target=google_service_account.document_push_invoker \
     -target=google_service_account_iam_member.pubsub_document_push_token_creator \
     -target=google_cloud_run_v2_service_iam_member.document_push_invoker \
     -target=google_pubsub_topic_iam_member.dlq_publisher_pubsub_agent \
     -target=google_pubsub_subscription_iam_member.document_uploaded_dlq_subscriber \
     -target=google_monitoring_alert_policy.document_uploaded_dead_lettered \
     -target=google_monitoring_alert_policy.document_uploaded_stalled
   ```
3. **Encender**: `document_service_push = true` (PR aparte de una línea en `variables.tf`, decisión del PO §11.1). Con el mismo `-target`, el plan debe dar **0 to add, 2 to change**:
   - servicio: `min_instance_count 1 -> 0`, `cpu_idle false -> true`, `DOCUMENT_CONSUMER_MODE pull -> push`;
   - suscripción: `+ push_config` hacia la URL run.app.

   Luego, apply.
4. **Prueba de humo** (runbook, §Push): publicar `{"smoke":"adr-085"}` y ver en ~1 min el log `document.uploaded malformado, ack para descartar`. Un 401/403/404 → tabla del runbook, o rollback.
5. Después del siguiente release: `gcloud run services describe` debe mostrar `minScale` 0 (o ausente) y `cpu-throttling` en `true` (o ausente).
6. A las 48 h: el costo diario del servicio en el export por recurso, en ~0 (SC-10).
7. A las dos semanas estable: commit aparte que retira el modo pull y el flag (decisión del PO §11.3; `.specs/_followups/document-service-retiro-modo-pull.md`).

**Rollback** (la imagen no cambia), en este orden:

1. `gcloud pubsub subscriptions modify-push-config document-uploaded-processor-sub --push-endpoint=""`. La suscripción vuelve a pull y los mensajes quedan retenidos.
2. `document_service_push = false` y apply con el mismo `-target`. El plan ya no muestra cambios en la suscripción, porque la refresca en pull.
3. Verificar:
   - `pushConfig` vacío;
   - `subscription/open_streaming_pulls > 0`;
   - la prueba de humo, que ahora consume el pull.

El orden importa: Terraform actualiza el servicio antes que la suscripción, y un StreamingPull rechazado contra una suscripción todavía en push podría no reintentarse (§9).

## 11. Decisiones del PO

Respondidas el 2026-10-22. Sus palabras: «Responde las 3 preguntas del #823 con lo recomendado: encendido en un PR aparte de una línea, DLQ en otro PR, y modo pull como rollback dos semanas y luego se retira. Marca el ADR-085 como aceptado y déjalo listo para mergear después del #822.»

1. **Encendido: en un PR aparte de una línea, después del release.** Este PR deja `document_service_push = false`. Se descartó `default = true` en este PR: un apply completo entre el merge y el release (el del #821 o el #822) mandaría el push a una imagen sin endpoint.
2. **La DLQ del resto del proyecto va en otro PR**: la suscripción del topic `pubsub-dead-letter`, el IAM de reenvío de las demás suscripciones y la alerta `pubsub_dlq`. Este PR solo cubre `document-uploaded-processor-sub`. Seguimiento: `.specs/_followups/pubsub-dlq-proyecto.md`.
3. **Modo pull: rollback durante dos semanas estables en push; después se retira**, junto con el flag, en un commit aparte. Seguimiento: `.specs/_followups/document-service-retiro-modo-pull.md`.

Orden de merge: este PR entra a `main` después del #822. Los dos tocan `infrastructure/compute.tf` y `cloudbuild.production.yaml`.
