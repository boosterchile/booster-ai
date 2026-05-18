# ADR-048 — Microservices extraction strategy: strangler con cutover-by-flag

**Fecha**: 2026-05-18
**Estado**: Accepted (conceptual; T9b/T9c diferidos)
**Refs**:
- `.specs/production-readiness/spec.md` SC-9 (notification-service), SC-10 (matching-engine), SC-11 (document-service), SC-30 (decisión strangler-vs-cutover en ADR antes de S3)
- `.specs/production-readiness/roadmap.md` §S3 + §S4 (sprints de extracción)
- `.specs/s0-housekeeping/spec.md` SC-S0.9a (este ADR), SC-S0.9b (medición budget S2), SC-S0.9c (criterios drill S3)
- `.specs/s0-housekeeping/plan.md` T9a (este PR), T9b (S2), T9c (S3)
- `.specs/production-readiness/review.md` O-1 (objection P0 que forzó el split T9a/T9b/T9c)
- ADR-001 (stack — Hono + Drizzle + Cloud Run)
- `infrastructure/modules/cloud-run-service/` (módulo Terraform reusable)

## Contexto

Tres `apps/` declarados en `README.md` y en ADR-001 viven hoy como **placeholders de 13 LOC cada uno**:

- `apps/notification-service` — capacidad de fan-out (Web Push / FCM / WhatsApp / Email / SMS), hoy *inlined* en `apps/api/src/services/notify-*.ts`.
- `apps/matching-engine` — scoring multifactor V2 + Pub/Sub consumer, hoy *inlined* en `apps/api/src/services/matching*.ts` + `packages/matching-algorithm/`.
- `apps/document-service` — DTE + Carta Porte + OCR + retention, hoy *inlined* en `apps/api/src/routes/{documentos,certificates,cumplimiento}.ts` + `packages/dte-provider/`.

El sub-spec `.specs/stubs-decision/spec.md` (Approved 2026-05-17) decidió **promover los 3** a microservicios Cloud Run independientes (no eliminarlos). La spec maestra production-readiness asigna la extracción a S3 (notification + matching) y S4 (document) del roadmap.

**Pregunta abierta** (Q-8 de la spec maestra original, escalada a SC-30 post devils-advocate): ¿qué patrón de migración usar? Las opciones reales son:

- **Cutover puro**: switch al microservicio con flag por endpoint, sin period de mirroring.
- **Strangler con mirroring**: traffic mirroring en staging (no en prod) + cutover prod con flag.
- **Strangler full**: mirroring en prod también (doble carga durante 1+ semana por servicio).

La spec maestra exige decisión documentada en ADR **antes de iniciar S3** (SC-30), porque la decisión afecta budget cloud + tiempo del sprint + rollback drill obligatorio.

Devils-advocate review O-1 (P0) además exigió que la **medición cuantitativa de budget USD/sem** y los **criterios concretos de drill** sean tareas separadas (T9b en S2 con métricas reales, T9c en la spec de S3), no parte de este ADR conceptual. Este ADR-048 cubre solo la **decisión cualitativa**.

## Decisión

### 1. Patrón elegido: **strangler con mirroring en staging + cutover en prod con flag por endpoint**

Cada extracción (notification, matching, document) sigue esta secuencia:

1. **Build microservicio independiente** (scaffold + Dockerfile + Cloud Build + Terraform `cloud-run-service` module instance). Tests ≥80/80/80/80.
2. **Wire consumers en monolito** con flag `<SERVICE>_VIA_MICROSERVICE=false` por default (`apps/api` sigue ejerciendo la lógica inline mientras el microservicio está OFF).
3. **Deploy staging** del microservicio + flag OFF en monolito.
4. **Rollback drill en staging** (obligatorio por SC-30, criterios concretos en T9c spec de S3): provocar fallo, verificar que flag retorna al monolito con datos consistentes <5min.
5. **Traffic mirroring en staging** (3-7 días, ajustable por servicio): el monolito sigue ejerciendo la lógica + envía request asíncrono al microservicio + compara outputs en logs. Sin afectar respuesta al cliente.
6. **Switch a microservicio en prod** vía flag `<SERVICE>_VIA_MICROSERVICE=true` (gradual: por endpoint o por porcentaje de tráfico según servicio).
7. **Monolito mantiene fallback funcional** durante 2 semanas post-switch (rollback inmediato disponible flag OFF).
8. **Tras 2 semanas estables + cero rollbacks**: eliminar código inline del monolito (commit separado).

### 2. Por qué no cutover puro

- **Sin mirroring staging = primera vez que el microservicio recibe carga real es en prod**. Las divergencias de comportamiento (timeouts, edge cases de payload, race conditions) aparecen con clientes pagando como víctimas.
- **Rollback drill imposible en prod sin pre-validación**: SC-30 exige rollback drill antes de cualquier switch en prod. Si no hay etapa staging mirrored, el drill se vuelve sintético (no comparable a tráfico real) y el riesgo crece.

### 3. Por qué no strangler full (mirroring también en prod)

- **Doble carga en prod por 1+ semana por servicio**. Costo cloud incremental significativo no cuantificable sin medir tráfico actual (eso es T9b en S2).
- **Sin evidencia de que la diferencia entre staging-mirrored y prod-mirrored sea grande**. Staging es full clone del schema y de la lógica; solo difiere en volumen, y el cutover-by-flag-progresivo permite controlar el escalado en prod sin necesidad de mirroring.
- **Si en T9b la medición revela que el budget es trivial** (e.g. <USD 50/sem por servicio), se puede revisitar agregando mirroring prod opcional. Esto se documenta en sub-ADR si aplica.

### 4. Tres microservicios = tres ADRs específicos en S3/S4

Este ADR-048 establece el **patrón general**. La extracción de cada microservicio (notification, matching, document) tiene su **propio ADR** durante S3/S4 que documenta:

- Mapping específico de endpoints/eventos del monolito al microservicio.
- Decisiones de payload schema (`@booster-ai/shared-schemas`).
- Plan de rollout específico (e.g. document-service es SII-grade y requiere rollback drill más estricto).
- Cualquier desviación justificada del patrón general (e.g. si un servicio amerita cutover puro por bajísima superficie, ADR específico lo documenta).

### 5. Lo que NO contiene este ADR (split T9b/T9c)

- **Tabla cuantitativa de budget USD/sem por microservicio** durante mirroring staging — requiere medir tráfico actual de `notify-*.ts`, `matching*.ts`, `documentos.ts`. Es **T9b**, diferido a **S2** (después del velocity check para no comprometer estimaciones sin data).
- **Criterios concretos de drill** (qué fallo provocar, qué outputs comparar, qué thresholds de tiempo en cada paso) — son específicos del primer servicio extraído (`notification-service`) y se documentan en su sub-spec en **S3** (T9c).

## Consecuencias

### Positivas

- **S3 arranca con patrón claro**, no necesita re-litigar la decisión de approach. La spec del sprint S3 referencia este ADR.
- **Rollback drill obligatorio en staging** (cubre SC-30) sin overhead de prod.
- **Cutover-by-flag-progresivo** permite control fino del rollout (por endpoint, por porcentaje, por cliente) sin mirroring continuo en prod.
- **Reversibilidad explícita**: si en T9b se descubre budget trivial o si el comportamiento del primer servicio extraído (notification) sugiere que mirroring staging es insuficiente, ADR de supersede + plan recuperación.

### Negativas

- **Mirroring staging implica setup adicional**: el monolito debe poder emitir requests al microservicio (sync o async) durante staging sin afectar respuesta al cliente. Esto es ~50-100 LOC por servicio. Trade-off aceptado vs el risk de cutover puro.
- **Comparación de outputs no es trivial**: monolito y microservicio pueden generar payloads con timestamps/IDs distintos. La spec del primer servicio define la metodología de comparación (e.g. hash de campos relevantes, no del payload completo).
- **Lead time total por servicio** ~2 semanas (S3 dura 2 semanas para 2 servicios, S4 dura 2 semanas para 1 servicio que es más complejo). No se acelera con cutover puro porque el rollback drill sigue siendo obligatorio.

### No mitigadas (out of scope ADR-048)

- **Schema de eventos Pub/Sub para microservicio matching**: el matching-engine consume Pub/Sub. El schema actual del topic está en `infrastructure/messaging.tf` + `apps/api/src/services/matching*.ts`. La spec de S3 valida que el contrato no cambia (backward compatible) al mover la lógica.
- **Service mesh / observability cross-service**: cada microservicio emite OTEL traces (igual que `apps/api` hoy). La correlación entre traces no requiere service mesh extra (OTEL trace context propagation es suficiente). Si en S8 el load test revela gaps, ADR separado.
- **Estrategia de versionado de microservicios**: cada microservicio se versiona con Changesets (igual que `apps/api`). Sin versioning de API HTTP en este alcance (single consumer = `apps/api` monolito; servicio interno). Si en post-launch hay consumers externos, ADR separado para versioning.

## Alternativas consideradas

### A. Cutover puro (sin mirroring) — RECHAZADA

Ya tratada en §Decisión 2. Razón principal: sin mirroring staging, el primer load real ocurre en prod con clientes como víctimas; rollback drill se vuelve sintético.

### B. Strangler full (mirroring también en prod) — RECHAZADA

Ya tratada en §Decisión 3. Razón principal: doble carga prod por 1+ sem por servicio sin budget cuantificado; revisitable si T9b muestra costo trivial.

### C. Service mesh (Istio / Linkerd) primero, extracción después — RECHAZADA

Pros: traffic shifting/mirroring nativo a nivel infra, sin código en monolito.
Cons: introducir service mesh es un sprint completo en sí mismo, agrega complejidad operacional permanente, y para 3 microservicios el ROI no justifica. Re-evaluar post-launch si Booster crece a >10 servicios.

### D. Big-bang rewrite (eliminar el monolito al final del sprint) — RECHAZADA

Pros: simplicidad final (sin fallback code).
Cons: viola CLAUDE.md §1 (cero deuda); rollback imposible una vez consolidado; viola SC-30 spec maestra (rollback drill obligatorio).

## Validación

- [ ] S3 produce sub-ADR específico para `notification-service` que referencia este ADR-048 y declara cualquier desviación.
- [ ] S3 produce sub-ADR específico para `matching-engine`.
- [ ] S4 produce sub-ADR específico para `document-service` (SII-grade, drill más estricto).
- [ ] T9b (en S2) produce `docs/perf/microservices-budget.md` con tabla USD/sem mirroring staging por servicio.
- [ ] T9c se materializa como sección en la spec de S3 (`.specs/s3-microservices-a/spec.md` o equivalente) con criterios drill concretos.
- [ ] Rollback drill ejecutado y documentado en `docs/runbooks/rollback-drill-microservicios.md` antes del primer switch en prod (referenciado por SC-30).
