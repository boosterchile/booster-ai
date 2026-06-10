# Follow-up: partición y retención de tablas de telemetría

**Origen**: Auditoría arquitectónica 2026-06-09 (seguimiento "Modelo de datos Postgres"), riesgo alto "sin particionamiento ni retención".
**Prioridad**: P2 (sube a P1 si la flota crece o la latencia del processor degrada).

## Problema

`telemetria_puntos` (~2.16M filas/mes estimadas a 50 devices), `posiciones_movil_conductor` (browser GPS ~1/10s por conductor, sin dedup) y `eventos_conduccion_verde` crecen sin límite en una instancia ZONAL de 1 vCPU/6GB. Cero `PARTITION BY` en las migraciones; ningún cron borra datos (los 5 de scheduling.tf no tocan estas tablas). La migración 0025 promete "políticas de retención independientes" que no existen. `/flota` (DISTINCT ON no-LATERAL con polling 20s) degrada linealmente con el histórico.

Nota: el COUNT(*) por insert ya fue eliminado (fix/telemetry-persist, 2026-06-10).

## Acción propuesta

- Partición mensual por `timestamp_device` en telemetria_puntos (pg_partman o particiones nativas + cron de creación).
- Retención hot 90d con archivado a BigQuery (el propio schema.ts:1543 plantea migrar a BQ >500 devices — adelantar el sink).
- Retención corta (30d) para posiciones_movil_conductor (solo se consume el último punto).
- DROP de índices redundantes detectados: `idx_telemetria_imei_ts` (duplica el UNIQUE), `idx_eventos_conduccion_vehiculo_ts` (prefijo del UNIQUE), `idx_telemetria_vehiculo_recibido` (sin queries), `idx_vehiculos_teltonika_imei` (duplica .unique()).
- Reescribir `/flota` como LATERAL o tabla `ultima_posicion_vehiculo` con UPSERT desde el processor.
- `log_acceso_stakeholder`: partición por `accedido_en` + sink BigQuery real ANTES de abrir el portal stakeholder.

## Estado

Pendiente. Requiere ventana de mantenimiento para la migración de partición (tabla viva).
