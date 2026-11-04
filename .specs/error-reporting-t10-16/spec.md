# Spec — Errores de backend a Error Reporting con alerta (T10-16)

Programa TRL 10, fase C ([ADR-082](../../docs/adr/082-objetivo-trl10-supersede-precomercial.md), `.specs/trl10/spec.md`).

## Entradas

- Solo `apps/web` reporta errores (Sentry). En api, telemetry-processor,
  telemetry-tcp-gateway y whatsapp-bot, pino serializa el error anidado en
  `err.stack`; Cloud Error Reporting no lo reconoce y no abre grupos.
- Ningún backend registra `uncaughtException`/`unhandledRejection`: el stack
  de una caída sale por stderr sin estructura.
- La API `clouderrorreporting.googleapis.com` ya está habilitada (`project.tf`).

## Salidas

1. `@booster-ai/logger`: toda entrada `error`/`fatal` que trae un `Error`
   (`logger.error({ err })` o `logger.fatal(err)`) agrega `@type`
   ReportedErrorEvent, `stack_trace` y `serviceContext {service, version}`.
   Errores sin `Error` (de negocio) y niveles menores no cambian.
2. `registrarErroresNoControlados(logger)`: loguea `fatal` con el error y sale
   con 1. Registrado en los 4 `main.ts`.
3. `infrastructure/error-reporting.tf`: log-based metric
   `error-reporting/backend_errores_reportados{servicio,severidad}` y alerta:
   cualquier `fatal`, o > 5 errores reportables en 5 min por servicio.
   Sin IAM: el SA runtime ya escribe logs.

## Criterios de éxito

- [x] Test (rojo exhibido): el formato del logger lleva los campos de Error
      Reporting en error/fatal con Error, y no en warn ni en error sin Error.
- [x] Test: los handlers de proceso loguean fatal con `Error` y salen con 1.
- [ ] Post-apply (lo verifica el PO): el primer error real aparece agrupado en
      Error Reporting con el servicio correcto, y la política de alerta existe.
