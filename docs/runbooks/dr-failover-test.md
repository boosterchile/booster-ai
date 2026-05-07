# Runbook — DR failover test (Wave 3 D4)

Procedimiento para validar el failover del telemetry-tcp-gateway
desde primary (southamerica-west1) al DR (us-central1) y de vuelta.

## Pre-requisitos

- Primary cluster funcionando: `booster-ai-telemetry` en
  `southamerica-west1`.
- DR cluster funcionando: `booster-ai-telemetry-dr` en
  `us-central1`.
- Cert TLS válido en ambos clusters (cert-manager Certificate
  `telemetry-tls-cert` tiene SANs `telemetry-tls.boosterchile.com` +
  `telemetry-dr.boosterchile.com`).
- DNS records:
  - `telemetry-tls.boosterchile.com` → IP del LB primary (5061).
  - `telemetry-dr.boosterchile.com` → IP del LB DR (5061).
- Device de lab con config:
  - Server Mode = Primary, Domain = `telemetry-tls.boosterchile.com`.
  - Server Mode (backup) = Backup, Domain = `telemetry-dr.boosterchile.com`.
  - Failover trigger: 5 timeouts consecutivos.

## Test 1 — Primary down → DR toma tráfico

1. Verificar que el device está conectado al primary:
   ```bash
   kubectl logs -n telemetry deployment/telemetry-tcp-gateway --tail 50 \
     --context=booster-primary | grep "handshake IMEI completado"
   ```
   Debería ver IMEI del device.

2. **Bloquear primary** simulando outage. Opciones:
   - Escalar deployment a 0 replicas:
     ```bash
     kubectl scale deployment/telemetry-tcp-gateway -n telemetry \
       --replicas=0 --context=booster-primary
     ```
   - O drop traffic a nivel network policy:
     ```bash
     kubectl apply -n telemetry --context=booster-primary -f - <<EOF
     apiVersion: networking.k8s.io/v1
     kind: NetworkPolicy
     metadata: { name: block-all }
     spec: { podSelector: {}, policyTypes: ["Ingress"] }
     EOF
     ```

3. **Esperar < 60s** para que el device detecte 5 timeouts y haga
   switchover.

4. **Verificar que DR recibió la conexión**:
   ```bash
   kubectl logs -n telemetry deployment/telemetry-tcp-gateway --tail 50 \
     --context=booster-dr | grep "handshake IMEI completado"
   ```

5. **Verificar telemetría continua**: query Postgres
   ```sql
   SELECT MAX(timestamp_device) FROM telemetria_puntos
   WHERE imei = '<imei device lab>';
   ```
   Debería ser < 2 min atrás.

## Test 2 — Primary back → device regresa

1. Restaurar primary:
   ```bash
   kubectl scale deployment/telemetry-tcp-gateway -n telemetry \
     --replicas=2 --context=booster-primary
   # O remover NetworkPolicy del Test 1.
   ```

2. **Esperar 1-5 min** según la config del device (algunos esperan
   un cooldown antes de re-probar primary).

3. **Verificar device reconectado al primary**: misma query del Test 1
   contra el primary cluster.

4. **NO debe haber gap en Postgres**:
   ```sql
   -- El span entre el último record en el primary antes del outage y
   -- el primer record en el DR debería ser < 60s. Idem entre DR y
   -- primary post-recovery.
   SELECT timestamp_device,
          LAG(timestamp_device) OVER (ORDER BY timestamp_device) AS prev,
          timestamp_device - LAG(timestamp_device) OVER (ORDER BY timestamp_device) AS gap
   FROM telemetria_puntos
   WHERE imei = '<imei>'
     AND timestamp_device > NOW() - INTERVAL '15 minutes'
   ORDER BY timestamp_device;
   ```

   Si hay gap > 5 min en alguna fila → falla. Investigación: device
   no estaba reintentando, o cert pinning falló, o DNS DR estaba mal
   resuelto.

## Criterios de aceptación (gate G3.4)

- [ ] DR responde en `telemetry-dr.boosterchile.com:5061` con cert
      válido (`openssl s_client -connect ...`).
- [ ] Device cambia a backup en < 60s tras fallar primary.
- [ ] Records que llegan al DR terminan en mismo Pub/Sub que primary
      (mismo topic global) → mismo Postgres.
- [ ] Cuando primary vuelve, device regresa sin pérdida de records.

## Troubleshooting

### Device no cambia al backup

- Verificar config del device: Server Mode (backup) = Backup, no
  "Disabled".
- Verificar Backup TLS = Enable. Si está Disable, el device intenta
  TCP plain en 5061 → falla TLS handshake.
- DNS resolución: desde el device (si soporta `ping`):
  `ping telemetry-dr.boosterchile.com`.

### Device cambia pero pierde telemetría

- Cert mismatch: device hace pinning del cert primary y rechaza el
  DR. Solución: incluir SAN dual en el Certificate de cert-manager.
- Timeout TLS: handshake DR > 5s y el device aborta. Verificar
  `tlsClientError` en logs del DR.

### Postgres no recibe records del DR

- Pub/Sub publish failing: verificar IAM del SA del DR cluster
  contra el topic `telemetry-events`. Workload Identity debe
  apuntar al mismo `booster-cloudrun-sa` que el primary.
- Processor no consumiendo: el processor corre en una sola región
  (primary), pero Pub/Sub es global → debería funcionar. Si no,
  verificar subscription `telemetry-events-processor-sub`.

## Refs

- Brief: `Booster-FMC150-Wave2-Wave3-Brief-2026-05-06.pdf` — Track D4 (G3.4)
- ADR: `docs/adr/005-telemetry-iot.md`
