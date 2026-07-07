# vehiculos.ts — instrumentar el resto del router (span OTel + métrica de negocio)

**Dimensión**: observabilidad · **Estado**: deuda preexistente, parcialmente cerrada.
**Fuente**: fix TOCTOU de `PATCH /vehiculos/:id/dispositivo` (revisión W2a, hito-2 CORFO mes 8), `.specs/hito-2-corfo-mes-8/decisiones.md` (D2/D2b/D3).

## Problema

`apps/api/src/routes/vehiculos.ts` tiene 8 endpoints (`GET /`, `GET /flota`, `POST /`, `GET /:id`, `PATCH /:id`, `PATCH /:id/dispositivo`, `DELETE /:id`, más el detalle de ubicación). Hasta este fix **ninguno** tenía span OTel de negocio ni métrica custom — solo la auto-instrumentación HTTP/DB genérica (spans de infraestructura, no de dominio). El contrato del repo (`CLAUDE.md` §Observabilidad) exige "span OTel y métrica de negocio en cada endpoint nuevo"; los 7 endpoints restantes son preexistentes a esta regla y quedaron fuera de su alcance.

## Qué se cerró (no está abierto)

`PATCH /:id/dispositivo` (W2 self-service) queda instrumentado como referencia:

- **Span** (`withBusinessSpan`, `apps/api/src/observability/business-span.ts` — ya existía, usado antes solo en `transport-documents.ts`): nombre `vehiculo.actualizar_dispositivo`, atributos `booster.vehiculo_id` / `booster.empresa_id` al inicio y `booster.dispositivo.reconciliacion` como resultado. Deliberadamente **sin el IMEI completo** como atributo (superficie de exportación a Cloud Trace más amplia que el logger estructurado; ningún span del repo expone hoy un identificador de dispositivo).
- **Métrica** (`getBusinessCounter`, nuevo helper `apps/api/src/observability/business-metrics.ts` — primera métrica de negocio de todo el API): contador `dispositivo_asociaciones_total` con labels `resultado` (ok/vehicle_not_found/imei_espejo_activo/imei_en_uso/imei_rechazado/pending_device_conflict/error_interno) y `reconciliacion` (aprobado/reaprobado_desde_rechazado/sin_registro/ninguna).

Ambos helpers son genéricos y reusables — no específicos de vehículos — para que el resto de este plan solo tenga que llamarlos, no reimplementarlos.

## Impacto de lo que queda abierto

Sin span/métrica en los otros 7 endpoints: mutaciones de flota (alta, baja, edición de patente/tipo) y las dos rutas de lectura bulk (`GET /flota` con el LATERAL JOIN, `GET /` lista completa) son invisibles como unidades de negocio en Cloud Trace/dashboards — solo se ven sus queries sueltas vía auto-instrumentación. Esto dificulta diagnosticar latencia o error rate por operación (p.ej. "¿cuántas altas de vehículo fallan por patente duplicada esta semana?" hoy exige grep de logs, no una métrica).

## Plan de pago

1. Envolver cada handler mutador (`POST /`, `PATCH /:id`, `DELETE /:id`) con `withBusinessSpan` — nombres sugeridos: `vehiculo.crear`, `vehiculo.actualizar`, `vehiculo.dar_baja`. Atributos mínimos: `booster.vehiculo_id` (cuando aplique) + `booster.empresa_id`.
2. Contador de negocio por mutación (`vehiculo_mutaciones_total` con labels `operacion`/`resultado`) usando el mismo `getBusinessCounter`.
3. Para los reads bulk (`GET /`, `GET /flota`) evaluar si amerita span (son de alto volumen; un span por request podría no aportar señal vs. costo — decisión de diseño, no mecánica, antes de instrumentar).
4. No mezclar con cambios de contrato: este follow-up es solo observabilidad, cero cambios de request/response shape.
