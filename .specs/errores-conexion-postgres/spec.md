# Spec — Cortes de conexión a Postgres: no tumbar el proceso y conservar la causa

- Fecha: 2026-11-23
- Estado: Vigente
- Programa: TRL 10, fase C, hallazgo al verificar T10-16 (`.specs/trl10/spec.md`). No marca ningún criterio.
- Pedido del PO en el chat (2026-11-23): «sí, arregla los tres en un PR».

## Entradas (prod, solo lectura, 2026-11-23)

- Error Reporting agrupa 34 eventos «Failed query: INSERT INTO telemetria_puntos» del telemetry-processor desde el 2026-10-19. Vienen en cinco ráfagas de 6, 10, 2, 6 y 10 fallos dentro del mismo segundo; el pool tiene 10 conexiones. En la ráfaga del 20-11 los 10 mensajes se reprocesaron bien 12 s después.
- Seis entradas `uncaughtException` «Connection terminated unexpectedly» desde el 30-10: cinco del telemetry-processor y una del api. El proceso termina con código 1.
- La entrada de log del `INSERT` fallido trae `err = { cause: {}, params: [...], query }`: sin mensaje, sin tipo y con la causa vacía. Los valores de la consulta (IMEI y coordenadas) aparecen en `err.params` y también dentro de `stack_trace`.

## Causas

1. **Sin listener de `error` en el pool.** `pg.Pool` emite `error` cuando una conexión inactiva se corta. Ningún servicio lo escucha, así que Node lo convierte en excepción no controlada y `registrarErroresNoControlados` termina el proceso. Afecta a api, telemetry-processor, telemetry-tcp-gateway y document-service.
2. **El logger aplana los `Error`.** `redactObjectValues` recorre el registro con `Object.entries` antes de que pino serialice: de un `Error` solo quedan sus propiedades enumerables, y de su causa, nada.
3. **Drizzle escribe los valores en el error.** `DrizzleQueryError` los deja en `params` y en el texto `params: …` del mensaje y del stack.

## Salidas

1. `@booster-ai/logger` exporta `registrarErroresDePool(pool, logger)`: escucha `error` y registra un `warn` con el error. Los cuatro `main.ts` lo llaman al crear su pool. `pg` ya descarta la conexión rota y abre otra cuando hace falta.
2. `redactObjectValues` serializa cada `Error` como `{ type, message, stack, …propiedades propias, cause }`, con la causa serializada igual y sin límite de profundidad distinto al de ciclos.
3. En un error con `query` y `params`, los valores se omiten: `params` pasa a `[omitidos: N]`, y el texto `params: …` se reemplaza igual en `message`, en `stack` y en el `stack_trace` de Error Reporting. El texto de la consulta se conserva.

## Criterios de éxito

- [ ] Test (rojo exhibido): un error tipo `DrizzleQueryError` registrado con `logger.error({ err })` conserva `err.message`, `err.type` y `err.cause.message` y `err.cause.code`.
- [ ] Test (rojo exhibido): ningún valor de `params` aparece en la línea de log, tampoco en `stack_trace`.
- [ ] Test (rojo exhibido): tras `registrarErroresDePool`, emitir `error` en el pool no lanza y deja un `warn` con el error.
- [ ] Los tests existentes del logger siguen pasando: mismo `@type`, `stack_trace` y `serviceContext` para errores comunes.
- [ ] `pnpm run ci` en verde.

## Fuera de alcance

- Por qué se cortan las conexiones. No está determinado; con la causa ya registrada, el próximo corte lo dirá.
- Los pools de los jobs de `apps/api/src/jobs/`: son procesos cortos que terminan al acabar.
- Entradas ya escritas en Cloud Logging con valores en `params`.
