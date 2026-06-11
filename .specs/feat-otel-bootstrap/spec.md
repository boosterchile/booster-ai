# Spec: feat-otel-bootstrap

- Author: Felipe Vicencio (with agent-rigor)
- Date: 2026-06-11
- Status: Approved
- Linked: Auditoría 2026-06-09, riesgo medio VERIFICADO #5 ("OTel declarado pero nunca inicializado — la regla CLAUDE.md 'cada endpoint tiene span' no se cumple en ninguno; el logger promete trace_id que no llega"). Decisión PO 2026-06-11: "todos los servicios".

## 1. Objective

Inicializar OpenTelemetry de verdad en los 5 servicios reales (api, telemetry-processor, telemetry-tcp-gateway, whatsapp-bot, sms-fallback-gateway) y correlacionar `trace_id` en los logs Pino: hoy las deps OTel viven solo en apps/api/package.json sin un solo import, y `@booster-ai/logger` documenta una correlación de traces que no existe.

## 2. Why now

Regla no-negociable del CLAUDE.md incumplida en el 100% de los endpoints; sin traces, el debugging cross-servicio (gateway→pubsub→processor→DB, bot→api) es a ciegas. Decisión PO explícita de cubrir todos los servicios en esta ola.

## 3. Success criteria

- [ ] `packages/otel-bootstrap` exporta `initOtel({serviceName, serviceVersion})`: NodeSDK + auto-instrumentations + Cloud Trace exporter (ADC, cero collector); no-op limpio sin `GOOGLE_CLOUD_PROJECT` (dev/test); shutdown graceful en SIGTERM.
- [ ] Cada servicio tiene `src/instrumentation.ts` (entry tsup propio) y su Dockerfile arranca con `node --import ./dist/instrumentation.js dist/main.js` — el ÚNICO orden que garantiza el patching de auto-instrumentación en ESM (la causa por la que nunca se inicializó: el CMD era `node dist/main.js`).
- [ ] `createLogger` correlaciona: mixin que agrega `trace_id`/`span_id` del span activo + campos `logging.googleapis.com/trace|spanId` (correlación nativa en Cloud Logging) cuando se pasa `gcpProjectId`.
- [ ] Tests: gating del bootstrap (sin env → no-op), mixin del logger con span activo/inactivo (vía @opentelemetry/api puro, sin SDK).

## 4. User-visible behaviour

Ninguno para usuarios. Operador: traces en Cloud Trace + logs correlacionados por trace en la consola GCP.

## 5. Out of scope

- Spans custom de negocio (la auto-instrumentación cubre http/pg/ioredis/grpc/pubsub; spans manuales vienen con cada feature futura).
- Métricas y logs OTel (solo traces; las métricas siguen siendo log-based per patrón del repo).
- Sampling avanzado (default del SDK; ajustar con datos reales post-deploy).
- apps/web (browser tracing es otro mundo) y los 3 app-skeletons.

## 6. Constraints

1. ESM + bundling tsup: la auto-instrumentación EXIGE cargarse antes que los módulos instrumentados → `--import` en el CMD, no import en main.ts (documentado en el package).
2. Exporter directo a Cloud Trace vía ADC (consistente con ADR-037/038: cero API keys, cero collector); dep nueva `@google-cloud/opentelemetry-cloud-trace-exporter` justificada acá (sin ella los traces no tienen destino en este stack).
3. Sin GOOGLE_CLOUD_PROJECT el bootstrap es no-op silencioso-con-log: dev y CI no requieren GCP.
4. El SA runtime ya tiene permisos de Cloud Trace (roles project-level del booster-cloudrun-sa incluyen cloudtrace.agent — verificar en review; si falta, el PR de TF lo agrega).

## 7. Approach

Package nuevo con las MISMAS versiones OTel que ya declaraba apps/api (que pierde sus deps muertas a favor del package). `instrumentation.ts` de 3 líneas por servicio + entry tsup + CMD con `--import`. Logger: mixin opt-in compatible con formatters/hooks existentes.

## 8. Alternatives considered

- **A. OTLP exporter (deps ya declaradas en api)** — Rechazada: exige desplegar un collector (otro servicio, otro costo); Cloud Trace directo con ADC es el camino cero-infra del stack.
- **B. Init dentro de main.ts (sin --import)** — Rechazada: en ESM los módulos ya evaluados no se re-patchean; es EXACTAMENTE el motivo por el que la instrumentación nunca funcionó como estaba pensada.
- **C. Un instrumentation.ts compartido publicado como bin** — Rechazada: cada servicio necesita su serviceName en el resource; 3 líneas locales son más claras que magia de env.

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Overhead de auto-instrumentación en hot paths (processor/gateway) | M | M | BatchSpanProcessor (default) + sampler padre-based; fs/dns instrumentations deshabilitadas; monitoreo de latencia post-deploy (§11) |
| El exporter falla en runtime (permisos/ADC) | L | M | Export es asíncrono y nunca bloquea requests; errores van a diagnósticos del SDK (log warn). Verificación manual post-deploy obligatoria |
| --import rompe el arranque si dist/instrumentation.js falta | L | H | Entry tsup garantiza el artefacto; smoke del Dockerfile = el propio deploy canary del api |
| Validación e2e imposible en local (sin GCP) | — | M | Igual que KMS (#435): paso manual post-deploy en §11 — abrir Cloud Trace y ver spans del smoke test |

## 10. Test list

- T1: initOtel sin GOOGLE_CLOUD_PROJECT → {started:false}, sin side effects.
- T2: initOtel con project (exporter inyectado fake) → {started:true} y segundo init es no-op (idempotente).
- T3: logger con span activo (NonRecordingSpan vía @opentelemetry/api) → log incluye trace_id/span_id y logging.googleapis.com/trace con el project.
- T4: logger sin span activo → log sin esos campos (cero ruido).
- T5: typecheck+build de los 5 servicios con el entry nuevo.

## 11. Rollout

- Flag: implícito (no-op sin GOOGLE_CLOUD_PROJECT; en prod la var ya existe en todos).
- Rollback: revert (CMD vuelve a node dist/main.js).
- Post-deploy (manual, obligatorio): correr el smoke de /health + un request real → verificar en Cloud Trace que aparecen spans del api con el resource correcto y que un log del request muestra el trace correlacionado en Logs Explorer.

## 12. Open questions

None as of 2026-06-11 (permiso cloudtrace.agent se verifica en review — §6.4).

## 13. Decision log

- 2026-06-11 — Draft + decisión PO "todos los servicios". Cloud Trace directo (no OTLP/collector); --import como mecanismo (la falta de esto era la causa raíz).
