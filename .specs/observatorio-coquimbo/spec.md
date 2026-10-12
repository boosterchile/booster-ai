# Spec — Observatorio urbano Coquimbo (T10-24, ADR-012 Capa 2)

**Contrato**: [ADR-012](../../docs/adr/012-urban-observatory-digital-twins.md) §Capa 2 y §Fase 2. Este documento es el plan; el ADR manda.
**Programa**: TRL 10 (ADR-082, en revisión en boosterchile/booster-ai#742), criterio T10-24: endpoints de observatorio, dashboard interno y entrega al municipio con contraparte identificada, con agregación mínima de 10 vehículos por bucket.
**Arquitectura**: BigQuery, según ADR-012. Decisión del PO del 2026-10-09.

## Entradas

- Cloud SQL, solo lectura:
  - `viajes` en estado `entregado`;
  - `asignaciones` (`recogido_en`, `entregado_en`, `vehiculo_id`);
  - `vehiculos` (`tipo_vehiculo`);
  - `metricas_viaje` (emisiones estimadas y reales, CO2e evitado por matching, distancia).
- Dataset BigQuery `observatory`, que ya existe en `infrastructure/data.tf`.
- Permisos: el SA runtime de Cloud Run ya tiene `roles/bigquery.dataEditor` y `roles/bigquery.jobUser` a nivel de proyecto (`iam.tf`). **No se toca IAM.**

## Salidas

1. **Tabla `observatory.viajes`**, la base de las vistas: una fila por viaje entregado.
   - Columnas: `viaje_id`, `vehiculo_id`, región y comuna de origen y destino, `recogido_en`, `entregado_en`, `clase_vehiculo` (`liviano | pesado`), distancia, emisiones (reales si existen; si no, estimadas) y CO2e evitado.
   - Los IDs no salen del sistema interno. BigQuery es interno, y las vistas y los endpoints exponen solo agregados (ADR-012 §Privacidad).
2. **Job `POST /admin/jobs/observatorio-export`**, que dispara Cloud Scheduler cada hora:
   - lee los viajes entregados de Cloud SQL;
   - los escribe en `observatory.viajes` con un *load job* `WRITE_TRUNCATE` desde NDJSON;
   - es idempotente porque reemplaza la foto completa (el volumen es de miles de filas);
   - tiene span OTel y métrica `observatorio.viajes_exportados`.
3. **Vistas materializadas `urban_flow_metrics_*`** (ADR-012 §Arquitectura), con refresco horario y declaradas en Terraform. Todas aplican **k ≥ 10 vehículos distintos por bucket** (`HAVING COUNT(DISTINCT vehiculo_id) >= 10`):
   - `urban_flow_metrics_franjas`: viajes y vehículos por región, comuna, mes, tipo de día (laboral o fin de semana), franja horaria de recogida (06-09, 09-12, 12-15, 15-18, 18-21, 21-06; hora de Chile) y clase de vehículo. Cubre ADR-012 métrica 1.
   - `urban_flow_metrics_emisiones`: kgCO2e totales, kgCO2e evitados por matching, viajes y vehículos por región, comuna, mes y clase. Cubre la métrica 3.
   - `urban_flow_metrics_od`: viajes y vehículos por mes, origen (región y comuna) y destino (región y comuna). Cubre la métrica 4.
   - `urban_flow_metrics_activos`: vehículos distintos por región, comuna y mes. Cubre la métrica 5; el crecimiento mes a mes se calcula en el API.
   - Una comuna nula se agrupa como `sin_comuna`. El formulario de carga no pide comuna, así que la región es el nivel confiable mientras no se capture.
4. **API** (lee las vistas con `@google-cloud/bigquery` y una caché de 10 min):
   - `GET /admin/observatorio/:region`, para el platform-admin (allowlist de ADR-076). Devuelve las cuatro secciones; la región es el código romano (`IV` = Coquimbo).
   - Defensa en profundidad: el API vuelve a descartar cualquier fila con `vehiculos < 10` y cualquier `vehiculo_id` o `viaje_id`.
   - Sin `BIGQUERY_OBSERVATORY_DATASET` responde 503 `observatorio_no_configurado`.
   - Span OTel y métrica `observatorio.consultas`.
   - **El acceso stakeholder o municipal (`/me/stakeholder/observatorio`) queda fuera de v1.** ADR-012 §Privacidad exige que el transportista pueda excluirse de la agregación (opt-out), y ese opt-out no existe en el código. Abrir datos a un tercero sin él contradice el ADR. La entrega al municipio de T10-24 se hace con el reporte que el PO exporta del dashboard interno, hasta que exista el opt-out.
5. **Web `/app/platform-admin/observatorio`**, el dashboard interno (ADR-012 §Fase 2 lo nombra `/admin/observatory/coquimbo`): selector de región (Coquimbo por defecto) y una tabla por sección. Un bucket sin datos muestra "Sin datos suficientes (menos de 10 vehículos)".
6. **Terraform** (`infrastructure/observatorio.tf`, sin IAM):
   - tabla `viajes` y las cuatro vistas materializadas;
   - job de Scheduler `observatorio-export` horario, que reutiliza `internal_cron_invoker`;
   - env `BIGQUERY_OBSERVATORY_DATASET` en el api.

## Desviaciones declaradas (requieren el visto del PO)

- **Transformaciones**: ADR-012 nombra Dataform. Aquí son vistas materializadas de BigQuery con refresco horario, declaradas en Terraform. El resultado es el mismo (`urban_flow_metrics_*` por hora) y no necesita repositorio Dataform ni credencial Git.
- **Fuente**: ADR-012 dice "cold storage de `telemetry_events` + trips". En v1 la base son los viajes entregados.
- **Congestión** (ADR-012 métrica 2) queda **fuera de v1**: necesita velocidades por segmento desde la telemetría, que no está en BigQuery. Queda como deuda declarada.
- **Clase de vehículo**: `liviano` = camioneta y furgones; `pesado` = el resto.
- **Masa crítica**: ADR-012 pide al menos 50 carriers activos en la región IV para la Fase 2. Con el volumen actual, las vistas devolverán pocos buckets o ninguno, porque k = 10 los oculta. Eso es lo esperado, no un error.

## Criterios de éxito

- [ ] Rojo exhibido antes de implementar en:
  - la proyección de un viaje a fila de BigQuery (franja, tipo de día, clase y emisiones con respaldo);
  - el filtro k ≥ 10 del API;
  - las rutas.
- [ ] Unit tests del job de export con un cliente BigQuery falso: `WRITE_TRUNCATE`, NDJSON válido y conteo en la respuesta.
- [ ] Integración contra Postgres real: la consulta de export trae solo viajes entregados, con las emisiones reales cuando existen.
- [ ] Ninguna respuesta del API contiene `vehiculo_id`, `viaje_id` ni un bucket con `vehiculos < 10`.
- [ ] `terraform validate` y `fmt` en verde. **La sintaxis SQL de las vistas solo se valida en BigQuery**: el sandbox no tiene acceso. Se declara en el PR y se verifica en el primer `terraform apply`.
- [ ] Coverage ≥ 80 % en el código nuevo; lint, typecheck y build; route default-deny y `lint:rls`.
- [ ] Fuera del código, a cargo del PO: contraparte municipal identificada y acta o correo de recepción (ADR-012, T10-24).
