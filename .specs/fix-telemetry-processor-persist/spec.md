# Spec: fix-telemetry-processor-persist

- Author: Felipe Vicencio (with agent-rigor)
- Date: 2026-06-10
- Status: Approved
- Linked: Auditoría arquitectónica 2026-06-09 — riesgo alto "eventos SMS fallback nunca se persisten" + riesgo alto BD "COUNT(*) en hot path"

## 1. Objective

Dos correcciones en `apps/telemetry-processor/src/persist.ts`: (1) los mensajes con `vehicleId: null` se descartan sin intentar resolución — pero `sms-fallback-gateway` publica SIEMPRE `vehicleId: null` con un comentario que promete "resuelto downstream por el processor", lookup que no existe: cada evento panic (Crash/Unplug/Jamming) que entra por SMS — justo cuando GPRS está caído — se pierde en silencio; (2) la detección de "primer punto del vehículo" ejecuta `SELECT COUNT(*)` sobre `telemetria_puntos` tras CADA insert — costo O(histórico del vehículo) por insert, agregado cuadrático en una tabla de ~2.16M filas/mes sin purga.

## 2. Why now

El canal SMS es la red de seguridad de eventos de seguridad física; hoy es un agujero silencioso. El COUNT es la bomba de crecimiento #1 del modelo de datos (instancia de 1 vCPU/6GB). Ambos fixes son quirúrgicos en el mismo archivo.

## 3. Success criteria

- [ ] Mensaje con `vehicleId: null` e IMEI registrado en `vehiculos.teltonika_imei` → se persiste con el vehicleId resuelto.
- [ ] Mensaje con `vehicleId: null` e IMEI desconocido → se descarta con log `warn` (antes `debug`) — visible para alerting.
- [ ] Detección de primer punto vía `SELECT 1 ... LIMIT 2` (costo O(1) con el índice existente) con semántica idéntica.
- [ ] Cero queries extra para mensajes que ya traen vehicleId (el caso 99% del TCP gateway).

## 4. User-visible behaviour

Sin UI. Eventos de telemetría que entren por SMS fallback de vehículos registrados aparecen en `telemetria_puntos` (y por ende en flota/tracking/alertas). El descarte de IMEIs desconocidos ahora se loguea como warn.

## 5. Out of scope

- Routing de eventos panic a los topics safety-p0/security-p1 (sin consumer real — cubierto por spec P2 de notification-service).
- Particionamiento/retención de telemetria_puntos (spec P2 dedicada).
- Cache en memoria del lookup IMEI (volumen actual no lo justifica; ver §8.B).

## 6. Constraints

1. El lookup solo corre cuando `vehicleId` es null (no agregar latencia al hot path normal).
2. Mantener el contrato `PersistResult` (consumido por main.ts para el TODO de telemetria_primera_recibida).
3. SQL parametrizado vía tagged template de drizzle (patrón existente del archivo).

## 7. Approach

En `persistRecord`: si `msg.vehicleId` es null, ejecutar `SELECT id FROM vehiculos WHERE teltonika_imei = $imei LIMIT 1`; con match, continuar con el id resuelto (log info con source de resolución); sin match, descartar con warn. Para primer punto: `SELECT 1 FROM telemetria_puntos WHERE vehiculo_id = $id LIMIT 2` → es primero si retorna exactamente 1 fila (la recién insertada). Usa el índice `idx_telemetria_vehiculo_ts` existente, leyendo máximo 2 entradas en vez de todo el histórico.

## 8. Alternatives considered

- **A. Resolver el IMEI en sms-fallback-gateway** — Rechazada: ese gateway no tiene conexión a DB por diseño (servicio mínimo webhook→Pub/Sub); agregarle Postgres amplía su superficie y duplica el path de resolución que el TCP gateway ya hace contra la misma tabla.
- **B. Cache en memoria (Map TTL) para el lookup** — Rechazada: el lookup solo corre con vehicleId null (mensajes SMS raros + devices pendientes); a ≤50 devices el ahorro es despreciable y el cache agrega invalidación al asociar un device.
- **C. Flag booleano en `vehiculos` para primer-punto** — Rechazada: requiere migración y UPDATE adicional por vehículo; LIMIT 2 logra O(1) sin tocar el schema.

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Flood de mensajes con IMEI desconocido genera 1 query c/u | L | L | Solo path vehicleId null; dispositivos_pendientes ya acota el caso TCP; warn permite detectar abuso |
| Cambio de semántica primer-punto con histórico preexistente | L | L | LIMIT 2 post-insert: 1 fila = primera; idéntico al COUNT==1 |
| Lookup encuentra vehículo de IMEI re-asignado | L | M | Mismo riesgo ya existente en el TCP gateway (única fuente: vehiculos.teltonika_imei); fuera de alcance |

## 10. Test list

- T1: vehicleId null + IMEI registrado → INSERT con el id resuelto + resultado inserted=true.
- T2: vehicleId null + IMEI desconocido → descarta sin INSERT, logger.warn llamado.
- T3: vehicleId presente → cero lookups extra (mismo número de executes que hoy).
- T4: primer punto → `LIMIT 2` retorna 1 fila → isFirstPointForVehicle=true.
- T5: no-primer punto → 2 filas → false; duplicado (RETURNING vacío) → no consulta primer-punto.

## 11. Rollout

- Feature-flagged? No.
- Migration needed? No.
- Rollback plan: revert del commit.
- Monitoring: post-deploy, enviar un BSTR de prueba por el path SMS y verificar la fila en telemetria_puntos; observar latencia de ack del consumer (oldest_unacked) que debería bajar al eliminar el COUNT.

## 12. Open questions

None as of 2026-06-10.

## 13. Decision log

- 2026-06-10 — Draft + aprobación del PO vía "ejecutar lo propuesto en el punto 6".
