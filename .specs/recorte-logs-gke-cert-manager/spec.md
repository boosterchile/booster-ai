# Spec: recorte-logs-gke-cert-manager

- Author: Felipe Vicencio (con Claude)
- Date: 2026-10-21
- Status: Draft — se aprueba con la revisión del PR
- Origen: auditoría de costos GCP del 2026-10-21 (solo lectura; cifras y consultas en `verify.md`).
- Relacionado: ADR-035 (exclusiones de ruido de Logging), ADR-065 y ADR-071 (workloads GKE por runbook, no por Terraform), `docs/audits/costos-servicios-2026-09-28.md` (recorte anterior, ADR-081).
- El `terraform apply` y el `helm upgrade` los ejecuta el PO. Este PR no aplica nada.

## 1. Objective

Bajar dos costos fijos de plataforma que no le sirven a ningún usuario:

1. **Cloud Logging** (~USD 100/mes al ritmo de octubre): excluir el ruido de plataforma GKE que llega con severidad `DEFAULT` y que la exclusión de mayo (`k8s-info-events-noise`, solo `INFO`) no atrapa.
2. **cert-manager en GKE Autopilot** (~USD 100/mes): darle requests explícitos. Hoy corre sin ellos y Autopilot le cobra 500m CPU / 2 GiB por pod a 3 pods que usan 0,001 vCPU y menos de 30 MiB.

## 2. Why now

Del 13 al 19 de octubre el gasto fue de USD 21–22/día (~USD 650–690/mes): el recorte del 28-sep (ADR-081) ya se perdió. Estos dos ítems suman ~USD 190/mes de ese total. Las dos palancas tienen alta confianza, no tocan código de la app y se revierten con un apply.

## 3. Success criteria

- [ ] SC-1: tres `google_logging_project_exclusion` nuevas en `infrastructure/logging-exclusions.tf`; las dos existentes no cambian. `terraform fmt -check` y `terraform validate` pasan.
- [ ] SC-2: cada filtro probado con `gcloud logging read` contra logs reales de prod, con el porcentaje que calza y lo que conserva documentado en `verify.md`.
- [ ] SC-3: `infrastructure/k8s/cert-manager-values.yaml` valida contra el `values.schema.json` del chart v1.20.2 que corre en el clúster y conserva los valores de usuario del release vivo.
- [ ] SC-4: un dry-run del servidor (`kubectl patch --dry-run=server`) sobre los 3 Deployments vivos muestra que Autopilot acepta los requests sin ajustarlos, y no cambia nada en vivo.
- [ ] SC-5 (PO, después del apply): en 48 h, `logging.googleapis.com/billing/bytes_ingested` baja de 6–10 GiB/día a ≤ 2 GiB/día. Siguen llegando los logs de Cloud Run, de los contenedores y las entradas WARNING/ERROR de k8s.
- [ ] SC-6 (PO, después de `setup-cert-manager.sh --apply`): los 3 Deployments quedan con 50m y 128Mi/128Mi/64Mi; `letsencrypt-prod` y `telemetry-tls-cert` siguen Ready; la renovación del 2026-11-04 sale bien.
- [ ] SC-7: este PR no ejecuta `terraform apply`, `helm upgrade` ni `kubectl apply` contra prod.

## 4. User-visible behaviour

Ninguno. Lo único que cambia para un operador es que en el Logs Explorer ya no aparecen las lecturas de la API de Kubernetes hechas por la plataforma GKE, los logs de journald de los nodos sin nivel de error, ni la consola serial de los nodos Autopilot.

## 5. Out of scope

- Ejecutar el `terraform apply` o el `helm upgrade` (PO).
- Bajar `DATA_READ` en `google_project_iam_audit_config.all_services` (`project.tf`): afectaría a todos los servicios y es un trade-off de compliance (Trivy AVD-GCP-0029).
- Los microservicios ociosos con `min_instances=1` (document, notification, matching): dependen de ADR-083 y de una decisión del PO.
- Subir de versión cert-manager (queda fijado en v1.20.2).
- Ajustar los requests del gateway TCP (0,5 vCPU / 1 GiB): es el ingreso de Teltonika y su margen puede ser a propósito.
- Arreglar el paso `ensure-cert-manager` de `cloudbuild-primary-deploy.yaml`: nunca llegó a ejecutarse (el único build, del 2026-05-13, falló antes). Aquí solo se alinea su `helm install` con el archivo de valores y la versión fijada.

## 6. Constraints

1. Las escrituras de objetos de la API de Kubernetes (`cloudaudit.googleapis.com/activity`) van al bucket `_Required`, que no admite exclusiones. Las exclusiones de proyecto solo afectan al sink `_Default`. Ojo: GKE registra como `data_access` algunas escrituras del sistema (subrecursos `status`, create de TokenReview y SubjectAccessReview); las que hace un `system:` también se descartan.
2. Los filtros usan RE2 (`=~`). En los heredocs de HCL las barras invertidas no se interpretan: `\b` y `\.` llegan literales (verificado con `terraform console`).
3. Autopilot, clase general-purpose: mínimo 50m CPU; razón memoria/CPU entre 1 y 6,5 GiB por vCPU.
4. ADR-065 / ADR-071: los workloads del clúster se aplican con Helm/kubectl desde un runbook, no desde Terraform.
5. El chart queda fijado en la versión que corre (`cert-manager-v1.20.2`, release Helm revisión 1). El script corta si encuentra otra.

## 7. Approach

**Logging** — tres exclusiones nuevas:

| Exclusión | Qué descarta | Qué conserva |
|---|---|---|
| `gke-system-data-access` | entradas Data Access de k8s.io hechas por identidades `system:` del control plane y por cuentas de `kube-system`; sondas anónimas `readyz/livez/healthz` | toda operación sobre Secrets, toda suplantación (`authoritySelector`), personas, cuentas de GCP (incl. el agente de servicio de GKE), cuentas de servicio de nuestros namespaces, cualquier otro acceso anónimo |
| `gke-node-default-noise` | journald de los nodos con severidad `DEFAULT` | líneas con `E/W/F` de klog, `level=error/fatal/panic/warning`, `ERROR/FATAL/WARNING` al inicio; entradas sin `jsonPayload.MESSAGE`; todo lo que no sea `DEFAULT` |
| `gke-node-serial-console` | consola serial de nodos `gk3-booster-ai-telemetry-*` | la consola serial del bastion y de cualquier otra VM |

**cert-manager** — `cert-manager-values.yaml` (valores vivos + anotación de Workload Identity + requests + imágenes fijadas por digest, iguales a las que corren) y `setup-cert-manager.sh`. Por defecto el script solo hace una vista previa: renderiza los Deployments y los manda a la API con `--dry-run=server`. Con `--apply` corre `helm upgrade --install --version v1.20.2 --wait` y verifica el rollout, los requests, la anotación del ServiceAccount, el ClusterIssuer y el Certificate. Usa un kubeconfig temporal.

## 8. Alternatives considered

- **A. Excluir todo `k8s_cluster` data_access** — Rechazada: perdería las lecturas de personas y de workloads, que son justamente lo que interesa en un incidente.
- **B. Quitar `DATA_READ` a nivel de proyecto** — Rechazada aquí: afecta a todos los servicios (Secret Manager, Storage, BigQuery…). `project.tf` deja prevista esta palanca, pero es una decisión de compliance.
- **C. Excluir todo `k8s_node`** — Rechazada: perdería los errores de kubelet y containerd (~2 % de sus líneas).
- **D. Llevar estos logs a un bucket o a BigQuery con TTL corto** — Rechazada: la ingesta a un bucket de Logging se cobra igual; es más infraestructura para logs que nadie consulta.
- **E. Aplicar cert-manager con un pipeline de Cloud Build** — Rechazada por ahora: no hay en el repo un paso probado con helm + `gke-gcloud-auth-plugin`, y el precedente vigente (ADR-071, `setup-datadog.sh`) es un runbook que corre el operador.

## 9. Risks and mitigations

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| Una exclusión descarta algo que se necesita en un incidente | B | M | Las escrituras de k8s quedan en `_Required` (400 días). Se conservan lecturas de personas, cuentas de GCP y workloads propios. Cada exclusión se desactiva con `disabled = true` y un apply |
| El regex de nodo deja pasar un formato de error nuevo como si fuera ruido | M | B | Solo aplica a severidad `DEFAULT` de nodos que administra Google. Los eventos de pods (`k8s_pod`) y los logs de contenedores no se tocan |
| Alguien con un token robado de kubelet o de un addon de kube-system lee datos sin dejar rastro | B | M | La exclusión nunca descarta operaciones sobre Secrets ni entradas con suplantación. Robar esos tokens exige escapar de un contenedor, y solo sirven desde la VPC |
| cert-manager se queda corto de memoria con 128 Mi | MB | M | Pico medido en 30 días: 29 MiB (4,4× de margen) y límite de 256 Mi. Rollback en dos pasos (README): `helm rollback` y volver a anotar el ServiceAccount, porque la revisión 1 no trae la anotación de Workload Identity |
| Un tag movido en quay.io cambia lo que corre el controller (lee todos los Secrets y tiene `dns.admin` sobre la zona) | B | A | Imágenes fijadas por digest; los digests coinciden con los imageID de los pods actuales. El chart sigue bajando de charts.jetstack.io por HTTPS sin verificación de firma (residual, ver `review.md`) |
| El reinicio del webhook coincide con una renovación | B | B | El reinicio dura segundos. La próxima renovación es el 2026-11-04 y el certificado vence el 2026-12-04: aplicar antes del 4-nov deja 30 días para corregir |
| Staging (ADR-083) usa el mismo módulo raíz | — | — | Las exclusiones también le aplican al hacer apply con los tfvars de staging, que es lo buscado |

## 10. Rollout (PO)

1. Mergear (ningún workflow aplica Terraform al mergear).
2. `terraform plan -target=google_logging_project_exclusion.gke_system_data_access -target=google_logging_project_exclusion.gke_node_default_noise -target=google_logging_project_exclusion.gke_node_serial_console`: debe dar **3 to add, 0 to change, 0 to destroy**. Luego, apply.
3. `./infrastructure/k8s/setup-cert-manager.sh` (vista previa) y después `--apply`, antes del 2026-11-04.
4. A las 48 h, revisar SC-5 y SC-6.
