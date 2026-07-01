# Runbooks operacionales — Booster AI

Índice de runbooks. Constantes para todos: project `booster-ai-494222`, región `southamerica-west1`, operador único `dev@boosterchile.com`, único canal de alerta = **email** (`infrastructure/monitoring.tf`; no hay Slack/PagerDuty). Reportar horarios al PO en **America/Santiago** (UTC también si es operacional). Si `gcloud` da token stale (INC-2026-06-19), leer GCP por REST con token ADC o pedir al owner que corra el comando.

## Runbooks por servicio

| Servicio | Plataforma | Runbook | Naturaleza |
|---|---|---|---|
| `apps/api` | Cloud Run (`booster-ai-api`) | [`service-api.md`](service-api.md) | API HTTP principal (Hono). Aloja hoy matching + fan-out de notificaciones. Corre migraciones al startup. |
| `apps/web` | Cloud Run (`booster-ai-web`) | [`service-web.md`](service-web.md) | PWA estática (nginx). Config build-time. |
| `apps/telemetry-tcp-gateway` | **GKE Autopilot** | [`service-telemetry-tcp-gateway.md`](service-telemetry-tcp-gateway.md) | TCP Teltonika (5027/5061). Único servicio con `kubectl`. |
| `apps/telemetry-processor` | Cloud Run (`booster-ai-telemetry-processor`) | [`service-telemetry-processor.md`](service-telemetry-processor.md) | Consumer Pub/Sub pull. **Requiere min-instances≥1 + CPU always-on.** |
| `apps/document-service` | Cloud Run (`booster-ai-document-service`) | [`service-document-service.md`](service-document-service.md) | Consumer Pub/Sub. Decodifica TED (PDF417). Bucket `documents` retención 6 años. |
| `apps/whatsapp-bot` | Cloud Run (`booster-ai-whatsapp-bot`) | [`service-whatsapp-bot.md`](service-whatsapp-bot.md) | Webhook Twilio WhatsApp + conversación XState en Redis. |
| `apps/sms-fallback-gateway` | Cloud Run (`booster-ai-sms-fallback-gateway`) | [`service-sms-fallback-gateway.md`](service-sms-fallback-gateway.md) | Webhook Twilio SMS → Pub/Sub `telemetry-events`. Ingress abierto (Twilio postea directo). |
| `apps/matching-engine` | Cloud Run (`booster-ai-matching-engine`) | [`service-matching-engine.md`](service-matching-engine.md) | **SKELETON** — el matching real vive en `apps/api`. |
| `apps/notification-service` | Cloud Run (`booster-ai-notification-service`) | [`service-notification-service.md`](service-notification-service.md) | **SKELETON** — el fan-out real vive en `apps/api`. |

## Alerta → runbook

| Alert policy (infra) | Runbook |
|---|---|
| `API error rate > 1%`, `API latency p95 > 2s`, `Uptime check failing` (`monitoring.tf`) | [`service-api.md`](service-api.md) / [`service-web.md`](service-web.md) (según el host del uptime) |
| `Cloud SQL storage > 80%` (`monitoring.tf`) | [`service-api.md`](service-api.md) §DB |
| `routes_api_rate`, `gemini_api_rate`, `routes_api_daily_volume` (`api-cost-guardrails.tf`) | [`service-api.md`](service-api.md) §Costos |
| `telemetry_consumer_stalled_p1`, `pubsub_backlog_p2` (`telemetry-monitoring.tf`) | [`service-telemetry-processor.md`](service-telemetry-processor.md) + [`oncall-telemetry-incidents.md`](oncall-telemetry-incidents.md) |
| `crash_trace_persistence_failures` (`crash-traces.tf`) | [`service-telemetry-processor.md`](service-telemetry-processor.md) §Crash trace |
| `telemetry_gateway_down_p1`, `gateway_enrollment_rate_limited_p1`, `gateway_connection_cap_reached_p2`, `parser_errors_p1` (`telemetry-monitoring.tf`) | [`service-telemetry-tcp-gateway.md`](service-telemetry-tcp-gateway.md) + [`oncall-telemetry-incidents.md`](oncall-telemetry-incidents.md) |
| crash/unplug/jamming P0 (`telemetry-monitoring.tf`) | [`oncall-telemetry-incidents.md`](oncall-telemetry-incidents.md) (respuesta a evento de seguridad física) |
| `Pub/Sub DLQ has messages` (`monitoring.tf`) | [`service-telemetry-processor.md`](service-telemetry-processor.md) / [`service-document-service.md`](service-document-service.md) (según el origen del mensaje) |
| `signup_probe_failure` (`signup-probe.tf`) | [`service-api.md`](service-api.md) (`/health/signup-flow`) |

## Runbooks de procedimiento (no por servicio)

| Runbook | Para qué |
|---|---|
| [`oncall-telemetry-incidents.md`](oncall-telemetry-incidents.md) | Árbol de respuesta por alerta de telemetría (crash/unplug/jamming/parser/backlog/stalled/ingress). |
| [`db-migration-rollback.md`](db-migration-rollback.md) | Revertir/contener una migración Drizzle (Caminos A rollback / B forward-fix / C PITR). |
| [`bootstrap-gke-telemetry-gateway.md`](bootstrap-gke-telemetry-gateway.md) | Primer levantamiento del cluster GKE (secret K8s, Workload Identity, Artifact Registry). |
| [`dr-failover-test.md`](dr-failover-test.md) | Test de failover DR. |
| [`load-content-sids.md`](load-content-sids.md) | Cargar/rotar Content SIDs de templates WhatsApp en Secret Manager. |
| [`migracion-bucket-certificados.md`](migracion-bucket-certificados.md) | Migrar certificados de carbono al bucket propio. |
| [`rotacion-maps-api-key.md`](rotacion-maps-api-key.md) | Rotar la Google Maps API key (referrer-restricted). |
| [`secret-init-runbook.md`](secret-init-runbook.md) | Inicializar secrets (placeholders post-`terraform apply`). |
| [`2026-05-13-workspace-admin-sdk-setup.md`](2026-05-13-workspace-admin-sdk-setup.md) | Setup del Workspace Admin SDK (observability dashboard). |
| [`agent-query-prod.md`](agent-query-prod.md) | Cómo consultar prod de forma segura (REST + ADC). |
| [`goal-templates.md`](goal-templates.md) | Plantillas de objetivos (coaching). |

> Para un incidente productivo en regla, además seguir la skill `booster-skills:incident-response` (detectar → estabilizar → entender). El estándar de "terminado" anti-parches: `booster-skills:definicion-de-terminado`.
