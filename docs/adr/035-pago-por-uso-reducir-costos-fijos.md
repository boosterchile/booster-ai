# ADR 035 — Principio rector: pagar por uso, costos fijos reducidos

**Estado**: Aceptado
**Fecha**: 2026-05-13
**Autor**: Claude (Opus 4.7) + Felipe Vicencio
**Extiende**: ADR-034 (right-sizing)
**Supersede**: parcialmente ADR-034 en lo referente a DR cluster

---

## Contexto

ADR-034 hizo right-sizing conservador (Cloud SQL tier + Cloud Run min_instances) preservando explícitamente el DR cluster y Memorystore Redis STANDARD_HA por argumentos de "estabilidad".

Felipe Vicencio (PO) aclaró el principio rector que debe guiar las decisiones de plataforma:

> **Lo fundamental es pagar por uso y tener costos fijos reducidos.**

Esto cambia el criterio de decisión: la "estabilidad" que se justifica en ADR-034 solo aplica si está **comprando algo real** (SLA contractual, prevención de incidente con costo real esperado, etc.). Capacidad fría sin valor entregable hoy = desperdicio.

Aplicando el principio sobre el baseline de ADR-034:

### Análisis de costos fijos vs variables (post ADR-034)

| Categoría | USD/mes | % |
|---|---|---|
| **Fijos** (paga existas o no) | ~570 | 62% |
| **Variables** (paga por uso real) | ~345 | 38% |

Objetivo declarado: reducir fijos, no necesariamente "total". Cualquier dólar movido de fijo → variable es win incluso si el variable creciera proporcionalmente — la organización paga solo cuando se usa.

---

## Decisión

### 1. Eliminar el DR cluster GKE Autopilot (`booster-ai-telemetry-dr`)

**Razón material**: el cluster DR existe en `infrastructure/dr-region.tf` desde 2026-04-24, pero a 2026-05-13 **no tiene `apps/telemetry-tcp-gateway` desplegado**. Los pods activos son solo system (cert-manager, gke-gmp-system, kube-system, etc.).

**Implicación**: si los devices Teltonika hicieran failover a `telemetry-dr.boosterchile.com` HOY, llegarían a una IP cuya backend (Network LB → Service K8s del gateway) **no existe**. El handshake TLS fallaría o, peor, conectaría a una IP sin listener.

**Conclusión**: el SLA Wave 3 D4 prometido en el comentario del archivo (`SLA: contratos B2B grandes piden 99.9% uptime`) **NO se cumple hoy con o sin DR cluster**. El cluster es teatro.

**Costo del teatro**: ~USD 100/mes (cluster fee Autopilot $73 + system pods Autopilot ~$30) + ~USD 32/mes Cloud NAT DR + ~USD 7/mes IP estática DR = **~USD 130/mes fijo**.

**Acción**: eliminar `dr-region.tf` completo + Cloud NAT DR + IP DR + DNS record `telemetry-dr`. Subnet `dr_private` también se elimina (no hay otros recursos que la usen).

**Reactivación**: cuando se materialice el deployment de `apps/telemetry-tcp-gateway` con manifest K8s en us-central1, recrear con `terraform apply` (~15 min). El código se preserva en el git history (commit `a4f741c` y previos).

### 2. Memorystore Redis: `STANDARD_HA` → `BASIC`

**Métricas reales 30d**: 0.6% memory usage (~6 MB de 1 GB).

**Diferencia funcional**:
- `STANDARD_HA`: 2 replicas multi-zona, failover automático ~1 min en falla del primario
- `BASIC`: 1 nodo, sin replica. Falla del nodo → ~5-10 min sin Redis durante recreación automática

**Justificación BASIC**:
- Redis solo guarda **caché efímera**: conversation store, OIDC token cache, rate-limit counters
- Pérdida total del cache → degradación temporal en latencia (DB direct hit), no falla funcional
- Probabilidad de falla del nodo Redis Memorystore es <<1% mensual
- Ahorro: ~USD 40/mes fijo

**Acción**: cambiar `var.redis_tier` default de `"STANDARD_HA"` a `"BASIC"`. **Implica recreate de la instancia** durante apply: ~5-10 min sin Redis. Servicios afectados (api, bot, web) deben tolerar cache miss → solo degradación de latencia.

### 3. Log exclusion preventivo: ruido GKE

**Estado**: hoy ingest de logs = 2 GB/mes (1.4 GB de `audited_resource` que en realidad es K8s API leases.get / configmaps.get del propio GKE), **dentro del free tier 50 GB/mes**.

**Riesgo**: cuando se despliegue `apps/telemetry-tcp-gateway` con tráfico productivo, el volumen K8s system podría escalar a 50-200 GB/mes — facilmente USD 25-100/mes en facturación de Cloud Logging.

**Acción preventiva**: agregar `google_logging_project_exclusion` para descartar:
- `protoPayload.serviceName="k8s.io" AND protoPayload.methodName=~"io\\.k8s\\.coordination\\.v1\\.leases\\.(get|update)"`
- `protoPayload.serviceName="k8s.io" AND protoPayload.methodName="io.k8s.core.v1.configmaps.get"`

Estos son operaciones internas de leader election + config refresh de GKE — sin valor de auditoría o debugging.

**Impacto hoy**: ahorro USD 0 (todavía bajo free tier). **Previene** gasto futuro variable.

### 4. Cloud SQL `REGIONAL` → `ZONAL`: NO se decide aún en este ADR

Felipe Vicencio pidió contexto antes de decidir. Se discute en sección separada (ver "Decisión pendiente" abajo). No se incluye en los cambios de este ADR.

---

## Cambios de código

### `infrastructure/dr-region.tf`
Eliminado completo (190 líneas, 6 recursos + 3 outputs).

### `infrastructure/wave-3-tls.tf`
Eliminados:
- `google_compute_router.dr_nat`
- `google_compute_router_nat.dr_nat`

### `infrastructure/variables.tf`
- `var.redis_tier` default: `"STANDARD_HA"` → `"BASIC"`

### `infrastructure/monitoring.tf` (o nuevo `logging-exclusions.tf`)
- Nuevo `google_logging_project_exclusion` con filtros de ruido K8s

### Process: apply en 2 steps

El cluster DR tiene `deletion_protection = true`. Para destruirlo:

1. **Apply 1**: cambiar `deletion_protection = false` en el cluster DR (commit aparte).
2. **Apply 2**: ejecutar el destroy completo (commit que elimina los archivos).

Esto se hace dentro del mismo PR con dos commits secuenciales claramente marcados.

---

## Impacto económico

### Ahorro adicional sobre ADR-034

| Acción | Ahorro USD/mes fijo | Mecanismo |
|---|---|---|
| Eliminar DR cluster GKE | ~$100 | Cluster fee + system pods |
| Eliminar Cloud NAT DR | ~$32 | NAT gateway 24/7 + flow logs |
| Eliminar IP estática DR | ~$7 | Static IP reservada |
| Redis BASIC | ~$40 | -50% Redis compute |
| Log exclusion (preventivo) | $0 hoy / $25-100 futuro | Variable saving |
| **TOTAL ADICIONAL** | **~$179** | |

### Acumulado total (ADR-034 + ADR-035)

| Capa | USD/mes |
|---|---|
| Baseline pre-ADR-034 | ~$915 |
| Ahorro ADR-034 | -$160 a -$180 |
| Ahorro ADR-035 | -$179 |
| **Total post-ambos ADRs** | **~$580 / mes** |
| **Reducción total** | **~37%** |

### Costos fijos resultantes (objetivo del usuario)

| Componente | USD/mes fijo |
|---|---|
| Cloud SQL `db-custom-1-6144` REGIONAL HA | ~$150 (pendiente decidir ZONAL → ~$75) |
| Memorystore Redis BASIC | ~$39 |
| Load Balancer global + IP global | ~$54 |
| Cloud NAT primary (saw1) | ~$32 |
| Static IPs (primary only, 3 IN_USE) | ~$22 |
| KMS keys | ~$3 |
| Cloud Run min=1 (solo `api`) | ~$8 |
| VPC + DNS + Artifact Registry | ~$2 |
| **TOTAL fijo** | **~$310 / mes** |

Sobre el baseline fijo de ~$570/mes pre-ADR-035, esto representa **-46% de costo fijo**.

Razón fijo/variable cambia de **62/38 → 53/47** (más cerca del ideal "paga por uso").

---

## Consecuencias

### Positivas

- Costos fijos reducidos casi a la mitad sin comprometer SLA real (porque el SLA Wave 3 D4 no se cumplía con o sin DR).
- Razón fijo/variable balanceada — escalas naturalmente con tráfico.
- DR cluster reactivable cuando exista deployment productivo (`apps/telemetry-tcp-gateway` en DR + Service K8s).
- Memorystore BASIC es suficiente para el caso de uso real (caché efímera).
- Log exclusion previene gasto variable futuro.

### Negativas

- **Sin DR multi-región**: caída de `southamerica-west1` = caída del producto. RTO actual ≈ tiempo de incident response Felipe (horas).
- **Sin HA Redis**: falla de nodo Memorystore = 5-10 min de degradación (no falla funcional).
- **Estado**: el archivo `dr-region.tf` desaparece del repo. Reactivación requiere recrear el código (git history sirve de referencia).

### Reversibilidad

- DR: `git revert` del commit que elimina + `terraform apply` ~15 min para recrear.
- Redis BASIC: cambiar `var.redis_tier = "STANDARD_HA"` + apply (recreate ~5 min).
- Log exclusion: eliminar el resource + apply.

---

## Decisión pendiente (separada): Cloud SQL HA

Felipe pidió contexto antes de decidir `REGIONAL` → `ZONAL`. Análisis a continuación; decisión va en ADR-036 o se agrega aquí cuando se confirme.

### Contexto de Cloud SQL HA

**¿Qué compra la opción REGIONAL?**
- Standby sincrónico en otra zona del mismo region (`southamerica-west1`)
- Failover automático ~30-60s en falla de zona
- Cobra 2× compute (la standby está siempre encendida y sincronizando)

**¿Qué cuesta?** Sobre `db-custom-1-6144`:
- ZONAL: ~$75/mes compute + $17 storage SSD = ~$92/mes
- REGIONAL: ~$150/mes compute + $34 storage SSD = ~$184/mes
- **Premium HA: $92/mes (CLP ~$86k/mes)**

**¿Qué se compra a cambio?**
- Probabilidad histórica de falla de zona GCP: <1 evento/año/región en saw1 (1 en 2024, 1 en 2025 según comentario código)
- Duración típica del incidente: 30 min - 4 horas
- **Sin HA**: durante el incidente, BD inaccesible → producto caído ese tiempo
- **Con HA**: failover transparente ~30-60s

**¿Hay SLA contractual que requiera HA hoy?**
- Pre-Corfo
- Pre-clientes pagados con contrato firmado
- Sin uptime guarantee comprometido en ningún documento

**Comparación con DR cluster (que SÍ se elimina)**:
- DR cluster era teatro (no tenía workload), aún con SLA documentado
- Cloud SQL REGIONAL SÍ funciona — si una zona cae, failover real ocurre
- Eliminar REGIONAL = pérdida funcional real, no teatro

**Recomendación**: si en los próximos 30 días no hay contrato firmado que requiera 99.9% uptime, cambiar a ZONAL. Mientras tanto, dejar REGIONAL.

---

## Validación post-deploy

- [ ] `terraform plan` confirma destroy de cluster DR + NAT DR + IP DR + DNS DR + Redis recreate
- [ ] `terraform apply` step 1 (deletion_protection=false) exitoso
- [ ] `terraform apply` step 2 (destroy + Redis recreate) exitoso
- [ ] `gcloud container clusters list` ya no muestra `booster-ai-telemetry-dr`
- [ ] `gcloud compute addresses list` ya no muestra IPs DR
- [ ] `gcloud redis instances describe booster-ai-redis --region=saw1 --format='value(tier)'` → `BASIC`
- [ ] `kubectl get ns` en cluster primary sigue intacto
- [ ] Cloud Run services siguen respondiendo
- [ ] Smoke test `pnpm demo:dry-run` ejecuta exitosamente
- [ ] Billing del próximo mes (post ADR-034 + ADR-035) ≤ $620 / mes en facturado real

---

## Referencias

- ADR-034 — right-sizing inicial
- `docs/audits/gcp-costs-2026-05-13.md` — auditoría base
- Conversación 2026-05-13 con PO: "lo fundamental es pagar por uso y tener costos fijos reducidos"
