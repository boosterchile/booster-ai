# Spec: stubs-decision

- Author: Felipe Vicencio (con agent-rigor)
- Date: 2026-05-17
- Status: **Approved** (PO 2026-05-17, junto con spec.md + roadmap.md v2 de production-readiness)
- Linked: [`../production-readiness/spec.md`](../production-readiness/spec.md) §SC-1, [`../production-readiness/review.md`](../production-readiness/review.md) §O-4

---

## 1. Objective

Tomar una decisión binaria por cada placeholder (3 apps + 5 packages) detectado en el inventory 2026-05-14: **eliminar del repo** o **promover a implementación con cobertura ≥80/80/80/80**. La decisión queda registrada en esta spec + (cuando corresponda) en un ADR de supersede del listado de packages original (ADR-001). Esta sub-spec es **input bloqueante de SC-1** de la spec maestra: sin decisión aprobada, el sprint S2 no puede arrancar.

## 2. Why now

El inventory mostró 8 archivos placeholder de 7–13 LOC con contenido textual `TODO: implementar según ADRs relacionados. Este archivo es un placeholder para que el monorepo compile.` Su existencia degrada el contrato CLAUDE.md §1 ("Cero deuda técnica desde day 0", "Sin features sin tests") y crea drift entre arquitectura documentada en ADR-001 y arquitectura real. Devils-advocate objection O-4 hizo explícito que SC-1 no es auditable mientras estas decisiones queden abiertas hasta S2; resolver ahora elimina ambigüedad.

## 3. Success criteria

- [ ] **SD-1** — Una decisión binaria por cada stub (8 total) registrada en §7.
- [ ] **SD-2** — ADR creado si la decisión incluye eliminar packages declarados en ADR-001 (cubre el "patrón cross-package" de CLAUDE.md §"Cómo decido cuándo preguntar vs ejecutar").
- [ ] **SD-3** — Para cada "implementar": LOC estimado + scope mínimo + sprint donde se ejecuta.
- [ ] **SD-4** — Para cada "eliminar": confirmación de que ningún `import` activo referencia el package (verificable con `grep -r '@booster-ai/<pkg>' apps packages`).
- [ ] **SD-5** — Spec aprobada por PO **antes** del inicio de S2 (cubre dependencia S2 del roadmap).

## 4. User-visible behaviour

Ninguno directo. Esta es una decisión interna de housekeeping. Indirectamente:
- Devs (futuros + Claude) ven sólo packages con código real, no placeholders engañosos.
- ADRs reflejan la realidad de qué se exporta como artefacto.
- Coverage CI no falsea reportes por excluir stubs declarados como exentos.

## 5. Out of scope

- **Implementación real** de los stubs que se decida promover. Cada uno tendrá su propio sprint o se absorbe en el sprint que lo necesita (ej: `apps/notification-service` se implementa en S3; `packages/carta-porte-generator` se decide en S4 según necesidad de `apps/document-service`).
- **Refactor masivo** de imports. Si un package se elimina pero algún consumer está por reescribirse de todas formas, el reemplazo se hace en el sprint del consumer, no aquí.
- **Nuevos packages**. Esta spec sólo decide sobre los 8 stubs existentes; agregar nuevos sigue el ciclo /spec normal.

## 6. Constraints

- **Consistencia con ADR-001**: si la decisión elimina packages listados en ADR-001 §"Total post-ADR-012… ~20 packages", crear ADR de supersede.
- **Consistencia con ADR-012**: si la decisión afecta packages listados como "nuevos post-ADR-012" (`packages/digital-twin`, `packages/urban-observatory-queries`, `packages/traffic-condition-detector`, `packages/route-alternatives-evaluator`), respetar que ese ADR los introduce; esta spec NO los toca (no existen aún).
- **No degradar coverage**: eliminar un stub no debe romper la suite. Verificable con `pnpm test` post-decisión.

## 7. Approach — decisión por stub

### 7.1 Apps stub

| Stub | Decisión | Razón | Donde se ejecuta |
|---|---|---|---|
| `apps/notification-service` | **PROMOVER** | Capacidad declarada en README + ADR-004. Hoy "inlined" en `apps/api/src/services/notify-*.ts`. Extracción reduce blast radius + permite scaling independiente. | **S3** (cubre SC-9). |
| `apps/matching-engine` | **PROMOVER** | Idem. Capacidad declarada en README + ADR-023/033 (matching V1/V2). Hoy en `apps/api/src/services/matching*.ts` + `packages/matching-algorithm`. | **S3** (cubre SC-10). |
| `apps/document-service` | **PROMOVER** | Idem. Capacidad declarada en README + ADR-007 (Chile docs) + ADR-024 (Sovos). Hoy en `apps/api/src/routes/documentos.ts` + `packages/dte-provider` + `packages/carta-porte-generator`. | **S4** (cubre SC-11). |


---

> **SUPERSEDED PARCIALMENTE**: ADR-051 (2026-05-19) supersedea puntos
> específicos de esta sección bajo el principio operativo "tiempo a producción"
> declarado por PO 2026-05-19. La sección mantiene status `Approved` pero los
> puntos enumerados en `docs/adr/ADR-051-resolucion-8-stubs.md` §"Supersedes
> explícitos sobre stubs-decision" quedan inaplicables a partir de esa fecha.
>
> Mapping exacto: 6 de 8 stubs superseded (matching-engine, notification-service,
> document-service, ai-provider, carta-porte-generator, document-indexer).
> Coinciden y mantienen vigencia: trip-state-machine y ui-components.

### 7.2 Packages stub

| Stub | Decisión | Razón | Acción |
|---|---|---|---|
| `packages/ai-provider` | **ELIMINAR** | El plan original era abstracción Gemini/Claude. La realidad post-ADR-037 (Vertex AI ADC migration) es que `apps/api/src/services/gemini-client.ts` y `packages/coaching-generator` / `packages/driver-scoring` usan Vertex SDK directo. No hay segundo provider en horizonte de production-readiness. Mantener el package crea ambigüedad sin valor. | Eliminar carpeta + workspace entry; ADR de supersede parcial ADR-001. **Ejecuta en S2.** |
| `packages/carta-porte-generator` | **PROMOVER** | Capacidad declarada explícita en README + ADR-007. Hoy la lógica de generación PDF está dispersa en `apps/api/src/services/`. Extracción mejora reuso cuando `apps/document-service` se extrae en S4. | **Implementar en S4** como parte del scaffold de `apps/document-service`. Cubre SC-1 ya cuando S4 cierra. |
| `packages/document-indexer` | **ELIMINAR** | El plan original era CRUD docs. La realidad es que la indexación está hecha via `apps/api/src/routes/documentos.ts` con Drizzle directo. No hay caso de uso fuera de `document-service` que requiera abstracción. Mantenerlo es duplicación implícita. | Eliminar + ADR de supersede parcial ADR-001. **Ejecuta en S2.** |
| `packages/trip-state-machine` | **PROMOVER** | Capacidad declarada explícita en README + comentarios en código original ("XState machines"). Hoy la state transition lógica está implícita en services (`liquidar-trip.ts`, `confirmar-entrega-viaje.ts`, etc.) y es la fuente del drift schema↔domain que ADR-043 resuelve. Una state machine declarativa elimina la fuente del drift estructuralmente. | **Implementar en S1** como parte del fix de drift (ADR-043). LOC estimado ~250 (definición XState + tests). |
| `packages/ui-components` | **PROMOVER** parcial | Capacidad declarada en README (shadcn/ui + componentes Booster). Hoy `apps/web/src/components/` tiene ~42 componentes; algunos son obviamente reutilizables (`ChileanPlate`, `CompanySwitcher`, `EmptyState`, `FormField`, `Layout`, `ProtectedRoute`, `RelativeTime`, `DemoBanner`, `ConsentTermsBanner`, `DocumentosSection`). | **Extraer 5-8 componentes reutilizables** a `packages/ui-components` en S2 + tests por componente. NO mover todo (los componentes específicos de una página quedan en `apps/web`). LOC estimado ~600 (moves + tests). |


---

> **SUPERSEDED PARCIALMENTE**: ADR-051 (2026-05-19) supersedea puntos
> específicos de esta sección bajo el principio operativo "tiempo a producción"
> declarado por PO 2026-05-19. La sección mantiene status `Approved` pero los
> puntos enumerados en `docs/adr/ADR-051-resolucion-8-stubs.md` §"Supersedes
> explícitos sobre stubs-decision" quedan inaplicables a partir de esa fecha.
>
> Mapping exacto: 6 de 8 stubs superseded (matching-engine, notification-service,
> document-service, ai-provider, carta-porte-generator, document-indexer).
> Coinciden y mantienen vigencia: trip-state-machine y ui-components.

### 7.3 Resumen

- **Eliminar**: 2 packages (`ai-provider`, `document-indexer`) — ADR de supersede parcial ADR-001.
- **Promover en S1**: 1 package (`trip-state-machine`) integrado con ADR-043.
- **Promover en S2**: 1 package (`ui-components`) extraídos 5-8 componentes.
- **Promover en S3**: 2 apps (`notification-service`, `matching-engine`).
- **Promover en S4**: 1 app (`document-service`) + 1 package (`carta-porte-generator`) como parte del scaffold.

Total LOC estimado para promoción: ~250 (trip-state-machine) + ~600 (ui-components moves) + LOC propio de los 3 microservicios (calculado en cada sprint individual) + LOC carta-porte-generator (~300 estimado).

## 8. Alternatives considered

- **A. Eliminar TODOS los stubs y agregar packages cuando se necesiten** — Rechazada. ADR-001 listó los packages como parte del diseño; eliminar arbitrariamente requiere ADRs múltiples + invalida diseño documentado. Eliminar selectivamente (los que ya no aplican) es más honesto.

- **B. Implementar TODOS los stubs antes de seguir** — Rechazada. `packages/ai-provider` y `packages/document-indexer` no tienen caso de uso real post-ADR-037 y post-arquitectura actual. Implementarlos sería YAGNI.

- **C. Mantener stubs con TODO comments (status quo)** — Rechazada explícitamente por CLAUDE.md §1 ("Cero deuda técnica desde day 0", "Sin features sin tests") y SC-1.

- **D. Decidir cada stub en su propio sprint sin esta sub-spec** — Rechazada por O-4 review.md: SC-1 es bloqueante de la spec maestra; necesita decisión cerrada antes de S2.

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Eliminar `ai-provider` deja referencia colgada en algún `package.json` o `import` | L | L | Verificación `grep -r '@booster-ai/ai-provider' apps packages` antes de eliminar. |
| Implementar `trip-state-machine` en S1 expande scope del fix de drift más de lo esperado | M | M | Limitar XState a estados ya documentados en `domain/trip.ts` post-ADR-043. No agregar estados nuevos en S1. |
| Mover componentes a `ui-components` rompe imports en `apps/web` | M | M | Move con `git mv` + actualización de imports + `pnpm typecheck` antes de commit. |
| ADR-001 supersede parcial confunde lectores futuros | L | L | ADR nuevo explicita exactamente qué packages elimina + razón + fecha. |
| `carta-porte-generator` resulta no necesario tras S4 scaffold (lógica inline en `apps/document-service` basta) | M | L | Decisión final se reconfirma en spec de S4. Si no es necesario, eliminar (un commit, no scope creep). |

## 10. Test list

- **TS-1** (SD-4): `grep -r '@booster-ai/ai-provider' apps packages --include='*.ts' --include='*.json' --include='*.tsx'` retorna 0 hits antes del commit que elimina el package.
- **TS-2** (SD-4): idem para `@booster-ai/document-indexer`.
- **TS-3** (SD-3 trip-state-machine): post-S1, `packages/trip-state-machine/src/index.ts` tiene XState machine con ≥4 estados documentados; `packages/trip-state-machine/src/*.test.ts` cubre ≥80/80/80/80.
- **TS-4** (SD-3 ui-components): post-S2, `packages/ui-components/src/` exporta ≥5 componentes; `apps/web/src/components/` ya no tiene las copias originales; coverage ≥80/80/80/80.
- **TS-5** (SD-1): `find apps packages -path '*src*' -name 'index.ts' -size -1k -exec grep -l 'TODO: implementar' {} \;` retorna 0 hits al cierre de S4 (cuando todos los stubs están resueltos).
- **TS-6** (SD-2): si decisión eliminar incluye packages de ADR-001, existe ADR-XXX en `docs/adr/` con `Status: Accepted` y `supersedes_partial: 001`.

## 11. Rollout

- **No es feature-flagged** (es housekeeping).
- **No requiere migration**.
- **Rollback plan**: cada decisión es un commit (o pequeño set de commits) revertible. Si tras eliminar `ai-provider` se descubre uso real, revert del commit restaura el placeholder; luego se decide qué hacer.
- **Monitoring**: no aplica (cambios doc/structure-only en mayoría).

## 12. Open questions

- **OQ-1** — Al extraer componentes a `ui-components`, ¿se mantiene `apps/web/src/components/` para componentes no-reutilizables o se prefija convención? Resolución: spec del sprint S2 decide convención de naming.
- **OQ-2** — `packages/trip-state-machine` XState v4 o v5? Resolución: spec del sprint S1 elige (recomendación: v5, vigente al 2026-05-17).

## 13. Decision log

- **2026-05-17** — Initial draft post devils-advocate O-4 (review.md). Decisiones por stub formalizadas.
- **2026-05-17** — **APPROVED por PO** junto con spec maestra. Ejecución: T-stubs-elim en S2 (eliminar `ai-provider` + `document-indexer`); T-trip-state-machine en S1 con ADR-043; T-ui-components en S2; promoción de 3 apps + `carta-porte-generator` integradas a S3/S4.
