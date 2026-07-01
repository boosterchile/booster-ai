# Runbook — Servicio `apps/api` (backend Hono, Cloud Run)

- **Estado**: Vigente
- **Servicio Cloud Run**: `booster-ai-api` · región `southamerica-west1` · project `booster-ai-494222`
- **URL pública**: `https://api.boosterchile.com` (sólo vía GCLB + Cloud Armor; el `*.run.app` está cerrado, `ingress = INTERNAL_LOAD_BALANCER`, ADR-062)
- **Naturaleza**: API HTTP principal del producto (Hono + `@hono/node-server`, Node 24, puerto 8080). Entrypoint `apps/api/src/main.ts`. Es el corazón del backend: además de los endpoints REST aloja hoy la lógica de **matching** (`apps/api/src/services/matching.ts`, `@booster-ai/matching-algorithm`) y el **fan-out de notificaciones** (`dispatch-safety-notification.ts`, `notify-offer.ts`, `webpush.ts`) — ver runbooks `service-matching-engine.md` y `service-notification-service.md`.

> Al **startup** el servicio corre migraciones Drizzle (`apps/api/src/db/migrator.ts`, forward-only, bajo advisory lock `pg_advisory_lock(938472561)`) **antes** de aceptar tráfico. Una migración rota puede dejar la revisión en estado `Failed` → ver `db-migration-rollback.md`.

---

## Health endpoints

| Endpoint | Tipo | Qué chequea |
|---|---|---|
| `GET /health` | liveness | proceso vivo. 200 sin tocar dependencias. Es el que mira el uptime check `API /health`. |
| `GET /ready` | readiness | `SELECT 1` contra Postgres (timeout ~2s). 503 si la DB no responde. |
| `GET /health/signup-flow` | synthetic | liveness del flujo de signup (T8 SEC-001) sin tocar BD — distingue "API entera caída" de "signup caído". Lo consume el probe `signup_probe`. |

```bash
curl -fsS https://api.boosterchile.com/health  ; echo
curl -fsS https://api.boosterchile.com/ready   ; echo   # 503 ⇒ DB inalcanzable
```

---

## Síntomas / alertas que disparan este runbook

| Alerta (policy en infra) | Significado | Sección |
|---|---|---|
| `API error rate > 1%` (`monitoring.tf:106`) | 5xx/total > 1% sostenido 5 min | [5xx elevado](#5xx-elevado--error-rate--1) |
| `API latency p95 > 2s` (`monitoring.tf:137`) | p95 de `request_latencies` > 2000 ms 5 min | [Latencia alta](#latencia-p95-alta) |
| `Uptime check failing` (`monitoring.tf:168`) | `/health` no responde 200 | [API caída](#api-caída--uptime-failing) |
| `Cloud SQL storage > 80%` (`monitoring.tf:218`) | disco Cloud SQL llenándose | [DB / Cloud SQL](#dependencia-db--cloud-sql) |
| `routes_api_rate` / `gemini_api_rate` (`api-cost-guardrails.tf`) | gasto/QPS anómalo a Google Routes o Gemini | [Costos APIs externas](#costos-de-apis-externas-routes--gemini) |

Reporte de horario al PO en **America/Santiago** (mostrar UTC también si es operacional).

---

## Diagnóstico general (primero esto, siempre)

```bash
SVC=booster-ai-api ; REGION=southamerica-west1 ; PROJECT=booster-ai-494222

# 1. ¿Qué revisión sirve tráfico y en qué estado está?
gcloud run services describe $SVC --region=$REGION --project=$PROJECT \
  --format='value(status.traffic)'
gcloud run revisions list --service=$SVC --region=$REGION --project=$PROJECT \
  --format='table(metadata.name, status.conditions[0].type, status.conditions[0].status, spec.containerConcurrency)' --limit=5

# 2. Errores recientes (severity ERROR, última hora)
gcloud logging read 'resource.type="cloud_run_revision"
  resource.labels.service_name="booster-ai-api" severity>=ERROR' \
  --project=$PROJECT --limit=50 --freshness=1h --format='value(timestamp, jsonPayload.message, jsonPayload.err.message)'

# 3. ¿La revisión llegó a arrancar? (migración fallida deja log del migrator)
gcloud logging read 'resource.type="cloud_run_revision"
  resource.labels.service_name="booster-ai-api"
  (jsonPayload.message=~"migrat" OR jsonPayload.message=~"advisory lock")' \
  --project=$PROJECT --limit=20 --freshness=2h
```

> **Token gcloud stale** (INC-2026-06-19, ver memoria del repo): si `gcloud` sale vacío o pide reauth no-interactivo, leé GCP por REST con token ADC (`gcloud auth application-default print-access-token`) o pedile al owner que corra el comando. No asumas que "no hay logs" = "no hay error".

---

## 5xx elevado / error rate > 1%

1. **Aislar la causa** en los logs (paso 2 de diagnóstico). Patrones típicos:
   - `err.message` con `ECONNREFUSED`/`timeout` a Postgres → ir a [DB](#dependencia-db--cloud-sql).
   - `UNABLE_TO_VERIFY_LEAF_SIGNATURE` / errores de Redis → ir a [Redis](#dependencia-redis--memorystore).
   - 5xx concentrados en **una ruta** → bug del último deploy. Confirmá con `git log` qué entró.
2. **¿Coincide con un deploy reciente?**
   ```bash
   gcloud run revisions list --service=$SVC --region=$REGION --project=$PROJECT \
     --format='table(metadata.name, metadata.creationTimestamp, status.conditions[0].status)' --limit=5
   ```
   Si el 5xx empezó junto con la revisión nueva → **rollback inmediato** (abajo) y recién después investigar.
3. Si es saturación (muchos requests, instancias topadas) y no un bug → revisar `max_instances` y CPU; subir si corresponde (Terraform).

### Rollback de revisión (mitigación más rápida)

```bash
# Revisión sana anterior:
gcloud run revisions list --service=$SVC --region=$REGION --project=$PROJECT --limit=5
# Mandar 100% del tráfico a ella:
gcloud run services update-traffic $SVC --region=$REGION --project=$PROJECT \
  --to-revisions=<REVISION_SANA>=100
```

> ⚠️ **Revertir la revisión NO revierte el esquema** (las migraciones son forward-only). Si la migración del deploy malo NO era backward-compatible, el rollback de código puede romper contra el esquema ya migrado → seguí `db-migration-rollback.md` (Camino B forward-fix o C PITR). El guard `migration-safety` en CI existe para que esto casi nunca pase.

### Canary atascado al 1%

El deploy productivo es canary (1% → 30 min → 100%, `cloudbuild.production.yaml`) y la promoción a 100% es **decisión humana** (`canary-verify` es placeholder `exit 0`). Si el tráfico quedó stuck al 1% (timeout del build, ver memoria "Cloudbuild canary timeout"):

```bash
gcloud run services update-traffic $SVC --region=$REGION --project=$PROJECT --to-latest
```

---

## Latencia p95 alta

1. **¿Dónde está el tiempo?** Cloud Trace (consola) filtrando por `booster-ai-api`, o por logs:
   ```bash
   gcloud logging read 'resource.type="cloud_run_revision"
     resource.labels.service_name="booster-ai-api" jsonPayload.duration_ms>2000' \
     --project=$PROJECT --limit=30 --freshness=30m \
     --format='value(jsonPayload.path, jsonPayload.duration_ms)'
   ```
2. **Causa típica = DB lenta**: ver query latency p99 en el dashboard de Cloud SQL. Si > 500 ms → [DB](#dependencia-db--cloud-sql).
3. **Cold starts**: el servicio corre con `min_instances` bajo. Una ráfaga tras escalar a cero produce p95 alto transitorio + el costo de correr migraciones al arrancar. Si el patrón es "primer request lento, resto normal" → cold start, no incidente. Evaluar subir `min_instances` si el tráfico lo amerita.
4. **Dependencia externa lenta** (Routes/Gemini/Twilio): buscar timeouts en logs; esas llamadas deben tener timeout + fallback (ej. Routes cae al centroide regional).

---

## API caída / uptime failing

1. **¿La revisión arranca?** Si todas las revisiones recientes están `Failed`, casi siempre es **migración** o **env/secret faltante**:
   ```bash
   gcloud logging read 'resource.type="cloud_run_revision"
     resource.labels.service_name="booster-ai-api" severity>=ERROR' \
     --project=$PROJECT --limit=30 --freshness=1h
   ```
   - Migración rota → `db-migration-rollback.md`.
   - `config.ts` (Zod) tira `Invalid environment` al startup → falta o está mal una env var/secret. Revisar `--update-secrets`/`--set-env-vars` de la revisión vs `apps/api/src/config.ts`.
2. **¿El LB/DNS está OK?** El `/health` se chequea contra `api.boosterchile.com` (GCLB). Si Cloud Run está sano pero el uptime falla, sospechar GCLB/Cloud Armor/cert:
   ```bash
   curl -fsS -o /dev/null -w '%{http_code}\n' https://api.boosterchile.com/health
   # Comparar contra el *.run.app NO sirve: ingress es INTERNAL_LOAD_BALANCER (no responde directo).
   ```
3. **Mitigación**: si la última revisión no arranca, mandar tráfico a la última sana (ver [rollback](#rollback-de-revisión-mitigación-más-rápida)).

---

## Dependencia: DB / Cloud SQL

- Instancia: `booster-ai-pg-<suffix>` (sufijo aleatorio). PITR habilitado (7 días, `data.tf`).
  ```bash
  gcloud sql instances list --project=$PROJECT
  ```
- **Storage > 80%** (`cloudsql_storage` alert): Cloud SQL tiene autoresize, pero confirmá que está activo y que no hay un runaway (tabla creciendo sin control, ej. logs/telemetría). Si urge, subir `disk_size` via Terraform.
- **DB inalcanzable / lenta**: `/ready` da 503. Verificar estado de la instancia, conexiones del pool (`DATABASE_POOL_MAX`), y latencia p99. Para corrupción/rollback de datos → `db-migration-rollback.md` (Camino C, PITR clone).

---

## Dependencia: Redis / Memorystore

El api usa Redis para rate-limiting, conversation store y cache de tokens (lazy-connect, `lazyConnect=true` → no crashea el startup; los middlewares que dependen de Redis devuelven 503 si no conecta).

- **Síntoma**: 5xx/503 en endpoints con rate-limit + logs `UNABLE_TO_VERIFY_LEAF_SIGNATURE` o `ECONNREFUSED` a Redis.
- **Causa conocida** (memoria "Redis TLS CA pinning", ADR-058): un replace de Memorystore **rota la CA** y rompe TLS de ioredis (`tls:{}`); los health checks no lo ven. Verificar que `REDIS_CA_CERT` corresponde a la instancia viva y hacer una op real de Redis tras tocar la instancia.
  ```bash
  gcloud redis instances list --region=$REGION --project=$PROJECT
  gcloud redis instances describe <instance> --region=$REGION --project=$PROJECT \
    --format='value(serverCaCerts[0].cert)' | head -c 80 ; echo
  ```

---

## Costos de APIs externas (Routes / Gemini)

Alertas `routes_api_rate`, `routes_api_daily_volume`, `gemini_api_rate` (`api-cost-guardrails.tf`) — disparan ante QPS o volumen diario anómalo.

1. Identificar quién dispara: logs del api buscando las llamadas a Routes/Gemini (loop inesperado, retry sin backoff, abuso).
2. Mitigación inmediata si es runaway: feature flag que apague la ruta (ver flags en `config.ts`, ej. `MATCHING_ALGORITHM_V2_ACTIVATED`) o, en extremo, restringir la API key (las keys GCP tienen restricción IP/referrer por contrato de stack).
3. Esto es señal de **costo**, no de caída — escalar al PO si el gasto proyectado es relevante, con número en CLP/USD.

---

## Escalación

- **Operador único** (`dev@boosterchile.com`): no hay segundo equipo. El único notification channel es email (`monitoring.tf`); no hay Slack/PagerDuty.
- Si no se resuelve en **30 min**, registrar estado en `docs/handoff/CURRENT.md` antes de seguir.
- Decisiones disruptivas (promover un PITR clone, cambiar `DATABASE_URL`, tocar IAM/infra) → **coordinar con el PO**, no ejecutar en silencio. Operaciones de credenciales/prod las corre el owner.
- Para un incidente productivo en regla seguir la skill `booster-skills:incident-response` (detectar → estabilizar → entender).

## Refs

- Deploy / canary / rollback: skill `booster-deploy-cloud-run`; `cloudbuild.production.yaml`.
- Migraciones: `db-migration-rollback.md`, ADR-066.
- Ingress sólo-GCLB: ADR-062. Webhooks vía LB: ADR-063.
- Config y env: `apps/api/src/config.ts`. Migrator: `apps/api/src/db/migrator.ts`.
