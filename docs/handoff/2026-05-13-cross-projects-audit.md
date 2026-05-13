# Auditoría cross-proyectos GCP — boosterchile.com (organización 435506363892)

**Fecha**: 2026-05-13
**Sesión**: Claude Opus 4.7
**Trigger**: Felipe pidió "revisar otros proyectos en GCP en el dominio boosterchile.com que estén generando costos"
**Billing account**: `019461-C73CDE-DCE377` (CLP)

## Proyectos identificados

| Project ID | Display name | Created | Billing | Estado real |
|---|---|---|---|---|
| `booster-ai-494222` | Booster AI | 2026-04-23 | ✅ Linked | **TRL 10 actual** — ~$575/mes post-optimizaciones |
| `big-cabinet-482101-s3` | Booster by TVO | 2025-12-23 | ✅ Linked | **Booster 2.0 legacy productivo** — ~$80-150/mes |
| `gen-lang-client-0486421631` | Booster | 2025-12-23 | ✅ Linked | Solo Gemini API key legacy (`Booster 1.0`) — ~$0-5/mes |
| `cs-hc-a1c2ef1734b54550be7f6005` | — | — | ❌ none | Cloud Shell session — $0 |
| `cs-host-c104dcd149104453b58c12` | — | — | ❌ none | Cloud Shell session — $0 |

## `big-cabinet-482101-s3` — análisis productivo

**Recursos activos (mucha más superficie de lo esperado para un "legacy")**:

- **9+ Cloud Run services** (saw1 + us-central1):
  - `booster-api` (us-central1)
  - `booster-backend` (saw1 + us-central1, duplicado por región)
  - `booster-fms-python` (saw1) — fleet management ?
  - `booster-frontend` (saw1 + us-central1) + `booster-frontend-admin/driver/fleet`
  - `booster-landing` (us-central1)
  - `booster-worker` (saw1)
- **Cloud SQL**: `booster2-db-new` Postgres 16, tier `db-g1-small`, ZONAL, 10 GB
- **2 Pub/Sub topics**: `booster-telemetry`, `device-telemetry`
- **5 GCS buckets**: cloudbuild, frontend-prod, documents, run-sources (saw1+us)
- **3 BigQuery datasets**: `booster_cloudrun_logs`, `booster_iot`, `booster_telemetry` (uno en `US` multi-region)

**Tráfico real últimos 30d** (Cloud Monitoring):
- `booster-backend@us-central1`: **259.184 requests** ← productivo intenso
- `booster-landing@us-central1`: **39.474 requests**
- `booster-backend@southamerica-west1`: 503 (estable, bajo)
- Otros: <20 req cada uno
- **Cloud SQL CPU avg 30d**: 7.9% (low pero sostenido)

**Estimación de costo `big-cabinet-482101-s3`**: ~**USD 80-150/mes**
- Cloud Run idle + requests: $50-100
- Cloud SQL `db-g1-small` ZONAL: $15-25
- BigQuery storage + queries: $5-20
- GCS + Pub/Sub: $5-15

## Hallazgos importantes

### 🔴 Decisión PO requerida: ¿migrar tráfico o sunset?

El repo `booster-ai` (este) se describe como **"reescritura greenfield de Booster 2.0 con cero deuda técnica desde day 0"** (per CLAUDE.md). Pero `big-cabinet-482101-s3` **sigue siendo el cliente productivo principal** — 259k req/mes en `booster-backend@us-central1`.

Esto implica una de dos cosas:
1. La migración a Booster AI todavía no ha sucedido — el tráfico sigue en Booster 2.0
2. Booster AI sirve un caso de uso distinto y ambos siguen en paralelo

**Costo continuo paralelo**: ~$655-725/mes (booster-ai $575 + big-cabinet $80-150). Si la migración va a tomar varios meses, ese costo dual se va a sumar.

### 🟡 API key `Booster 1.0` en `gen-lang-client-0486421631`

Otro proyecto separado con UNA API key Gemini llamada `Booster 1.0`. Probablemente usada por el frontend de Booster 2.0. Mismo problema que las eliminadas en ADR-037: sin restricción de origen + cobra al proyecto al que pertenece.

**Acción**: si Booster 2.0 va a sunset, eliminar esta key + proyecto. Si sigue activo, aplicar mismo patrón ADC que ADR-037.

### 🟢 Cluster DR `booster-ai-telemetry-dr` sigue inactivo

El cluster DR de `booster-ai-494222` (~$130/mes) sigue sin `telemetry-tcp-gateway` desplegado. Issue #194 abierto + PR #204 con plan + esta sesión intentó deploy via Cloud Build private worker pool **pero fracasó por networking cross-region** (worker pool saw1 no llega al master DR us-central1 a pesar de `master_global_access_config=enabled`).

**Nueva opción a evaluar**: crear un Cloud Run Job (o segundo worker pool) en us-central1 para correr el `kubectl apply` desde dentro del VPC peering DR.

## Costos consolidados estimados

| Capa | USD/mes |
|---|---|
| `booster-ai-494222` (post-ADR-034/035/037/038) | ~$575 |
| `big-cabinet-482101-s3` (Booster 2.0 productivo) | ~$80-150 |
| `gen-lang-client-0486421631` (Gemini legacy key) | ~$0-5 |
| **TOTAL org boosterchile.com** | **~$655-730/mes** ≈ **CLP $615-685k/mes** |

## Recomendaciones

### Inmediato

1. **Decisión PO**: ¿Booster 2.0 (`big-cabinet`) sigue siendo productivo o se va a apagar? El costo dual depende de esto.
2. **Si sunset Booster 2.0**: agendar fecha de corte → migrar tráfico residual → `gcloud projects delete big-cabinet-482101-s3 + gen-lang-client-0486421631`.
3. **Si sigue activo Booster 2.0**: aplicar mismo right-sizing que ADR-034 al `booster2-db-new` (db-g1-small ZONAL ya es chico) y a los Cloud Run con min_instances elevado.

### Mes que viene (cuando billing export tenga datos reales)

4. Re-correr esta auditoría con queries directas a `booster-ai-494222.billing_export.gcp_billing_export_v1_019461_C73CDE_DCE377` filtrado por `project.id`. Vamos a tener cifras facturadas reales por proyecto + por SKU.

### Higiene de IAM (este último checks)

5. Verificar que NO hay roles/owner directos a usuarios humanos en `big-cabinet-482101-s3` (anti-pattern). Usar `engineers_group` o equivalente.
6. Validar que `gen-lang-client-0486421631` tiene billing budget alert configurado (cualquier Gemini-key leak ahí escala muy rápido).

🤖 Generado por Claude Opus 4.7
