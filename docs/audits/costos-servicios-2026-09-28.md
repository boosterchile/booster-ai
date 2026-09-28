# Revisión de costos — servicios contratados por Booster

**Fecha**: 2026-09-28
**Billing account**: `019461-C73CDE-DCE377` (factura en CLP)
**Proyecto principal**: `booster-ai-494222`
**Dólar observado usado para pasar a CLP**: 964 CLP/USD (publicado para el 2026-09-28). El dashboard de admin usa el tipo de mindicador.cl; si difiere, manda el del dashboard.
**Alcance**: lo que Booster paga cada mes (GCP, Twilio, Google Workspace, Datadog y proyectos legacy del mismo billing). No es el modelo comercial de comisiones (ADR-079).

**Dónde se ve en el producto**: Platform Admin → «Observabilidad de plataforma» (`/app/platform-admin/observability`). La pestaña **Costos** lee el billing export de BigQuery (GCP, por servicio, por proyecto y por SKU). La pestaña **Uso** lee Twilio y los asientos de Google Workspace. Salud, Capacity y Forecast no son la factura: sirven para decidir si un recorte cabe.

Esta revisión no pudo leer la factura viva. En este entorno no hay `gcloud` ni credenciales del proyecto de producción (la variable de proyecto apunta a `booster-ai-dev` y no hay metadata de GCP). Las cifras de abajo son la lista de precios pública aplicada a lo que Terraform y los manifiestos declaran hoy, más lo que ya se midió en mayo y junio. El número que cierra es el de la pestaña Costos. Si un SKU de esta lista no aparece ahí, el recorte ya está en la factura. Si aparece un SKU que esta lista no nombra, ese es el siguiente candidato.

---

## 1. Qué ya se recortó (no volver a proponerlo)

La auditoría del 2026-05-13 estimaba ~USD 920/mes. ADR-034 y ADR-058 (aplicados en prod el 2026-06-06, según el handoff de esa sesión) ya bajaron el piso:

| Palanca | Estado en el código hoy |
|---|---|
| Cloud SQL `db-custom-2-7680` REGIONAL → `db-custom-1-6144` ZONAL | `cloudsql_tier` default y `cloudsql_high_availability = false` |
| Redis `STANDARD_HA` → `BASIC` 1 GB | `redis_tier` default `BASIC` |
| Cloud Run web, api, whatsapp-bot y marketing con `min_instances=1` | api y web en 0; marketing eliminado el 2026-05-13 |
| Gateway primary 2 réplicas → 1; DR 2 → 0 | `telemetry-tcp-gateway.yaml` `replicas: 1`; el de DR `replicas: 0` |
| `log_temp_files` de Cloud SQL | `-1` (apagado) |
| CUDs a 3 años | pospuestos a propósito (ADR-058, palanca A4) |

Volver a HA, a Redis con failover o a `min_instances=1` en el api es la reversión de ADR-058, y solo corresponde al firmar el primer contrato B2B con SLA.

---

## 2. Lo que sigue contratado

### 2.1 Piso fijo de `booster-ai-494222` (se paga con 0 viajes)

Tarifas de lista consultadas el 2026-09-28 en las páginas de precios de Cloud Run, GKE y Cloud SQL. Cloud Run publica USD 0,000018 por vCPU-segundo y USD 0,000002 por GiB-segundo en facturación por instancia, y Santiago está en ese conjunto de regiones. El fee de clúster GKE es USD 0,10 por clúster por hora, igual en Autopilot. 730 horas/mes.

| Servicio | Por qué sigue | USD/mes | CLP/mes (×964) |
|---|---|---|---|
| **Dos clústeres GKE Autopilot** (`booster-ai-telemetry` en Santiago y `booster-ai-telemetry-dr` en `us-central1`) | El fee se cobra aunque el DR esté en 0 réplicas. Encima van los pods de sistema (Autopilot los factura) y, en el primario, el gateway (0,5 vCPU + 1 Gi) más cert-manager | 220–310 | 212.000–299.000 |
| **Cloud NAT × 2** (Santiago y `us-central1`) | USD 0,044/h por gateway, más GB procesados. El de DR existe solo para el clúster frío | 65–90 | 63.000–87.000 |
| **`telemetry-processor` siempre encendido** | `min_instances=1`, `cpu=2`, `cpu_idle=false`. 2 vCPU × 0,000018 × 2.628.000 s = USD 95; 1 Gi suma USD 5 | ~100 | ~96.000 |
| **Cloud SQL** `db-custom-1-6144` ZONAL, 50 GB SSD, PITR, 30 días de backup | Lista Iowa: 1 vCPU × 0,0413 × 730 + 6 GB × 0,007 × 730 + disco. Santiago puede ir más caro; el SKU del dashboard manda | 70–140 | 67.000–135.000 |
| **Memorystore Redis BASIC 1 GB** | El mínimo de Memorystore es 1 GB. En mayo usaba ~6 MB. Ya no hay tier más barato dentro de Memorystore | 35–55 | 34.000–53.000 |
| **Serverless VPC Access** `min_instances=2` | El mínimo del conector es 2. Sin él, Cloud Run no llega a Cloud SQL ni a Redis | 12–25 | 12.000–24.000 |
| **Load balancer HTTPS global** (2 forwarding rules: 443 y redirect 80) | USD ~0,025/h cada una | ~36 | ~35.000 |
| **Dos Network LB del gateway** (puertos 5027 y 5061, IPs `34.176.238.106` y `34.176.1.94`) | El TCP largo de Teltonika no cabe en Cloud Run. Cada forwarding rule regional suma otro ~USD 18 | ~36 | ~35.000 |
| **Bastion IAP** `e2-micro` | Acceso de operadores a Postgres. Barato y útil | ~8 | ~8.000 |
| **KMS, DNS, Artifact Registry, Scheduler, Pub/Sub, logs dentro del free tier** | Ruido de control plane de GKE ya está excluido (ADR-035) | 5–20 | 5.000–19.000 |
| **Suma del piso de este proyecto** | | **~590–820** | **~570.000–790.000** |

El budget declarado en Terraform es USD 500/mes (`monthly_budget_usd`). El piso de arriba lo puede estar pasando aunque no entre ningún camión nuevo. La pestaña Forecast lo dice contra ese presupuesto.

Cloud Run con `min_instances=0` (api, web, whatsapp-bot, sms-fallback, matching-engine, notification-service, document-service) no entra en el piso: se paga por request. Tres de ellos siguen en la imagen placeholder `gcr.io/cloudrun/placeholder` desde el 2026-07-12. Apagarlos ahorra casi nada; sí reduce superficie.

### 2.2 Lo que el dashboard parte en otra pestaña, o no muestra

| Servicio | Dónde verlo | Qué revisar |
|---|---|---|
| **Google Workspace** | Pestaña Uso | Asientos pagos vs. gente que entra. Cada asiento sin uso es el precio del plan (Starter/Standard/Plus) todos los meses |
| **Twilio (WhatsApp)** | Pestaña Uso | Saldo, número y categorías. Con el volumen actual (pocos mensajes de operación) el fijo del sender puede ser más grande que el uso |
| **Datadog** (`us5.datadoghq.com`) | Factura de Datadog, no el dashboard | ADR-071 lo dejó en infra + logs, con `containerCollectAll: true`, encima de Cloud Logging y Cloud Trace que ya existen. Si el agente está instalado en el clúster, cobra hosts y GB de log aunque nadie abra la UI |
| **`big-cabinet-482101-s3` (Booster 2.0)** | Pestaña Costos → por proyecto | El dominio ya no lo sirve (revisión `docs/audits/booster-2-0-2026-09-28.md`). En mayo eran ~USD 80–150/mes. Hoy no se pudo leer el billing: si el proyecto sigue linked, es piso sin audiencia |
| **`gen-lang-client-0486421631`** | Pestaña Costos → por proyecto | API key Gemini «Booster 1.0». En mayo era ~USD 0–5, pero una key sin tope sube sola |
| **Rutas, Geocoding, Places, Document AI, Gemini** | Pestaña Costos, SKU de esas APIs | En mayo Routes tenía 16 llamadas/30 días. Hay alertas de runaway en `api-cost-guardrails.tf`. No recortar: vigilar que no aparezcan en el top de SKUs |
| **Dominio `boosterchile.com` y `demo.boosterchile.com`** | Registrador, no GCP | El demo sigue resolviendo. El costo de DNS es despreciable; el costo es de producto (Slot 2), no de esta factura |
| **Teltonika** | Contrato de hardware / comodato (ADR-026) | No sale en el billing de GCP |

---

## 3. Palancas, en orden

Ninguna de estas se aplica desde este documento. `terraform apply`, borrar un proyecto y dar de baja un SaaS los ejecuta el PO. ADR-058 dejó el clúster DR a propósito; sacarlo pide una decisión nueva, no un apply silencioso.

### P1 — Sacar el DR frío

**Ahorro**: USD 145–190/mes (CLP 140.000–183.000). Es el fee del segundo clúster (~USD 73), sus pods de sistema, el Cloud NAT de `us-central1` (~USD 32 más datos) y la IP/LB de `telemetry-dr.boosterchile.com`.

**Por qué ahora**: el gateway DR está en 0 réplicas. Cloud SQL no tiene réplica en otra región, así que ese clúster nunca levantaba el producto entero ante una caída de Santiago. ADR-058 ya lo dijo. Conservar subnet, IP y clúster «por si hay que reactivar» igual paga el fee de Autopilot todos los meses. Reactivar desde Terraform es más lento (horas, no 15–40 minutos) y es el costo de esta palanca.

**Qué borrar, junto**: `google_container_cluster.telemetry_dr`, la subnet `booster-ai-dr-private`, `google_compute_router_nat.dr_nat`, la IP `telemetry_dr_lb` y el worker pool `booster-production-pool-dr`. El rango de peering interno de ese pool se queda: sacarlo recrea el peering de Cloud SQL. El gateway primario, su NAT y sus dos LB se quedan: sin ellos no hay TCP de Teltonika.

**No hacer**: comprar CUD de GKE o de Cloud Run antes de esta decisión. Congelaría el clúster que conviene apagar.

### P1 — Bajar el processor de 2 vCPU a 1 vCPU

**Ahorro**: ~USD 47/mes (CLP ~45.000). La mitad de los USD 95 de CPU. La memoria de 1 Gi se queda.

**Por qué no se apaga**: el consumer es pull de Pub/Sub. Con `min_instances=0` nadie tira de la suscripción y la telemetría se cae (incidente del 2026-06-07, ~26 h). `cpu_idle=false` también se queda: con CPU throttled entre requests el pull se muere de hambre. Lo que sobra es el segundo vCPU. La flota medida el 2026-09-22 era 8 vehículos con Teltonika.

**Riesgo**: si el CPU de esa instancia se pega a 100 % en la pestaña Capacity, no bajar. Con 8 dispositivos no debería.

### P1 — Cerrar Booster 2.0 si el proyecto todavía factura

**Ahorro**: USD 80–150/mes (CLP 77.000–145.000) si `big-cabinet-482101-s3` sigue vinculado, más USD 0–5 de `gen-lang-client-0486421631`. Si el desglose de 30 días ya está en cero, ese ahorro ya ocurrió.

**Qué se midió el 2026-09-28**: apex, www, app, api y demo responden Booster AI. Firebase `big-cabinet-482101-s3.web.app` responde «Site Not Found» (el mismo 404 que un proyecto inexistente: no prueba el delete). Los subdominios de rol no resuelven. El detalle y el orden de corte están en `docs/audits/booster-2-0-2026-09-28.md`.

**Cómo cerrarlo**: Costos → por proyecto, últimos 30 días. Costo > 0 y sin requests de usuarios: export de BigQuery si hace falta, después `gcloud projects delete` de los dos. Esta sesión no lo ejecuta: no hay ADC y el delete es irreversible.

### P2 — Datadog, solo si nadie lo usa

**Ahorro**: el de la factura Datadog (típico de un clúster chico con logs de todos los contenedores: decenas a un par de cientos de USD; el número real está en su billing, no aquí).

El gateway ya exporta traces a Cloud Trace con redacción de credenciales, y los logs van a Cloud Logging. Datadog se superpone (ADR-071, decisión C). Si en las últimas semanas nadie diagnosticó el gateway desde Datadog, desinstalar el agente (`containerCollectAll: true` es lo que más come) y dejar el secreto en Secret Manager hasta decidir. Volver a instalar es el runbook `infrastructure/k8s/setup-datadog.sh`.

### P2 — Asientos de Workspace y el sender de Twilio

Sin número hasta abrir la pestaña Uso. Criterio: asiento sin login en 30 días se baja de plan o se suspende; categoría de Twilio con costo y 0 mensajes se cancela. No tocar el sender si por ahí sale la activación de conductores (hoy el api en prod no tiene el content SID montado, así que conviene mirar el uso real antes de darlo de baja).

### P3 — No tocar, o el ahorro no paga el riesgo

| Idea | Por qué no |
|---|---|
| Cloud SQL a `db-custom-1-3840` o shared-core | En mayo la RAM usada era ~3,7 GB. 6 GB deja margen; 3,75 GB queda al límite. Shared-core no es el perfil de la única base. Mirar Capacity antes de cualquier cambio |
| Redis bajo 1 GB o sacarlo | Memorystore no baja de 1 GB. Sacarlo reescribe rate-limit, caché y el dashboard |
| VPC connector a 1 instancia | El mínimo de GCP es 2 |
| `min_instances=0` en `telemetry-processor` | Reabre el incidente del 2026-06-07 |
| CUD a 1 o 3 años | ADR-058 los pospuso. Primero bajar el piso |
| Apagar Routes, Geocoding o Gemini | El gasto medido era ~0. Las alertas de `api-cost-guardrails.tf` ya cubren un runaway |
| Borrar los Cloud Run placeholder | Ahorro ~0 mientras `min_instances=0` |

---

## 4. Si se aceptan las tres P1

| Escenario | USD/mes | CLP/mes |
|---|---|---|
| Piso actual de `booster-ai-494222` (sección 2.1) | 590–820 | 570.000–790.000 |
| Menos DR frío | −145 a −190 | −140.000 a −183.000 |
| Menos 1 vCPU del processor | −47 | −45.000 |
| Menos Booster 2.0, solo si el proyecto sigue facturando | −80 a −150 | −77.000 a −145.000 |
| **Piso resultante, sin Workspace, Twilio ni Datadog** | **~300–550** | **~290.000–530.000** |

Workspace, Twilio y Datadog se suman encima. Esos tres no están en la tabla porque su monto sale de la pestaña Uso y de la factura de Datadog, no de Terraform.

El presupuesto de USD 500 queda holgado solo después de sacar el DR. Antes, el piso puede estar por encima del budget aunque el producto esté quieto.

---

## 5. Qué se ejecutó el 2026-09-28, y qué no

Pedido posterior: revisar en profundidad y cortar. El detalle de la revisión y el runbook de apply están en `.specs/recorte-piso-gcp/` y en ADR-081.

| Palanca | Resultado |
|---|---|
| Clúster DR, subnet, IP pública, DNS `telemetry-dr`, NAT de `us-central1`, worker pool DR, manifiestos K8s de esa región | Sacados del código. El apply a producción no corrió: no hay credenciales de `booster-ai-494222` y ADR-076 pide un `terraform plan` registrado antes. Hasta ese apply la factura no baja |
| Processor 2 vCPU → 1 vCPU | En `compute.tf` y en el deploy de Cloud Build. Mismos `min_instances=1` y CPU siempre asignada. Tampoco está aplicado en la revisión viva hasta el apply o el próximo deploy |
| Rango de peering del pool DR | Se queda. Quitarlo recrea el peering de Cloud SQL |
| Cloud SQL, Redis, VPC connector, clúster de Santiago, Datadog, Workspace, Twilio | Revisados y no cortados. Los motivos están en la spec |
| Booster 2.0 (`big-cabinet-482101-s3`) y `gen-lang-client-0486421631` | La superficie pública ya es de Booster AI. El proyecto no se borra aquí: sin billing export no se sabe si sigue pagando. Revisión en `docs/audits/booster-2-0-2026-09-28.md` |

## 6. Cómo contrastar esto en el dashboard (15 minutos)

1. Platform Admin → Observabilidad → **Costos**. Anotar mes a la fecha, mes anterior completo y el Δ contra el mismo periodo.
2. En el donut, confirmar que Kubernetes Engine, Cloud SQL, Cloud Run y Networking son los cuatro grandes. Si Logging o una API de Maps está arriba, esa fila pasa delante de las palancas de la sección 3.
3. En «por proyecto», ver si `big-cabinet-482101-s3` y `gen-lang-client-0486421631` tienen costo > 0 en 30 días.
4. Tabla de top SKUs: buscar `Cluster Management Fee`, `Cloud NAT`, `Cloud Run CPU` del processor y `Cloud SQL`. Esos cuatro validan o tiran las cifras de la sección 2.1.
5. **Capacity**: CPU y RAM de Cloud SQL, y CPU del `telemetry-processor`. Si el processor está bajo 40 % de CPU, el paso a 1 vCPU cabe.
6. **Uso**: asientos de Workspace y categorías de Twilio con monto y 0 uso.
7. **Forecast**: si la proyección de fin de mes supera USD 500, el budget ya está corto para el piso actual.
8. Factura Datadog del mes, fuera del dashboard. Si el agente no está instalado, esta fila es cero y se cierra.

Con esos ocho datos se puede firmar o descartar cada palanca sin otra auditoría de inventario.
