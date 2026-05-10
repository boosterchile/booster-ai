# Handoff — Wave 3 TLS dual-endpoint listo para rollout (2026-05-10)

Estado del proyecto Wave 3 (TLS + DR backup) al cierre de la sesión
2026-05-10. **Toda la capa de código está mergeada**. Pendiente: pasos
operacionales del operador cuando se cumplan las pre-conditions del
runbook `wave-2-3-deploy.md` §5.2.

## TL;DR

- ✅ **Código 100%**: Terraform (`wave-3-tls.tf`, `dr-region.tf`), manifests K8s (`telemetry-tcp-gateway.yaml`, `-dr.yaml`, `cert-primary.yaml`, `cert-dr.yaml`, `cert-manager-issuers.yaml`), gateway Node (`main.ts` con dual server 5027 + 5061).
- ✅ **Smoke test script**: `scripts/smoke-test-wave-3-tls.sh` valida DNS → IP drift vs TF → TCP → TLS handshake → cert chain + CN + vigencia, opcionalmente handshake IMEI Teltonika.
- ⏳ **Bloqueado operacionalmente** por las pre-conditions del runbook:
  1. G2.3 — Capacity load test PASS (Wave 2 estable).
  2. G3.4 — DR failover test PASS.
  3. Wave 2 estable >7 días en prod sin alertas P0/P1 críticas.

## Inventario del código Wave 3

### Terraform
- `infrastructure/wave-3-tls.tf` — IP estática `booster-telemetry-tls-lb-ip` + DNS `telemetry-tls.boosterchile.com` + SA `cert-manager-cloud-dns` + Workload Identity binding + Cloud NAT (primary + DR).
- `infrastructure/dr-region.tf` — IP estática `telemetry_dr_lb` + DNS `telemetry-dr.boosterchile.com` + cluster DR `booster-ai-telemetry-dr` us-central1.
- **Outputs disponibles**: `telemetry_tls_lb_ip` (primary), `dr_lb_ip` (DR), `cert_manager_gcp_sa_email`.

### K8s manifests
- `infrastructure/k8s/telemetry-tcp-gateway.yaml` — Deployment + 2 Services (`telemetry-tcp-gateway` plain 5027, `telemetry-tcp-gateway-tls` TLS 5061) + HPA. Hardened (non-root UID 10001, readOnlyRootFilesystem, cap drop ALL).
- `infrastructure/k8s/telemetry-tcp-gateway-dr.yaml` — Mirror en cluster DR. Service único TLS 5061 (sin plain en DR).
- `infrastructure/k8s/cert-manager-issuers.yaml` — ClusterIssuer `letsencrypt-prod` con DNS-01 solver via Cloud DNS SA.
- `infrastructure/k8s/cert-primary.yaml` — Certificate Let's Encrypt para `telemetry-tls.boosterchile.com`.
- `infrastructure/k8s/cert-dr.yaml` — Certificate para `telemetry-dr.boosterchile.com`.

### Gateway code
- `apps/telemetry-tcp-gateway/src/main.ts` — dual server pattern: `net.createServer` en 5027 + `tls.createServer` en 5061 (conditional, requiere TLS_CERT_PATH + TLS_KEY_PATH). Ambos invocan el mismo `handleConnection`, mismas dependencias.
- Si los paths no se montan (cert-manager aún no resolvió ACME), el listener TLS skipea con warn — el plain sigue funcionando.

## Procedimiento operacional (cuando las pre-conditions se cumplan)

Sigue el runbook completo `docs/runbooks/wave-2-3-deploy.md` §3.2 + §5.2. Resumen:

### 1. Terraform apply (primary + DR networking)
```bash
cd infrastructure
terraform plan -var-file=terraform.tfvars.local -out=/tmp/plan-wave-3
terraform apply /tmp/plan-wave-3
```

Recursos esperados: `google_compute_address.telemetry_tls_lb`, `google_dns_record_set.telemetry_tls`, `google_service_account.cert_manager_cloud_dns`, `google_compute_router_nat.primary_nat`, `google_compute_router_nat.dr_nat`.

### 2. Verificar IPs reservadas
```bash
terraform output telemetry_tls_lb_ip   # primary
terraform output dr_lb_ip              # DR
```

Si los valores difieren del `loadBalancerIP` hardcoded en los manifests, **actualizar antes del `kubectl apply`**:
- `infrastructure/k8s/telemetry-tcp-gateway.yaml` → service `telemetry-tcp-gateway-tls` → `loadBalancerIP`.
- `infrastructure/k8s/telemetry-tcp-gateway-dr.yaml` → service `telemetry-tcp-gateway-tls` → `loadBalancerIP`.

### 3. cert-manager en cluster primary
```bash
gcloud container clusters get-credentials booster-ai-telemetry --region=southamerica-west1
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --version v1.16.0 --set crds.enabled=true

# Anotar K8s SA cert-manager para Workload Identity
kubectl annotate serviceaccount cert-manager -n cert-manager \
  iam.gke.io/gcp-service-account="$(cd ../infrastructure && terraform output -raw cert_manager_gcp_sa_email)"

kubectl apply -f infrastructure/k8s/cert-manager-issuers.yaml
kubectl apply -f infrastructure/k8s/cert-primary.yaml
```

Esperar a que el Certificate esté Ready (~2-5 min con DNS-01):
```bash
kubectl get certificate telemetry-tls-cert -n telemetry -w
```

### 4. cert-manager en cluster DR
Idéntico al paso 3 pero contra cluster DR + `cert-dr.yaml`.

### 5. Deploy gateway con TLS habilitado
```bash
./scripts/deploy-telemetry-gateway.sh $(git rev-parse HEAD)
```

El manifest ya monta el Secret `telemetry-tls-cert` como volumen optional — si cert-manager terminó, el pod arranca con listener TLS automáticamente.

### 6. Smoke test desde laptop operador
```bash
./scripts/smoke-test-wave-3-tls.sh                              # primary
./scripts/smoke-test-wave-3-tls.sh --dr                         # DR
./scripts/smoke-test-wave-3-tls.sh --imei 863238075489155       # con handshake IMEI
```

Valida en orden:
1. DNS → IP coincide con `terraform output`.
2. TCP open en `:5061`.
3. TLS handshake TLSv1.2+ con cert válido Let's Encrypt.
4. CN del cert incluye el dominio.
5. Cert vigente con >7 días.
6. (Opcional) handshake IMEI → ACK 0x01.

### 7. Migración devices Wave 3
Por device en Teltonika Configurator:
- **Server Mode (primary)**: TLS, Domain `telemetry-tls.boosterchile.com`, Port 5061.
- **Server Mode (backup)**: Backup, Domain `telemetry-dr.boosterchile.com`, Port 5061, TLS Enable.
- Push config.
- Verificar `kubectl logs -n telemetry deployment/telemetry-tcp-gateway --tail=100 --context=booster-primary | grep "handshake IMEI completado"`.

### 8. Documentar en ADR-005
Update sección "Status post-Wave 3":
- Devices migrados a TLS: N/total.
- DR failover testado: fecha, pass.

## Rollback

Si algo falla en el rollout TLS pero Wave 2 sigue OK:
- **Devices**: revertir cfg al endpoint plain `telemetry.boosterchile.com:5027`. Los devices Wave 1/2 ya estaban acá.
- **K8s**: el Service `telemetry-tcp-gateway-tls` puede borrarse sin afectar el Service plain `telemetry-tcp-gateway`. `kubectl delete svc telemetry-tcp-gateway-tls -n telemetry`.
- **Terraform**: las IPs estáticas tienen `prevent_destroy=false` por default — `terraform destroy -target=google_compute_address.telemetry_tls_lb` las libera. Lo mismo con el DNS A record.

## Próximos pasos cuando esto se merge

1. **Confirmar pre-conditions**:
   - `kubectl get pods -n telemetry --context=booster-primary` estable.
   - Cloud Monitoring → no alertas P0/P1 en últimos 7d.
   - `scripts/load-test` ejecutado con resultados PASS documentados.
   - `docs/runbooks/dr-failover-test.md` ejecutado con resultados PASS.

2. **Programar ventana de rollout TLS** (1-2h, no requiere downtime — los devices migran 1×1).

3. **Comunicar a flota Wave 1/2** que recibirán nueva config TLS via push remoto.

## Referencias

- ADR-005 — Stack telemetría IoT.
- Runbook `docs/runbooks/wave-2-3-deploy.md` §3.2 + §5.2.
- Brief `Booster-FMC150-Wave2-Wave3-Brief-2026-05-06.pdf` (D3 + D4).
- Handoffs previos: `2026-05-07-wave-2-3-deploy-progress.md`, `2026-05-09-iac-hardening-sprint.md`.
