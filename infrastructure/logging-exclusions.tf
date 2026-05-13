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
