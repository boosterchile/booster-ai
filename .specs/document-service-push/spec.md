# Spec: document-service-push

- Author: Felipe Vicencio (con Claude)
- Date: 2026-10-21
- Status: Draft. Se aprueba junto con ADR-085 (Propuesto) en la revisión del PR.
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

- [ ] SC-1: con `document_service_push=false` (default de este PR), un apply no cambia el comportamiento. La suscripción sigue en pull y el servicio en `min=1` con CPU siempre asignada. Solo se suman el SA, los bindings, dos alertas, dos env (`DOCUMENT_CONSUMER_MODE=pull`, `PUSH_CALLER_SA`) y la concurrencia 4.
- [ ] SC-2: con `document_service_push=true`, el mismo apply pone la suscripción en push hacia `<url run.app>/pubsub/document-uploaded`, con OIDC de `document-push-invoker@` y `audience` igual a la URL run.app. El servicio queda en `min=0`, `cpu_idle=true` y `DOCUMENT_CONSUMER_MODE=push`.
- [ ] SC-3: el worker atiende el push con la misma decisión ack/nack que el pull (`src/handle-document-uploaded.ts`): 204 = ack, 500 = nack, 401 = token rechazado. Un sobre o un mensaje fuera de contrato se confirma y se registra como error.
- [ ] SC-4: el endpoint push solo acepta un OIDC firmado por Google, con `email` = `PUSH_CALLER_SA` y `email_verified`. Cloud Run IAM exige además `aud` = URL del servicio y `run.invoker`, que solo tiene el SA del push.
- [ ] SC-5: el ingress sigue en `INTERNAL_ONLY` (ADR-063).
- [ ] SC-6: `cloudbuild.production.yaml` deja de fijar `--min-instances=1` y `--no-cpu-throttling` en `deploy-document-service`.
- [ ] SC-7: el service agent de Pub/Sub puede reenviar a la DLQ desde esta suscripción: publisher sobre `pubsub-dead-letter` y subscriber sobre la suscripción.
- [ ] SC-8: dos alertas: mensaje reenviado a la DLQ (> 0), y mensaje sin confirmar por más de 30 min.
- [ ] SC-9: tests del worker con cobertura ≥ 80/80/80/80. Typecheck, Biome, build y `terraform validate` OK.
- [ ] SC-10 (PO): después del encendido, la prueba de humo del runbook da `document.uploaded malformado, ack para descartar`, y a las 48 h el costo diario del servicio está en ~0.
- [ ] SC-11: este PR no ejecuta `terraform apply`, `gcloud` con efectos ni deploys.

## 4. User-visible behaviour

Ninguno mientras el flag esté apagado. Con el flag encendido, el primer documento después de un rato sin uso tarda unos segundos más en pasar de `pendiente` a `decodificado` (arranque en frío). La subida responde 202 igual que antes: el decode siempre fue asíncrono.

## 5. Out of scope

- **La DLQ del resto del proyecto.** El topic `pubsub-dead-letter` no tiene suscripción. La alerta `pubsub_dlq` mira `num_unacked_messages_by_region` del topic, que sin suscripción no se mueve, y el service agent no tiene permisos de reenvío para ninguna suscripción. Este PR solo habilita el reenvío de `document-uploaded-processor-sub` y le da una alerta propia. El resto es un PR aparte (pregunta 3 al PO).
- **Unificar la variable `concurrency` del módulo**, que nunca estuvo conectada (telemetry-processor declara 10 y corre con 160). Se documenta en `variables.tf` y no se toca.
- **Retirar el modo pull**: va en un commit aparte cuando el push lleve dos semanas estable (ADR-085 §6).
- `telemetry-processor` sigue en pull: tiene tráfico real.

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
- `src/push-auth.ts`: verificación del OIDC (`google-auth-library`, igual que matching-engine).
- `src/main.ts`: StreamingPull solo en modo pull. El HTTP corre siempre. Al apagarse espera hasta 8 s a los requests en curso.

**Infra**
- `modules/cloud-run-service`: variable `max_instance_request_concurrency` (`null` = sin gestionar).
- `compute.tf` (`service_document`): `min_instances`, `cpu_idle` y `DOCUMENT_CONSUMER_MODE` derivados de `var.document_service_push`; `PUSH_CALLER_SA`; concurrencia 4.
- `messaging.tf`:
  - `push_config` dinámico en `document_uploaded_processor`;
  - SA `document_push_invoker`, Token Creator del service agent y `run.invoker` sobre el servicio;
  - publisher y subscriber para la DLQ.
- `variables.tf`: `document_service_push` (default `false`).
- `telemetry-monitoring.tf`: entrada `document_uploaded` en `wave2_stall_alerts`, al inicio del mapa para no chocar con el #822.
- `document-service.tf`: alerta `document_uploaded_dead_lettered`.
- `cloudbuild.production.yaml`: sin `--min-instances` ni `--no-cpu-throttling` en `deploy-document-service`.

**Docs**: ADR-085; runbooks `service-document-service.md` (modos, diagnóstico del push, prueba de humo, DLQ real y rollback del modo), `README.md` y `rollback-drill-microservicios.md`; README del worker.

## 8. Alternatives considered

Ver ADR-085 §Alternativas: dejarlo como está, pull con `min=0`, push (elegida) y Eventarc. Dos variantes de la elegida, también descartadas:

- **Imagen solo push (sin modo pull)**: menos código, pero el rollback exigiría volver a la imagen anterior y a la vez revertir Terraform. Con los dos modos, el rollback es un apply.
- **Flag encendido por defecto en este PR**: un solo apply en vez de dos. Pero un apply completo antes del release (por ejemplo, el del #821 o el #822) mandaría el push a una imagen sin endpoint. Pregunta 1 al PO.

## 9. Risks and mitigations

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| El flag se enciende antes de que el release traiga el endpoint: la revisión vieja responde 404 | B | M | Default `false`; el runbook exige release primero. Si pasa, los mensajes van a la DLQ en minutos (alerta), los documentos quedan en `pendiente` y el cron los republica cuando el endpoint exista. No se pierde ningún documento |
| Cloud Run no deja la firma del `Authorization` intacta y el OIDC falla en la app: todo da 401 | B | M | La documentación de Cloud Run describe quitar la firma solo para `X-Serverless-Authorization`, y Pub/Sub usa `Authorization`. matching-engine usa la misma verificación. La prueba de humo lo detecta en ~1 min y el rollback es apagar el flag |
| El push no entra por `INTERNAL_ONLY` | MB | M | La documentación lo admite para el mismo proyecto con la URL `run.app`, que es la que usa Terraform. La prueba de humo lo detecta |
| Un decode supera los 120 s del ack, Pub/Sub reentrega, el duplicado se saltea y el primero falla después | MB | B | Medido: 0,05–0,2 s por documento. Si pasara, el documento queda en `fallido`, conservado y con ingreso manual |
| OOM con varios documentos grandes en una instancia | B | B | Concurrencia 4 (pico medido ~670 MB con fotos de 12 MP). Un OOM deja la fila en `procesando`; el cron la libera a los 30 min |
| Un mensaje que falla siempre despierta instancias en cada reintento | B | B | 5 intentos y DLQ (SC-7), más la alerta |
| Arranque en frío en el primer documento | A | B | El decode es asíncrono; la subida no espera |
| Un release vuelve a fijar el mínimo | MB | B | SC-6; ningún otro pipeline despliega este servicio (verificado) |

## 10. Rollout (PO)

1. **Mergear.** El release que sale del merge trae la imagen con los dos modos. Sin `DOCUMENT_CONSUMER_MODE`, la imagen se comporta igual que hoy (pull), y el release ya no toca el mínimo ni la CPU.
2. **Apply con el flag apagado**, antes o después del release: la imagen vieja ignora las env nuevas (su schema Zod no es estricto) y sigue en pull. Debe dar **7 to add, 1 to change, 0 to destroy**: en el servicio, solo las dos env y `max_instance_request_concurrency: 80 -> 4`; la suscripción no cambia.
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
     -target='google_monitoring_alert_policy.wave2_consumer_stalled["document_uploaded"]'
   ```
3. **Encender**: `document_service_push = true` (PR de una línea en `variables.tf`, pregunta 1). Con el mismo `-target`, el plan debe dar **0 to add, 2 to change**:
   - servicio: `min_instance_count 1 -> 0`, `cpu_idle false -> true`, `DOCUMENT_CONSUMER_MODE pull -> push`;
   - suscripción: `+ push_config` hacia la URL run.app.

   Luego, apply.
4. **Prueba de humo** (runbook, §Push): publicar `{"smoke":"adr-085"}` y ver en ~1 min el log `document.uploaded malformado, ack para descartar`. Un 401/403/404 → tabla del runbook, o rollback.
5. Después del siguiente release: `gcloud run services describe` debe mostrar `minScale` 0 (o ausente) y `cpu-throttling` en `true` (o ausente).
6. A las 48 h: el costo diario del servicio en el export por recurso, en ~0 (SC-10).
7. A las dos semanas estable: commit aparte que retira el modo pull y el flag.

**Rollback**: `document_service_push = false` y apply con el mismo `-target`. La imagen no cambia. Si el apply no puede correr, el corte manual es `gcloud pubsub subscriptions modify-push-config document-uploaded-processor-sub --push-endpoint=""`; después, igual hay que aplicar.

## 11. Preguntas para el PO

1. **¿El encendido va en un PR de una línea después del release (recomendado) o con `default = true` en este mismo PR?** Separado son dos applies, pero ningún apply previo al release puede romper nada. Junto es un apply, pero exige que nadie aplique Terraform completo entre el merge y el release.
2. **¿La DLQ del proyecto se arregla en un PR aparte?** Sería la suscripción del topic `pubsub-dead-letter`, el IAM de reenvío para las demás suscripciones con DLQ y la alerta `pubsub_dlq`. Este PR solo cubre document-service. Según la documentación de Pub/Sub, sin esos permisos no se cuentan intentos, así que hoy un mensaje de telemetry-processor que falla siempre no llegaría a la DLQ.
3. **¿Retiramos el modo pull a las dos semanas estables en push, o lo dejamos como rollback permanente?** Retirarlo quita código y el flag. Dejarlo mantiene un rollback sin redeploy, a cambio de dos caminos que testear.
