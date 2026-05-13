# Cloud Logging — exclusiones de ruido (ADR-035).
#
# Audit Data Access logs (`allServices` configurado en project.tf) ingesta
# ~2 GB/mes en mayo 2026, dentro del free tier (50 GB/mes). Pero el 70 % del
# volumen es ruido puro de la control plane de GKE (leader election leases,
# configmaps watch). Cuando `apps/telemetry-tcp-gateway` entre en producción
# y los devices Teltonika empiecen a hacer connect/disconnect a escala, ese
# componente de ruido escalará linealmente con la cantidad de pods/nodes,
# pudiendo llegar a 50-200 GB/mes (CLP 23k-95k/mes en facturación).
#
# Este exclusion filter descarta esos eventos a nivel ingest, ANTES de
# llegar a `_Default`/`_Required` o cualquier sink. Es la forma más barata
# (~$0/mes) de prevenir el gasto futuro.
#
# IMPORTANTE: solo se excluyen operaciones internas de GKE control plane.
# Cualquier escritura productiva (deployments, services, secrets, etc.) y
# todo lo que NO sea `serviceName="k8s.io"` queda intacto.

resource "google_logging_project_exclusion" "gke_control_plane_noise" {
  name        = "gke-control-plane-noise"
  project     = google_project.booster_ai.project_id
  description = "ADR-035: descarta leases.get/update + configmaps.get + listings de inference pools — operaciones internas de leader election y config refresh de GKE, sin valor de auditoría."

  filter = <<-EOT
    protoPayload.serviceName="k8s.io"
    AND (
      protoPayload.methodName="io.k8s.coordination.v1.leases.get"
      OR protoPayload.methodName="io.k8s.coordination.v1.leases.update"
      OR protoPayload.methodName="io.k8s.coordination.v1.leases.list"
      OR protoPayload.methodName="io.k8s.coordination.v1.leases.watch"
      OR protoPayload.methodName="io.k8s.core.v1.configmaps.get"
      OR protoPayload.methodName="io.k8s.core.v1.configmaps.watch"
      OR protoPayload.methodName="io.gke.networking.v1.gcpinferencepoolimports.list"
    )
  EOT

  # No deshabilitar — esta exclusion debe estar siempre activa.
  disabled = false
}

# ---------------------------------------------------------------------------
# k8s_cluster + k8s_node informational events — exclusion adicional
# ---------------------------------------------------------------------------
# Hallazgo 2026-05-13 post-deploy DR: el ingest de logs explotó de 2 GB/mes
# (pre-deploy) a ~149 GB/mes (estimado, basado en 34.75 GB en 7 días).
# Cobrable: 99 GB × $0.50/GB ≈ $50/mes EXTRA.
#
# Top contributors (7d):
#   19.75 GB  k8s_cluster (cluster events, autopilot autoscaling, kubelet)
#    4.88 GB  k8s_node (node health checks, kubelet logs verbose)
#    1.44 GB  gce_subnetwork (VPC flow logs — atacado en data.tf sampling)
#    1.78 GB  k8s_container (logs INFO de los containers — KEEP, low cost)
#
# Esta exclusion descarta events de severidad INFO de k8s_cluster + k8s_node.
# WARN/ERROR/CRITICAL siguen capturándose (necesarios para alertas).

resource "google_logging_project_exclusion" "k8s_info_events_noise" {
  name        = "k8s-info-events-noise"
  project     = google_project.booster_ai.project_id
  description = "Hallazgo 2026-05-13: descarta INFO events de k8s_cluster + k8s_node — autoscaling, kubelet heartbeats, etc. WARN/ERROR siguen capturándose. Reduce log ingest ~80 GB/mes post-deploy DR."

  filter = <<-EOT
    (resource.type="k8s_cluster" OR resource.type="k8s_node")
    AND severity="INFO"
  EOT

  disabled = false
}
