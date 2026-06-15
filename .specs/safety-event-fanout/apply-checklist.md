# Checklist — `terraform apply` safety fan-out (P0-G)

Activa la infra del safety fan-out (push subscription + envs). Ejecutar **post-merge + post-deploy** de #473.

> El **apply (paso 4) es gate del PO**. Los pasos 1-3 (plan) son read-only y los puede correr el agente para revisión.

## 0. Precondiciones
- [ ] **#473 mergeado** a `main`.
- [ ] **Release desplegado**: `release.yml` desplegó las imágenes nuevas de `api` + `telemetry-processor` (con el endpoint + los producers); revisiones nuevas al 100% de tráfico.
  - *Por qué el orden*: hasta el apply el código es **inerte y safe** (sin `SAFETY_EVENTS_TOPIC` el processor no publica; sin `SAFETY_PUSH_CALLER_SA` el endpoint rechaza todo). El apply **activa** la pipeline. Aplicar antes del deploy → push da 404.

## 1. Posicionarse en main actualizado
```
cd /Users/felipevicencio/booster-ai
git checkout main && git pull --ff-only
git log --oneline -1   # debe incluir el merge de #473
```

## 2. Reautenticar GCP si hace falta
La ADC caduca (`invalid_rapt`). Si el plan falla con error de auth:
```
gcloud auth application-default login    # cuenta dev@boosterchile.com
```

## 3. Plan completo y revisión (NO `-target` — lección prod-drift)
```
cd infrastructure
terraform plan -out=safety.tfplan
```
Confirmar que el plan diga EXACTAMENTE:
- [ ] `Plan: 3 to add, 3 to change, 0 to destroy`
- [ ] **3 add**: `google_service_account.safety_push_invoker`, `google_service_account_iam_member.pubsub_safety_push_token_creator`, `google_cloud_run_v2_service_iam_member.safety_push_invoker_api`
- [ ] **3 change (in-place)**: subscription `telemetry_events_safety_p0_notification` (suma `push_config`), `service_api` (env `SAFETY_PUSH_CALLER_SA`), `service_telemetry_processor` (env `SAFETY_EVENTS_TOPIC`)
- [ ] **0 destroy**, y ningún recurso inesperado (si aparece drift ajeno → parar y triagear).

## 4. Aplicar (gate del PO)
```
terraform apply safety.tfplan
```
Crea el SA + bindings, cambia la subscription a push, dispara revisiones nuevas de `api` + `telemetry-processor` (imagen ya desplegada por el release + el env nuevo; `image`/`revision` están en `ignore_changes`).

## 5. Verificación post-apply
- [ ] Subscription en push:
```
gcloud pubsub subscriptions describe telemetry-events-safety-p0-notification-sub \
  --project=booster-ai-494222 \
  --format="value(pushConfig.pushEndpoint, pushConfig.oidcToken.serviceAccountEmail, pushConfig.oidcToken.audience)"
```
Esperado: `https://api.boosterchile.com/internal/safety-events` · `safety-push-invoker@booster-ai-494222.iam.gserviceaccount.com` · `https://api.boosterchile.com`

- [ ] Smoke test end-to-end (device demo, IMEI `863238075489155`):
```
gcloud pubsub topics publish telemetry-events-safety-p0 --project=booster-ai-494222 \
  --message='{"eventType":"unplug","imei":"863238075489155","occurredAt":"2026-06-15T18:00:00.000Z","rawValue":1}'
```
Luego en logs del api:
```
gcloud logging read 'resource.labels.service_name="booster-ai-api" AND jsonPayload.message=~"safety"' \
  --project=booster-ai-494222 --freshness=10m --limit=5 \
  --format="value(timestamp,jsonPayload.message,jsonPayload.outcome)"
```
Esperado: outcome `notified` (o `unknown_vehicle` si el device aún no está mapeado a un vehículo real — ahí entra el de-demo). **NO** esperar `401`/`403`.

- [ ] Sin acumulación en DLQ ni backlog: la alerta P1-A (`oldest_unacked_message_age` de la sub) NO debe dispararse. Si los push dan 401/403/404, los mensajes van a DLQ tras 5 intentos → revisar audience / SA / endpoint.

## 6. Rollback
Revertir el commit de infra + `terraform apply`, **o** en caliente (vuelve a pull, detiene el fan-out sin romper nada):
```
gcloud pubsub subscriptions modify-push-config telemetry-events-safety-p0-notification-sub \
  --project=booster-ai-494222 --push-endpoint=""
```

## 7. Follow-up WhatsApp (separado, cuando Meta apruebe)
Agregar `CONTENT_SID_SAFETY_ALERT` al bloque `secrets` de `compute.tf` (con su secret en Secret Manager). Hasta entonces el fan-out sale solo por push — sin cambio de código.
