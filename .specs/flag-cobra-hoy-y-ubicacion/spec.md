# Cobra hoy apagado, última posición y estados del hub

**Estado**: aceptada · **Fecha**: 2026-10-19 · **Package**: `apps/api`, `apps/web`

Pedido del PO. El flag `FACTORING_V1_ACTIVATED` sigue en `false`. No se toca producción.

## Problema

Con el flag apagado, `GET /me/cobra-hoy/historial`, `GET /assignments/:id/cobra-hoy/cotizacion` y `POST /assignments/:id/cobra-hoy` responden 503 `{error:'feature_disabled'}`. Un 503 se lee como caída del servicio. La pantalla de historial tiene que seguir diciendo que el pronto pago no está activo.

`GET /vehiculos/:id/ubicacion` en prod va de ~0,5 s a ~33 s. #796 (`d85027f`) ya quitó el cómputo cuadrático de golpe y hormiga que bloqueaba el hilo y hacía esperar a esta ruta. Queda otra causa en la propia query.

La tarjeta del mapa en el hub dice «Sin posición GPS todavía» cuando la posición todavía no respondió, y el mismo texto cuando la lectura falla.

## Causa de la ubicación

La lectura de la última posición válida filtra `latitud`/`longitud` no nulas y distintas de 0, ordena por `timestamp_device DESC` y pide `LIMIT 1`. El índice `idx_telemetria_vehiculo_ts` (y el unique por IMEI en el camino espejo) incluye los pings sin fix (0,0 o null). Postgres camina ese índice desde el más nuevo y lee el heap —con `io_data`— hasta el primer fix válido.

Si el último ping ya tiene coordenada, es una lectura. Si el dispositivo lleva horas sin fix, son miles de filas. Eso explica el salto de ~0,5 s a decenas de segundos. No es N+1 (un vehículo, una query) ni el clima: Weather tiene timeout de 5 s y caché. No se rehace el arreglo de `/trayectos-teltonika`.

## Entradas

- Flag `FACTORING_V1_ACTIVATED=false` (default de `apps/api/src/config.ts`).
- Los tres endpoints de `apps/api/src/routes/cobra-hoy.ts`.
- `GET /vehiculos/:id/ubicacion` con Teltonika propio o espejo.
- Hub de `/app/vehiculos/$id` con IMEI, mientras carga, sin puntos y con error.

## Salidas

- GET de cotización e historial, con el flag apagado: `200 {enabled:false, items:[]}`. No consultan la base.
- POST de solicitud, con el flag apagado: `403 {error:'feature_disabled'}`. 404 queda para `assignment_not_found`.
- Con el flag encendido, el mismo contrato de hoy (cotización, alta, `adelantos`).
- La UI del historial sigue mostrando «La opción de pronto pago todavía no está activa».
- Índices parciales `idx_telemetria_vehiculo_gps_valido` e `idx_telemetria_imei_gps_valido` sobre filas con coordenada válida. Migración `0066`: #793, #794 y #795 reservan 0063–0065 y no están en `main`. El idx del journal se ajusta cuando #799 se mergea último. Los dos `CREATE INDEX` son `IF NOT EXISTS` con el mismo `WHERE`. Antes del deploy, Ops los crea con `CONCURRENTLY` según `docs/runbooks/indice-parcial-gps-0066.md`.
- El `items:[]` de la cotización apagada es el mismo sobre que el del historial. No es una lista de tarifas: va vacío y el cliente mira `enabled`.
- El plan de la última posición usa ese índice y no descarta miles de pings sin fix.
- La tarjeta distingue carga (skeleton), sin datos y error.

## Criterio de éxito

1. Tests de rutas: flag apagado → 200 en los GET y 403 en el POST. Flag encendido sin cambios.
2. Test del historial con `{enabled:false, items:[]}` muestra el aviso y no el empty state de «aún no tienes solicitudes».
3. `EXPLAIN (ANALYZE)` de la query real, con miles de pings 0,0 más nuevos que un fix válido, nombra el índice parcial y `Rows Removed by Filter` es 0. No se afirma el tiempo de pared (coverage lo infla).
4. Test del hub: pendiente → carga, sin el texto de sin GPS; 404 → sin GPS; 500 → error y reintento, sin el texto de sin GPS.

## Fuera de alcance

- Activar `FACTORING_V1_ACTIVATED`.
- Admin cobra-hoy, jobs y liquidaciones (siguen con su 503).
- Prod, Terraform, workflows, IAM.
- Reescribir la segmentación de trayectos.
