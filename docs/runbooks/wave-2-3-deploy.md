# Wave 2 + Wave 3 — Deploy runbook

Procedimiento de despliegue de los 9 tracks del brief
`Booster-FMC150-Wave2-Wave3-Brief-2026-05-06.pdf` ya mergeados en
`main` (MRs !24..!32).

**Tiempo total estimado**: 4-6 horas si todo va sin issues. 1-2 días si
hay que iterar (cert-manager DNS-01, Twilio number aprobación, etc.).

**Reversión**: cada paso tiene rollback documentado al final. Los
recursos con `lifecycle.prevent_destroy = true` (KMS keys, GCS
buckets, BQ tables) NO se borran sin pasos manuales explícitos —
diseño defensivo.

---

## §0 — Pre-flight checklist

Antes de empezar:

- [ ] `gcloud` autenticado con cuenta humana owner del proyecto
      `booster-ai-494222`:
      ```bash
      gcloud auth login dev@boosterchile.com
      gcloud config set project booster-ai-494222
      ```
- [ ] `terraform >= 1.5` instalado.
- [ ] `kubectl` con kubeconfig vacío (los context se crean en §3).
- [ ] `helm >= 3.12` instalado.
- [ ] `glab` instalado (para PRs si se hace algún hotfix).
- [ ] `pnpm` con node 22+ (para validar tests localmente si hace falta).
- [ ] Ventana de mantenimiento comunicada a clientes activos (la
      activación de Wave 2 puede causar 1-2 reconexiones por device).

---

## §1 — Provisionamiento humano (fuera de Terraform)

Estos pasos NO los hace Terraform porque dependen de servicios externos
o decisiones operativas. Hacer ANTES de los `terraform apply` que los
necesitan.

### 1.1 Twilio number (B4)

1. Twilio Console → Phone Numbers → Buy a number.
2. País: empezar con **Chile (+56)** (carrier productivo principal).
   Provisionar también +52 (México) y +54 (Argentina) cuando se expanda.
3. Capabilities requeridas: **SMS** (Voice no necesario).
4. Webhook config inicial: cualquier URL placeholder. Vamos a setearlo
   en §1.4 después de tener el Cloud Run URL.
5. Anotar el número provisto. Ejemplo: `+56XXXXXXXXX`.

### 1.2 cert-manager (D3, D4)

Sobre el cluster primary (después que Terraform lo cree en §2):

```bash
helm repo add jetstack https://charts.jetstack.io
helm repo update
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --version v1.16.0 \
  --set crds.enabled=true
```

Repetir en el cluster DR cuando exista (post-§3).

### 1.3 Service Account para cert-manager DNS-01

cert-manager necesita resolver el DNS-01 challenge creando TXT records
en Cloud DNS. Esto requiere una SA con `roles/dns.admin`:

```bash
gcloud iam service-accounts create cert-manager \
  --display-name="cert-manager DNS-01 challenge"

gcloud projects add-iam-policy-binding booster-ai-494222 \
  --member=serviceAccount:cert-manager@booster-ai-494222.iam.gserviceaccount.com \
  --role=roles/dns.admin

# Crear key + montarla como Secret en cluster.
gcloud iam service-accounts keys create /tmp/cert-manager-key.json \
  --iam-account=cert-manager@booster-ai-494222.iam.gserviceaccount.com

# Sobre cluster primary:
kubectl create secret generic cert-manager-cloud-dns \
  --from-file=key.json=/tmp/cert-manager-key.json \
  -n cert-manager

# Borrar el key local — quedó en el Secret.
rm /tmp/cert-manager-key.json
```

Repetir el `kubectl create secret` en cluster DR cuando exista.

### 1.4 Editar cert-manager.yaml para SAN dual

D4 requiere que el Certificate cubra primary + DR. Editar
`infrastructure/k8s/cert-manager.yaml`:

```yaml
# antes:
  commonName: telemetry-tls.boosterchile.com
  dnsNames:
    - telemetry-tls.boosterchile.com

# después (SAN dual):
  commonName: telemetry-tls.boosterchile.com
  dnsNames:
    - telemetry-tls.boosterchile.com
    - telemetry-dr.boosterchile.com
```

Commit + push + merge como hotfix antes de §3.2.

### 1.5 Decidir staging environment

Si todavía no hay staging, decidir:
- Reusar prod con isolation por env vars + datasets BigQuery distintos.
- Crear segundo proyecto GCP `booster-ai-staging-XXXXXX`.

Para el load test (D1) recomendado **proyecto staging dedicado** — el
test stress de 100 devices puede saturar Pub/Sub quotas si comparte con
prod.

---

## §2 — Terraform apply (todos los tracks de infraestructura)

Orden recomendado: TODO de una sola vez. Terraform calcula el grafo
y aplica en el orden correcto. La alternativa "apply incremental por
track" es más control pero 5-10× más tiempo.

### 2.1 Set variables de override

Crear `infrastructure/terraform.tfvars.local` (gitignored):

```hcl
# Wave 2 B4 — webhook URL del sms-fallback-gateway. Setear DESPUÉS del
# primer apply (§2.3) cuando el Cloud Run URL exista.
sms_fallback_webhook_url = ""  # placeholder; ver §4.

# Wave 3 D4 — DR region. Default us-central1; cambiar a us-east1 si
# se prefiere (anotar en docs/adr/005).
# dr_region = "us-central1"
```

### 2.2 Plan + revisar

```bash
cd infrastructure/
terraform init -upgrade
terraform plan -var-file=terraform.tfvars.local -out=/tmp/wave-2-3.plan
```

Plan esperado — recursos NUEVOS:
- `google_kms_crypto_key.crash_traces` (CMEK Crash Trace).
- `google_storage_bucket.crash_traces` (con CMEK + 7 años retention).
- `google_pubsub_topic` × 5 (safety-p0, security-p1, eco-score, trip-transitions, crash-traces).
- `google_pubsub_subscription` × 5 (4 channels + crash-traces-processor).
- `google_bigquery_table.crash_events` (partitioned + clustered).
- `google_logging_metric` × 8 (B3 + D5).
- `google_monitoring_alert_policy` × 6 (B3 + D5).
- `google_monitoring_dashboard.telemetry_overview`.
- `module.service_sms_fallback_gateway` (Cloud Run).
- `google_compute_subnetwork.dr_private` (us-central1).
- `google_container_cluster.telemetry_dr` (GKE Autopilot DR).
- `google_compute_address.telemetry_dr_lb` (IP estática DR).
- `google_dns_record_set.telemetry_dr` (A record).
- `module.service_telemetry_processor` modificado (env vars Crash Trace).

Plan esperado — modificaciones:
- `infrastructure/messaging.tf` agregó topics + subscriptions sin
  destruir nada existente.
- `module.service_telemetry_processor` env vars actualizadas (no recrea
  el service).

**Si hay destrucción inesperada**: parar y revisar. Probable causa:
algún recurso pre-existente fue importado mal o hay drift.

### 2.3 Apply

```bash
terraform apply /tmp/wave-2-3.plan
```

**Tiempo estimado**: 12-15 minutos (GKE cluster DR es el más lento, ~10
min).

### 2.4 Capturar outputs

```bash
terraform output -json > /tmp/wave-2-3.outputs.json

# IPs y URLs que vamos a necesitar:
terraform output dr_lb_ip
terraform output dr_telemetry_domain
terraform output -raw service_sms_fallback_gateway_url 2>/dev/null \
  || gcloud run services describe booster-ai-sms-fallback-gateway \
       --region=southamerica-west1 --format='value(status.url)'
```

Anotar los valores. Volveremos en §4.

### 2.5 Rollback Terraform

Si algo sale mal:
```bash
terraform plan -destroy -var-file=terraform.tfvars.local \
  -target=google_container_cluster.telemetry_dr  # ejemplo: solo cluster DR
terraform apply -destroy -var-file=terraform.tfvars.local \
  -target=...
```

**Recursos con `prevent_destroy=true`** que NO se pueden borrar sin
flip manual del flag:
- `google_kms_crypto_key.crash_traces`
- `google_storage_bucket.crash_traces`
- `google_bigquery_table.crash_events`
- `google_container_cluster.telemetry_dr`

Diseño defensivo — borrarlos accidentalmente perdería forensics
históricos.

---

## §3 — Despliegue K8s

### 3.1 Cluster primary

```bash
gcloud container clusters get-credentials booster-ai-telemetry \
  --region=southamerica-west1
kubectl config rename-context $(kubectl config current-context) booster-primary

# 1. cert-manager (§1.2 si no se hizo).
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --version v1.16.0 --set crds.enabled=true

# 2. SA secret (§1.3 si no se hizo).
kubectl create secret generic cert-manager-cloud-dns \
  --from-file=key.json=/tmp/cert-manager-key.json -n cert-manager

# 3. Apply cert-manager Issuer + Certificate.
kubectl apply -f infrastructure/k8s/cert-manager.yaml

# 4. Esperar 5-10 min para que DNS-01 challenge resuelva.
kubectl get certificate -n telemetry telemetry-tls-cert -w
# Status debería pasar de False → True.

# 5. Apply gateway (con TLS endpoint dual + crash-trace publisher).
kubectl apply -f infrastructure/k8s/telemetry-tcp-gateway.yaml

# 6. Verificar pods Ready.
kubectl get pods -n telemetry -w
# 2 replicas, ambos 1/1 Ready.

# 7. Verificar listening dual.
GATEWAY_IP=$(kubectl get svc telemetry-tcp-gateway-tls -n telemetry \
  -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
echo $GATEWAY_IP

openssl s_client -connect telemetry-tls.boosterchile.com:5061 \
  -showcerts < /dev/null
# Debería mostrar cert con CN=telemetry-tls.boosterchile.com (Let's Encrypt).
```

### 3.2 Cluster DR

```bash
gcloud container clusters get-credentials booster-ai-telemetry-dr \
  --region=us-central1
kubectl config rename-context $(kubectl config current-context) booster-dr

# Repetir 1-3 del primary en este cluster.
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace --context=booster-dr \
  --version v1.16.0 --set crds.enabled=true

kubectl create secret generic cert-manager-cloud-dns \
  --from-file=key.json=/tmp/cert-manager-key.json -n cert-manager \
  --context=booster-dr

# El cert-manager Issuer puede ser el mismo (ClusterIssuer, no namespaced).
# El Certificate sí necesita aplicarse acá también — usa el mismo Issuer
# pero genera un Secret en este cluster.
kubectl apply -f infrastructure/k8s/cert-manager.yaml --context=booster-dr

# Apply gateway DR.
kubectl apply -f infrastructure/k8s/telemetry-tcp-gateway-dr.yaml \
  --context=booster-dr

# Anotación para usar la IP estática (provisional hasta que el manifest la incluya).
DR_LB_IP=$(terraform -chdir=../infrastructure output -raw dr_lb_ip)
kubectl annotate service telemetry-tcp-gateway -n telemetry \
  cloud.google.com/load-balancer-ip=$DR_LB_IP --context=booster-dr
kubectl annotate service telemetry-tcp-gateway-tls -n telemetry \
  cloud.google.com/load-balancer-ip=$DR_LB_IP --context=booster-dr

# Verificar.
kubectl get pods -n telemetry --context=booster-dr -w
openssl s_client -connect telemetry-dr.boosterchile.com:5061 \
  -showcerts < /dev/null
```

### 3.3 Rollback K8s

Si el primary falla post-deploy:
```bash
kubectl rollout undo deployment/telemetry-tcp-gateway -n telemetry \
  --context=booster-primary
```

Si toda la flota empieza a desconectar tras Wave 2:
```bash
# Restaurar imagen pre-Wave 2 (anotar SHA antes de empezar).
kubectl set image deployment/telemetry-tcp-gateway \
  gateway=southamerica-west1-docker.pkg.dev/booster-ai-494222/containers/telemetry-tcp-gateway:$PRE_WAVE_2_SHA \
  -n telemetry --context=booster-primary
```

---

## §4 — Configurar webhook Twilio + redeploy sms-fallback-gateway

```bash
# 1. Sacar la URL del Cloud Run service.
SMS_GATEWAY_URL=$(gcloud run services describe booster-ai-sms-fallback-gateway \
  --region=southamerica-west1 --format='value(status.url)')
WEBHOOK_URL="${SMS_GATEWAY_URL}/webhook"
echo $WEBHOOK_URL
```

2. Twilio Console → Phone Numbers → seleccionar el número provisto en
   §1.1 → Messaging Configuration:
   - **A message comes in**: Webhook
   - **URL**: `$WEBHOOK_URL`
   - **HTTP**: POST
   - Save.

3. Setear la URL en Terraform y re-apply para que el service la valide:

```bash
cd infrastructure/
echo "sms_fallback_webhook_url = \"$WEBHOOK_URL\"" >> terraform.tfvars.local
terraform apply -var-file=terraform.tfvars.local
# Solo recrea el Cloud Run service con la env var nueva.
```

4. **Test manual**: enviar SMS al número Twilio con el body
   `BSTR|356307042441013|20260507T120000|-33.456900,-70.648300|0|1|247`
   y verificar:
   - `gcloud logging read 'resource.labels.service_name="booster-ai-sms-fallback-gateway"
     jsonPayload.msg="sms fallback procesado"' --limit=5`
   - Mensaje en Pub/Sub: `gcloud pubsub topics publish ... --dry-run`
     (no, simplemente verificar logs del processor downstream).

---

## §5 — Cargas FMC150 (rollout devices)

### 5.1 Wave 2 — todos los devices productivos

Por device, con el conductor / carrier owner notificado:

1. Desde Teltonika Configurator (PC) o FOTA Cloud:
   - Cargar `docs/research/teltonika-fmc150/CONFIGURACION-BOOSTER-DETALLADA.md`
     Wave 2 cfg.
   - Anotar configs críticas que cambian:
     - **Network Ping Timeout** = 60s (esto activa el fix D2 — sin ese
       fix mergeado el device se reconectará cada 60s).
     - **Min Period Moving** = 30s (×10 records, gate G2.3 capacity test
       lo valida).
     - 14 AVL IDs Low Priority en `Operand = Monitoring`.
     - 10 AVL IDs eventuales en `Priority = Panic/High`.
     - SMS Number = número Twilio §1.1.
2. Push config al device.
3. Verificar primer record en `telemetria_puntos`:
   ```sql
   SELECT * FROM telemetria_puntos
   WHERE imei = '<imei>'
   ORDER BY timestamp_device DESC LIMIT 5;
   ```
4. Verificar AVL IDs nuevos en `io_data` JSONB.

### 5.2 Wave 3 — TLS + DR backup

Solo después de:
- [ ] G2.3 cerrado (load test PASS, ver §6.1).
- [ ] G3.4 listo (failover test PASS, ver §6.2).
- [ ] Wave 2 estable >7 días en producción sin alertas P0/P1 críticas.

> **⚠️ Pre-step obligatorio aprendido del incidente 2026-05-11** (ver ADR-033): el firmware FMC150 `04.01.00.Rev.08` no tiene `ISRG Root X1` (CA root Let's Encrypt) en su trust store. Sin pre-cargar la CA, el handshake TLS falla silenciosamente y el device queda sin telemetría hasta rollback manual.

Por device, **en este orden estricto**:

**Paso 0 — Cargar CA root (una sola vez por device)**:
1. Obtener `ISRG Root X1` PEM: `curl -sS -o /tmp/isrgrootx1.pem https://letsencrypt.org/certs/isrgrootx1.pem`
2. FOTA WEB → tarea **"Cargar certificado TLS de usuario"** con `isrgrootx1.pem` (cancelar warning FMx — verificado funcional en prod 2026-05-12).
3. Esperar status **Completado** en FOTA (depende de ventana de polling RMS del device).

**Paso 1 — Push cfg Wave 3**:
1. Update cfg con:
   - **Server Mode (primary)**: TLS, Domain `telemetry-tls.boosterchile.com`,
     Port 5061.
   - **Server Mode (backup)**: Backup, Domain
     `telemetry-dr.boosterchile.com`, Port 5061, TLS Enable.
2. FOTA WEB → tarea **"Configuración de la carga"** con `FMC150_Booster_Wave3.cfg`.
3. Verificar conexión TLS via logs del gateway:
   ```bash
   kubectl logs -n telemetry deployment/telemetry-tcp-gateway \
     --tail=100 --context=booster-primary | grep "handshake IMEI completado"
   ```
4. Validar puerto local (5061 = TLS, 5027 = plain):
   ```bash
   kubectl exec -n telemetry <pod> -- sh -c 'cat /proc/net/tcp6 | awk "NR>1 && \$4==\"01\" {print \$2}"'
   # 0x13C5 = 5061 TLS ← esperado
   ```

**Rollback remoto si handshake falla** (sin acceso físico):

SMS-MT vía operador SIM con sintaxis (2 espacios prefijo críticos):
```
  setparam 2020:0;2004:telemetry.boosterchile.com;2005:5027
```
ETA rollback: ~30s post-Delivered. Probado 2026-05-11.

---

## §6 — QA gates

### 6.1 G2.3 — Capacity load test (D1)

```bash
cd scripts/load-test/
pnpm install

# 1. Baseline (1 device, validar < 5% CPU, < 100MB RAM).
pnpm start --host telemetry.staging.boosterchile.com --port 5027 \
  --scenario baseline > /tmp/baseline.json

# 2. Target Wave 2 (10 devices, 1 hora).
pnpm start --host telemetry.staging.boosterchile.com --port 5027 \
  --scenario target > /tmp/target.json

# 3. Stress (100 devices, 30 min).
pnpm start --host telemetry.staging.boosterchile.com --port 5027 \
  --scenario stress > /tmp/stress.json

# 4. Crash burst.
pnpm start --host telemetry.staging.boosterchile.com --port 5027 \
  --scenario crash-burst > /tmp/crash-burst.json
```

EN PARALELO durante el test, capturar dashboard "Booster Telemetría —
Overview + Operations" en Cloud Monitoring.

Criterios PASS:
- Baseline: error_rate=0, p95<200ms.
- Target: error_rate<0.5%, p95<300ms, CPU<30%, RAM<200MB.
- Stress: error_rate<1%, p95<1000ms, gateway no cae, DLQ=0.
- Crash burst: parser no peta, publish a topic crash-traces OK.

Documentar en `docs/handoff/2026-05-XX-telemetry-load-test-results.md`.

### 6.2 G3.4 — DR failover test

Seguir `docs/runbooks/dr-failover-test.md`. Resumen:

```bash
# 1. Verificar device en primary.
kubectl logs -n telemetry deployment/telemetry-tcp-gateway --tail 50 \
  --context=booster-primary | grep "$LAB_IMEI"

# 2. Bloquear primary.
kubectl scale deployment/telemetry-tcp-gateway -n telemetry \
  --replicas=0 --context=booster-primary

# 3. Esperar < 60s; verificar device en DR.
kubectl logs -n telemetry deployment/telemetry-tcp-gateway --tail 50 \
  --context=booster-dr | grep "$LAB_IMEI"

# 4. Restaurar primary.
kubectl scale deployment/telemetry-tcp-gateway -n telemetry \
  --replicas=2 --context=booster-primary

# 5. Verificar device regresa al primary, sin gap en Postgres.
```

Criterio PASS: gap < 60s en `telemetria_puntos` durante toda la
transición.

---

## §7 — Cierre

Cuando todos los gates cierren:

1. Tag release:
   ```bash
   git tag -a wave-2-3-deployed -m "Wave 2 + 3 desplegado YYYY-MM-DD"
   git push origin wave-2-3-deployed
   ```

2. Update ADR-005 con sección "Status post-Wave 3" indicando:
   - Devices migrados a TLS: N/total.
   - DR failover testado: fecha, pass.
   - Capacity headroom medido: peak observado / threshold.

3. Comunicar a clientes:
   - **Generadores de carga**: nuevas alertas seguridad (Crash, GNSS
     Jamming) disponibles. Vector upsell "plan + forensics".
   - **Carriers**: TLS encrypted endpoint disponible para Wave 3.

4. Archive este runbook moviéndolo a `docs/runbooks/archive/` con
   sufijo de fecha.

---

## §8 — Troubleshooting común

### `terraform apply` falla con "API not enabled"

```bash
gcloud services enable container.googleapis.com bigquery.googleapis.com \
  pubsub.googleapis.com cloudkms.googleapis.com cloudrun.googleapis.com
```

### Cert-manager Certificate stuck en False

```bash
kubectl describe certificate telemetry-tls-cert -n telemetry
# Revisar Events: "Solving challenge", "Failed to determine zone".
# 90% de casos: la SA cert-manager no tiene roles/dns.admin sobre el
# managed_zone. Re-aplicar §1.3.
```

### DR cluster pods en `CreateContainerConfigError`

```bash
kubectl describe pod -n telemetry -l app=telemetry-tcp-gateway \
  --context=booster-dr
# Si dice "secret telemetry-tls-cert not found": cert-manager no
# sincronizó el cert al DR todavía. Esperar 5 min o revisar
# §1.3 en el cluster DR.
```

### SMS fallback recibe 403 Forbidden

Twilio signature inválida. Causas:
1. `WEBHOOK_PUBLIC_URL` no coincide con la URL en Twilio Console.
   Verificar exactamente (incluir `https://`, sin trailing slash).
2. `TWILIO_AUTH_TOKEN` desactualizado (Twilio rota tokens). Re-pull
   desde Console y update Secret Manager:
   ```bash
   echo -n "$NEW_TOKEN" | gcloud secrets versions add twilio-auth-token --data-file=-
   ```
3. Re-deploy del Cloud Run service para que tome la nueva versión:
   ```bash
   gcloud run services update booster-ai-sms-fallback-gateway \
     --region=southamerica-west1 --update-secrets=...
   ```

---

## Refs

- Brief: `Booster-FMC150-Wave2-Wave3-Brief-2026-05-06.pdf`
- ADR: `docs/adr/005-telemetry-iot.md`
- Runbooks relacionados:
  - `docs/runbooks/oncall-telemetry-incidents.md` (D5)
  - `docs/runbooks/dr-failover-test.md` (D4)
- MRs Wave 2/3 ya mergeados: !24, !25, !26, !27, !28, !29, !30, !31, !32.
