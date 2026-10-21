# Verify: document-service-push

- Spec: .specs/document-service-push/spec.md
- Fecha: 2026-10-21. Solo lecturas en prod (billing export, Cloud Monitoring, Cloud Logging, `describe` y `get-iam-policy`) con la cuenta del PO. El plan corrió con `-lock=false`. Nada se aplicó ni se desplegó.

## 1. Situación actual

### Costo (export por recurso `billing_export.gcp_billing_export_resource_v1_019461_C73CDE_DCE377`)

Cloud Run, `resource.name LIKE '%booster-ai-document-service%'`, días completos en hora de Santiago:

| Ventana | CLP | USD (tasa del export: 969,74 CLP/USD) | USD/día |
|---|---|---|---|
| 2026-10-13 → 2026-10-20 (8 días) | 16.092 | **16,59** | **2,07** |

| SKU | USD en 8 días | Uso |
|---|---|---|
| Services CPU (Instance-based billing) | 14,93 | 691.421 vCPU-s = 86.428 s/día = 1 vCPU las 24 h |
| Services Memory (Instance-based billing) | 1,66 | 691.220 GiB-s |

- Proyección: 2,07 × 30,4 ≈ **USD 63/mes**.
- Sin créditos: el costo neto es igual al bruto.
- El 2026-10-12 es el primer día con costo (parcial, CLP 1.196). Desde el 2026-09-25 no hay costo antes de esa fecha.

### Por qué empieza el 2026-10-12

`gcloud run revisions list`: la revisión `00008-8pb` (2026-10-12) es la primera con `autoscaling.knative.dev/minScale: 1`. Las anteriores (`00001` a `00007`) tienen 0. Sale del PR #763 (`28786054`, 2026-10-10), que puso el worker en prod con `min_instances=1` y el `--min-instances=1` del deploy. Las revisiones `00009` a `00012` (18 y 19 de octubre) son releases que volvieron a fijarlo.

### Uso (Cloud Monitoring, 30 días hasta 2026-10-21 14:50 UTC, alineación diaria)

| Métrica | Resultado | Control positivo |
|---|---|---|
| `topic/send_request_count`, `document.uploaded` | sin series (0) | `telemetry-events`: 30 puntos, 186.783 |
| `subscription/sent_message_count`, `document-uploaded-processor-sub` | sin series (0) | `telemetry-events-processor-sub`: 966.563 |
| `subscription/dead_letter_message_count` | sin series (0) | — |
| `subscription/num_undelivered_messages` (máx.) | 0 | — |
| `subscription/open_streaming_pulls` (máx. diario) | 7–10 desde el 2026-10-12 | el worker está conectado, sin mensajes |
| `run.googleapis.com/request_count`, document-service | sin series (0) | — |
| `container/instance_count` (máx. diario) | 1 todos los días; picos de 2–10 en días de deploy | — |

### Logs (Cloud Logging, 30 días)

262 entradas, todas de ciclo de vida: `GetService`/`ReplaceService` (auditoría de deploys), probes de startup y liveness, `document-service (worker TED) starting`, `shutdown requested`, `subscription closed`, `pg pool closed` y `Starting new instance. Reason: MANUAL_OR_CUSTOMER_MIN_INSTANCE`. Ningún `document.uploaded procesado` ni error de procesamiento.

### Quién publica (código, `main` al 2026-10-21)

- `apps/api/src/routes/transport-documents.ts`: tras persistir la fila `pendiente`, publica `document.uploaded` si `DOCUMENT_UPLOADED_TOPIC` está definido, **sin flag**. `compute.tf` siempre lo define.
- `apps/api/src/services/reconciliar-documentos-pendientes.ts`: el cron `documentos-pendientes` (Cloud Scheduler, `*/15`, `ENABLED`, último intento 2026-10-21 15:15 UTC con HTTP 200) republica los `pendiente` sin tocar por más de 10 min.
- No hay otros publicadores en el monorepo.

Conclusión: con pull y `min=0`, la próxima subida publicaría un mensaje que nadie consume. Por eso la alternativa B se rechaza.

## 2. Estado de IAM y de la DLQ (en vivo)

| Chequeo | Resultado |
|---|---|
| `gcloud run services get-iam-policy booster-ai-document-service` | vacío: ningún invoker explícito |
| Bindings de proyecto que dan invocación | `roles/owner` (grupo admins), `roles/editor` (SA de Google APIs), `roles/run.admin` (`github-deployer@`) |
| `gcloud pubsub topics get-iam-policy pubsub-dead-letter` | vacío |
| `gcloud pubsub subscriptions get-iam-policy document-uploaded-processor-sub` | vacío |
| Rol del service agent de Pub/Sub en el proyecto | solo `roles/pubsub.serviceAgent`. Trae `iam.serviceAccounts.getOpenIdToken` y `getAccessToken`, ninguna `pubsub.*` |
| Suscripciones sobre `pubsub-dead-letter` | ninguna (`gcloud pubsub subscriptions list`). La `pubsub-dead-letter-sub` del runbook no existe |
| Config viva de la suscripción | `ackDeadlineSeconds: 120`, DLQ a `pubsub-dead-letter` con 5 intentos, retry 10–600 s, `pushConfig: {}` (pull) |
| Config viva del servicio | `ingress: internal`, `minScale: 1`, `cpu-throttling: false`, `containerConcurrency: 80`, `timeoutSeconds: 300`. URL `https://booster-ai-document-service-wbfevjot4q-tl.a.run.app` |

La documentación de Pub/Sub (*Handling message failures*) dice que el reenvío a la DLQ exige publisher sobre el topic y subscriber sobre la suscripción de origen. También dice que solo se cuentan intentos si la DLQ está bien configurada.

## 3. Documentación verificada para el diseño

| Pregunta | Respuesta (docs.cloud.google.com) |
|---|---|
| ¿El push entra con ingress `internal`? | *Restrict network ingress for Cloud Run*: las suscripciones de Pub/Sub cuentan como internas si están «en el mismo proyecto o perímetro de VPC-SC» y usan «la URL `run.app` por defecto y no una URL o dominio propio» |
| ¿Qué códigos confirman un push? | *Push subscriptions*: 102, 200, 201, 202 y 204. Cualquier otro es nack. El ack deadline de un push no se puede extender por mensaje |
| Rango del ack deadline | *Subscription properties*: 10–600 s |
| Concurrencia del push | Pub/Sub ajusta los requests concurrentes con *slow start*: crece con cada éxito y baja con cada falla |
| Auth del push | *Authenticate push*: el service agent necesita `getOpenIdToken` o Token Creator sobre el SA del push. El SA necesita `roles/run.invoker` sobre el servicio. Claims a verificar: `email`, `email_verified`, `aud` e `iss` |
| `audience` por defecto | provider `google` 6.50.0 (`oidc_token.audience`): si se omite, usa el endpoint con path. Por eso se fija la URL sin path |
| Permisos para aplicar el `push_config` | provider 6.50.0 (`oidc_token.service_account_email`): quien llama `subscriptions.patch` necesita `iam.serviceAccounts.actAs` sobre el SA |
| ¿Cloud Run quita la firma del token? | *Authenticating service-to-service* lo describe solo para `X-Serverless-Authorization`. Pub/Sub manda `Authorization`. No se encontró documentación explícita para `Authorization`: lo cubre la prueba de humo (spec §10) |
| Leer la DLQ sin suscripción previa | Con retención en el topic (30 días en `pubsub-dead-letter`), una suscripción nueva puede inicializarse con mensajes ya retenidos (*Replay and purge with seek*) |
| `max_instance_request_concurrency` | provider 6.50.0: `optional` + `computed`. `null` no genera diff |
| Custom audiences | *Configure custom audiences*: se suman a la URL run.app por defecto, que «siempre» sigue aceptada. Provider 6.50.0: `custom_audiences` es `optional`; con `null` no genera diff |
| Rol mínimo para firmar el OIDC | `roles/iam.serviceAccountOpenIdTokenCreator` = solo `iam.serviceAccounts.getOpenIdToken` (`gcloud iam roles describe`) |
| ¿Pub/Sub acepta StreamingPull sobre una suscripción push? | sin documentación. El cliente 4.11.0 solo reintenta `DEADLINE_EXCEEDED`, `RESOURCE_EXHAUSTED`, `ABORTED`, `INTERNAL`, `UNAVAILABLE` y `CANCELLED` (`build/src/pull-retry.js`). Por eso el rollback pone primero la suscripción en pull (spec §10) |

## 4. Medición del decode (local, no Cloud Run)

Ingestor real (`createPdfTedIngestor` de `@booster-ai/transport-documents`). Apple M5, Node 26, con tsx. Los archivos son sintéticos: PDFs de texto de `pdf-lib` sin PDF417 (el peor caso, porque recorre todas las páginas) y un JPEG de 12 MP de ruido. Cloud Run (1 vCPU) será más lento; el margen contra el ack de 120 s es de más de 100 veces.

| Caso | Tiempo | RSS |
|---|---|---|
| PDF carta, 1 página, primera llamada (inicializa WASM) | 353 ms | 216 MB |
| PDF carta, 3 páginas (tope `PDF_MAX_PAGES`) | 50–73 ms | ~295 MB |
| PDF A4, 3 páginas | 49–57 ms | — |
| PDF oficio, 10 páginas (se rasterizan 3) | 60–69 ms | — |
| Foto JPEG 12 MP | 208–215 ms | 519–549 MB |
| 120 PDFs seguidos, RSS tras GC cada 20 | — | 380 → 343 MB, estable: sin fuga |

Fotos de 12 MP en paralelo (RSS base ~400 MB tras calentar):

| Concurrentes | Tiempo total | Pico de RSS |
|---|---|---|
| 1 | 214 ms | 388 MB |
| 4 | 647 ms | **673 MB** |
| 5 | 969 ms | 607 MB |
| 8 | 1.136 ms | 741 MB |

La concurrencia apenas acelera: 4 en paralelo tardan 3 veces lo de 1. Se fija **4**, con margen bajo 1 GiB.

**Solo entradas normales.** La revisión de seguridad midió en local una entrada hostil: un JPEG de 16000×16000 que pesa 1,5 MB lleva el RSS a ~1.646 MB, porque sharp corre con su `limitInputPixels` por defecto (~268 Mpx). Eso tumba la instancia de 1 GiB con cualquier concurrencia. Es un riesgo previo, que existe igual en pull, y queda como follow-up (spec §5, `review.md`).

## 5. Gates del código

| Gate | Resultado |
|---|---|
| `pnpm --filter @booster-ai/document-service test:coverage` | 6 archivos, **55/55**. Cobertura: statements 100 %, branches 92 %, functions 100 %, lines 100 % (umbral 80) |
| `pnpm --filter @booster-ai/document-service typecheck` | OK |
| `pnpm exec biome check apps/document-service` | OK, tras `--write` de formato |
| `pnpm --filter @booster-ai/document-service build` | OK (`dist/main.js` 111 KB) |
| `node scripts/lint-rls.mjs` | 0 queries fuera de allowlist |
| Humo local del bundle en modo push (sin base ni GCS) | `/health` 200; push sin token 401; token basura 401 (`ID token inválido`, nivel `error`); no abre StreamingPull; SIGTERM cierra HTTP y pool. En push sin `PUSH_OIDC_AUDIENCE` no arranca (`Fatal startup error`) |
| `pnpm lint` (repo completo) | 0 errores. Los 16 avisos son previos y en archivos que este PR no toca |

## 6. Terraform

| Gate | Resultado |
|---|---|
| `terraform fmt -check -recursive` | OK |
| `terraform validate` | OK |
| `check-adr-numbering --allow-legacy 028,034,035` (como el pre-commit) | OK. Se usa **085** porque el PR abierto #820 ya ocupa el 084 |

### Plan acotado contra prod (`-lock=false`, `TF_VAR_billing_account=""`, con los `-target` de la spec §10)

Corrido de nuevo después de la revisión (commit 2).

**Flag apagado (default): `Plan: 7 to add, 1 to change, 0 to destroy`.**

| Recurso | Cambio |
|---|---|
| `google_service_account.document_push_invoker` | + crea `document-push-invoker@` |
| `google_service_account_iam_member.pubsub_document_push_token_creator` | + `roles/iam.serviceAccountOpenIdTokenCreator` para el service agent |
| `google_cloud_run_v2_service_iam_member.document_push_invoker` | + `roles/run.invoker` sobre el servicio |
| `google_pubsub_topic_iam_member.dlq_publisher_pubsub_agent` | + `roles/pubsub.publisher` sobre `pubsub-dead-letter` |
| `google_pubsub_subscription_iam_member.document_uploaded_dlq_subscriber` | + `roles/pubsub.subscriber` sobre la suscripción |
| `google_monitoring_alert_policy.document_uploaded_dead_lettered` | + alerta |
| `google_monitoring_alert_policy.document_uploaded_stalled` | + alerta |
| `module.service_document…service` | + `custom_audiences = ["https://booster-ai-document-service-469283083998.southamerica-west1.run.app"]`; `max_instance_request_concurrency: 80 -> 4`; + env `DOCUMENT_CONSUMER_MODE=pull`, `PUSH_CALLER_SA`, `PUSH_OIDC_AUDIENCE`. Nada más |
| `google_pubsub_subscription.document_uploaded_processor` | sin cambios |

**Flag encendido (`-var=document_service_push=true`): `Plan: 7 to add, 2 to change, 0 to destroy`.** Son los mismos 7 recursos nuevos, más:

| Recurso | Cambio |
|---|---|
| `module.service_document…service` | lo anterior, con `DOCUMENT_CONSUMER_MODE=push`, más `cpu_idle: false -> true` y `min_instance_count: 1 -> 0` |
| `google_pubsub_subscription.document_uploaded_processor` | `+ push_config`: endpoint `https://booster-ai-document-service-wbfevjot4q-tl.a.run.app/pubsub/document-uploaded`; `oidc_token`: audience `https://booster-ai-document-service-469283083998.southamerica-west1.run.app` (la custom audience), SA `document-push-invoker@…` |

Después del apply con el flag apagado, el encendido es entonces **0 to add, 2 to change**.

### Plan completo (`terraform-drift.yml` sobre la rama, cuenta de solo lectura `terraform-drift@`, `-lock=false`)

Flag en su default (`false`). Dos corridas, las dos con **Plan: 7 to add, 2 to change, 0 to destroy**:

- run [39625346040](https://github.com/boosterchile/booster-ai/actions/runs/39625346040), primer commit (`e72562fd`);
- run [39627709286](https://github.com/boosterchile/booster-ai/actions/runs/39627709286), después de la revisión (`097defa3`), con `document_uploaded_stalled` en lugar de la entrada del mapa de telemetría.

- Los 7 recursos nuevos y el cambio de `module.service_document` son los mismos del plan acotado.
- El segundo cambio es `module.service_api`, que quita la env `RESEND_API_KEY`. **No es de este PR**: es el artefacto conocido del workflow, que no define `resend_api_key_ready`. La corrida programada de `main` del 2026-10-20 (run 39450315380) ya falla igual (`.specs/microservicios-min-segun-flags/verify.md` §4). Por eso el apply va con `-target`.
- Sin ciclos ni errores. El job termina en `failure` porque hay diff (exit 2), que es lo esperado.

No verificado aquí:

- el apply mismo;
- el comportamiento del push en vivo (OIDC e ingress), que cubre la prueba de humo;
- la dirección inversa del plan (quitar el `push_config`). El rollback manual con `modify-push-config --push-endpoint=""` está en el runbook.
