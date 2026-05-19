# ADR-050: Política de Observabilidad Obligatoria \+ Cableado OpenTelemetry

- **Fecha**: 2026-05-19  
- **Status**: Accepted  
- **Decisores**: Felipe Vicencio (PO)  
- **Tags**: observability, opentelemetry, pino, sprint-1, p0, trl-10

---

## Contexto y problema

La auditoría arquitectónica 2026-05-19 (sesión `21c07e7c-e6f9-4de9-9c1d-f819e6b5d5d7`, ver ADR-054 / PR \#303) identificó el bloqueo **P0 R-001** documentado en `audit-outputs/06_REFACTOR_PRIORITIES.md`:

7 paquetes OpenTelemetry \+ `pino-http` declarados en `apps/api/package.json` pero **0 imports en `src/`**.

Esto viola directamente el **Principio §6 "Observabilidad obligatoria"** de `CLAUDE.md` y bloquea cualquier ruta hacia TRL 10, porque:

1. Sin tracing distribuido, no se pueden correlacionar errores entre Cloud Run \+ Cloud SQL \+ servicios externos (Gemini API, Routes API, etc.).  
2. Sin structured logging con `correlation_id`, los SLOs y dashboards de operación quedan ciegos.  
3. Sin export OTLP hacia Cloud Trace, no hay evidencia auditable de rendimiento para compliance pre-launch (DTE, GLEC, ISO 14064).  
4. Cualquier feature nueva que vaya a producción incrementa la deuda observacional y posterga el cierre del P0.

Esta deuda fue introducida al planificar el stack pero nunca cableada operativamente. La presencia de los paquetes sin uso es un indicador de **"deuda silenciosa"** — el `package.json` declara la intención pero el bootstrap no la ejecuta.

---

## Decisión

Cablear OpenTelemetry como **estándar obligatorio** en `apps/api`, según las siguientes 5 secciones.

### 1\. Bootstrap OpenTelemetry NodeSDK

Crear `apps/api/src/observability/bootstrap.ts` que:

- Inicialice `NodeSDK` con auto-instrumentations (HTTP, fetch, pg, etc.).  
- Exporte vía `OTLPTraceExporter` apuntando a Google Cloud Trace.  
- Configure `Resource` con `service.name`, `service.version`, `service.instance.id` (desde env vars de Cloud Run).  
- Se cargue **antes** que cualquier otro módulo de la aplicación (flag `-r` en el arranque, o `import` al inicio absoluto de `index.ts`).

### 2\. Middleware Hono para correlationId

Crear `apps/api/src/middleware/correlation.ts`:

- Genera o propaga header `x-correlation-id` por request.  
- Lo inyecta en el context de Hono y en el contexto activo de OTel.  
- Logs y spans del request comparten el mismo `correlation_id`.

### 3\. Structured logging con pino \+ pino-http

Crear `apps/api/src/observability/logger.ts`:

- Pino con formatter para Cloud Logging (campos: `severity`, `time`, `message`, `traceId`, `spanId`, `correlation_id`).  
- Middleware `pino-http` integrado con el middleware de correlation.  
- Niveles: `error`, `warn`, `info`, `debug` (debug habilitable vía env var `LOG_LEVEL`).

### 4\. Política operativa "cero módulo nuevo sin observabilidad"

Todo módulo nuevo en `apps/api` debe emitir, como mínimo:

- Al menos un span de tracing en la operación principal del módulo.  
- Logs estructurados con `correlation_id` en error paths.

Esta política se enforza vía revisión humana en PR \+ gate automatizado en CI (ver Trabajo futuro).

### 5\. Verificación E2E

Tras implementación, ejecutar test de integración que dispare una request y verifique:

- Trace exportado a Cloud Trace (verificable vía `gcloud trace traces describe`).  
- Log estructurado en Cloud Logging con `traceId` \+ `correlation_id` correlacionados.  
- Latencia adicional p99 \< 5ms por request (con sampling configurable si excede).

---

## Consecuencias

### Positivas

- **Cierre del bloqueo P0 R-001**.  
- Cumplimiento estricto del Principio §6 (Observabilidad obligatoria).  
- Habilita debugging distribuido para integración Gemini \+ Routes API \+ Cloud SQL.  
- Base sólida para SLOs y monitoring de producción.  
- Evidencia auditable de rendimiento para compliance pre-launch (DTE SII, GLEC v3.0, ISO 14064).  
- Desbloquea otros items de Sprint 1 que dependen de visibilidad operacional.

### Negativas

- Setup adicional en bootstrap (nuevo módulo `observability/`, ajustes en `index.ts`).  
- Latencia mínima por export async de trazas (mitigable con batch processor \+ sampling).  
- Costo de Cloud Trace (mitigable con sampling rate configurable; default 100% en dev, 10% en prod).

### Riesgos

- **Si el bootstrap falla, la app no inicia.** Mitigación: try/catch alrededor del initialize con fallback a console \+ alerta crítica.  
- **Cardinality explosion en métricas custom.** Mitigación: solo métricas con labels controladas \+ alerta de cardinality si crece.

### Trabajo futuro

- Gate automatizado en CI que detecte módulos nuevos sin tracing/logging (script que busca handlers Hono sin `logger.info` \+ `tracer.startActiveSpan`).  
- Extender política a `apps/web` (frontend) con OpenTelemetry Browser SDK \+ propagación de header `traceparent`.  
- Custom dashboards en Cloud Monitoring por dominio (cargo, fleet, compliance, etc.).  
- Integración con Sentry como complemento (no sustituto) para error tracking en frontend.

---

## Plan de implementación

| Fase | Tarea | Estimación | Owner | Bloqueante |
| :---- | :---- | :---- | :---- | :---- |
| 1 | Crear `apps/api/src/observability/bootstrap.ts` \+ `logger.ts` \+ `correlation.ts` | 0.5d | TBD | Ninguno |
| 2 | Integrar bootstrap en `apps/api/src/index.ts` (preload con `-r` flag) | 0.5d | TBD | Fase 1 |
| 3 | Verificación E2E con Cloud Trace \+ Cloud Logging | 0.5d | TBD | Fase 2 \+ IAM Cloud Trace habilitado |
| 4 | Documentación en `apps/api/README.md` \+ ejemplo de uso para devs | 0.5d | TBD | Fase 3 |

**Total estimado**: 1-3 días (incluye buffer para troubleshooting de env vars Cloud Run y permisos IAM).

**Sprint**: Sprint 1 ejecutivo (según ADR-054 — colisión con S1b `s1-drift-coverage-e2e/` pendiente de resolución del PO).

**Files afectados (creación)**:

- `apps/api/src/observability/bootstrap.ts`  
- `apps/api/src/observability/logger.ts`  
- `apps/api/src/middleware/correlation.ts`

**Files afectados (modificación)**:

- `apps/api/src/index.ts` (preload del bootstrap)  
- `apps/api/README.md` (sección Observability)

---

## Alternativas consideradas

### Alternativa 1: Sin observabilidad (status quo)

- **Rechazada**: viola directamente Principio §6. No es alternativa válida en este repo bajo el actual marco arquitectónico.

### Alternativa 2: Solo Sentry (sin OTel)

- **Rechazada como sustituto, aceptada como complemento**. Sentry es excelente para error tracking pero no provee distributed tracing ni structured logging integrado con trazas. Puede coexistir con OpenTelemetry; si se adopta, será objeto de un ADR separado.

### Alternativa 3: Custom logging propio sin OTel ni pino-http

- **Rechazada**: viola portabilidad. OpenTelemetry es estándar industry-wide; logging propio crea lock-in al repo y dificulta debugging distribuido.

### Alternativa 4: OTel pero export a otro backend (Datadog, New Relic, Honeycomb)

- **Rechazada**: Cloud Trace es nativo a la infraestructura GCP del proyecto. Cualquier otro backend introduce dependencia externa innecesaria \+ costo adicional.

### Alternativa 5: Solo logging (sin tracing distribuido)

- **Rechazada**: pierde la correlación entre llamadas a Gemini API \+ Routes API \+ Cloud SQL, que es exactamente el caso de uso donde TRL 10 requiere observabilidad rica.

---

## Referencias

- `CLAUDE.md` §6 Observabilidad obligatoria  
- `audit-outputs/06_REFACTOR_PRIORITIES.md` (R-001 P0)  
- `audit-outputs/05_TECH_DEBT_REGISTRY.md`  
- `audit-outputs/03_SECURITY_FINDINGS.md` (correlación con logs de auth)  
- ADR-054 (Arquitecto Maestro Migration, PR \#303)  
- PR \#304 (skill activation \+ Fase 1 disambiguation)  
- [OpenTelemetry NodeSDK docs](https://opentelemetry.io/docs/languages/js/getting-started/nodejs/)  
- [Cloud Trace OTLP setup](https://cloud.google.com/trace/docs/setup/nodejs-ot)  
- [pino-http](https://github.com/pinojs/pino-http)

