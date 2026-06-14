# Runbook — On-call telemetry incidents

Procedimientos para responder alertas del sistema de telemetría
Booster (gateway + processor + apps consumer de eventos AVL).

**Cuando recibas una alerta**:
1. Acusá recibo (canal real hoy: email a dev@boosterchile.com — único notification channel, `infrastructure/monitoring.tf:8-18`; no hay Slack/PagerDuty configurado).
2. Ubicá la sección correspondiente abajo.
3. Seguí los pasos en orden — no saltar.
4. Si no podés resolver en 30 min, registrá el estado en docs/handoff/CURRENT.md antes de seguir (operador único — no existe escalamiento a otro equipo).

---

## Crash event (P0)

**Métrica**: `telemetry/crash_events` incrementó.

**Significado**: un vehículo Booster sufrió un impacto detectado por
el acelerómetro del FMC150. El device envió un Crash Trace y el
processor lo guardó en GCS + BigQuery.

### Pasos

1. **Identificar vehículo + carrier**: query BigQuery
   ```sql
   SELECT crash_id, vehicle_id, imei, timestamp, peak_g_force, gcs_path
   FROM `booster-ai-494222.telemetry.crash_events`
   WHERE timestamp > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR)
   ORDER BY timestamp DESC;
   ```

2. **Confirmar via WhatsApp** al carrier owner del vehículo
   (`SELECT phone FROM users JOIN memberships ON ... WHERE empresa_id =
   (SELECT empresa_id FROM vehicles WHERE id = '<vehicle_id>')`).
   Mensaje template: "Booster detectó impacto en vehículo
   {plate}. ¿El conductor está bien?"

3. **Si el conductor confirma incidente real**:
   - Descargar el Crash Trace del bucket: `gsutil cp $gcs_path /tmp/`.
   - Generar reporte forense (script futuro: `scripts/crash-report.py`).
   - Notificar al área comercial — vector de upsell para venta de
     "plan + forensics".

4. **Si el conductor dice "no pasó nada"**:
   - Posible falso positivo del acelerómetro.
   - Investigar: peak G-force en el log + threshold del device.
   - Si `peak_g_force < 1.5G` → falso positivo (typical baches).
     Revisar config Crash Detection del device en
     `docs/research/teltonika-fmc150/CONFIGURACION-BOOSTER-DETALLADA.md`.

---

## Unplug event (P0)

> **✅ ALERTA OPERATIVA desde 2026-06-11**: el telemetry-processor emite
> `eventName=Unplug` al detectar el IO 252 en cualquier record (incluido
> el path SMS fallback) — `apps/telemetry-processor/src/panic-events.ts`.
> Mientras la condición persista, cada record re-emite el log (la policy
> agrega por ventana).

**Métrica**: `telemetry/unplug_events` incrementó.

**Significado**: el device perdió alimentación externa (cable
desconectado). Posible tamper/sabotaje o el carrier desinstaló el
device.

### Pasos

1. **Identificar device + vehículo** (mismo query que Crash, pero
   filtro `eventName="Unplug"` en logs Cloud Logging del processor).

2. **Cross-check** con histórico:
   - ¿Es el primer unplug de este device? → posible tamper, contactar
     carrier urgente.
   - ¿Hay unplugs frecuentes? → posible problema de instalación
     (cable suelto), ticket al carrier para reinstalar.

3. **Si es tamper sospechoso**:
   - Activar tracking continuo del vehículo (consultar última
     posición en Firestore).
   - Notificar a admin Booster + WhatsApp owner del carrier.
   - Si no hay respuesta del carrier en 30 min y el vehículo se está
     moviendo, escalar a fuerzas de orden con histórico GPS.

---

## GNSS Jamming critical (P0)

> **✅ ALERTA OPERATIVA desde 2026-06-11**: el telemetry-processor emite
> `eventName=GnssJamming` con `rawValue` (la métrica filtra valor 2 =
> crítico; valor 1 = warning queda en logs) —
> `apps/telemetry-processor/src/panic-events.ts`.

**Métrica**: `telemetry/gnss_jamming_critical_events` incrementó.

**Significado**: el device detectó un jammer GPS muy fuerte (valor=2
de la spec Teltonika AVL 318). Indicador típico de **intento de
robo**: el delincuente bloquea el GPS antes de mover el camión.

### Pasos

1. **Acción inmediata** (< 5 min):
   - Última posición GPS conocida (Firestore `vehicles/{id}/position`).
   - Confirmar via WhatsApp al carrier: "Detectamos posible jamming
     en vehículo {plate}. ¿Está conduciendo?".

2. **Si NO contesta o dice "no":**
   - Llamar al conductor (teléfono en `users` table).
   - Si no responde, escalar a fuerzas de orden con la última posición.

3. **Si confirma "estoy bien, debe ser falso positivo":**
   - Verificar si hay otros devices en el mismo radio (cluster jamming
     ej. cerca de aeropuerto / instalación militar / antena).
   - Si solo un device → posible jammer real, igual notificar al
     carrier para preventivo.

---

## Parser errors sostenido (P1)

**Métrica**: `telemetry/parser_errors > 5/min sostenido 5 min`.

**Significado**: el gateway recibe AVL packets que no parsea — bug
del parser, cambio de protocolo del device, o tráfico malicioso.

### Pasos

1. **Identificar IMEIs** en logs:
   ```
   resource.type="k8s_container"
   jsonPayload.message="parse error, ack 0 + cerramos"
   ```

2. **Si todos los errores son del mismo IMEI**: device problemático,
   contactar carrier para reflashear o sacar de operación.

3. **Si los errores son distribuidos** (varios IMEIs):
   - Posible regression del parser tras un deploy reciente. Verificar
     `git log packages/codec8-parser/src/`. Rollback con `kubectl
     rollout undo deployment/telemetry-tcp-gateway -n telemetry`.

4. **Si el error es repetido en mismo offset hex**:
   - Capturar el packet raw con `tcpdump` en el pod del gateway:
     `kubectl exec -n telemetry $POD -- tcpdump -X -i any port 5027 -w
     /tmp/capture.pcap` por 1 min, copiar a local con `kubectl cp`.
   - Reportar a Backend con el .pcap para análisis del frame.

---

## Pub/Sub backlog (P2)

**Métrica**: backlog de telemetry-events-processor-sub o
crash-traces-processor-sub > 1000.

**Significado**: el processor no está consumiendo al ritmo del
gateway. Causas típicas: DB lenta, instancias Cloud Run insuficientes,
bug en el handler.

### Pasos

1. **Verificar Cloud Run instances**: `gcloud run services describe
   booster-ai-telemetry-processor` — `min/max_instances` y
   utilization.

2. **Verificar latency Postgres**: dashboard Cloud SQL — query latency
   p99 > 500ms es alarma.

3. **Si latency Postgres alta**: aumentar `cpu` en Cloud SQL via
   Terraform (raro, pero medía estaba en piloto).

4. **Si Postgres OK pero processor saturado**: aumentar
   `MAX_MESSAGES_IN_FLIGHT` (env var del processor). Default 50, push
   a 100-200 en alto throughput.

5. **Si nada funciona**: increment `max_instances` del Cloud Run.

---

## Telemetry consumer stalled

**Métrica** (P1): `telemetry_consumer_stalled_p1` — `oldest_unacked_message_age`
de `telemetry-events-processor-sub` > 30 min. (La sub `crash-traces-processor-sub`
NO está en esta alerta: es bursty y un único crash-trace lento podría flapearla; su
stall lo cubren `pubsub_dlq` + `crash_trace_persistence_failures`.)

**Significado**: el `telemetry-processor` **dejó de consumir** Pub/Sub. Los
mensajes envejecen sin ack → no se escribe nada en `telemetria_puntos`. Este es
el modo de falla del incidente del 2026-06-07 (processor escaló a cero ~26h).

> Por qué esta alerta y no el backlog por conteo: `oldest_unacked_message_age`
> sube +60s/min apenas muere el consumer, **independiente del volumen**, así que
> dispara también de madrugada (fleet estacionado). El conteo (`pubsub_backlog_p2`)
> de noche tardó 14h en cruzar 1000 — es solo señal secundaria.

### Pasos

1. **¿Hay instancias del processor corriendo?**
   ```bash
   gcloud run services describe booster-ai-telemetry-processor \
     --region=southamerica-west1 \
     --format="value(spec.template.metadata.annotations['autoscaling.knative.dev/minScale'], spec.template.metadata.annotations['run.googleapis.com/cpu-throttling'])"
   ```
   El processor es un **consumer Pub/Sub pull** (StreamingPull dentro del
   container). Requiere `min-instances>=1` **y** `cpu-throttling=false` (CPU
   always-on); si no, escala a cero cuando no hay requests HTTP y deja de tirar
   de la cola.

2. **Fix inmediato** si está en `min=0` / throttled:
   ```bash
   gcloud run services update booster-ai-telemetry-processor \
     --region=southamerica-west1 --min-instances=1 --no-cpu-throttling
   ```
   La instancia levanta, drena el backlog acumulado (Pub/Sub retiene 7 días,
   no se pierde nada) y la ingesta vuelve.

3. **Verificar recuperación**: el backlog (`num_undelivered_messages`) baja a ~0
   y `telemetria_puntos` recibe escrituras nuevas (último `timestamp_recibido_en`
   en segundos).

4. **Errores en el handler** (si hay instancia viva pero igual no drena): logs
   del processor `severity>=ERROR` — DB caída, Redis (dedup) inalcanzable, etc.
   Tras 5 fallos por mensaje, va al DLQ (`pubsub-dead-letter`).

5. **Permanente**: que el `min-instances=1` + CPU always-on quede en IaC (no solo
   aplicado a mano) para que un deploy/terraform apply no lo revierta.

---

## Telemetry ingress stopped

**Métrica** (P1): `telemetry_gateway_down_p1` — `condition_absent` sobre
`kubernetes.io/container/uptime` del container `gateway` (ns `telemetry`),
agregado colapsando `pod_name`, ausente > 10 min.

> ⚠️ Validación pendiente: es una alerta por ausencia; confirmar que dispara con un
> **stop controlado del gateway** (~3 min, en horario de bajo tráfico). Los devices
> Teltonika buffean y reenvían al reconectar → pérdida ≈ 0. Procedimiento de test al
> final de esta sección.
>
> Diseño: se usa liveness POSITIVO del pod (uptime), NO `device_records` en 0,
> porque (a) en un apagón total las series por-IMEI desaparecen y un REDUCE_SUM sin
> inputs no se marca como ausente de forma confiable, y (b) con el fleet estacionado
> de noche los records caen a 0 legítimamente (los Network Pings 0xFF no cuentan).
> El uptime del pod es estable 24/7 y sólo desaparece si el pod muere. Se colapsa
> `pod_name` para que un rolling restart no falsee.

**Significado**: **no llegan AVL records de ningún device**.
Falla del lado de ingreso: pod del gateway caído, LB/DNS desalineado, cert TLS
(5061) vencido, o todos los devices offline. (Distinto de "consumer stalled": acá
los mensajes ni siquiera entran a Pub/Sub — el consumer-stall sí tiene alerta.)

### Pasos

1. **Pod del gateway** (single replica, GKE):
   ```bash
   gcloud container clusters get-credentials booster-ai-telemetry --region=southamerica-west1
   kubectl get pods -n telemetry
   kubectl logs -n telemetry deploy/telemetry-tcp-gateway --tail=50
   ```
   Si el control plane no es alcanzable desde la laptop (master authorized
   networks), usar Cloud Logging: `resource.labels.container_name="gateway"`.

2. **LB / DNS**: `telemetry.boosterchile.com` (plain 5027) y
   `telemetry-tls.boosterchile.com` (TLS 5061) deben resolver a las IP estáticas
   del Service (ver `infrastructure/k8s/telemetry-tcp-gateway.yaml`). Outage
   2026-05-07 fue por IP efímera vs estática.

3. **Cert TLS** (si los devices usan 5061): `kubectl get certificate -n telemetry`
   + `openssl s_client -connect telemetry-tls.boosterchile.com:5061` (¿vencido?).

4. **Devices**: si gateway + LB + cert OK, revisar si los devices están online
   (operador móvil, energía). De madrugada con fleet estacionado puede ser normal.

### Validación de la alerta (test controlado, correr 1 vez post-deploy)

Confirmar que `telemetry_gateway_down_p1` realmente dispara. Hacerlo en **horario
de bajo tráfico** (los devices buffean y reenvían → pérdida ≈ 0).

```bash
gcloud container clusters get-credentials booster-ai-telemetry --region=southamerica-west1
# 1. Bajar el gateway a 0 réplicas
kubectl scale deployment/telemetry-tcp-gateway -n telemetry --replicas=0
# 2. Esperar > duration de la alerta (10 min) + margen de propagación (~5 min)
#    Confirmar que la alerta abre: GCP Console → Monitoring → Alerting,
#    o revisar el email del canal email_alerts.
# 3. Restaurar
kubectl scale deployment/telemetry-tcp-gateway -n telemetry --replicas=1
kubectl rollout status deployment/telemetry-tcp-gateway -n telemetry
```

- **Si la alerta abrió** → validada; nada más que hacer.
- **Si NO abrió tras ~15 min** → revisar la condición `condition_absent` (¿la
  agregación produce serie?, ¿`duration`?). NO confiar en ella hasta que dispare.
- Tras restaurar, verificar que la telemetría vuelve a fluir (ver §Telemetry
  consumer stalled paso 3).

---

## Crash trace persistence failed (P0)

**Métrica**: `crash_trace_persistence_failures > 0`.

**Significado**: el processor no logró guardar un Crash Trace en GCS
o BigQuery. Cada falla = evidencia forense potencialmente perdida.

### Pasos

1. **Logs Cloud Logging**:
   ```
   resource.type="cloud_run_revision"
   resource.labels.service_name="booster-ai-telemetry-processor"
   jsonPayload.message="error persistiendo crash-trace, nack para reintento"
   ```

2. **Identificar la causa del error** (`err.message`):
   - `permission denied` → IAM binding faltante, reaplicar Terraform.
   - `bucket not found` → bucket no creado o env var
     `GCS_CRASH_TRACES_BUCKET` mal configurada.
   - `timeout` → Cloud Run agotó su 5min ack deadline (raro), reducir
     `flowControl.maxMessages`.

3. **Si el error persiste > 30 min**: los packets quedan en
   `pubsub-dead-letter` topic. Reproc manual:
   ```bash
   gcloud pubsub subscriptions pull pubsub-dead-letter-sub \
     --auto-ack --limit=100 > /tmp/crashes-dlq.json
   # → reprocesar manualmente o re-publicar al topic crash-traces
   ```

---

## TODOs (futuras métricas)

Las siguientes requieren instrumentation OpenTelemetry que aún no
está implementada — quedan documentadas acá para no olvidar.

1. **`pubsub_publish_latency_p99`**: distribution metric desde el
   gateway. Wrap en `TelemetryPublisher.publishRecord()` con
   `metrics.createHistogram('pubsub.publish.duration')`. Alerta si
   p99 > 2s.

2. **`bigquery_insert_latency_p99`**: distribution metric desde el
   processor. Wrap en `createBigQueryCrashTraceIndexer.insertRow()`.

3. **`device_profile_compliance_pct`**: gauge desde el api. Query
   periódica a `dispositivos_telemetria` filtrando `version_config`.

4. **`tcp_connection_resets_per_hour` (refinamiento)**: el log-based
   metric actual es agregado. OpenTelemetry permitiría labels por
   `imei` para detectar device specific issues.
