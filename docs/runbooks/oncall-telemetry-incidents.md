# Runbook — On-call telemetry incidents

Procedimientos para responder alertas del sistema de telemetría
Booster (gateway + processor + apps consumer de eventos AVL).

**Cuando recibas una alerta**:
1. Acusá recibo en Slack/PagerDuty (no resolver hasta validar fix).
2. Ubicá la sección correspondiente abajo.
3. Seguí los pasos en orden — no saltar.
4. Si no podés resolver en 30 min, escalá a ingeniería backend.

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
   jsonPayload.msg="parse error, ack 0 + cerramos"
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

## Crash trace persistence failed (P0)

**Métrica**: `crash_trace_persistence_failures > 0`.

**Significado**: el processor no logró guardar un Crash Trace en GCS
o BigQuery. Cada falla = evidencia forense potencialmente perdida.

### Pasos

1. **Logs Cloud Logging**:
   ```
   resource.type="cloud_run_revision"
   resource.labels.service_name="booster-ai-telemetry-processor"
   jsonPayload.msg="error persistiendo crash-trace, nack para reintento"
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
