# Guion de la primera operación — cliente 1

**Para qué**: guiar el día 1 del primer viaje real del cliente 1 y saber, en cada paso, qué mirar en la app, en los logs y en las métricas para detectar un problema antes de que lo note el cliente.
**Requisito previo**: `checklist-onboarding.md` completo hasta el paso 4, y cada brecha marcada con una decisión (resuelta u operada a mano).
**Verificado contra**: `origin/main` del 2026-10-08.

## Roles del día

| Rol | Persona | Medio de contacto |
|---|---|---|
| Operador Booster (sigue el viaje, mira logs) | | |
| Contacto del generador | | |
| Despachador del transportista | | |
| Conductor | | |

## Cómo mirar logs y métricas

- **Logs**: Cloud Logging del proyecto `booster-ai-494222`, recurso `cloud_run_revision`, servicio `booster-ai-api` (y `booster-ai-telemetry-processor`, `booster-ai-whatsapp-bot` según el paso). Filtrar por `severity>=WARNING` y por el identificador del viaje (`tripId`) o de la asignación cuando se conozca. Los logs son JSON estructurados con `trace_id`.
- **Telemetría del gateway**: recurso `k8s_container` del clúster `booster-ai-telemetry`, y las métricas de logs `telemetry/*` (`device_records_per_minute`, `parser_errors`, `tcp_connection_resets`, `gateway_connection_cap_reached`).
- **Métricas de negocio del API**: los contadores de `apps/api/src/observability/business-metrics.ts` (por ejemplo `recogidas_confirmadas_total`, `viajes_entregados_total`, `huella_segmento_total`, `huella_cobertura_degradada_total`). Si T10-15 aún no está cerrado, puede que no lleguen a Cloud Monitoring: en ese caso, se verifica el mismo hecho en los logs y en la base.
- **Base de datos**: solo lectura con `scripts/db/agent-query.sh` (runbook `docs/runbooks/agent-query-prod.md`).

## Antes de empezar (T−1 día)

1. [ ] Último release desplegado y sano: los servicios de Cloud Run con la revisión esperada al 100 % (`docs/runbooks/service-api.md`).
2. [ ] Vehículo con Teltonika enviando posiciones: `/app/vehiculos/$id/live` muestra posición de los últimos minutos; `telemetry/device_records_per_minute` > 0 para su IMEI.
3. [ ] Datos CAN presentes en la telemetría del vehículo (necesarios para un certificado `primario_verificable`).
4. [ ] Conductor activado y con sesión en su teléfono (`/login/conductor`); permiso de ubicación del navegador concedido.
5. [ ] Medición de huella activa en la empresa (`/app/empresa`).
6. [ ] Configuración del API: `REQUIRE_DOCUMENT_TO_CLOSE_SINCE`, `CERTIFICATE_SIGNING_KEY_ID` y `CERTIFICATES_BUCKET` presentes (sin las dos últimas, el certificado no se emite: log `emitirCertificadoViaje skipped: config incompleto`).
7. [ ] Acordado con el cliente cómo se factura este viaje (ver brecha del paso 9 del checklist).

## Paso a paso del día 1

### 1. Publicación de la carga (generador)

- **Acción**: el generador publica en `/app/cargas/nueva`.
- **Esperado**: la solicitud pasa a `esperando_match` y luego a `ofertas_enviadas` en `/app/cargas/$id`.
- **Logs**: errores de `POST /trip-requests-v2`; si el origen no geocodifica, mirar `viaje_origen_geocodificacion_total` por resultado.
- **Si falla**: si no se emiten ofertas, revisar que la empresa transportista esté `activa`, tenga zonas que cubran el origen y un vehículo con capacidad suficiente.

### 2. Oferta y aceptación (transportista)

- **Acción**: el despachador acepta en `/app/ofertas` y asigna conductor y vehículo en `/app/asignaciones/$id`.
- **Esperado**: viaje `asignado`; el conductor ve el viaje en `/app/conductor`.
- **Logs**: errores de `POST /offers/:id/accept` y `POST /assignments/:id/asignar-conductor`; notificación al conductor (WhatsApp o *push*) en logs del API.
- **Revisar**: que la oferta muestre solo el precio del transportista.

### 3. Recogida (conductor)

- **Acción**: el conductor confirma la recogida en `/app/conductor`.
- **Esperado**: viaje `en_proceso`; `recogidas_confirmadas_total` +1.
- **Logs**: errores de `PATCH /assignments/:id/confirmar-recogida`.

### 4. En ruta

- **Acción**: el operador sigue el viaje en `/app/cargas/$id/track` y prueba el enlace público `/tracking/$token`.
- **Esperado**: la posición se actualiza; con Teltonika, cada pocos segundos; sin Teltonika, desde el teléfono del conductor.
- **Logs y métricas**: `telemetry/device_records_per_minute` estable para el IMEI; sin picos de `telemetry/parser_errors`; sin errores de `POST /assignments/:id/driver-position` si se usa el teléfono.
- **Si falla**: si la traza tiene huecos largos, anotarlo: bajará la cobertura y el nivel del certificado (`huella_cobertura_degradada_total`).

### 5. Entrega (conductor)

- **Acción**: el conductor confirma la entrega en `/app/conductor`.
- **Esperado**: viaje `entregado`; `viajes_entregados_total` +1.
- **Logs a vigilar justo después de la entrega** (son tareas que corren al entregar y no deben fallar en silencio):
  - `liquidarTrip falló — revisar manualmente o esperar job de reconciliación`
  - `liquidarTrip: carrier sin membership activa, skip` (esperable con el modelo v2 si el transportista no tiene membresía; anotarlo)
  - `recalcularNivelPostEntrega fallo — emitiendo cert con valores estimados`
  - `emitirCertificadoViaje throwed inesperadamente — pendiente para backfill`
  - `emitirCertificadoViaje skipped tras entrega`
  - `calcularScoreConduccionViaje fallo` y `generarCoachingViaje fallo`
  - `cierre rechazado por precondición documental (F4)` (falta el documento del viaje)

### 6. Cierre documental

- **Acción**: el transportista o el generador sube la guía de despacho o la factura en el panel de documentos de `/app/asignaciones/$id` o `/app/cargas/$id/track`.
- **Esperado**: el documento aparece con `retention_until` y, si el timbre se leyó, con sus datos extraídos.
- **Logs**: errores de `POST /transport-orders/:id/documents` y del procesamiento del documento.

### 7. Certificado

- **Acción**: el generador abre `/app/certificados` y descarga el PDF.
- **Esperado**: certificado con nivel, fuente de datos e incertidumbre; firma válida en un lector de PDF; `GET /certificates/:tracking_code/verify` responde válido.
- **Anotar**: nivel obtenido (`primario_verificable`, `secundario_modeled`, `secundario_default`), fuente de la traza y cobertura. Si el nivel no es primario con Teltonika y CAN, anotar la causa.

### 8. Liquidación y facturación

- **Acción**: revisar `/app/liquidaciones` (transportista) y registrar la factura de Booster y los pagos según lo acordado.
- **Anotar**: montos, fechas y si se facturó dentro o fuera del sistema.

## Después del día 1 (T+1 a T+7)

1. [ ] Revisar logs de error del API y del procesador de telemetría de las 24 horas siguientes, filtrando por el viaje.
2. [ ] Confirmar que no hubo reintentos pendientes de certificado ni de liquidación.
3. [ ] Llenar `docs/handoff/<fecha>-cliente-1.md` con `plantilla-feedback.md`.
4. [ ] Abrir un issue por cada incidencia, con su severidad y el paso del guion en que ocurrió.
