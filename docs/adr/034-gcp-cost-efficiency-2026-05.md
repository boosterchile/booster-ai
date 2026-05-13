# ADR 034 — GCP cost efficiency: right-sizing 2026-05

**Estado**: Aceptado
**Fecha**: 2026-05-13
**Autor**: Claude (Opus 4.7) + Felipe Vicencio
**Supersede**: —
**Relacionado**: `docs/audits/gcp-costs-2026-05-13.md`

---

## Contexto

Auditoría profunda de costos GCP (ver `docs/audits/gcp-costs-2026-05-13.md`) detectó:

1. **Cloud SQL sobre-aprovisionado**: tier `db-custom-2-7680` con uso real 30d:
   - CPU avg **3.9%**, p95 **4.6%**, máximo absoluto **23.7%**
   - RAM avg **47.6%**, p95 **48.2%**, máximo **48.4%** (~3.7 GB de 7.68 GB)
2. **Cloud Run `min_instances=1`** en 4 servicios con tráfico real <0.002 RPS:
   - `booster-ai-web`: 100 req/día
   - `booster-ai-marketing`: 150 req/día
   - `booster-ai-whatsapp-bot`: 19 req/día
   - `booster-ai-telemetry-processor`: 0.27 req/día
3. **Billing export a BigQuery no configurado** → toda auditoría es estimación, no facturación real.

Otros hallazgos (Memorystore Redis 0.6% memory, DR cluster idle) NO se incluyen en este ADR — el DR cluster es load-bearing para SLA Wave 3 D4 (failover Teltonika a `telemetry-dr.boosterchile.com`).

---

## Decisión

### 1. Cloud SQL: downsize a `db-custom-1-6144` (1 vCPU, 6 GB RAM)

**Antes**: `db-custom-2-7680` (2 vCPU, 7.68 GB RAM) REGIONAL HA
**Después**: `db-custom-1-6144` (1 vCPU, 6 GB RAM) REGIONAL HA

**Headroom resultante**:
- CPU: max actual 23.7% × 2 vCPU = 0.47 vCPU → en 1 vCPU = **47%** (margen 2.1×)
- RAM: max actual 48.4% × 7.68 GB = 3.72 GB → en 6 GB = **62%** (margen 1.6×)

Mantiene `REGIONAL` (HA multi-zona) sin compromiso del backup config, PITR, retention, ni IAM auth.

**Costo**: ~3-5 min de downtime durante el `terraform apply` (Cloud SQL programa el reinicio en ventana de mantenimiento si está configurada; aplicación inmediata si no).

### 2. Cloud Run: `min_instances=0` para 4 servicios con tráfico marginal

Cambio en `infrastructure/compute.tf`:

| Servicio | min_instances ANTES | min_instances DESPUÉS | Justificación |
|---|---|---|---|
| `booster-ai-api` | 1 | **1** (no cambia) | 3 RPS sostenidos, latency-critical |
| `booster-ai-web` | 1 | **0** | 100 req/día = ~0.001 RPS |
| `booster-ai-marketing` | 1 | **0** | 150 req/día = ~0.002 RPS |
| `booster-ai-whatsapp-bot` | 1 | **0** | 19 req/día; Twilio reintenta automáticamente |
| `booster-ai-telemetry-processor` | 1 | **0** | 0.27 req/día; Pub/Sub push reintenta |

Cold start medido en `api`: 5-10s. Aceptable para los 4 servicios afectados:
- `web` y `marketing`: páginas públicas de baja frecuencia, primer hit del día tolerable
- `whatsapp-bot`: Twilio webhook con retry built-in (3 reintentos exponential backoff)
- `telemetry-processor`: subscriber Pub/Sub, redelivery automático

### 3. Billing export a BigQuery: habilitar

**Acción**: crear dataset `billing_export` en `booster-ai-494222` (location `southamerica-west1`) y habilitar el export del billing account `019461-C73CDE-DCE377` con:

- ✅ Standard usage cost data
- ✅ Detailed usage cost data
- ✅ Pricing data
- Retention: indefinida (BigQuery storage barato)

Permite re-correr la auditoría dentro de 24-48h con cifras facturadas reales.

### 4. NO TOCAR (por estabilidad)

- **DR cluster `booster-ai-telemetry-dr`** (us-central1) — load-bearing para SLA Wave 3 D4
- **Memorystore Redis STANDARD_HA** — diferir downgrade a BASIC; coordinar ventana porque requiere recrear instancia (caché efímera, no hay data loss real, pero ~5-10 min sin Redis durante recreate)
- **Static IPs internas reservadas** (`booster-ai-private-services`, `booster-cloudbuild-pool-range`) — necesarias para Private Service Connect + Cloud Build private pool

---

## Impacto económico

| Cambio | Ahorro USD/mes | Ahorro CLP/mes |
|---|---|---|
| Cloud SQL downsize | ~$100 | ~$94.000 |
| Cloud Run min=0 × 4 | ~$60-80 | ~$56.000-75.000 |
| Billing export | $0 (visibilidad) | $0 |
| **TOTAL** | **~$160-180** | **~$150.000-170.000** |

Sobre baseline auditoría ~$915/mes (~CLP $860k/mes) = **18-20% de reducción inmediata**.

Optimizaciones diferidas a próximos ADRs:
- Redis BASIC: -$40/mes (post-validación ventana)
- Auditoría post-billing-export: TBD según hallazgos reales

---

## Consecuencias

### Positivas

- **CLP ~$1.8M/año** de ahorro recurrente sin perder capacidad funcional ni SLA.
- Visibilidad granular de costos via billing export → próximas optimizaciones serán dato-driven.
- Right-sizing alineado con tráfico real (proyecto en TRL 6-7, pre-clientes pagados masivos).

### Negativas

- **Cold start latency** en 3 endpoints públicos (web/marketing/whatsapp-bot): primer request del día tarda 5-10s en respondedr. Mitigación: warmup endpoint custom + monitoreo p95 startup latency.
- **Downtime breve** (~3-5 min) en Cloud SQL durante el apply. Mitigación: ejecutar en ventana baja-tráfico (madrugada Chile).
- Reducción de headroom Cloud SQL: si llega cliente que genera tráfico 3-5× actual, hay que volver a subir tier. Reversión: 1 cambio de variable + apply 5 min.

### Reversibilidad

Todos los cambios son reversibles en <10 min cambiando `cloudsql_tier` y `min_instances` de vuelta y reaplicando. La habilitación del billing export es reversible (deshabilitar export) pero los datos ya escritos permanecen.

---

## Validación post-deploy

- [ ] `terraform plan` sin errores antes del PR
- [ ] `terraform apply` exitoso post-merge
- [ ] Cloud SQL CPU p95 7d post-apply < 70% (alerta si supera)
- [ ] Cloud Run cold-start p95 < 8s para los 4 services afectados
- [ ] Billing export con datos en `booster-ai-494222:billing_export.gcp_billing_export_v1_*` dentro de 48h
- [ ] Comparar billing real del mes 2026-06 vs estimación: delta < 15%

---

## Referencias

- `docs/audits/gcp-costs-2026-05-13.md` — auditoría base
- `infrastructure/data.tf` — `google_sql_database_instance.main`
- `infrastructure/compute.tf` — `module.service_*`
- `infrastructure/variables.tf` — `var.cloudsql_tier`
- [Cloud SQL custom machine types pricing](https://cloud.google.com/sql/pricing)
- [Cloud Run pricing model](https://cloud.google.com/run/pricing)
