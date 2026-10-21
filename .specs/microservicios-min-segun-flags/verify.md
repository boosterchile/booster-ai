# Verify: microservicios-min-segun-flags

- Spec: .specs/microservicios-min-segun-flags/spec.md
- Fecha: 2026-10-21. Solo lecturas en prod; el plan corrió con la cuenta de solo lectura `terraform-drift@` (`-lock=false`). Nada se aplicó.

## 1. Nadie usa los servicios con los flags apagados

| Chequeo | Resultado |
|---|---|
| Flags vivos en `booster-ai-api` (`gcloud run services describe`) | `MATCHING_SHADOW=false`, `MATCHING_VIA_MICROSERVICE=false`, `NOTIFICATIONS_SHADOW=false`, `NOTIFICATIONS_VIA_MICROSERVICE=false` |
| `apps/api/src/services/whatsapp-enrutado.ts` | ambos flags en false → modo `directo`: devuelve el emisor directo y nunca llama a `publicar` |
| `apps/api/src/services/matching-ranking.ts` | ambos flags en false → modo `local`: devuelve `rankeadorLocal`, nunca llama al remoto |
| Publicadores y llamadores en el monorepo | Solo el api publica en `notification-events` y llama a matching-engine. notification-service solo consume `notification-events-sub` (`main.ts`). matching-engine no tiene Pub/Sub ni trabajo de fondo |
| `run.googleapis.com/request_count`, 30 días | matching-engine y notification-service sin series (0). api 591.982, web 145.492 |
| `pubsub.googleapis.com/topic/send_message_operation_count`, 30 días | `notification-events` sin series (0) |
| Alertas y SLO | Ningún SLO sobre estos servicios (`slo.tf`). Las métricas `telemetry/unplug_events` y `gnss_jamming_critical_events` filtran también por notification-service, pero los eventos los emite telemetry-processor. Las alertas de suscripción estancada que nombran a estos servicios (`security-p1`, `eco-score`) apuntan a suscripciones que ellos no consumen en el código: inconsistencia previa, fuera de alcance |

## 2. Costo que se recorta

Export de facturación por recurso, neto en USD por día:

| Servicio | Desde | USD/día | USD/mes |
|---|---|---|---|
| booster-ai-notification-service (1 vCPU, CPU siempre asignada, 512 Mi) | 2026-10-19 | 1,37–1,56 (días incompletos); por configuración ≈ 1,95 | 45–60 |
| booster-ai-matching-engine (1 vCPU, CPU solo en requests, 512 Mi) | 2026-10-19 | 0,32–0,37 | ~11 |

El costo empezó el 19-oct: ese release desplegó los dos servicios con `--min-instances=1` (`cloudbuild.production.yaml`).

## 3. Expresiones de `min_instances` (`terraform console`)

Las dos líneas de `locals` de `compute.tf`, copiadas tal cual y evaluadas:

| shadow | via_microservice | matching_engine_min | notification_service_min |
|---|---|---|---|
| false | false | 0 | 0 |
| false | true | 1 | 1 |
| true | false | 1 | 1 |
| true | true | 1 | 1 |

Con solo `matching_shadow=true` y los flags de notificaciones en false: matching 1, notification 0. Cada servicio sigue solo a sus propios flags.

## 4. Plan real contra prod

`terraform-drift.yml` sobre la rama (`workflow_dispatch`, run 39618010825): **Plan: 0 to add, 3 to change, 0 to destroy**.

| Recurso | Cambio |
|---|---|
| `module.service_matching_engine.google_cloud_run_v2_service.service` | `template.scaling.min_instance_count: 1 -> 0`, nada más |
| `module.service_notification.google_cloud_run_v2_service.service` | `template.scaling.min_instance_count: 1 -> 0`, nada más |
| `module.service_api.google_cloud_run_v2_service.service` | quita la env `RESEND_API_KEY` (secret `resend-api-key`). **No es de este PR**: la corrida programada de `main` del 2026-10-20 (run 39450315380) muestra el mismo diff. Viene de que el workflow no define `resend_api_key_ready` y usa su default `false`; el apply del PO con sus tfvars no debería mostrarlo |

Por eso el apply de este PR va con `-target=module.service_matching_engine -target=module.service_notification`.

## 5. Gates locales

| Gate | Resultado |
|---|---|
| `terraform fmt -check -recursive infrastructure/` | OK |
| YAML de `cloudbuild.production.yaml` | parsea. `deploy-notification-service`: `--no-cpu-throttling --cpu=1 --memory=512Mi`; `deploy-matching-engine`: `--cpu=1 --memory=512Mi`; telemetry-processor y document-service siguen con `--min-instances=1` |
| gitleaks (staged) | no leaks found |
| check-adr-numbering, spec-canonical-drift | OK |
| commitlint | OK |

## 6. Después de la revisión

Cambios por la revisión (detalle en `review.md`): `depends_on` de `service_api` sobre los dos módulos, alerta `wave2_consumer_stalled["notification_events"]`, rollback del canal en dos pasos y runbooks corregidos.

| Chequeo | Resultado |
|---|---|
| Ciclo de dependencias | Ninguno de los dos servicios referencia a `module.service_api`; `cloud_run_matching_url` es un texto fijo (`compute.tf`); el módulo `cloud-run-service` no tiene data sources (un `depends_on` de módulo no difiere lecturas) |
| `notification-service` entrega `modo: 'enviar'` estando el api en sombra | Sí: el modo viaja en cada evento y `procesar-evento.ts` solo compara hashes cuando `evento.modo === 'sombra'` |
| Plan real de la rama con los cambios de la revisión (`terraform-drift.yml`, run 39619307347) | **Plan: 1 to add, 3 to change, 0 to destroy.** + `google_monitoring_alert_policy.wave2_consumer_stalled["notification_events"]` («Wave2 notification_events consumer stalled — oldest unacked > 10min (CRITICAL)»); `min_instance_count: 1 -> 0` en matching-engine y notification-service; en el api, solo el artefacto conocido `RESEND_API_KEY` (§4). Sin ciclos ni errores: el `depends_on` no agrega cambios |
