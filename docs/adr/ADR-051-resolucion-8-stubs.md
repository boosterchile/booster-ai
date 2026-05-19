# ADR-051: Resolución 8 stubs bajo principio operativo "tiempo a producción"

- **Fecha**: 2026-05-19
- **Status**: Accepted
- **Decisores**: Felipe Vicencio (PO)
- **Tags**: stubs, refactor, sprint-planning, production-priority, p1

---

## Relación con otros ADRs y specs

- **Supersede parcialmente**: `.specs/stubs-decision/spec.md` §7.1 y §7.2 (PO-aprobada 2026-05-17) en 6 de 8 stubs. Mantiene 2 puntos coincidentes (trip-state-machine, ui-components).
- **Supersede parcialmente**: ADR-001 (listado original de packages) en lo referente a `ai-provider` — se reabre la abstracción multi-provider rechazada implícitamente por ADR-037.
- **Coordina con**: ADR-037 (Vertex AI ADC migration), ADR-043 (drift schema↔domain), ADR-055 (calendar consolidado Sprint 1).
- **Habilita**: ejecución de S1b en la Fase 2 del calendar consolidado (C.1.5 trip-state-machine es input directo).

---

## Contexto y problema

### Inventario de stubs (auditoría 2026-05-19)

8 placeholder identificados empíricamente (LOC ≤ 13, files = 1), clasificados por audit con simbología `a` (app skeleton) y `p` (package stub):

**3 apps skeleton** (LOC ≈ 13): `apps/document-service/`, `apps/matching-engine/`, `apps/notification-service/`. Solo `logger.info('starting (skeleton)')` + TODO.

**5 packages stub** (LOC = 7): `packages/ai-provider/`, `packages/trip-state-machine/`, `packages/carta-porte-generator/`, `packages/document-indexer/`, `packages/ui-components/`. Solo `export const PACKAGE_NAME = ... // TODO implementar segun ADRs`.

### Spec previa stubs-decision (2026-05-17, PO-aprobada)

Decidió: ELIMINAR 2 packages (`ai-provider`, `document-indexer`), PROMOVER 6 restantes (notification-service S3, matching-engine S3, document-service S4, carta-porte-generator S4, trip-state-machine S1, ui-components S2 parcial). Total LOC promoción estimado ~1150.

### Cambio de principio operativo (2026-05-19)

PO consolida un principio operativo nuevo bajo el contexto de auditoría 2026-05-19:

> "Ir a producción es prioridad. No podemos estar en desarrollo eterno. Refactor de código que ya funciona inline en `apps/api` queda diferido sine die. Nuevo desarrollo solo si es bloqueante (drift schema, trip-state, segunda app frontend) o aporta directamente a la oferta de valor productiva (multi-LLM)."

Este principio recalifica las 8 decisiones de stubs-decision, produciendo 6 divergencias y 2 coincidencias.

---

## Decisiones consolidadas

### Tabla maestra

| ID | Stub | Decisión | Acción | vs spec stubs-decision | Sprint |
|---|---|---|---|---|---|
| C.1.1 | `apps/matching-engine` | **D** | Mantener stub + trazabilidad | Diverge (spec: PROMOVER S3) | Diferido |
| C.1.2 | `apps/notification-service` | **D** | Mantener stub + trazabilidad | Diverge (spec: PROMOVER S3) | Diferido |
| C.1.3 | `apps/document-service` | **D** | Mantener stub + trazabilidad | Diverge (spec: PROMOVER S4) | Diferido |
| C.1.4 | `packages/ai-provider` | **A** | Implementar abstracción multi-provider | **CONFLICTO** (spec: ELIMINAR S2; ADR-037 implícito: Vertex SDK directo) | Post-S1b (Mini-Sprint residual o sprint dedicado) |
| C.1.5 | `packages/trip-state-machine` | **A** | Implementar XState + tests | Coincide (spec: PROMOVER S1) | S1b (Fase 2 calendar ADR-055+052) |
| C.1.6 | `packages/carta-porte-generator` | **D** | Mantener stub + trazabilidad | Diverge (spec: PROMOVER S4 como parte document-service) | Diferido |
| C.1.7 | `packages/document-indexer` | **D** | Mantener stub + trazabilidad | Diverge parcial (spec: ELIMINAR S2 — D es más rápido que ELIMINAR bajo principio operativo) | Diferido |
| C.1.8 | `packages/ui-components` | **A** | Extraer 5-8 componentes reutilizables identificados | Coincide (spec: PROMOVER parcial S2) | Condicional a calendar segunda app frontend |

---

## Acciones concretas por stub

### C.1.1 — `apps/matching-engine` (D)

**Justificación**: funcionalidad de matching ya productiva inline en `apps/api/src/services/matching*.ts` consumiendo `packages/matching-algorithm/` (779 LOC). Extracción a Cloud Run separado aporta scaling independiente pero requiere refactor de varios días sin valor productivo inmediato. Bajo principio operativo, diferido.

**Acción**: editar `apps/matching-engine/src/main.ts:12` para reemplazar:

```
// TODO: implementar segun el ADR correspondiente
```

por:

```
// TODO(spec: stubs-decision §7.1; diferido por ADR-051 2026-05-19 priorizacion produccion)
// Funcionalidad inline en apps/api/src/services/matching*.ts + packages/matching-algorithm/
// Promover cuando: blast radius operacional excede 5x costo extraccion, o spec MVP especifica.
```

### C.1.2 — `apps/notification-service` (D)

**Justificación**: funcionalidad de notifications ya productiva inline en `apps/api/src/services/notify-*.ts` consumiendo `packages/notification-fan-out/` (236 LOC). Pub/Sub topics existentes (`telemetry-events-safety-p0`, `telemetry-events-security-p1`) ya consumidos vía esta inline implementation. Extracción no es bloqueante para producción.

**Acción**: idem C.1.1, en `apps/notification-service/src/main.ts:12`. Trazabilidad: `TODO(spec: stubs-decision §7.1; diferido por ADR-051 2026-05-19)`.

### C.1.3 — `apps/document-service` (D)

**Justificación**: funcionalidad de gestión documental ya productiva inline en `apps/api/src/routes/documentos.ts` + `packages/dte-provider/` (825 LOC) + `packages/certificate-generator/` (2591 LOC, firma KMS+signpdf). Ecosistema completo dispersos pero operativo. Extracción consolidaría arquitectura pero no aporta funcionalidad productiva.

**Acción**: idem, en `apps/document-service/src/main.ts:12`.

### C.1.4 — `packages/ai-provider` (A) ⚠️ supersede explícito

**Justificación PO**: oferta de valor de Booster AI incluye `coaching-generator + matching-algorithm + customer-support-bot` como capacidades productivas. Multi-LLM provider (Anthropic + Google Vertex + OpenAI según necesidad) es diferenciador competitivo. Mantener Vertex SDK directo en cada consumer (estado actual post-ADR-037) bloquea esta capacidad.

**Conflicto técnico explícito**:
- spec stubs-decision §7.2 cita: "post-ADR-037 Vertex AI ADC migration, `apps/api/src/services/gemini-client.ts` y `packages/coaching-generator` / `packages/driver-scoring` usan Vertex SDK directo. No hay segundo provider en horizonte de production-readiness."
- ADR-051 reabre la abstracción multi-provider con justificación de horizonte de producto extendido (post-PO 2026-05-19): customer-support-bot planeado con Anthropic, opciones de routing por costo/calidad por feature.

**Acción**:
1. Diseño de interfaz `packages/ai-provider/src/index.ts`:
   - `interface AiProvider { chat(req: ChatRequest): Promise<ChatResponse> }`
   - Implementaciones: `VertexProvider`, `AnthropicProvider`, `OpenAIProvider`
   - Routing strategy: config-driven (env-based, no hardcode).
   - Telemetría: tokens consumed, latency, cost, provider used.
   - Retry/fallback strategy: provider primary + provider fallback configurable.
2. Refactor `apps/api/src/services/gemini-client.ts` → consume `AiProvider`.
3. Refactor `packages/coaching-generator` y `packages/driver-scoring` → consumen `AiProvider`.
4. Documentación: ADR específico de routing strategy (ADR-060 condicional) si se decide políticas complejas (ej. fallback por error rate).

**Sprint placement**: post-S1b. Encaja en Mini-Sprint residual de ADR-055 si el esfuerzo cabe (~3-5 días estimado), o sprint dedicado post-Mini-Sprint residual.

**Validation gate**: diseño peer-reviewed antes de implementar para evitar API que no calce con los 3 consumers planeados.

### C.1.5 — `packages/trip-state-machine` (A) — coincide con spec

**Justificación**: spec stubs-decision §7.2 declara "es la fuente del drift schema↔domain que ADR-043 resuelve. Una state machine declarativa elimina la fuente del drift estructuralmente." Coincide con principio operativo: trip-state-machine ES bloqueante para resolver drift, no es refactor especulativo.

**Acción**: implementar dentro de S1b (Fase 2 del calendar consolidado ADR-055 + ADR-052):
1. `packages/trip-state-machine/src/index.ts` con XState definitions para trip lifecycle.
2. Estados (mínimo): `draft → submitted → assigned → in_transit → completed → liquidated`.
3. Transitions tipadas + guards declarativos.
4. Tests: cobertura ≥80% conforme CLAUDE.md §1.
5. Refactor: services con lógica de transición implícita (`liquidar-trip.ts`, `confirmar-entrega-viaje.ts`) consumen la state machine.
6. Integración con ADR-043 (drift schema↔domain).

**LOC objetivo**: ~250 (definición XState + tests). Coincide con estimación spec.

### C.1.6 — `packages/carta-porte-generator` (D)

**Justificación PO**: obligación legal Carta Porte (Ley 18.290 Chile, retención 6 años) aplica a transporte de carga regulado. Booster AI pre-TRL-10 sin operación productiva de carga regulada hoy. Obligación no es vigente para el estado actual de producto. Implementación premature.

**Caveat operativo**: si en el futuro Booster AI activa operación con carga regulada, ADR-051 debe revisitarse — C.1.6 se promueve a A con urgencia alta (obligación legal).

**Acción**: idem patrón D, trazabilidad `TODO(spec: stubs-decision §7.2 PROMOVER S4; diferido por ADR-051 hasta activacion caso uso carga regulada productiva)`.

### C.1.7 — `packages/document-indexer` (D)

**Justificación**: spec stubs-decision §7.2 decía ELIMINAR ("indexación está hecha via `apps/api/src/routes/documentos.ts` con Drizzle directo. No hay caso de uso fuera de document-service que requiera abstracción. Mantenerlo es duplicación implícita.").

Bajo principio operativo, **D es más rápido que ELIMINAR**: mantener stub vacío (7 LOC, costo zero) es preferible a ejecutar plan de eliminación (eliminar carpeta + workspace entry + ADR supersede parcial ADR-001). El stub vacío no causa daño funcional ni operativo.

**Acción**: idem D, trazabilidad `TODO(spec: stubs-decision §7.2 ELIMINAR S2; mantenido como stub vacio por ADR-051 - eliminacion diferida por costo operativo zero del stub)`.

**Trade-off explícito**: drift declarativo permanece (CLAUDE.md → realidad). Aceptado bajo priorización producción.

### C.1.8 — `packages/ui-components` (A) — coincide con spec (acelerado)

**Justificación**: spec stubs-decision §7.2 ya identifica 5-8 componentes reutilizables específicos. PO confirma "segunda app frontend planeada" — el caso de uso real existe. Implementación coherente con spec, calendar condicional al inicio de la segunda app.

**Componentes a extraer** (identificados en spec §7.2):
- `ChileanPlate`
- `CompanySwitcher`
- `EmptyState`
- `FormField`
- `Layout`
- `ProtectedRoute`
- `RelativeTime`
- `DemoBanner`
- `ConsentTermsBanner`
- `DocumentosSection`

**Acción**:
1. Crear estructura `packages/ui-components/src/{components,index.ts}`.
2. Mover los 5-8 componentes desde `apps/web/src/components/` a `packages/ui-components/src/components/`.
3. Tests por componente con Vitest + Testing Library.
4. Storybook stories opcional (decisión en sub-ADR si se adopta Storybook).
5. Refactor `apps/web/` para consumir `@booster-ai/ui-components`.
6. Documentar contrato de cada componente (props + design tokens consumidos vía `packages/ui-tokens/`).

**LOC objetivo**: ~600 (moves + tests). Coincide con estimación spec.

**Sprint placement**: condicional al kickoff de segunda app frontend. Si la segunda app está agendada en horizonte ≤3 meses, ejecutar antes de su kickoff (refactor previo). Si horizonte >3 meses, esperar 1 mes antes del kickoff.

---

## Resumen ejecutivo

| Categoría | Stubs | Acción agregada |
|---|---|---|
| Implementación inmediata (S1b) | C.1.5 trip-state-machine | ~250 LOC, parte de S1b |
| Implementación post-S1b | C.1.4 ai-provider | ~3-5 días, sprint dedicado post-Mini-Sprint residual |
| Implementación condicional | C.1.8 ui-components | ~600 LOC, condicional a segunda app frontend |
| Mantenidos como stub con trazabilidad | C.1.1, C.1.2, C.1.3, C.1.6, C.1.7 | 5 stubs, edición de `TODO` para trazabilidad |

**Total LOC nuevo bajo ADR-051**: ~250 (S1b) + ~3-5 días de ai-provider (post-S1b) + ~600 (ui-components condicional). Significativamente menor que spec stubs-decision que proyectaba ~1150 LOC + 3 microservicios extraídos.

---

## Supersedes explícitos sobre stubs-decision

ADR-051 supersede `.specs/stubs-decision/spec.md` §7.1 y §7.2 en los siguientes puntos. La spec mantiene status `Approved` pero los puntos enumerados aquí son **inaplicables a partir de 2026-05-19**:

| Punto stubs-decision | Estado |
|---|---|
| §7.1 `apps/notification-service` PROMOVER S3 | SUPERSEDED por C.1.2 D |
| §7.1 `apps/matching-engine` PROMOVER S3 | SUPERSEDED por C.1.1 D |
| §7.1 `apps/document-service` PROMOVER S4 | SUPERSEDED por C.1.3 D |
| §7.2 `packages/ai-provider` ELIMINAR S2 | SUPERSEDED por C.1.4 A |
| §7.2 `packages/carta-porte-generator` PROMOVER S4 | SUPERSEDED por C.1.6 D |
| §7.2 `packages/document-indexer` ELIMINAR S2 | SUPERSEDED por C.1.7 D |

**Puntos NO superseded** (mantienen vigencia):
- §7.2 `packages/trip-state-machine` PROMOVER S1 → ejecutado en S1b por C.1.5
- §7.2 `packages/ui-components` PROMOVER parcial S2 → ejecutado condicionalmente por C.1.8

**Acción documental adicional**: en `.specs/stubs-decision/spec.md`, agregar al final de §7.1 y §7.2 una nota:

```
> **SUPERSEDED PARCIALMENTE**: ADR-051 (2026-05-19) supersedea 6 de 8 puntos
> bajo principio operativo "tiempo a producción". Ver ADR-051 §"Supersedes
> explícitos sobre stubs-decision" para mapping exacto.
```

---

## Riesgos identificados + mitigations

| Riesgo | Severidad | Mitigation |
|---|---|---|
| Drift declarativo permanente entre CLAUDE.md y realidad por 5 stubs en D | Medio | Trazabilidad `TODO(spec: ...)` por stub; revisión semestral (próxima 2026-11-19) |
| `ai-provider` diseñado con 1 consumer real validado, puede no calzar con futuros | Medio | Diseño peer-reviewed con previsión clara de los 3 consumers; validation gate antes de implementar |
| Obligación legal Carta Porte se activa antes de implementación | Alto | Caveat operativo explícito en C.1.6: si caso de uso productivo se activa, ADR-051 se revisita con urgencia |
| `document-indexer` mantenido como stub vacío indefinidamente vs ELIMINAR de spec | Bajo | Costo operativo zero del stub; revisión 6 meses |
| Calendar ui-components no fijado puede retrasar segunda app frontend | Medio | C.1.8 condicional a calendar de segunda app; ejecutar refactor antes de kickoff |
| `coaching-generator` y `driver-scoring` actualmente usan Vertex SDK directo — refactor a abstracción puede romper código productivo | Alto | Refactor con tests de regresión completos; feature flag para rollback inmediato |

---

## Criterios de re-evaluación de los stubs en D

Los 5 stubs en D (C.1.1, C.1.2, C.1.3, C.1.6, C.1.7) se mantienen hasta que se cumpla **cualquiera** de:

1. **Blast radius operacional**: la funcionalidad inline en `apps/api` causa incidentes recurrentes, deploys bloqueados, o downtime que excede 5x el costo de extracción.
2. **Spec específica ejecutable**: aparece spec MVP del stub correspondiente lista para ejecutarse.
3. **Requirement legal/regulatorio**: ej. Carta Porte se vuelve obligación productiva, GDPR/Ley 19.628 requiere document-indexer, etc.
4. **Requirement de scaling independiente**: ej. notification-service requiere queue scaling distinto que apps/api por volumen.
5. **Revisión 2026-11-19** (6 meses): si ninguno de 1-4 se cumple, considerar ELIMINAR los stubs que sigan vacíos para reducir drift declarativo.

---

## Cierres explícitos

- ADR-051 documenta las 8 decisiones operativas sobre stubs (cierra C.1 de auditoría 2026-05-19).
- 6 puntos de `.specs/stubs-decision/spec.md` §7.1 y §7.2 quedan SUPERSEDED.
- 2 puntos coinciden con spec previa: C.1.5 (S1b) y C.1.8 (condicional a segunda app).
- TD3 del audit (`05_TECH_DEBT_REGISTRY.md`) — recomendación P2 de trazabilidad `TODO(feature: <slug>)` se aplica a los 5 stubs en D.

---

## Refs

- `.specs/stubs-decision/spec.md` (PO-aprobada 2026-05-17, parcialmente superseded por ADR-051)
- `.specs/production-readiness/spec.md` §SC-1 (input bloqueante original)
- `.specs/production-readiness/review.md` §O-4
- `.specs/s1-drift-coverage-e2e/spec.md` (S1b — incluye trip-state-machine implementation)
- `.specs/tripstate-alignment/` (spec relacionada con C.1.5)
- `audit-outputs/05_TECH_DEBT_REGISTRY.md` TD3 (placeholders TODO en servicios skeleton)
- `audit-outputs/01_ARCHITECTURE.md` (árbol anotado con apps `a` y packages `p`)
- ADR-001 — listado original de packages (parcialmente superseded por ADR-051 en `ai-provider`)
- ADR-037 — Vertex AI ADC migration (campo "no multi-provider" implícito superseded por C.1.4)
- ADR-043 — drift schema↔domain (resuelto parcialmente por C.1.5 trip-state-machine)
- ADR-049 (PR #307) — react-pdf-renderer
- ADR-050 (PR #305) — OTel observabilidad
- ADR-052 (PR #309) — refactor Terraform multi-env
- ADR-053 (PR #306) — security headers
- ADR-054 (PR #303) — Arquitecto Maestro
- ADR-055 (PR #308 mergeado) — colisión Sprint 1 vs S1b (define calendar consolidado donde encaja C.1.5)
