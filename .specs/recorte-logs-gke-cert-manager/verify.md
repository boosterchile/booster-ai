# Verify: recorte-logs-gke-cert-manager

- Spec: .specs/recorte-logs-gke-cert-manager/spec.md
- Fecha: 2026-10-21. Todo se midió en prod con lecturas (`gcloud logging read`, API de Cloud Monitoring, `kubectl get`, `kubectl patch --dry-run=server`). Nada se aplicó.

## 1. Línea base de costo

| Fuente | Dato |
|---|---|
| Billing export, SKU «Log Storage cost» | 2026-09: 173,7 GiB (USD 61,8). 2026-10 al día 20: 144,7 GiB (USD 47,4) |
| `logging.googleapis.com/billing/bytes_ingested`, 7 días al 2026-10-21 | k8s_node 22,4 GiB · k8s_cluster 20,4 · gce_instance 9,3 · k8s_container 5,7 · audited_resource 3,2 · cloud_run_revision 0,6 · resto < 1,2 c/u. Total ~65 GiB (~9,3 GiB/día) |
| Billing export, Kubernetes Engine 2026-10-01..19 | Autopilot Pod mCPU Requests 48.016 mCPU·h/día (2,0 vCPU) = USD 92,8/mes; Memory Requests 168 GiB·h/día (7,0 GiB) = USD 36,0/mes |
| `kubernetes.io/container/cpu/request_cores`, promedio horario de 3 días | cert-manager 1,5 vCPU (3 × 0,5) · telemetry 0,505 · default (canary-probe) 0,25 |

## 2. Filtros de Logging contra logs reales

### `gke-system-data-access`
- Muestra de 6.000 entradas `k8s_cluster` data_access (2026-10-21 11:55–12:00): severidad 100 % DEFAULT. Bytes: gke-master-healthcheck 19,7 % · addon-manager 14,3 · anonymous 10,5 (readyz 8,8 + livez 1,7) · clouddns 7,1 · kube-controller-manager 6,5 · `system:node:*` 6,2 · cuentas de kube-system 4,6 · kube-scheduler 4,1 · … · agente de servicio de GKE 2,0 · cuentas de cert-manager y gke-gmp-system 0,6.
- Ventana 2026-10-21 11:40–11:50: 12.501 entradas. Primera versión del filtro: 12.142 calzan (97,1 %). **Versión final**, que tras la revisión de seguridad conserva toda operación sobre Secrets y toda suplantación: **12.124 calzan (97,0 %)**. De las 34 operaciones sobre Secrets de la ventana (todas `watch`: apiserver, kubestore-collector, kubelet, cert-manager, gke-gmp-system, agente de GKE), **0 calzan**. Lo demás que queda es `service-469283083998@container-engine-robot.iam.gserviceaccount.com` (pods/nodes/componentstatuses list, CRD get, watches…), una identidad de GCP que se conserva a propósito.
- La API de Logging acepta la sintaxis completa del filtro final (`authoritySelector:*`, `NOT … =~`, regex con `(/|$)`).

### `gke-node-default-noise`
- 7 días por log y severidad (`byte_count` / `log_entry_count`): gcfsd 9,07 GiB · gcfs-snapshotter 4,65 · kubelet 3,59 · container-runtime 3,27 · kube-node-configuration 1,41 · kube-node-installation 0,23 · docker 0,03, todo DEFAULT. WARNING/ERROR (events, fluentbit) < 0,03 GiB.
- El volumen llega en ráfagas (horas de 410–624 MiB en cada deploy) y no por reenvío de logs viejos: en una muestra por `receiveTimestamp`, el 100 % llegó con menos de 1 minuto de retraso.
- Ráfaga 2026-10-20 20:20–20:30 (60.000 entradas, 103,7 MiB): **el filtro calza el 92,1 % de los bytes**. Conserva líneas `level=warning|error` de gcfs-snapshotter y gcfsd (p. ej. «Failed to mount, falling back to default»), errores klog de kubelet, `level=error` de containerd, y todo lo WARNING/ERROR de events y fluentbit.
- En período tranquilo (2026-10-21 10:04–11:57, 8.000 entradas): ~2 % de las líneas de kubelet y containerd traen nivel de error o advertencia en el texto; esas se conservan.

### `gke-node-serial-console`
- 24 h (2026-10-20 12:00 → 2026-10-21 12:00): el 100 % de la consola serial es de nodos `gk3-booster-ai-telemetry-pool-1-*` (serial_port_1 y serial_port_3); no quedó ninguna entrada fuera del filtro. El bastion no escribió consola serial en esa ventana, y el filtro por prefijo `^gk3-booster-ai-telemetry-` lo deja fuera por construcción.

### Escapes de HCL y equivalencia con lo probado
`terraform console` sobre los tres heredocs: `\b` y `\.` llegan literales al filtro (los heredocs de HCL no interpretan barras invertidas). El texto que renderiza Terraform es **idéntico** (diff vacío) al de los filtros que se probaron con `gcloud logging read`.

### Estimación
Las tres exclusiones cubren ~50 de ~65 GiB/semana: k8s_cluster ~97 %, k8s_node ~92 %, consola serial ~100 %. Quedan ~66 GiB/mes; con el free tier de 50 GiB, Logging pasa de ~USD 100/mes (ritmo de los últimos 7 días) a menos de USD 10/mes.

## 3. cert-manager

| Chequeo | Resultado |
|---|---|
| Release vivo (`sh.helm.release.v1.cert-manager.v1`) | chart cert-manager v1.20.2, revisión 1, 2026-05-08. Valores de usuario: `crds.enabled=true`, `global.leaderElection.namespace=cert-manager` |
| Requests vivos de los 3 Deployments | 500m CPU / 2Gi / 1Gi de almacenamiento efímero (valores por defecto de Autopilot; el chart no trae `resources`) |
| Memoria non-evictable por pod, 30 días (33 series, sin sumar pods solapados) | pico: controller 24,2 MiB · cainjector 29,2 · webhook 11,8. Mediana 23,1 / 24,2 / 11,2 |
| CPU por pod, máximo horario de 30 días | 0,001 vCPU en los tres |
| Reinicios en 30 días | 0 |
| `cert-manager-values.yaml` contra el `values.schema.json` del chart v1.20.2 (sacado del release vivo) | 0 errores (Draft 7). Control negativo: una clave inventada sí se rechaza |
| ¿Conserva los valores de usuario del release vivo? | Sí |
| `serviceAccount.annotations` | El template `serviceaccount.yaml` la usa (`with .Values.serviceAccount.annotations`); hoy la anotación está en vivo por un `kubectl annotate` |
| `kubectl patch --dry-run=server` con los nuevos requests en los 3 Deployments | Autopilot acepta 50m / 128Mi (límite 256Mi) y 50m / 64Mi (límite 128Mi) sin ajustarlos. Las *generations* vivas siguen en 2/1/1 después del dry-run: nada cambió |
| Certificate `telemetry/telemetry-tls-cert` | Ready. notAfter 2026-12-04, renewalTime 2026-11-04 |
| Digests de imagen fijados | Los 3 imageID de los pods vivos son iguales a los digests de los índices multi-arquitectura `v1.20.2` en quay.io (HEAD al registro). startupapicheck: digest del índice en quay.io |
| Salidas del script | `kubectl apply -o` no acepta `custom-columns` (lo marcó la revisión; confirmado con `kubectl apply --help`). Con varios documentos la salida es una `List`: el jsonpath con `range .items[*]` se probó con un `apply --dry-run=server` de 3 Deployments por stdin, y también los jsonpath de requests y de la anotación del ServiceAccount. Las *generations* vivas siguieron en 2/1/1 |
| `setup-cert-manager.sh` | `bash -n` OK. `helm` no está instalado en esta máquina: los pasos `helm template/upgrade/history` no se ejecutaron aquí. Su primera corrida sin `--apply` es la vista previa y no cambia nada |

Costo esperado después: 0,15 vCPU + 0,31 GiB ≈ USD 8,6/mes (precios derivados del billing de octubre: USD 46,4 por vCPU-mes y USD 5,14 por GiB-mes). Ahorro ≈ USD 91/mes.

## 4. Gates locales

| Gate | Resultado |
|---|---|
| `terraform fmt -check -recursive infrastructure/` | OK |
| `terraform validate` de las 5 exclusiones (módulo aislado, provider google 6.50.0 en caché) | OK. El `init` del módulo raíz no se pudo hacer sin descargar providers (el caché local no coincide con el lockfile de `main`) |
| Values con digests contra el schema del chart | 0 errores; conserva los valores de usuario del release vivo |
| YAML de `cert-manager-values.yaml` y `cloudbuild-primary-deploy.yaml` | parsean |
| `terraform plan` | No corrido. Lo corre el PO (spec §10): debe dar 3 to add, 0 to change, 0 to destroy |
