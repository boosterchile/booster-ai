# Plan: recorte-logs-gke-cert-manager

- Spec: .specs/recorte-logs-gke-cert-manager/spec.md
- Status: Complete (build). Apply pendiente del PO (spec §10).

### T1 [DONE]: medir antes de escribir
Muestras de logs de prod con `gcloud logging read` y métricas de Cloud Monitoring (solo lectura) para decidir cada filtro. En cert-manager: consumo por pod en 30 días, valores del release Helm vivo y schema del chart. Resultados en `verify.md`.

### T2 [DONE]: exclusiones de Logging
`infrastructure/logging-exclusions.tf`: `gke_system_data_access`, `gke_node_default_noise`, `gke_node_serial_console`. Las dos exclusiones de mayo no cambian.

### T3 [DONE]: cert-manager
- `infrastructure/k8s/cert-manager-values.yaml`: valores vivos + Workload Identity + requests.
- `infrastructure/k8s/setup-cert-manager.sh`: vista previa por defecto; `--apply` hace el upgrade y verifica.
- `infrastructure/k8s/cloudbuild-primary-deploy.yaml`: el `helm install` del bootstrap usa el mismo archivo y la misma versión.
- `infrastructure/k8s/README.md`: sección cert-manager. `infrastructure/wave-3-tls.tf`: corrige la referencia a un `cert-manager.yaml` que no existe.

### T4 [DONE]: verificación local
`terraform fmt -check`, `terraform validate`, render de los heredocs con `terraform console`, cada filtro contra logs reales, schema del chart, dry-run del servidor de los requests y `bash -n` del script.

### T5 [DONE]: revisión
code-reviewer y security-auditor (overrides en `agents/`) sobre el diff.

REVIEW: hallazgos y respuesta en `review.md`.
