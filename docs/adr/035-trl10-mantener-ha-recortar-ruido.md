# ADR 035 — TRL 10: mantener HA productiva, recortar solo ruido sin valor

**Estado**: Aceptado
**Fecha**: 2026-05-13
**Autor**: Claude (Opus 4.7) + Felipe Vicencio
**Extiende**: ADR-034 (right-sizing)
**Reemplaza**: una versión preliminar de este ADR que proponía eliminar el DR cluster y degradar Redis a `BASIC` — descartada al confirmar que el objetivo del producto es **TRL 10** (sistema probado, certificado, listo para despliegue comercial).

---

## Contexto

ADR-034 hizo right-sizing conservador: Cloud SQL tier downsize y Cloud Run `min_instances=0` en servicios con tráfico marginal. Después se exploraron optimizaciones adicionales bajo el principio "pagar por uso, costos fijos reducidos":

1. Eliminar DR cluster (`booster-ai-telemetry-dr`)
2. Cloud SQL `REGIONAL` → `ZONAL`
3. Memorystore Redis `STANDARD_HA` → `BASIC`
4. Log exclusion preventivo (ruido GKE control plane)

**Aclaración del PO 2026-05-13**: el objetivo del producto Booster AI es **TRL 10** (no TRL temprano). Esto significa:

- Sistema en/cerca de despliegue comercial.
- Clientes B2B grandes con contratos firmados que exigen 99.9 % uptime (comentario del código `dr-region.tf` lo deja explícito).
- DR multi-región **debe** funcionar — no es ítem futuro.
- HA Cloud SQL **debe** sostenerse en caída de zona.
- HA Redis es deseable para mantener la latencia en caída de nodo.

**Implicación**: las decisiones (1), (2) y (3) que apuntaban a eliminar redundancia operativa **son incompatibles con TRL 10** y se descartan. La decisión (4) — log exclusion — es ortogonal a HA y se mantiene.

---

## Decisión

### Lo único que cambia este ADR: agregar log exclusion preventivo

**Acción**: crear `google_logging_project_exclusion` que descarta el ruido de control plane de GKE:

- `io.k8s.coordination.v1.leases.{get,update,list,watch}` (leader election)
- `io.k8s.core.v1.configmaps.{get,watch}` (config polling)
- `io.gke.networking.v1.gcpinferencepoolimports.list` (housekeeping)

**Justificación**:
- Hoy 70 % del volumen de Cloud Logging (~1.4 GB/mes) es ruido de la control plane de GKE — operaciones internas de Kubernetes sin valor de auditoría ni debugging.
- Hoy el volumen total (~2 GB/mes) está dentro del free tier (50 GB/mes). El ahorro inmediato es **$0**.
- Cuando `apps/telemetry-tcp-gateway` entre en producción y los devices Teltonika hagan connect/disconnect a escala, el ruido escalará linealmente con pods/nodes. Estimación: 50-200 GB/mes → **USD 25-100/mes facturados**.
- Aplicar la exclusion ahora previene ese gasto **sin tocar nada que comprometa observabilidad o auditoría real**.
- Cualquier evento que NO sea `serviceName="k8s.io"` queda intacto. Audit logs productivos (deployments, secrets, etc.) tampoco se filtran.

### Lo que NO cambia (preservado por TRL 10)

- **DR cluster GKE Autopilot** `booster-ai-telemetry-dr` (us-central1) → **mantener**. Es load-bearing para el SLA Wave 3 D4.
- **Cloud NAT DR + Router DR + IP estática DR + DNS `telemetry-dr`** → **mantener**.
- **Cloud SQL `availability_type = "REGIONAL"`** → **mantener**. HA multi-zona es requisito de SLA productivo.
- **Memorystore Redis `STANDARD_HA`** → **mantener**. Failover sub-minuto en caída de nodo evita degradación visible al cliente.

---

## Issue de seguimiento (fuera de este PR)

El cluster DR existe y consume capacidad, pero hoy **no tiene `apps/telemetry-tcp-gateway` desplegado**. Es decir, si un device Teltonika hiciera failover a `telemetry-dr.boosterchile.com` ahora mismo, llegaría a una IP del LB cuyo backend (Service K8s del gateway) no existe.

**Para que el SLA Wave 3 D4 sea real, hay que desplegar el gateway en el cluster DR**. Este ADR NO hace ese trabajo (es deployment K8s, no Terraform). Pero deja la tarea registrada como TODO crítico de TRL 10.

Acción recomendada: abrir issue separado titulado **"Desplegar telemetry-tcp-gateway en cluster DR (us-central1) para cumplir SLA Wave 3 D4"** con:
- Helm chart / manifests K8s del gateway.
- Service con `loadBalancerIP = google_compute_address.telemetry_dr_lb.address`.
- Certificate de cert-manager con SAN `telemetry-dr.boosterchile.com`.
- Smoke test de failover device → DR backup.

---

## Impacto económico

### Inmediato

| Acción | Ahorro USD/mes | Notas |
|---|---|---|
| Log exclusion | **$0 hoy** | Dentro del free tier hoy |
| | **$25-100/mes prevenidos** | Cuando telemetry-tcp-gateway entre en producción |

### Acumulado con ADR-034

ADR-034 sigue válido tal cual:

| Cambio | Ahorro USD/mes |
|---|---|
| Cloud SQL tier `db-custom-2-7680` → `db-custom-1-6144` | ~$100 |
| 4 Cloud Run `min_instances` 1 → 0 | ~$60-80 |
| **Total fijo recortado** | **~$160-180/mes** |
| + Log exclusion (preventivo) | + $0-100/mes futuro |
| **TOTAL** | **~$160-180/mes hoy, hasta ~$280/mes en 6 meses** |

Sobre baseline ~$915/mes = **-18 % a -30 % según volumen futuro de telemetría**, **manteniendo TRL 10 sin compromiso**.

---

## Consecuencias

### Positivas

- TRL 10 preservado: HA multi-zona BD + HA Redis + DR cluster intacto.
- Log exclusion previene gasto variable futuro sin tocar observabilidad real.
- ADR-034 sigue válido — Cloud SQL right-sized y Cloud Run min=0 en servicios sin tráfico.

### Negativas

- DR cluster sigue siendo capacidad fría hasta que se despliegue el gateway en él. Issue de seguimiento abierto.
- Costos fijos no se reducen tanto como permitía el principio "pagar por uso" — el premium HA es el precio del SLA TRL 10.

### Reversibilidad

Log exclusion: `terraform destroy -target=google_logging_project_exclusion.gke_control_plane_noise` o eliminar el archivo + apply.

---

## Validación post-apply

- [ ] `google_logging_project_exclusion.gke_control_plane_noise` creado vía `gcloud logging exclusions list`
- [ ] Volumen Cloud Logging post-apply baja en ~1.4 GB/mes (componente `audited_resource`)
- [ ] Audit logs de operaciones productivas (deployments, secrets, etc.) siguen visibles
- [ ] Cluster DR sigue running (`gcloud container clusters list`)
- [ ] Cloud SQL sigue REGIONAL HA
- [ ] Redis sigue STANDARD_HA

---

## Referencias

- ADR-034 — right-sizing inicial
- `docs/audits/gcp-costs-2026-05-13.md` — auditoría base
- `infrastructure/dr-region.tf` — DR cluster (mantenido)
- `infrastructure/data.tf` — Cloud SQL REGIONAL + Redis STANDARD_HA (mantenidos)
- Conversación 2026-05-13 con PO: confirmación TRL 10 como objetivo del producto
