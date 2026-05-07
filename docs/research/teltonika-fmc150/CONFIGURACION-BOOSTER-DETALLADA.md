# Configuración Booster — Teltonika FMC150 (Wave 2)

Configuración paso-a-paso para cargar manualmente desde **Teltonika
Configurator** (PC) o vía FOTA Cloud. Cada parámetro lleva la sección
exacta del Configurator donde se setea, el valor canónico Booster, y
una nota corta explicando por qué.

**Aplica a**: todos los devices FMC150 productivos migrando a Wave 2.
Wave 3 (TLS dual + DR backup) se documenta en sección §6 de este
archivo y se aplica después de cerrar G2.3.

**Pre-requisitos del lado server**:
- Gateway K8s con `loadBalancerIP: 34.176.238.106` (MR !39 ya mergeada).
- Pub/Sub topics fan-out `safety-p0`, `security-p1`, `eco-score`,
  `trip-transitions`, `crash-traces` (Wave 2/3 apply).
- Twilio webhook configurado en `+19383365293` apuntando a
  `https://booster-ai-sms-fallback-gateway-...run.app/webhook`.
- ⚠️ **Bloqueante para SMS Fallback**: el container del
  `sms-fallback-gateway` está en placeholder. Hasta que se buildee y
  deploye la imagen real, los SMS de fallback se reciben pero se
  pierden silenciosamente downstream. La cfg del device se puede
  cargar igual — solo evitar disparar Crash/Unplug/Jamming a propósito
  para tests hasta resolver el deploy.

---

## §1 — Configuración global del device

### §1.1 GPRS — conexión al server primary

Sección Configurator: **GPRS → Server Settings**

| Parámetro | Valor | Nota |
|---|---|---|
| Server Mode (primary) | TCP | Plain TCP. Wave 3 migra a TLS port 5061. |
| Server Address (primary) | `telemetry.boosterchile.com` | DNS que resuelve a IP estática `34.176.238.106` (LB del gateway K8s). |
| Server Port (primary) | `5027` | Puerto Teltonika canónico. |
| Server Protocol | TCP | El gateway no acepta UDP. |
| TLS Encryption (primary) | Disable | Wave 2 = plain. Wave 3 lo activa. |
| Codec | Codec 8 Extended | Necesario para AVL ID 318 (GNSS Jamming) que es 2 bytes — Codec 8 estándar no lo soporta. |

### §1.2 SIM / APN

Sección: **GPRS → APN**

| Parámetro | Valor | Nota |
|---|---|---|
| APN | (depende del operador SIM — ej. `bam.entelpcs.cl` para Entel) | El conductor / dueño confirma. No tocar si ya está OK. |
| APN Username / Password | (según operador) | Igual. |
| Authentication Type | PAP o CHAP según operador | Default suele bastar. |

### §1.3 Timing parameters — Min Period / Min Distance / Min Angle

Sección: **System → Records**

| Parámetro | Valor canónico Wave 2 | Nota |
|---|---|---|
| Min Period (Moving) | `30` segundos | Records cada 30s con vehículo en marcha. Gate G2.3 capacity test asume este valor. |
| Min Period (Static) | `600` segundos (10 min) | Records cada 10 min con vehículo parado. Reduce tráfico cuando el vehículo está estacionado. |
| Min Distance | `100` metros | Cambio de posición ≥100m fuerza record (independiente del period). |
| Min Angle | `10` grados | Cambio de rumbo ≥10° fuerza record (curvas, giros). |
| Min Saved Records | `10` | Buffer envío en lotes. Sale al server cuando hay 10 records acumulados, no por cada uno. |
| Send Period | `30` segundos | Frecuencia mínima de envío de buffer (con Min Saved Records=10, lo que ocurra primero). |

### §1.4 Network Ping (Wave 2 keep-alive)

Sección: **GPRS → Server Settings → Network**

| Parámetro | Valor | Nota |
|---|---|---|
| Network Ping Timeout | `60` segundos | Activa el fix D2 del gateway: el device manda un byte sentinel cada 60s para mantener NAT abierto. Sin esto la sesión TCP se cae cada 1-2 min en redes Entel/Movistar. |
| Open Link Timeout | `7200` segundos (2h) | Keepalive máximo de la sesión TCP antes de reconectar. |
| Response Timeout | `30` segundos | Wait antes de declarar timeout en handshake server. |
| Reconnect Attempts | `5` | Reintentos antes de marcar server unreachable y caer a fallback (SMS). |

---

## §2 — AVL IDs Low Priority (Operand = Monitoring) — 14 IDs

Sección: **System → I/O Settings → I/O list** — para cada uno:
- **Status** = Enable
- **Priority** = Low
- **Operand** = Monitoring (NO eventual; viaja en cada packet regular)
- **Average Const** = 0 (sin filtro, valor instantáneo)

| AVL ID | Nombre Configurator | Tipo | Función Booster |
|---|---|---|---|
| 16 | Total Odometer | uint32 (m) | GLEC distance acumulada para cálculo CO₂. |
| 21 | GSM Signal | uint8 (0-5 bars) | Métrica salud red — alerta si <2 bars sostenido. |
| 24 | Speed | uint16 (km/h) | DAQ + over-speeding context + cálculo eco. |
| 66 | External Voltage | uint16 (mV) | Detección unplug por voltaje (cae a 0 con ignición ON = sabotaje). |
| 67 | Battery Voltage | uint16 (mV) | Salud device (batería interna). |
| 68 | Battery Current | int16 (mA) | Salud device (carga/descarga interna). |
| 69 | GNSS Status | enum 0-4 | Diagnóstico GPS — alerta si OFF_NO_FIX sostenido. |
| 80 | Data Mode | enum 0-5 | Home / Roaming / Unknown — costos red distintos. |
| 181 | GNSS PDOP | uint16 (×10) | Calidad fix — filtrar PDOP > 5. |
| 182 | GNSS HDOP | uint16 (×10) | Calidad fix horizontal. |
| 199 | Trip Odometer | uint32 (m) | trip-state-machine — distancia del trip actual. |
| 200 | Sleep Mode | enum 0-4 | Diagnóstico telemetría — qué nivel de sleep el device. |
| 239 | Ignition | bool | Trip start/end signal. |
| 240 | Movement | bool | DAQ + trip-state-machine. |

**Verificación post-push**: el primer record en `telemetria_puntos`
debe traer estos 14 IDs en `io_data` JSONB. Query:

```sql
SELECT io_data FROM telemetria_puntos
WHERE imei = '<imei device>'
ORDER BY timestamp_device DESC LIMIT 1;
```

---

## §3 — AVL IDs Eventuales (Priority Panic/High) — 10 IDs

Sección: **System → I/O Settings → I/O list** — para cada uno:
- **Status** = Enable
- **Priority** = (según tabla)
- **Operand** = (según tabla — On Change / Hysteresis / Monitoring)
- **High Level** / **Low Level** según especifique cada ID

| AVL ID | Nombre Configurator | Priority | Operand | Trigger | Channel Booster |
|---|---|---|---|---|---|
| 247 | Crash Detection | **Panic** | On Change | accel ≥ 2.5g durante ≥30ms | safety-p0 → notification + GCS crash trace |
| 252 | Unplug | **Panic** | On Change | external voltage < 1V con ignición ON | safety-p0 |
| 318 | GNSS Jamming | **Panic** | Hysteresis (High level=2) | jamming critical detectado | safety-p0 |
| 246 | Towing | High | On Change | towing detected sin ignición | security-p1 |
| 175 | Auto Geofence | High | On Change | salida de zona segura cuando estacionado | security-p1 |
| 251 | Excessive Idling | High | On Change | idle >5 min con ignición ON | eco-score |
| 253 | Green Driving Type | High | On Change | acel/freno/curva fuerte | eco-score |
| 255 | Over Speeding | High | On Change | velocidad > límite zona | eco-score |
| 250 | Trip | High | On Change | trip start (ignition+movement) o end | trip-transitions |
| 155 | Geofence Zone (1-50) | High | On Change | entrada/salida geofence trip-defined | trip-transitions |

**Configuración específica de AVL 247 (Crash)**:
- Sección: **Features → Crash Detection**
- Status: Enable
- Crash Trace: Enable (envía hasta 1000 records al recibir crash)
- Records Before Crash: 100
- Records After Crash: 50
- G-Force Threshold: 2.5g (default Teltonika)

**Configuración específica de AVL 318 (GNSS Jamming)**:
- Sección: **Features → GNSS Jamming**
- Status: Enable
- Sensitivity: Default (medium)

**Configuración específica de AVL 252 (Unplug)**:
- Sección: **Features → Unplug Detection** o equivalente
- Status: Enable
- Voltage threshold: 1000 mV (1V) — debajo de esto = unplug confirmado.

---

## §4 — SMS Fallback (Wave 2 Track B4)

Sección: **GSM → SMS / Call Settings**

| Parámetro | Valor | Nota |
|---|---|---|
| SMS Send Number | `+19383365293` | Número Twilio configurado en §1.1 del runbook. |
| SMS Trigger | Panic events only | Crash (247), Unplug (252), GNSS Jamming critical (318). NO bajar a High events — sería mucho ruido. |
| SMS Body Format | Custom | Ver §4.1 abajo. |

### §4.1 Formato canónico Booster del SMS

El parser en `apps/sms-fallback-gateway/src/parser.ts` espera este
formato exacto (separador `|`):

```
BSTR|<IMEI>|<TIMESTAMP_ISO>|<LAT>,<LON>|<SPEED_KMH>|<RAW_VALUE>|<AVL_ID>
```

Ejemplo (Crash detectado):

```
BSTR|863238075489155|20260507T120000|-33.456900,-70.648300|0|1|247
```

**Configuración en el Configurator**: usar **SMS Macros** (algunos
firmwares Teltonika lo llaman "SMS Templates") con expansiones:

```
BSTR|%IMEI%|%TIMESTAMP%|%LAT%,%LON%|%SPEED%|1|%AVL_ID%
```

Verificar en la doc del firmware del FMC150 los exactos macros
soportados — varía por versión. Si la versión no soporta macros, hay
que cargar el formato a mano via SMS template fijo y aceptar que solo
funciona si el AVL ID es uno conocido.

---

## §5 — Crash Trace upload (Wave 2 Track B3)

Sección: **Features → Crash Detection → Crash Trace**

| Parámetro | Valor |
|---|---|
| Crash Trace Enable | True |
| Records Before Crash | 100 |
| Records After Crash | 50 |
| Send Mode | TCP (al gateway primary) |

El packet completo (~1000 records) viaja al gateway, que lo detecta
por `eventIoId=247 priority=panic` y publica al topic `crash-traces`
(no al `telemetry-events` regular). El processor consume y persiste a
`gs://booster-ai-494222-crash-traces-prod/` (CMEK + retention 7 años)
+ inserta índice en BigQuery `telemetry.crash_events`.

---

## §6 — Wave 3 (TLS + DR backup) — solo después de G2.3 verde

NO aplicar hasta que:
- [ ] G2.3 cerrado (load test PASS — ver runbook §6.1).
- [ ] Wave 2 estable >7 días sin alertas P0/P1.
- [ ] cert-manager produciendo certs Let's Encrypt para
      `telemetry-tls.boosterchile.com` (runbook §3.2).
- [ ] Service `telemetry-tcp-gateway-tls` en K8s con IP estática
      reservada y `loadBalancerIP` en el manifest.

Cambios a aplicar entonces:

### §6.1 Server Mode primary → TLS

Sección: **GPRS → Server Settings**

| Parámetro | Valor Wave 3 |
|---|---|
| Server Address (primary) | `telemetry-tls.boosterchile.com` |
| Server Port (primary) | `5061` |
| TLS Encryption (primary) | Enable |
| TLS CA Certificate | Subir Let's Encrypt root (ISRG Root X1) |

### §6.2 Backup Server (DR region us-central1)

| Parámetro | Valor |
|---|---|
| Server Mode (backup) | Backup |
| Server Address (backup) | `telemetry-dr.boosterchile.com` |
| Server Port (backup) | `5061` |
| TLS Encryption (backup) | Enable |
| Backup Trigger | 5 timeouts consecutivos al primary → switchover |

---

## §7 — Verificación post-push (checklist)

Después de hacer push de la cfg al device:

1. **Handshake IMEI** — primer log esperado en gateway:
   ```bash
   kubectl logs -n telemetry deployment/telemetry-tcp-gateway --tail=100 \
     | grep "<imei>"
   ```
   Esperado: `"handshake IMEI completado"` con el IMEI del device.

2. **Primer AVL packet con 14 Low Priority IDs**:
   ```sql
   SELECT timestamp_device, prioridad,
          jsonb_object_keys(io_data) AS avl_id
   FROM telemetria_puntos
   WHERE imei = '<imei>'
   ORDER BY timestamp_device DESC
   LIMIT 50;
   ```
   Esperado: jsonb_object_keys debe incluir `16`, `21`, `24`, `66`,
   `67`, `68`, `69`, `80`, `181`, `182`, `199`, `200`, `239`, `240`.

3. **Min Period Moving funcionando**: con vehículo en marcha, debe
   haber records cada ~30s (no más frecuente, no menos).

4. **Network Ping**: el gateway no debe reportar `"connection idle
   timeout"` para este IMEI durante la primera hora.

5. **Eventos Panic NO disparados** (verificación negativa):
   ```sql
   SELECT COUNT(*) FROM telemetria_puntos
   WHERE imei = '<imei>' AND prioridad = 2;
   ```
   Esperado: 0. Si > 0 al primer push, hay algo mal calibrado
   (probable: Crash sensitivity o Unplug threshold mal seteado).

6. **Records con prioridad=1 (High)**: pueden empezar a aparecer
   conforme el conductor maneja (Trip start, Green Driving). Es OK
   verlos, pero NO deben dispararse stack de Panic events.

---

## §8 — Rollback rápido

Si el device empieza a comportarse mal tras el push (ej. CPU 100% del
device, no manda records, batería se drena):

1. **Cargar cfg Wave 1 backup** desde Configurator (la que tenía
   antes — guardarla siempre antes del Wave 2 push).
2. Push.
3. Verificar que records vuelven a llegar al gateway con la cfg vieja.

Si el problema persiste: device tiene problema físico (no es la cfg).
Reportar al integrador / contactar support Teltonika con el IMEI y
firmware version.

---

## Referencias

- Spec oficial Teltonika FMC150 AVL Parameters:
  https://wiki.teltonika-gps.com/view/FMC150_Teltonika_Data_Sending_Parameters_ID
- Spec Codec 8 / Codec 8 Extended:
  https://wiki.teltonika-gps.com/view/Codec
- Catálogo IDs en código:
  - `packages/shared-schemas/src/avl-ids/low-priority.ts` (14 Low Priority).
  - `packages/shared-schemas/src/avl-ids/high-panic.ts` (10 eventuales).
- Runbook deploy Wave 2/3: `docs/runbooks/wave-2-3-deploy.md`.
- ADR 005 telemetry-iot: `docs/adr/005-telemetry-iot.md`.
