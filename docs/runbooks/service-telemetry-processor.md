# Runbook — Servicio `apps/telemetry-processor` (Pub/Sub consumer, Cloud Run)

- **Estado**: Vigente
- **Servicio Cloud Run**: `booster-ai-telemetry-processor` · región `southamerica-west1` · project `booster-ai-494222` · `ingress = INTERNAL_ONLY`, `public = false`.
- **Naturaleza**: **consumer Pub/Sub pull** (StreamingPull dentro del container, NO request-driven). Entrypoint `apps/telemetry-processor/src/main.ts`. Expone sólo un health probe HTTP en `/health` (puerto 8080) para la liveness de Cloud Run. Consume **dos** subscriptions:
  1. `telemetry-events-processor-sub` → records AVL individuales → `persistRecord()` → Postgres `telemetria_puntos` (dedup natural por `UNIQUE(imei, timestamp_device)`). De paso emite eventos panic (`Unplug`/`GnssJamming`) y green-driving.
  2. `crash-traces-processor-sub` → packet de crash completo → `persistCrashTrace()` → GCS (`{project}-crash-traces-{env}`) + BigQuery (`telemetry.crash_events`).

> ⚠️ **Config crítica (incidente 2026-06-07, ~26 h sin ingesta)**: por ser pull consumer requiere **`min-instances >= 1` Y `cpu-throttling = false` (CPU always-on)**. Con `min=0` escala a cero (nadie tira de la cola); con CPU throttled, el StreamingPull se starvea entre requests. Esto debe vivir en IaC (`compute.tf`), no aplicado a mano.

---

## Health endpoint

```bash
# El servicio es interno (INTERNAL_ONLY): no se chequea con curl público.
# Liveness real = está consumiendo. Verificación operacional:
gcloud run services describe booster-ai-telemetry-processor \
  --region=southamerica-west1 --project=booster-ai-494222 \
  --format='value(spec.template.metadata.annotations["autoscaling.knative.dev/minScale"], spec.template.metadata.annotations["run.googleapis.com/cpu-throttling"])'
# Esperado: minScale >= 1  y  cpu-throttling = false
```

---

## Síntomas / alertas que disparan este runbook

| Alerta (policy) | Significado | Sección |
|---|---|---|
| `telemetry_consumer_stalled_p1` (`telemetry-monitoring.tf:379`) | `oldest_unacked_message_age` de `telemetry-events-processor-sub` > 30 min → **el processor dejó de consumir** | [Consumer stalled](#consumer-stalled-p1--el-modo-de-falla-principal) |
| `pubsub_backlog_p2` (`telemetry-monitoring.tf:331`) | backlog por conteo > 1000 (señal secundaria, lenta de noche) | [Backlog](#backlog-acumulado-p2) |
| `crash_trace_persistence_failures` > 0 (`crash-traces.tf:322`) | un crash trace no se pudo persistir (evidencia forense perdida) | [Crash trace persistence](#crash-trace-persistence-failed-p0) |
| `Pub/Sub DLQ has messages` (`monitoring.tf:194`) | mensajes en `pubsub-dead-letter` (5 nacks) | [DLQ](#mensajes-en-dlq) |

Este servicio comparte tablero con `oncall-telemetry-incidents.md` (§Pub/Sub backlog, §Telemetry consumer stalled, §Crash trace persistence). Este runbook es la **operación del servicio**; aquel es el árbol por alerta — referenciar, no duplicar.

---

## Consumer stalled (P1) — el modo de falla principal

`oldest_unacked_message_age` sube +60 s/min apenas muere el consumer, **independiente del volumen** (por eso dispara también de madrugada). Es el incidente del 2026-06-07.

1. **¿Hay instancias corriendo con CPU always-on?**
   ```bash
   gcloud run services describe booster-ai-telemetry-processor \
     --region=southamerica-west1 --project=booster-ai-494222 \
     --format='value(spec.template.metadata.annotations["autoscaling.knative.dev/minScale"], spec.template.metadata.annotations["run.googleapis.com/cpu-throttling"])'
   ```
2. **Fix inmediato** si está en `min=0` o throttled:
   ```bash
   gcloud run services update booster-ai-telemetry-processor \
     --region=southamerica-west1 --project=booster-ai-494222 \
     --min-instances=1 --no-cpu-throttling
   ```
   La instancia levanta y **drena el backlog acumulado** (Pub/Sub retiene 7 días → no se pierde nada). La ingesta vuelve.
3. **Verificar recuperación**: el backlog (`num_undelivered_messages`) baja a ~0 y `telemetria_puntos` recibe escrituras nuevas (último `timestamp_recibido_en` en segundos).
4. **Hay instancia viva pero igual no drena** → error en el handler:
   ```bash
   gcloud logging read 'resource.type="cloud_run_revision"
     resource.labels.service_name="booster-ai-telemetry-processor" severity>=ERROR' \
     --project=booster-ai-494222 --limit=40 --freshness=30m
   ```
   Causas: DB caída, o un deploy nuevo que rompe el handler. Tras 5 fallos por mensaje → DLQ.
5. **Permanente**: que `min-instances=1` + `--no-cpu-throttling` queden en `compute.tf` (no sólo a mano) para que un `terraform apply` o un deploy no lo reviertan.

---

## Backlog acumulado (P2)

Backlog por conteo > 1000. Si el [consumer stalled](#consumer-stalled-p1--el-modo-de-falla-principal) ya está descartado (hay instancia, CPU always-on, sin errores), entonces el processor consume pero **más lento que el gateway produce**.

1. **¿DB lenta?** Cloud SQL dashboard, query latency p99 > 500 ms = cuello de botella en `persistRecord()`.
2. **¿Throughput insuficiente?** Subir `MAX_MESSAGES_IN_FLIGHT` (env var; default 50, rango hasta 1000) y/o `max-instances`:
   ```bash
   gcloud run services update booster-ai-telemetry-processor \
     --region=southamerica-west1 --project=booster-ai-494222 \
     --update-env-vars=MAX_MESSAGES_IN_FLIGHT=150
   ```
3. **Pico transitorio** (la flota volvió a moverse en masa): el backlog se drena solo una vez que se alcanza el throughput. No es incidente si baja monótonamente.

---

## Crash trace persistence failed (P0)

`crash_trace_persistence_failures > 0`: cada falla = evidencia forense potencialmente perdida (seguros/upsell). Detalle en `oncall-telemetry-incidents.md` §"Crash trace persistence failed". Resumen:

1. **Causa del error**:
   ```bash
   gcloud logging read 'resource.type="cloud_run_revision"
     resource.labels.service_name="booster-ai-telemetry-processor"
     jsonPayload.message="error persistiendo crash-trace, nack para reintento"' \
     --project=booster-ai-494222 --limit=20 --freshness=1h
   ```
   - `permission denied` → IAM binding faltante (re-aplicar Terraform).
   - `bucket not found` → bucket `{project}-crash-traces-{env}` no creado o `GCS_CRASH_TRACES_BUCKET` mal seteada (vacío = consumer de crash deshabilitado, es modo dev).
   - `timeout` → el ack deadline de 300 s se agotó (raro); bajar `MAX_MESSAGES_IN_FLIGHT`.
2. **Si persiste > 30 min**: los packets quedan en `pubsub-dead-letter`. Reproc manual (ver [DLQ](#mensajes-en-dlq)).

---

## Mensajes en DLQ

Ambas subscriptions van a `pubsub-dead-letter` tras 5 entregas fallidas. La alerta `Pub/Sub DLQ has messages` salta con >0.

```bash
# Inspeccionar SIN consumir (no --auto-ack para no perderlos):
gcloud pubsub subscriptions pull pubsub-dead-letter-sub \
  --limit=20 --project=booster-ai-494222 --format=json | python3 -m json.tool
```

1. Leer el payload + el atributo de error para entender qué falló.
2. Arreglar la causa raíz primero (DB, IAM, bucket).
3. Re-publicar al topic original (`telemetry-events` o `crash-traces`) para reprocesar, o `seek` la subscription a un timestamp previo si corresponde reprocesar en bloque:
   ```bash
   gcloud pubsub subscriptions seek crash-traces-processor-sub \
     --time=<RFC3339> --project=booster-ai-494222
   ```

---

## Deploy / rollback

Deploy estándar Cloud Run (imagen vía Cloud Build). Rollback = mover tráfico a la revisión sana anterior:

```bash
gcloud run revisions list --service=booster-ai-telemetry-processor \
  --region=southamerica-west1 --project=booster-ai-494222 --limit=5
gcloud run services update-traffic booster-ai-telemetry-processor \
  --region=southamerica-west1 --project=booster-ai-494222 \
  --to-revisions=<REVISION_SANA>=100
```

> Tras **cualquier** deploy/rollback verificá que la revisión activa conserva `min-instances=1` + `--no-cpu-throttling`. Si la revisión nueva no los trae, vuelve el incidente del consumer stalled.

---

## Escalación

- **Operador único** (`dev@boosterchile.com`). Canal: email. Si no se resuelve en 30 min, registrar en `docs/handoff/CURRENT.md`.
- Pérdida de crash traces (P0) puede tener impacto **legal/seguros** → escalar al PO con el detalle de qué `crash_id`/`imei` se vio afectado.
- Para un evento de seguridad física (unplug/jamming que el processor emitió) seguir `oncall-telemetry-incidents.md`.

## Refs

- Alertas telemetría (árbol por alerta): `oncall-telemetry-incidents.md`.
- Topics/subs/DLQ: `infrastructure/messaging.tf`, `infrastructure/crash-traces.tf`.
- Config Cloud Run (min-instances/CPU): `infrastructure/compute.tf`.
- Código: `apps/telemetry-processor/src/`.
