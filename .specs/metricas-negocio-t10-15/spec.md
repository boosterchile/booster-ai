# Spec — Métricas de negocio en Cloud Monitoring (T10-15)

Programa TRL 10, fase C ([ADR-082](../../docs/adr/082-objetivo-trl10-supersede-precomercial.md), `.specs/trl10/spec.md`).

## Entradas

- `apps/api` emite ~25 contadores de negocio vía `metrics.getMeter('booster-ai-api/business')`
  (`viajes_entregados_total`, `huella_segmento_total`, `huella_cobertura_degradada_total`,
  `huella_peso_ausente_total`, …), pero ningún servicio registra un `MeterProvider`:
  la API de OTel devuelve el meter no-op y Cloud Monitoring tiene 0 descriptores propios.
- No existe contador de certificados emitidos.
- El SA runtime ya tiene `roles/monitoring.metricWriter` (`infrastructure/iam.tf`); no se toca IAM.

## Salidas

1. `packages/otel-bootstrap`: `initOtel` registra un `PeriodicExportingMetricReader`
   (60 s) con el `MetricExporter` de Cloud Monitoring (prefijo `workload.googleapis.com/`).
2. `BusinessOnlyMetricExporter`: solo exporta scopes cuyo nombre termina en `/business`.
   Las métricas de la auto-instrumentación (histogramas HTTP/pg por ruta) no se envían:
   duplican lo que Cloud Run ya mide y costarían del orden de GiB/mes en distribuciones.
3. `apps/api`: contador `certificados_emitidos_total{resultado}` con
   `resultado ∈ {emitido, config_missing, trip_not_found, trip_not_delivered,
   metrics_missing, already_issued, no_shipper}`.
4. `shutdownOtelForTests` desregistra los providers globales para que un segundo
   `initOtel` en el mismo proceso de test pueda registrar su `MeterProvider`.

## Criterios de éxito

- [x] Test: con `initOtel` activo, un contador de un meter `*/business` llega al exporter
      y uno de `@opentelemetry/instrumentation-http` no.
- [x] Test (rojo exhibido): `emitirCertificadoViaje` suma 1 a `certificados_emitidos_total`
      con el resultado correcto.
- [ ] Post-deploy (lo verifica el PO): `gcloud monitoring metrics-descriptors list
      --filter='metric.type=starts_with("workload.googleapis.com/")'` lista
      `viajes_entregados_total`, `certificados_emitidos_total` y `huella_segmento_total`.

## Riesgos declarados

- El `MetricExporter` de `@google-cloud/opentelemetry-cloud-monitoring-exporter` está
  marcado deprecated en favor de OTLP a `telemetry.googleapis.com`. Se usa porque es el
  par del `TraceExporter` ya en uso (misma auth ADC, sin collector) y sigue publicándose
  (0.22.0, 2026-08). Migrar ambos a OTLP es un follow-up, no bloquea T10-15.
