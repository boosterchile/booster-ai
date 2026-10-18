# Spec — `document-service` en producción (T10-21, servicio 1 de 3)

**Programa**: TRL 10, fase D. Criterio T10-21 de `.specs/trl10/spec.md`.
**Patrón**: [ADR-083](../../docs/adr/083-staging-gemelo-y-extraccion-con-shadow.md) §2 y `.specs/microservicios-t10-21/spec.md` §2.
**Estado**: aceptada por el PO el 2026-10-08 ("sigue con document-service").

## Diagnóstico (main @ 0008fa6)

El worker TED existe (`apps/document-service`: consumer de `document.uploaded`, claim idempotente y decodificación vía `@booster-ai/transport-documents`), pero la cadena no corre en prod. Hay cuatro cortes:

1. **El api no publica.** `DOCUMENT_UPLOADED_TOPIC` es opcional en `apps/api/src/config.ts`, y `compute.tf` no lo inyecta. Por eso `publishDocumentUploaded` se omite y todo documento subido queda en `pendiente`.
2. **El worker no tiene imagen.** `cloudbuild.production.yaml` no construye ni despliega `document-service`, así que el servicio sigue con `gcr.io/cloudrun/placeholder`.
3. **El worker no llega a la base.** El módulo `service_document` no tiene `vpc_connector`, y Cloud SQL y Redis son privados.
4. **El worker escala a cero.** Con `min_instances = 0` y `cpu_idle = true` (el default), nadie hace pull: un consumer StreamingPull no recibe requests que despierten la instancia. Es el mismo modo de falla del incidente de telemetry-processor del 2026-06-07.

A eso se suma un hueco de diseño. El comentario de `transport-documents.ts` afirma que "el worker reconcilia por estado pendiente", pero ningún componente lo hace, y los documentos subidos antes de cablear el topic quedarían en `pendiente` para siempre.

## Entradas

- Filas de `documentos_transporte` en `pendiente` (subidas sin publish, o con un publish fallido) o atascadas en `procesando` (el worker murió a mitad, por ejemplo por OOM al rasterizar).
- Mensajes `document.uploaded` publicados por el api.

## Salidas

- **Api**: `DOCUMENT_UPLOADED_TOPIC = google_pubsub_topic.document_uploaded.name` en `service_api`.
- **Api**: `POST /admin/jobs/documentos-pendientes`, disparado por Cloud Scheduler cada 15 min, en dos pasos:
  - (a) `procesando` con `actualizado_en` de más de 30 min pasa a `fallido`. No se republica, para no entrar en un loop si el PDF tumba al worker. `fallido` deja el ingreso manual habilitado.
  - (b) `pendiente` con `actualizado_en` de más de 10 min se republica a `document.uploaded`, con un máximo de 100 por tick, y se toca `actualizado_en` para no republicarlo en cada tick. El claim condicional del worker vuelve inocuos los duplicados.
  - Sin topic configurado, responde 200 `skipped: true`.
- **Terraform**:
  - `service_document` queda con `vpc_connector`, `min_instances = 1`, `cpu_idle = false` y `cpu = "1"`.
  - Scheduler job `documentos-pendientes`, con el mismo SA OIDC de los demás crons.
- **Cloud Build**: `build-`, `push-` y `deploy-document-service` con `services update --image`, que preserva la config de Terraform. `release-staging.yml` (#760) lo hereda sin cambios.
- **Runbooks**:
  - `docs/runbooks/rollback-drill-microservicios.md`, sección document-service.
  - `service-document-service.md` corregido: decía "autoscaling Pub/Sub pull" con `min = 0`.

## Criterios de éxito

- [ ] Tests unitarios y de integración del reconciliador contra Postgres real. La transición `procesando` → `fallido` y el republish de `pendiente` se verifican por estado de fila.
- [ ] Coverage ≥ 80 % en api y document-service (gate de CI).
- [ ] La imagen de `document-service` se construye. Docker build local simulado (`docker-sim.sh`) y el smoke `node dist/main.js` falla solo por config, no por módulos faltantes.
- [ ] `terraform validate` OK con el provider mirror.
- [ ] **Post-merge (PO)**: `terraform apply` + release. `gcloud run services describe booster-ai-document-service` muestra una imagen ≠ placeholder, y un documento subido pasa a `decodificado` o `fallido` en < 2 min.
- [ ] **Post-merge (PO)**: drill de rollback en staging según `rollback-drill-microservicios.md`.

## Por qué no hay shadow

`document-service` no duplica lógica del api: es el único consumidor de `document.uploaded`, y el api nunca decodificó TED inline. No hay salida del monolito con la cual comparar. El rollback es volver a la revisión anterior (`update-traffic --to-revisions`). Mientras tanto, los documentos esperan en `pendiente` o en la subscription, con retención de 7 días.

## Costo

`min_instances = 1` con 1 vCPU y 1 GiB always-on cuesta del orden de USD 45/mes, la misma configuración que telemetry-processor después de ADR-081. La alternativa con scale-to-zero es una push subscription con OIDC hacia un endpoint HTTP del worker, pero requiere un SA invoker nuevo y un binding IAM. Eso cae en `.tf` de IAM, que CLAUDE.md reserva al PO, así que queda fuera de este PR. Si el PO prefiere push, se hace en un PR aparte.
