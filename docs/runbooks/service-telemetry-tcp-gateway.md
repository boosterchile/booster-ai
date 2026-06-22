# Runbook — Servicio `apps/telemetry-tcp-gateway` (TCP Teltonika, GKE Autopilot)

- **Estado**: Vigente
- **Plataforma**: **GKE Autopilot** (NO Cloud Run, ADR-005). Cluster `booster-ai-telemetry` · región `southamerica-west1` · project `booster-ai-494222`.
- **Workload**: namespace `telemetry`, Deployment `telemetry-tcp-gateway` (**1 réplica**, pre-comercial ≤10 Teltonika), Service `telemetry-tcp-gateway` (LoadBalancer IP estática `34.176.238.106`). SA del pod: `telemetry-gateway-sa` (Workload Identity).
- **Naturaleza**: servidor **TCP** que termina las conexiones persistentes de los devices Teltonika (Codec8/Codec8 Extended). Entrypoint `apps/telemetry-tcp-gateway/src/main.ts`. Por cada record AVL parseado publica a Pub/Sub (`telemetry-events`; crash traces a `crash-traces`). Autentica el device por IMEI al handshake (`imei-auth.ts`), rate-limita el enrollment (`rate-limiter.ts`) y capa un máximo de conexiones concurrentes por pod (`connection-handler.ts`).

> Este runbook cubre **el servicio gateway** (restart, rollback de imagen, escalado, conexiones). Las **alertas de telemetría end-to-end** (crash/unplug/jamming, parser errors, consumer stalled, gateway down) están en `oncall-telemetry-incidents.md` — ese es el árbol de respuesta por alerta; éste es la operación del componente. El **primer levantamiento** de un cluster (secret K8s, Workload Identity, Artifact Registry) está en `bootstrap-gke-telemetry-gateway.md`.

---

## Puertos / endpoints

| Puerto | Uso |
|---|---|
| `5027` | TCP plano Teltonika. Hostname público `telemetry.boosterchile.com`. También sirve de TCP health probe (liveness/readiness apuntan al puerto `teltonika-tcp`). |
| `5061` | TCP **TLS** (cert Let's Encrypt vía cert-manager, pinned por el device). Hostname `telemetry-tls.boosterchile.com` (Wave 3 D3). |

Env vars clave del Deployment (`infrastructure/k8s/telemetry-tcp-gateway.yaml`): `MAX_CONCURRENT_CONNECTIONS` (cap por pod, protege file descriptors), `ENROLLMENT_RATE_MAX` + `ENROLLMENT_RATE_WINDOW_SEC` (anti-flood de handshakes), `IDLE_TIMEOUT_SEC`, `PUBSUB_TOPIC_TELEMETRY`, `PUBSUB_TOPIC_CRASH_TRACES`, `DATABASE_URL` (del secret `telemetry-gateway-secrets`).

---

## Síntomas / alertas que disparan este runbook

| Alerta (policy en `telemetry-monitoring.tf`) | Significado | Acción |
|---|---|---|
| `Telemetry gateway pod down — no ingress (P1)` (`telemetry_gateway_down_p1`) | el container `gateway` no reporta uptime > 10 min → **no entra ningún record** | [Gateway caído](#gateway-caído--no-ingresa-telemetría) |
| `Gateway enrollment rate-limited sostenido (P1)` (`gateway_enrollment_rate_limited_p1`) | rechazos de enrollment sostenidos > 5 min | [Enrollment rate-limited](#enrollment-rate-limited-p1) |
| `Gateway connection cap alcanzado (P2)` (`gateway_connection_cap_reached_p2`) | el cap de conexiones concurrentes se está rechazando | [Connection cap](#connection-cap-alcanzado-p2) |
| `Parser errors sostenido (P1)` | AVL packets que no parsean | ver `oncall-telemetry-incidents.md` §Parser errors |

Reportar horarios al PO en **America/Santiago**. De madrugada, con la flota estacionada, la baja de records es **normal** (los Network Pings 0xFF no cuentan) — por eso la alerta de caída usa el **uptime del pod**, no `device_records==0`.

---

## Conexión al cluster

```bash
PROJECT=booster-ai-494222 ; REGION=southamerica-west1
# Credenciales vía DNS endpoint (ADR-059). Requiere roles/container.developer.
gcloud container clusters get-credentials booster-ai-telemetry \
  --location=$REGION --dns-endpoint --project=$PROJECT

kubectl get pods -n telemetry
kubectl get svc  -n telemetry telemetry-tcp-gateway -o wide   # ver EXTERNAL-IP = 34.176.238.106
```

> Si el control plane no es alcanzable desde la laptop (master authorized networks), usá **Cloud Logging** en vez de `kubectl logs`:
> ```bash
> gcloud logging read 'resource.type="k8s_container"
>   resource.labels.cluster_name="booster-ai-telemetry"
>   resource.labels.namespace_name="telemetry"
>   resource.labels.container_name="gateway"' \
>   --project=$PROJECT --limit=50 --freshness=30m
> ```

---

## Gateway caído / no ingresa telemetría

(Detalle completo en `oncall-telemetry-incidents.md` §"Telemetry ingress stopped". Resumen accionable.)

1. **Pod**:
   ```bash
   kubectl get pods -n telemetry
   kubectl describe pod -n telemetry -l app=telemetry-tcp-gateway   # ¿OOMKilled? ¿ImagePullBackOff? ¿CrashLoopBackOff?
   kubectl logs -n telemetry deploy/telemetry-tcp-gateway --tail=80
   ```
   - `ImagePullBackOff` / `CreateContainerConfigError` → falta el grant de Artifact Registry o el secret/Workload Identity → `bootstrap-gke-telemetry-gateway.md`.
   - `CrashLoopBackOff` → mirar los logs: típicamente `DATABASE_URL` ausente (secret no montado) o env mal seteada.
2. **LB / DNS**: `telemetry.boosterchile.com` (5027) y `telemetry-tls.boosterchile.com` (5061) deben resolver a `34.176.238.106` (IP **estática** del Service). El outage 2026-05-07 fue por IP efímera. Verificar:
   ```bash
   kubectl get svc -n telemetry telemetry-tcp-gateway -o jsonpath='{.status.loadBalancer.ingress[0].ip}' ; echo
   nc -vz telemetry.boosterchile.com 5027     # ¿acepta TCP?
   ```
3. **Cert TLS** (si los devices usan 5061):
   ```bash
   kubectl get certificate -n telemetry
   openssl s_client -connect telemetry-tls.boosterchile.com:5061 -servername telemetry-tls.boosterchile.com </dev/null 2>/dev/null | openssl x509 -noout -dates
   ```
4. **Restart del gateway** (los devices Teltonika **buffean y reenvían** al reconectar → pérdida ≈ 0; aun así hacerlo en horario de bajo tráfico):
   ```bash
   kubectl rollout restart deployment/telemetry-tcp-gateway -n telemetry
   kubectl rollout status  deployment/telemetry-tcp-gateway -n telemetry
   ```

---

## Enrollment rate-limited (P1)

El gateway rechaza handshakes cuando un IMEI excede `ENROLLMENT_RATE_MAX` en la ventana `ENROLLMENT_RATE_WINDOW_SEC` (anti-flood, `rate-limiter.ts`).

1. **¿Quién dispara los rechazos?** (¿un device en loop de reconexión, o un flood real?)
   ```bash
   gcloud logging read 'resource.type="k8s_container"
     resource.labels.namespace_name="telemetry" resource.labels.container_name="gateway"
     jsonPayload.message=~"enrollment"' --project=$PROJECT --limit=40 --freshness=15m
   ```
2. **Un solo IMEI martillando** → device con config de reconexión agresiva o falla de red intermitente. Contactar al carrier para reflashear/ajustar; mientras tanto el cap lo contiene (no es caída del servicio).
3. **Muchos IMEIs distintos a la vez** → posible cambio de config masiva o tráfico hostil. Si es legítimo y esperado (enrollment masivo planificado), subir `ENROLLMENT_RATE_MAX` en el manifiesto y re-aplicar. Si es hostil, mantener el límite.

---

## Connection cap alcanzado (P2)

Se rechazan conexiones nuevas porque se alcanzó `MAX_CONCURRENT_CONNECTIONS` por pod (protege FDs/memoria).

1. **¿Es crecimiento legítimo de flota o conexiones colgadas?**
   ```bash
   gcloud logging read 'resource.type="k8s_container"
     resource.labels.namespace_name="telemetry" resource.labels.container_name="gateway"
     jsonPayload.message=~"connection cap"' --project=$PROJECT --limit=30 --freshness=15m
   ```
2. **Conexiones colgadas** (devices que no cierran limpio): bajar `IDLE_TIMEOUT_SEC` ayuda a reciclarlas. Un `rollout restart` las limpia de inmediato (los devices reconectan).
3. **Crecimiento real de flota** acercándose al cap pre-comercial (≤10 Teltonika hoy): subir `MAX_CONCURRENT_CONNECTIONS` en el manifiesto, o pasar a >1 réplica (requiere validar que el LB distribuye y que el design tolera múltiples pods). Decisión de capacity → coordinar con PO (ver `.specs/cost-optimization-precomercial`).

---

## Deploy / rollback de imagen

El deploy recurrente NO es `kubectl apply` del YAML completo: Cloud Build hace **`kubectl set image`** sobre el Deployment (pipelines `cloudbuild-primary-deploy.yaml`; bootstrap manual con `scripts/deploy-telemetry-gateway.sh`).

```bash
# Ver imagen/tag actual:
kubectl get deploy telemetry-tcp-gateway -n telemetry \
  -o jsonpath='{.spec.template.spec.containers[0].image}' ; echo

# Rollback a la revisión anterior del Deployment (revierte el set image):
kubectl rollout undo deployment/telemetry-tcp-gateway -n telemetry
kubectl rollout status deployment/telemetry-tcp-gateway -n telemetry

# Historial de revisiones:
kubectl rollout history deployment/telemetry-tcp-gateway -n telemetry
```

> El `rollout undo` es el camino correcto cuando un deploy nuevo del gateway introduce una regresión del parser (síntoma: `parser_errors` sube tras el deploy — ver `oncall-telemetry-incidents.md` §Parser errors, que usa exactamente este undo).

---

## Escalación

- **Operador único** (`dev@boosterchile.com`). Canal de alerta: email (`monitoring.tf`). Si no se resuelve en 30 min, registrar en `docs/handoff/CURRENT.md`.
- Sospecha de **tamper/robo** (unplug, jamming): seguir el procedimiento de `oncall-telemetry-incidents.md` (puede escalar a fuerzas de orden con el histórico GPS) — eso es respuesta de **incidente de seguridad física**, no de servicio.
- Cambios de capacity (réplicas, caps) que alteren costo/arquitectura → coordinar con PO.

## Refs

- Alertas telemetría (árbol por alerta): `oncall-telemetry-incidents.md`.
- Bootstrap de cluster nuevo / reactivación DR: `bootstrap-gke-telemetry-gateway.md`.
- DR failover GKE: `dr-failover-test.md`.
- ADR-005 (GKE Autopilot para TCP), ADR-058 (DR cold), ADR-059 (DNS endpoint + IAM cluster).
- Manifiesto: `infrastructure/k8s/telemetry-tcp-gateway.yaml`. Código: `apps/telemetry-tcp-gateway/src/`.
