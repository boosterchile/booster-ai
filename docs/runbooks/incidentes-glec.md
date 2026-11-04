# Runbook — Incidentes de huella GLEC y certificados

Cubre el cálculo de huella por viaje (GLEC v3.0, [ADR-021](../adr/021-glec-v3-compliance.md); niveles de certificación según ADR-077) y la emisión de certificados firmados con KMS. Ventana de respuesta: [`on-call.md`](on-call.md). Un certificado ya emitido es un documento firmado que el generador de carga puede presentar a terceros. Cualquier incidente que toque uno emitido es **P1 como mínimo**.

## Piezas

| Pieza | Dónde | Qué hace |
|---|---|---|
| Cálculo al cierre | `apps/api/src/services/calcular-metricas-viaje.ts` | Distancia real (GPS Teltonika o PWA), consumo (CAN `exacto_canbus`, `modelado` o `por_defecto`), emisiones y nivel de certificación. Persiste en `trip_metrics`. |
| Algoritmos | `packages/carbon-calculator` | Factores GLEC y SEC Chile. Lógica pura: un error acá afecta a todos los viajes. |
| Emisión | `apps/api/src/services/emitir-certificado-viaje.ts` | PDF + firma KMS (`certificate-carbono-signing`) + subida a `CERTIFICATES_BUCKET`. Idempotente: no re-emite si `certificate_issued_at` existe. |
| Verificación pública | `GET /certificates/:tracking_code/verify` (`routes/certificates.ts`) | Valida la firma del PDF contra KMS. |
| Backfill | `apps/api/src/jobs/backfill-certificados.ts` | Emite los certificados faltantes de viajes entregados. Tiene `--dry-run` y `--limit=N`. |

Métricas de negocio: `huella_segmento_total{resultado,fuente}`, `huella_cobertura_degradada_total` y `huella_peso_ausente_total`. Llegan a Cloud Monitoring como `workload.googleapis.com/…` desde T10-15. Hay piezas que dependen de PRs abiertos y entran cuando esos PRs se mergeen:

- **#747**: alerta `huella_cierre_degradado` sobre el evento `huella.segmento.cierre`.
- **#749**: métrica `huella_canbus_no_usado_total`.
- **#754**: `certificados_emitidos_total{resultado}`.

## Escenarios

### 1. Certificados que no se emiten

**Síntoma**: viajes `entregado` sin `certificate_issued_at`, o `certificados_emitidos_total{resultado!="emitido"}` creciendo.

1. Leer el `reason` en los logs (`emitirCertificadoViaje skipped`) o en el atributo `booster.certificate.reason` del span `certificate.emitir`:
   - `config_missing`: faltan `CERTIFICATE_SIGNING_KEY_ID` o `CERTIFICATES_BUCKET` en la revisión de Cloud Run. Revisar el env de la revisión activa contra `infrastructure/compute.tf`. Se corrige solo por Terraform.
   - `metrics_missing`: el cálculo de huella no corrió o falló. Ir al escenario 2.
   - `no_shipper`: el viaje no tiene generador de carga (WhatsApp anónimo antes de la vinculación). Es esperado: no hay a quién emitirle el certificado.
   - Error de KMS o GCS en los logs: verificar el estado de la versión de la llave (habilitada) y del bucket. La emisión es fire-and-forget y no reintenta sola.
2. Corregida la causa, recuperar los faltantes con el backfill: primero `--dry-run`, después `--limit=10` y, si sale bien, sin límite. El comando y las credenciales están en el encabezado del job.

### 2. Huella no calculada o degradada

**Síntoma**: `huella_cobertura_degradada_total` o `huella_peso_ausente_total` subiendo, viajes con `precision_method=por_defecto` que deberían ser `modelado` o `exacto_canbus`.

1. Separar si es un viaje o todos: filtrar `huella_segmento_total` por `fuente`.
2. **Cobertura GPS degradada**: revisar la telemetría del vehículo ([`oncall-telemetry-incidents.md`](oncall-telemetry-incidents.md)). Sin posiciones suficientes, el cálculo cae a la distancia de ruta, que es lo diseñado y queda declarado en el certificado.
3. **Peso ausente**: falta `cargo_weight_kg` en el viaje. Es un dato de entrada del generador de carga; se corrige en origen, no en el cálculo.
4. **CAN no usado en un vehículo con `fuente_combustible_can='83'`**: lecturas AVL 83 insuficientes o descartadas. Cuando #749 esté mergeado, el motivo queda en `huella_canbus_no_usado_total`.
5. **Todos los viajes afectados después de un deploy**: sospechar de `packages/carbon-calculator`. Hacer rollback de la revisión del api y tratarlo como P1.

### 3. Certificado emitido con datos incorrectos

Es el caso más grave porque el documento ya circuló.

1. **Contener**: identificar el alcance (qué viajes, qué rango de fechas, qué revisión). No borrar objetos del bucket: la evidencia se conserva.
2. **Corregir** la causa con un PR y TDD con rojo exhibido (dominio crítico, `CLAUDE.md`).
3. **Re-emitir**: el servicio es idempotente y no re-emite. Re-emitir exige limpiar `certificate_issued_at` en los viajes afectados, lo que es una migración que toca datos. Esa decisión es del PO, con lista de verificación y corrida en seco (ADR-076).
4. **Comunicar** a cada generador de carga afectado: qué certificado, qué dato cambió y dónde está el nuevo.
5. Post-mortem obligatorio ([`post-mortem-template.md`](post-mortem-template.md)).

### 4. `/verify` falla para certificados válidos

1. Probar con un `tracking_code` conocido: `curl -sS https://api.boosterchile.com/certificates/<tracking_code>/verify`.
2. Si falla para todos, revisar el permiso del SA runtime sobre la llave KMS y que la versión usada para firmar siga habilitada. **Nunca destruir una versión de la llave de firma**: invalida todos los certificados firmados con ella.
3. Si falla solo para algunos, comparar el `kms_key_version` del certificado con las versiones disponibles.

## Qué no hacer

- Recalcular huella o re-emitir certificados en masa sin dry-run y sin la decisión del PO.
- Cambiar factores de emisión sin ADR: el resultado tiene que ser trazable a la metodología declarada.
- Rotar la llave de firma destruyendo la versión anterior.
