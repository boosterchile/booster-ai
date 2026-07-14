# Hallazgos — Auditoría contrato telemetría FMC150 ↔ Booster AI

**Fecha:** 2026-07-13 · **Alcance:** Fases A–C del brief (`~/Downloads/brief-v2-auditoria-telemetria-fmc150.md`).
**Naturaleza:** auditoría READ-ONLY. No se modificó infra, Terraform, cluster, `.cfg`, ni se desplegó nada.
**Regla de evidencia:** cada afirmación lleva `archivo:línea` o salida literal de comando. Lo no comprobable se marca **NO VERIFICADO**.

**Documentos de esta auditoría:**
- `hallazgo-distancia-medida-vs-estimada.md` — **F0-0, el hallazgo más grave**: distancia real (GPS Teltonika + app) descartada; huella calculada con estimación. Incluye corrección del gate backhaul §6.4 y propuestas A/B.
- `delta.md` (Fase E) — habilitado vs presente vs consumido; hueco CAN + lecturas muertas (temp, crash-G).
- `mapa-avl.md` (Fase D) — catálogo de elementos AVL y consumidores.
- `adr-propuesto-contrato-telemetria-fmc150.md` — ADR propuesto (no ratificado) + decisiones que quedan al PO.

---

## Fase A — El 5027 (gate) · **RESUELTO con un tercer estado**

**Frase de cierre:** *el 5027 SÍ está vivo (listener siempre arriba, LB declarado con IP estática, host DNS-alcanzable, pod procesando AVL), NO es un LoadBalancer huérfano — pero solo 1 dispositivo (IMEI `863238075489155`) reportó en 24h, y no es verificable por cuál puerto entra.*

| # | Pregunta | Veredicto | Evidencia |
|---|---|---|---|
| 2 | ¿El repo declara el 5027? | **SÍ, plenamente. No es drift.** | Service `telemetry-tcp-gateway` LoadBalancer port 5027 `infrastructure/k8s/telemetry-tcp-gateway.yaml:208-234`; containerPort+env `:85-96`; IP estática TF `google_compute_address.telemetry_lb` `infrastructure/compute.tf:845-846` |
| 4 | ¿El pod escucha en 5027? | **SÍ, siempre.** TLS 5061 condicional. | `apps/telemetry-tcp-gateway/src/main.ts:111-120` (plainServer listen incondicional), `:175` (TLS condicional) |
| 3 | ¿Dispositivos reportando hoy? | **1 IMEI en 24h.** Puerto **NO VERIFICADO**. | Cloud Monitoring `telemetry/device_records_per_minute` → 1 serie: IMEI `863238075489155`, pod `telemetry-tcp-gateway-66b6987b9f-64bh9`. Sin label de puerto (`infrastructure/telemetry-monitoring.tf:38-52`); gateway no loguea `localPort`/TLS-vs-plain (`connection-handler.ts:93-101`) |
| 1 | ¿Tiene endpoints el 5027? | **kubectl bloqueado.** Respaldo fuerte: sí (pod vivo + selector compartido). | Control plane `34.176.77.88` inalcanzable (timeout, authorized-networks). Ambos Services comparten `selector: app: telemetry-tcp-gateway` (`:229`,`:259`) |

**Discrepancia con el "contexto verificado" del brief §1:** el brief afirma *"El 34.176.238.106 no tiene registro DNS conocido"* → **incorrecto**. `dig telemetry.boosterchile.com → 34.176.238.106` (la IP del LB plano). El canal en claro es **DNS-alcanzable hoy**.

**Naturaleza del 5027:** dual-stack intencional de la migración Wave 3 (plain 5027 pre-existente + TLS 5061), documentado en `docs/handoff/2026-05-10-wave-3-tls-ready.md`, `docs/adr/040-*`, `config.ts:99`. No es huérfano ni drift; es superficie legacy en claro **viva y alcanzable**, con exposición efectiva hoy acotada a ≤1 device de canal desconocido.

---

## Fase B — El contrato AVL

### B.1 Codec — **El parser SÍ soporta Codec 8 Extended.** No es "Codec 8 puro".

Detecta el codec por el byte ID y ramifica toda la estructura:
- `packages/codec8-parser/src/avl-packet.ts:43-44` `CODEC_8=0x08`, `CODEC_8E=0x8e`; `:74-80` valida id + `isExtended`
- `:157-158` Event IO ID/Total de 2 bytes en 8E (1 en Codec 8); `:164-166` counts+IDs de 2 bytes; `:188-196` sección NX variable-length **exclusiva de 8E**
- El `.cfg` declara `Data Protocol = Codec 8 Extended` (brief §1) → **compatible**. Riesgo "parsea basura" del brief §1 **no aplica a este parser** (aplica solo a los scripts de load-test que arman Codec 8 a mano, no al ingest).

### B.2 ACK AVL — **Se ACK-ea DESPUÉS de confirmar el publish a Pub/Sub.** Sin pérdida silenciosa.

- `connection-handler.ts:253-260`: publica cada record y `await Promise.all(publishes)` (**espera confirmación de Pub/Sub**)
- `:267`: `socket.write(encodeAvlAck(packet.recordCount))` — ACK recién **tras** resolver los publishes
- Fallo de publish → `Promise.all` rechaza → `catch` `:278-288` → `encodeAvlAck(0)` + `socket.destroy()` → el device **reenvía** (semántica at-least-once). No hay pérdida silenciosa.
- **Matiz (comentario engañoso):** `:263-266` dice "*si fallara la publish… igual respondemos el total*", pero el código ACK-ea **0**, no el total. La conducta del código (ACK 0 + reintento) es la segura; el comentario contradice al código. Efecto real: en fallo parcial de un batch multi-record puede haber **duplicados** (no pérdida) → dedup natural aguas abajo por `UNIQUE (imei, timestamp_device)` (`persist.ts:91`).
- ACK encoder: `avl-packet.ts:218-225` (4 bytes BE = record count).

### B.3 Handshake IMEI + enrollment — **diagnóstico corregido** (el framing previo "open enrollment persiste todo" era FALSO)

- Handshake implementado: `connection-handler.ts:161-191` (`parseImeiHandshake` → `resolveImei` → `encodeImeiAck(true)`; parse inválido → `encodeImeiAck(false)`+destroy).
- **La allowlist SÍ existe = `vehiculos.teltonika_imei`, aplicada EN PERSIST** (no en la conexión). Camino del IMEI desconocido:
  - Wire: `imei-auth.ts:53-104` — sin match → upsert `dispositivos_pendientes` (rate-limited `:62-68`), `vehicleId=null`, no cierra; ACK true; publica a Pub/Sub con `vehicleId=null` (`connection-handler.ts:253-260`). *Open enrollment* **solo en la bandeja** (UX del instalador), no en la data.
  - **Posiciones + green-driving → CERRADO:** `persist.ts:42-58` re-busca por IMEI en `vehiculos`; sin match → **descarta** (warn, `inserted:false`); `persist-green-driving.ts:57` skip sin `vehicleId`. Ningún dato de device desconocido entra a `telemetria_puntos`. → **documentar, no hay fix.**
- **Residuo 1 — crash traces NO cerrado (fix acotado):** `persist-crash-trace.ts:126-150,171-185` persiste **igual** con `vehicleId=null` en GCS `unassigned/{imei}/` + fila BigQuery. Un device no-registrado escribe forensics. → gatear en `vehicleId` o política de retención de `unassigned/`.
- **Residuo 2 — el agujero real = spoofing de un IMEI conocido:** el IMEI es la única credencial, viaja en claro por 5027 y **no es secreto**; el TLS 5061 es **server-auth only** (`main.ts:154 requestCert:false`) → un atacante con un IMEI registrado válido inyecta telemetría a ese vehículo **aun sobre TLS**. Hoy **no hay autenticación del device**. Se resuelve con **mTLS / client-cert por device** (ligado a la CA privada — ADR punto 3), no con un flag de allowlist.

### B.4 Elementos AVL — parser **agnóstico**; semántica en catálogo aparte

- El parser NO interpreta IDs: entrega `{id, value, byteSize}` crudos (`tipos.ts:13-17, 21-38`).
- El wire-schema `telemetry-record.ts:38-48` viaja los `io.entries` **crudos** (id/value/byteSize genéricos) + GPS a campos nombrados + `eventIoId`.
- Los IDs con **decodificador semántico** se detallan en `mapa-avl.md`. Set con **consumidor de producción**: GPS (estructural), IO 72 (temp), IO 253/254/255 (green driving), IO 247+17/18/19 (crash). El resto del catálogo `avl-ids/` está definido y testeado pero **sin consumidor**.
- **NO VERIFICADO:** los IDs 17/18/19 (acelerómetro del crash trace) son **convención asumida**, no confirmada contra el device real (`crash-trace.ts:29-32, 140-143` "*Si el device productivo usa IDs distintos, ajustar… Validar contra fixture real en QA*").

---

## Fase C — El DR

### C.1 Topic — **El DR publica al MISMO topic global `telemetry-events`.** No hay topic propio.

- Env DR `infrastructure/k8s/telemetry-tcp-gateway-dr.yaml:98-103`: `GOOGLE_CLOUD_PROJECT="booster-ai-494222"`, `PUBSUB_TOPIC_TELEMETRY="telemetry-events"`, `PUBSUB_TOPIC_CRASH_TRACES="crash-traces"` — **idénticas** al primario (`telemetry-tcp-gateway.yaml:97-105`).
- `infrastructure/dr-region.tf:4-8` (explícito): "*Pub/Sub es global → ambos gateways publican al mismo topic, processor único en primary*".
- `infrastructure/messaging.tf:22-31`: topic `telemetry-events` declarado **una sola vez**, sin región. No existe topic DR.

### C.2 Destino — **Convergen a la MISMA base.** Un solo destino.

- Una sola Cloud SQL: `infrastructure/data.tf:109` `google_sql_database_instance "main"`, región `southamerica-west1`. Sin réplica ni segunda instancia.
- Un solo processor, en el primario: `infrastructure/compute.tf:466-519` (`booster-ai-telemetry-processor`, `region=var.region`). **No** hay processor en el DR (cloudbuild DR solo despliega el gateway).
- Una sola subscription: `messaging.tf:214-247` `telemetry-events-processor-sub` (default en `apps/telemetry-processor/src/config.ts:8`).
- **Flujo:** device en failover → DR gateway → topic global → **único** processor primario → **única** `telemetria_puntos`. Sin bifurcación de destino.

**Hallazgo agravante (DR incompleto):** `docs/adr/058-*:43-46` — "*aun con el gateway DR desplegado, Cloud SQL NO tiene réplica cross-region… ante una caída regional completa, el gateway DR levantaría sin base de datos*". Y el DR está **cold** (`telemetry-tcp-gateway-dr.yaml:45` `replicas: 0`). Es decir: el DR de **cómputo** escribe a una BD que **no** es DR.
- Consecuencia para `Server Mode = Backup` del `.cfg`: durante una caída **regional completa** (el escenario para el que existe el DR), los records que el device manda al DR quedan en el topic sin consumidor hasta que el primario vuelva. Si el outage supera la retención de la subscription → **hoyos en la serie histórica** → la reconstrucción de viajes/huella los hereda. (Si es solo el gateway primario el caído pero la región está viva, el path DR sí converge.)

### C.3 Gobernanza / residencia — **NO VERIFICADO: no existe ADR que lo cubra.**

- Los ADR que tocan us-central1 lo tratan **solo** como SLA/costo/operación, nunca residencia ni transferencia internacional: `034:74`, `035:53`, `040:38`, `058:39,55-56,80-85`.
- **Ley 21.719** aparece únicamente en `docs/adr/068-*` (consentimiento ESG, schema de `consents`) — no menciona DR, us-central1, telemetría ni transferencia a EE.UU.
- **Ley 19.628** en ADRs 006/007/010/012/028/051/052/053/062/064 — ninguna ligada al DR/telemetría.
- El modelo de consentimiento (`docs/legal/modelo-consentimiento-esg-v1.md:102-106,155-157`) tiene la sección "Transferencias Internacionales" con **placeholder sin rellenar** (`[INDICAR PROVEEDORES / PAÍSES…]`).
- **Falta para verificar/decidir (PO):** un ADR que reconozca que el DR en us-central1 saca geolocalización de conductores chilenos fuera de Chile, documente las garantías bajo Ley 21.719/19.628, y complete el país/proveedor en el consentimiento. Es decisión del PO (brief §4), aquí solo se reporta el gap.

---

## Fase F — Higiene

### F.1 Supresión `.trivyignore` (~L72) — **sigue justificada**
Es `GCP-0050` ("service account defined for GKE nodes"), aplicada a los clusters Autopilot `telemetry`/`telemetry_dr` (`.trivyignore` ~L68-90). Razón: en Autopilot el operador **no puede** customizar el node SA (`node_config.service_account` lo ignora el provider; `auto_provisioning_defaults.service_account` también); la protección real la da **Workload Identity** (configurado — verificado en Fase A: cert-manager ACME DNS-01 con WI) + node SA mínimo. Tiene cláusula "reabrir si → migración a GKE Standard / Trivy detecte Autopilot". **No requiere acción.** (Contigua: `GCP-0033` CMEK vs CSEK del bastion, también justificada.)

### F.2 El `.cfg` **NO está versionado** — debería estarlo
`git ls-files` no trackea ningún `.cfg` (solo docs: ADR-040 y `docs/research/teltonika-fmc150/*.md`, que son notas, no el archivo ni su set de elementos diffeable). El binario vive solo en `~/Downloads/FMC150_Truphone_Google.cfg`.
- **Por qué importa:** el `.cfg` define el **esquema de entrada** del sistema. Deshabilitar un elemento **corta una serie**; cambiar un coeficiente de corrección de combustible cambia la **semántica de datos históricos** sin cambiar el tipo. Un cambio al `.cfg` es una **migración de esquema**, no un ajuste de GUI.
- **Recomendación:** versionar en el repo (a) el binario `.cfg` y (b) un export legible/diffeable del set de elementos habilitados (el `mapa-avl.md` cumple ese rol), para que cada cambio pase por review como cualquier migración.

## Fuentes de acceso usadas
- Repo (read-only): `rg`, `Read`.
- Cloud Monitoring vía REST + token ADC (kubectl al cluster **inalcanzable** desde este host; Logging API dio 429 por quota del proyecto default). Detalle en la memoria `gcp-read-access-mechanics-2026-07`.
