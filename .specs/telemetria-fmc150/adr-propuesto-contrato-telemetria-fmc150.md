# ADR-PROPUESTO — Contrato de telemetría FMC150 ↔ Booster AI

> **Estado: PROPUESTA (no decisión).** Para promover a `docs/adr/ADR-XXX-contrato-telemetria-fmc150.md` con número real **solo tras aprobación del PO** (docs/adr/* está protegido + CI de numeración). Este documento sintetiza la auditoría `.specs/telemetria-fmc150/{hallazgos,mapa-avl,delta}.md` (2026-07-13) y propone el contrato; las decisiones marcadas **[PO]** no se toman aquí.

## Contexto (verificado)

Ingesta Teltonika FMC150 → `telemetry-tcp-gateway` (GKE Autopilot) → Pub/Sub `telemetry-events` → `telemetry-processor` → Cloud SQL `telemetria_puntos` + BigQuery. 1 device real en producción (`863238075489155`, 260k filas, 2+ meses). Auditoría encontró: el pipeline de telemetría y el cálculo de huella están **desconectados**; varios elementos AVL habilitados no se consumen; dos consumidores leen elementos que el device **no emite**.

## Decisiones propuestas (el contrato)

### 1. Codec — **Codec 8 Extended**. Sin cambio.
El parser soporta 8E dinámicamente (`avl-packet.ts:44,80,157-196`). El `.cfg` ya declara 8E. ✔

### 2. ACK AVL — **ACK después de confirmar Pub/Sub**. Mantener; corregir comentario.
`connection-handler.ts:260→267` ya ACK-ea tras `await Promise.all(publishes)`. Corregir el comentario engañoso `:263-266` (dice "responde el total"; el código responde 0 en fallo — que es lo correcto). Semántica at-least-once + dedup `UNIQUE(imei,timestamp)`. ✔

### 3. TLS + **autenticación de device (mTLS)** — es la MISMA decisión que CA privada
Técnico: **TLS 1.2** (límite del FMC150, no hace 1.3). Sin cambio ahí.
**[PO] — CA privada + client-cert por device (mTLS) = autenticación de device.** Hoy el TLS es **server-auth only** (`main.ts:154 requestCert:false`): el servidor se autentica, el device **no**. La única "credencial" del device es su **IMEI**, que viaja en claro por 5027 y **no es secreto** (etiqueta física, configs) → un atacante que presenta un IMEI **registrado válido** inyecta telemetría a ese vehículo, **incluso sobre TLS**. Una CA privada con **client-cert por device (mTLS)** lo resuelve de raíz: cada device presenta su propio certificado y el IMEI deja de ser credencial. **CA privada vs Let's Encrypt y device-auth son la misma decisión** — resolverlas juntas. Más grave de lo estimado: hoy **no hay autenticación del device**.

### 4. Puertos — **retirar el 5027 (plano) una vez confirmada la migración TLS**.
El 5027 está vivo, declarado y DNS-alcanzable (`telemetry.boosterchile.com`), pero es geolocalización **en claro** sobre red móvil de terceros. Hoy: 1 device, canal no verificable (gap de instrumentación: el gateway no loguea `localPort`). **Propuesta:** (a) instrumentar el puerto/canal por conexión; (b) confirmar que ningún device usa 5027; (c) retirar el Service plano. **[PO]** aprueba el retiro.

### 5. Server Mode — **[PO]**: `Backup` vs `Duplicate` vs `Disabled`.
Matiz de la auditoría: el DR (us-central1) publica al **mismo** topic global y converge a la **única** Cloud SQL, que **no tiene réplica cross-region** y hoy está `cold` (`replicas:0`) (`ADR-058:43-46`). En caída **regional** completa, los records al DR quedan en el topic sin consumidor hasta que el primario vuelva → riesgo de hoyos si el outage supera la retención de Pub/Sub. `Duplicate` no ayuda mientras el destino sea único. Decisión debe considerar: primero **DR de datos** (réplica/lectura cross-region), después el modo del device.

### 6. Enrollment / allowlist — **corrección de diagnóstico** (era falso "open enrollment persiste todo")
La allowlist **ya existe** = `vehiculos.teltonika_imei`, aplicada **en persist** (no en la conexión):
- **Posiciones (`telemetria_puntos`) + green-driving: CERRADO.** IMEI no registrado → `persist.ts:42-58` descarta (warn, `inserted:false`); `persist-green-driving.ts:57` hace skip. Ningún dato de device desconocido entra a la tabla. El "open enrollment" solo existe en el **wire/bandeja** (`dispositivos_pendientes`), que es UX intencional (el instalador ve el device aparecer). → **documentar**, no hay fix.
- **Crash traces: NO cerrado (fix acotado).** `persist-crash-trace.ts:126-150,171-185` persiste **igual** con `vehicleId=null`, en GCS `unassigned/{imei}/` + fila BigQuery. Un device no-registrado (o spoofeado) escribe forensics. → **fix:** gatear `persistCrashTrace` en `vehicleId`, **o** decisión explícita + **política de retención/limpieza** de `unassigned/`.
- **El agujero real = spoofing de un IMEI conocido**, no la allowlist. Se resuelve con **mTLS (punto 3)**: la allowlist ya está; lo que falta es que el IMEI deje de ser la credencial.

### 7. Conjunto de elementos AVL habilitados — **alinear a consumo** (ver `mapa-avl.md`/`delta.md`)

| Acción | Elementos | Justificación (evidencia) |
|---|---|---|
| **Mantener** | GPS; 247 crash; 253/254/255 green driving | Tienen consumidor de producción vivo |
| **Ya habilitado; arreglar hardware** | **CAN combustible** (Fuel Consumed/Level, RPM, Engine Load, VIN…) + **16/24** | `.cfg` CAN ya habilitado y operativo; no llegan por la capa CAN-hardware/OEM (archivo OEM `Desconocido ID:0` / cableado), en arreglo por FOTA (opción 2). Necesarios para `exacto_canbus` / distancia GLEC medida |
| **Habilitar (F0-1, decidido)** | **72** Dallas Temp 1 | Sensor Dallas se instala en días → **habilitar IO 72 en el `.cfg` ahora** (antes de la instalación, punto 11). **NO** retirar `temperatura_c`. Hoy se consume (`vehiculos.ts:204`) y no llega → `temperatura_c` null hasta habilitar + instalar |
| **Confirmar IDs + habilitar, O retirar consumidor (F0-2)** | **acelerómetro** (¿17/18/19?) | Crash trace lo consume pero **nunca llega** → `peakGForce=0`; IDs asumidos sin verificar |
| **Candidatos a deshabilitar** *(revisar intención de producto, no automático)* | 239/240/66/199/200/21/69/181/182/80/241/388/175/249/250/251/257/317/318 | Habilitados y llegando, **sin consumidor**; pagan MB. Cautela: 16/24/66/239/240 son de valor inminente |

### 8. Orden de cableado de la huella medida (no hay backfill)
El `.cfg` con CAN I/O ya está cargado y operativo; el bloqueo es la capa CAN-hardware/OEM (archivo OEM `Desconocido ID:0` / cableado), en arreglo por FOTA. Por eso el trabajo se **paraleliza**, no se secuencia:
- **Backend, AHORA (no depende del `.cfg`):** (a) agregar los IDs CAN al catálogo `avl-ids/`; (b) construir `metodo:'exacto_canbus'` en `calcular-metricas-viaje.ts`. Queda listo para cuando el CAN empiece a llegar.
- **En paralelo:** cargar **Send LKV** en el `.cfg` (forward-only, evita litros fantasma con bus caído) + arreglar el archivo OEM/cableado por FOTA.
- **Verificar** cuando el CAN aparezca en `io_data` (punto 12).
El doble camino (con Teltonika mide / sin Teltonika estima) es lo que **ADR-028 ya modela**.

### 9. Versionar el `.cfg` (higiene, Fase F)
Versionar el binario + un export diffeable del set de elementos (rol que cumple `mapa-avl.md`). Un cambio al `.cfg` = migración de esquema → review obligatorio.

### 10. Referencia rota (higiene)
`apps/api/drizzle/0005_*.sql:58-60` apunta a `apps/api/src/services/io-catalog.ts` (no existe); el catálogo vive en `packages/shared-schemas/src/avl-ids/`. Corregir el comentario.

### 11. Principio: capacidad (`.cfg`) ≠ dato (hardware) — habilitar antes de que el hardware esté listo
El `.cfg` habilita **capacidad**; el hardware entrega el **dato**. Son dos capas **independientes**, y esta auditoría lo probó en ambas direcciones:
- **CAN:** `.cfg` habilitado + hardware sin decodificar → 0 elementos en 260k filas.
- **Dallas:** `.cfg` deshabilitado + sensor por instalarse → si no se habilita ahora, el sensor llega y el dato tampoco existe.
**Regla operativa:** habilitar el elemento en el `.cfg` **antes** de que el hardware esté listo. Costo de habilitar de más = **bytes**; costo de habilitar de menos = **dato que no se recupera retroactivamente**. La asimetría manda: ante la duda, habilitar.

### 12. Instrumentación: elemento habilitado ausente en `io_data` = alerta, no silencio
Hoy **no existe** un chequeo que compare lo habilitado en el `.cfg` contra lo presente en `io_data` — eso permitió que el hueco CAN durara **2 meses** sin que nadie lo notara. Un elemento habilitado que no aparece es una **alerta**, no un silencio.
**Propuesta (mínima):** job periódico (Cloud Scheduler → Cloud Run job, o scheduled query) que:
1. Lee el set de AVL IDs **permanentes** habilitados en el `.cfg` (fuente: el `.cfg` versionado + export diffeable, punto 9).
2. Compara contra los IDs presentes por device: `SELECT DISTINCT jsonb_object_keys(io_data) FROM telemetria_puntos WHERE timestamp_device > now() - interval 'N days'`.
3. **Alerta** (Cloud Monitoring, patrón de `infrastructure/telemetry-monitoring.tf`) sobre los **habilitados-pero-ausentes**.
**Matiz de diseño (crítico):** aplica solo a I/O **permanente** (Low priority periódico: CAN combustible, Dallas 72, voltaje 66, odómetro 16…), que debe aparecer en cada record. **NO** a I/O **eventual** (crash 247, green driving 253/254/255, geofence, jamming): son legítimamente esporádicos y su ausencia no es señal de falla. Sin este matiz, el chequeo genera falsos positivos y se ignora.

### 13. `consumo_l_por_100km_base` NULL — requisito de GLEC §6.4 completo, hoy omitido en silencio
**77% de la flota** (10 de 13 vehículos) tiene `consumo_l_por_100km_base` **NULL** (incluido KZBB26; solo 3 lo declaran). Efecto hoy: huella en modo `por_defecto` (genérico). Efecto **con CAN**: `exacto_canbus` vuelve irrelevante el consumo base para el **loaded leg** (usa combustible medido, `exacto-canbus.ts:48-50`), **pero** el **empty backhaul (GLEC §6.4)** sigue gateado en `consumoBasePor100km != null` (`exacto-canbus.ts:70`) → si es NULL, la atribución del retorno vacío **se omite en silencio**. **El silencio es el problema.**
**Propuesta:** (a) declarar `consumo_l_por_100km_base` por vehículo (requisito para §6.4 completo); **o** (b) que el certificado marque explícitamente **"backhaul no atribuido"** en vez de omitirlo callado. Nunca omisión silenciosa.

## Decisiones que quedan al PO (no se toman aquí)
- **[PO]** CA privada + **mTLS / autenticación de device** (punto 3) — misma decisión; resuelve el spoofing de IMEI de raíz. Hoy no hay auth de device.
- **[PO]** Retiro del 5027 (punto 4).
- **[PO]** Crash-trace `unassigned/`: gatear en `vehicleId` o política de retención (punto 6).
- **[PO]** Declarar `consumo_l_por_100km_base` (77% NULL) o marcar "backhaul no atribuido" explícito (punto 13).
- **[PO]** Server Mode + DR de datos cross-region (punto 5).
- **[PO]** Gobernanza Ley 21.719/19.628: el DR en us-central1 saca geolocalización de conductores chilenos fuera de Chile y **no existe ADR que lo cubra** (hallazgos §C.3); completar además el país/proveedor en el modelo de consentimiento.

## Consecuencias
- **Positivas:** contrato explícito y diffeable; elementos AVL alineados a consumo; dos features muertas (temp, crash-G) dejan de aparentar funcionar; camino claro a huella medida.
- **Costo:** trabajo backend (wire `exacto_canbus`, gate de crash-trace, instrumentación de puerto/detección); mTLS + CA privada; decisiones de gobernanza del PO; posible re-firma de compliance.
- **Riesgo si no se actúa:** **sin auth de device** (spoofing de IMEI inyecta a vehículos reales, aun sobre TLS); se sigue vendiendo/asumiendo features vacías (cadena de frío, forensics de impacto); crash-traces de devices no-registrados en `unassigned/` sin límite; **backhaul GLEC §6.4 omitido en silencio en el 77% de la flota**; la huella queda estimada indefinidamente; y persiste superficie de datos personales en claro + transferencia internacional sin ADR.
