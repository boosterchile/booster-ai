# Review: document-service-push

- Spec: .specs/document-service-push/spec.md
- Fecha: 2026-10-21
- Revisores: code-reviewer y security-auditor (`.cursor/agents/`), sobre el primer commit de la rama (`e72562fd`). Solo lectura: corrieron los tests y leyeron IAM y config viva con `describe`/`get-iam-policy`/`list`.
- Ninguno encontró hallazgos críticos ni altos. Las correcciones van en el segundo commit.

## code-reviewer

| Severidad | Hallazgo | Respuesta |
|---|---|---|
| Medio | La app no verificaba `aud`, y la razón dada era falsa: la URL run.app determinista se arma sin ciclo (como `local.cloud_run_matching_url`). El comentario «mismo criterio que matching-engine» no era cierto | **Corregido.** `local.cloud_run_document_url` es la audience del push y la env `PUSH_OIDC_AUDIENCE`, y la app hace `verifyIdToken({ idToken, audience: [aud] })`. Para no depender de qué URLs run.app acepta Cloud Run IAM por defecto, el servicio la declara como custom audience (variable nueva `custom_audiences` del módulo). El endpoint sigue en `module.service_document.url`. Se corrigieron el ADR §2, la spec SC-4 y los comentarios |
| Medio | La alerta de DLQ y el runbook mandaban a mirar `severity>=ERROR`, pero los 401 se registraban como `warn` y Cloud Run registra los 4xx como WARNING | **Corregido.** Los rechazos de auth se registran como `error`, y la alerta y el runbook filtran `severity>=WARNING` |
| Advertencia | El drain de 8 s cubría solo HTTP: en pull, `subscription.close()` no espera a los handlers y después venían `pool.end()` y `exit` | **Corregido.** `main.ts` lleva un `Set` con los handlers pull en curso y espera HTTP y pull bajo el mismo tope de 8 s antes de cerrar el pool |
| Advertencia | La alerta `wave2_consumer_stalled["document_uploaded"]` agregaba fijo el runbook de telemetría | **Corregido.** Es un recurso propio (`document_uploaded_stalled`, `document-service.tf`) con el runbook del servicio. Además deja de tocar el mapa que edita el #822 |
| Sugerencia | El rollback no verificaba que el pull consumiera después, y en esa ventana StreamingPull abre contra una suscripción que sigue en push (comportamiento no documentado) | **Corregido.** Rollback en dos pasos (primero `modify-push-config --push-endpoint=""`, después el apply) y verificación de `open_streaming_pulls > 0` más la prueba de humo (spec §10, runbook). Revisé el cliente: no reintenta códigos como `FAILED_PRECONDITION` (`pull-retry.js`) |
| Sugerencia | El `grep` del diagnóstico 5 no mostraba el valor de `DOCUMENT_CONSUMER_MODE` | **Corregido** con `grep -A1` |
| Sugerencia | La spec §5 remitía a la «pregunta 3» por la DLQ (es la 2), y un comentario de `cloudbuild.production.yaml` seguía diciendo «consumer Pub/Sub pull» | **Corregido** |

## security-auditor

| Severidad | Hallazgo | Respuesta |
|---|---|---|
| Medio (previo) | sharp corre sin `limitInputPixels` propio y el api no revisa dimensiones. En local, un JPEG de 16000×16000 que pesa 1,5 MB llevó el RSS a ~1.646 MB: tumba la instancia de 1 GiB y los requests vecinos. Las filas quedan en `procesando`, la reentrega se saltea y el cron las pasa a `fallido` sin TED | **Fuera de alcance, con follow-up.** Existe igual en pull y vive en `packages/transport-documents`. Se registró en el ADR (Consecuencias), en la spec (§5 y §9) y en `verify.md` §4: la concurrencia 4 se midió con entradas normales. Propuesta: `limitInputPixels` en sharp y un tope de tamaño de página en pdfium |
| Bajo | `verifyIdToken` sin `audience` | **Corregido** (igual que el Medio del code-reviewer) |
| Bajo (previo) | El claim y el persist se atan solo a `documentId`: un mensaje con el `documentId` de A y el `filePath` de B escribiría en A los datos del DTE de B. Puede emitirlo el SA del push o cualquier servicio con `booster-cloudrun-sa`, que tiene `pubsub.publisher` en el proyecto | **Fuera de alcance, con follow-up.** Es previo al push (el canal es el topic). Propuesta: claim con `WHERE id AND viaje_id AND file_path`, o descargar el `file_path` de la fila |
| Info | `roles/iam.serviceAccountTokenCreator` da más que `getOpenIdToken` | **Corregido.** `roles/iam.serviceAccountOpenIdTokenCreator` |
| Info | El email del emisor rechazado se loguea redactado (`[REDACTED:email]`), así que no sirve para diagnosticar | **Corregido.** Se loguean `emailDomain` y `emailVerified` |

Confirmado por la revisión:

- Con el flag apagado, el apply no cambia el comportamiento.
- No hay ciclos.
- Ack/nack coincide con los códigos de push.
- El body se lee después de autenticar, con tope.
- El endpoint activo en pull es aceptable.
- El publisher sobre el topic de la DLQ no activa el reenvío de las otras 7 suscripciones.
- Los logs son JSON, con redacción por valor (JWT y emails incluidos).
- `cloudbuild.production.yaml` conserva ingress, IAM y SA.
- Sin `any`, sin `console.*`, sin `catch` que trague errores en silencio.

## Codex (comentarios en el PR, sobre `98520e3f`)

| Severidad | Hallazgo | Respuesta |
|---|---|---|
| P2 | El endpoint push solo registraba logs; faltaba una métrica de negocio por resultado (principio 6 de CLAUDE.md) | **Corregido.** `documentos_entregas_total{transporte, resultado}` (`src/business-metrics.ts`) en el meter `booster-ai-document-service/business`, que `otel-bootstrap` exporta. Cubre pull y push: los resultados del procesamiento, los descartes, los reintentos y los 401. Probado con tests y de punta a punta con `initOtel` y un exporter en memoria (`verify.md` §5) |
| P2 | `ack_deadline_seconds = 120` con timeout de request de 300 s: Pub/Sub podía reentregar mientras el request original seguía. El duplicado se salteaba y confirmaba, y un fallo posterior del original quedaba sin reintento | **Corregido.** `local.document_service_request_timeout_s = 300` fija el timeout del servicio y el ack deadline de la suscripción. Plan: la suscripción cambia solo `ack 120 -> 300`; el timeout del servicio no tiene diff. El residual (request cortado a los 300 s con el trabajo siguiendo en segundo plano) está en el ADR §Consecuencias |
