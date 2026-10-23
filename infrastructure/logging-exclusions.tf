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

# ---------------------------------------------------------------------------
# Ruido de plataforma GKE con severidad DEFAULT (auditoría de costos 2026-10-21)
# ---------------------------------------------------------------------------
# Cloud Logging facturó 174 GiB en septiembre y en octubre va a 6-10 GiB/día.
# La app aporta poco: Cloud Run + contenedores propios < 0,2 GiB/día. El resto
# es plataforma GKE, y casi todo llega con severidad DEFAULT, que
# `k8s_info_events_noise` (solo INFO) no ve. Bytes facturables de 7 días
# (`logging.googleapis.com/billing/bytes_ingested`, al 2026-10-21):
#
#   20,4 GiB  k8s_cluster    auditoría Data Access de k8s.io (lecturas)
#   22,4 GiB  k8s_node       gcfsd, gcfs-snapshotter, kubelet, containerd,
#                            arranque de nodo; llega en ráfagas en cada deploy
#    9,1 GiB  gce_instance   consola serial de los nodos Autopilot (gk3-*)
#
# Las tres exclusiones de abajo cubren ~50 GiB/semana de ~65. A ese ritmo la
# factura de Logging pasa de ~USD 100/mes a casi el free tier (50 GiB/mes).
#
# Lo que NO se toca: las escrituras de objetos de la API de Kubernetes (van a
# cloudaudit.googleapis.com/activity → bucket _Required, que no admite
# exclusiones y se guarda 400 días), las lecturas hechas por personas, por
# cuentas de GCP o por las cuentas de servicio de nuestros workloads, toda
# lectura de Secrets, los logs de los contenedores y los eventos
# WARNING/ERROR.

# Lecturas de la API de Kubernetes hechas por la propia plataforma GKE.
#
# Muestra de 6.000 entradas (2026-10-21): el 97 % de los bytes son lecturas
# de identidades `system:` del control plane administrado por Google
# (gke-master-healthcheck, addon-manager, clouddns, kube-controller-manager,
# kube-scheduler, kubelets `system:node:*`, addons de kube-system…). En
# Autopilot no podemos desplegar en kube-system, así que sus cuentas de
# servicio también son de Google.
#
# Se conservan:
#   - toda operación sobre Secrets, la haga quien la haga (~131 entradas/h,
#     ~0,1 GiB/mes). Si alguien roba el token de un kubelet o de un addon de
#     kube-system tras escapar de un contenedor, sus lecturas de Secrets
#     siguen quedando, y la línea base de los watch del sistema también;
#   - toda entrada con suplantación (`authoritySelector`, el usuario que se
#     impersona). GKE ya registra en principalEmail a quien hace la llamada,
#     y Autopilot no deja suplantar identidades `system:`; esto es defensa
#     extra y no cuesta nada;
#   - cualquier principal que no empiece con `system:` (personas, cuentas de
#     servicio de GCP, el agente de servicio de GKE);
#   - `system:serviceaccount:` de cualquier namespace que no sea kube-system
#     (cert-manager, telemetry, gke-gmp-system);
#   - `system:anonymous`, salvo las sondas de salud (readyz/livez/healthz):
#     un acceso anónimo a otro recurso es justo lo que hay que ver.
#
# Ojo: GKE registra como data_access, no como activity, algunas escrituras
# del sistema (subrecursos `status` de pods/nodos/daemonsets, y los create de
# TokenReview y SubjectAccessReview). Las que hace un `system:` también se
# descartan. Las escrituras de objetos (Secrets, Pods, RBAC…) y las de
# personas siguen en activity.
#
# `project.tf` (allServices con DATA_READ, por Trivy AVD-GCP-0029) ya
# anticipaba este paso: «exclusion filter en Logs Router para servicios
# específicos» si el volumen crecía.
resource "google_logging_project_exclusion" "gke_system_data_access" {
  name        = "gke-system-data-access"
  project     = google_project.booster_ai.project_id
  description = "Auditoría de costos 2026-10-21: descarta las entradas Data Access de k8s.io hechas por identidades system: del control plane de GKE y por cuentas de kube-system, más las sondas anónimas readyz/livez/healthz. Conserva toda operación sobre Secrets, toda suplantación, personas, cuentas de GCP, cuentas de servicio de nuestros namespaces y cualquier otro acceso anónimo."

  filter = <<-EOT
    resource.type="k8s_cluster"
    AND LOG_ID("cloudaudit.googleapis.com/data_access")
    AND NOT protoPayload.methodName=~"^io\.k8s\.core\.v1\.secrets\."
    AND NOT protoPayload.authenticationInfo.authoritySelector:*
    AND (
      (
        protoPayload.authenticationInfo.principalEmail=~"^system:"
        AND NOT protoPayload.authenticationInfo.principalEmail=~"^system:(anonymous$|serviceaccount:)"
      )
      OR protoPayload.authenticationInfo.principalEmail=~"^system:serviceaccount:kube-system:"
      OR (
        protoPayload.authenticationInfo.principalEmail="system:anonymous"
        AND protoPayload.resourceName=~"^(readyz|livez|healthz)(/|$)"
      )
    )
  EOT

  disabled = false
}

# Logs del sistema de los nodos Autopilot (journald) sin severidad.
#
# Son 99,9 % DEFAULT: el agente de GKE no traduce la severidad de estos
# servicios. Por bytes (7 días): gcfsd 9,1 GiB, gcfs-snapshotter 4,7, kubelet
# 3,6, containerd 3,3, kube-node-configuration 1,4. Los nodos los administra
# Google; nosotros no podemos actuar sobre ellos, y lo que afecta a nuestros
# pods llega igual por los eventos de k8s_pod y los logs de los contenedores.
#
# Para no perder fallas, se conservan las líneas que traen el nivel en el
# texto: klog (`E1021 …`, `W1021 …`, `F1021 …`), logrus/containerd
# (`level=error|fatal|panic|warning`) y scripts (`ERROR`, `FATAL`, `WARNING`
# al inicio). En kubelet y containerd son ~2 % de las líneas. Una entrada sin
# `jsonPayload.MESSAGE` también se conserva: el `NOT campo=~` daría verdadero
# sobre un campo ausente y la descartaría sin mirar el texto (hoy son 0).
resource "google_logging_project_exclusion" "gke_node_default_noise" {
  name        = "gke-node-default-noise"
  project     = google_project.booster_ai.project_id
  description = "Auditoría de costos 2026-10-21: descarta los logs de journald de los nodos GKE con severidad DEFAULT (gcfsd, gcfs-snapshotter, kubelet, containerd, arranque de nodo), salvo las líneas que traen error, fatal, panic o warning en el texto."

  filter = <<-EOT
    resource.type="k8s_node"
    AND severity="DEFAULT"
    AND jsonPayload.MESSAGE:*
    AND NOT jsonPayload.MESSAGE=~"^[EFW][0-9]{4} |level=(error|fatal|panic|warning)|^(ERROR|FATAL|WARNING)\b"
  EOT

  disabled = false
}

# Consola serial de los nodos Autopilot del clúster de telemetría.
#
# 100 % de nodos `gk3-booster-ai-telemetry-*`, todo severidad INFO de
# resource.type gce_instance (fuera del alcance de `k8s_info_events_noise`).
# Es la salida de arranque de VMs que administra Google. El filtro va por
# prefijo de nombre: la consola serial del bastion (`db-bastion`) se conserva.
resource "google_logging_project_exclusion" "gke_node_serial_console" {
  name        = "gke-node-serial-console"
  project     = google_project.booster_ai.project_id
  description = "Auditoría de costos 2026-10-21: descarta la consola serial (serialconsole.googleapis.com) de los nodos Autopilot gk3-booster-ai-telemetry-*. La del bastion y de cualquier otra VM se conserva."

  filter = <<-EOT
    resource.type="gce_instance"
    AND logName=~"/logs/serialconsole\.googleapis\.com%2F"
    AND labels."compute.googleapis.com/resource_name"=~"^gk3-booster-ai-telemetry-"
  EOT

  disabled = false
}
