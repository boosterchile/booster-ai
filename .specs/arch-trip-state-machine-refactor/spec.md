# Spec: arch-trip-state-machine-refactor

- Author: Felipe Vicencio (with agent-rigor / Claude Opus 4.8)
- Date: 2026-06-02
- Status: **Draft — pendiente de priorizar (NO ejecutado)**
- Tipo: **Refactor arquitectónico** (no nueva feature; no ejecución en esta sesión)
- Linked:
  - Origen: `.specs/adr-vs-prod-inventory/inventory.md` §ADR-004 — finding 🔴 (trip-state-machine stub + lógica inline)
  - ADRs que prometen el estado-objetivo: [ADR-004](../../docs/adr/004-uber-like-model-and-roles.md) §Trip lifecycle como máquina de estados · [ADR-005](../../docs/adr/005-telemetry-iot.md) (referencia el package como pieza del lifecycle)
  - CLAUDE.md §Reglas de arquitectura ("Algoritmos viven en `packages/`. `apps/api/src/services/` orquesta DB/transacciones … Prohibido escribir lógica … inline en services")
  - Precedente XState en el repo: `apps/whatsapp-bot/src/conversation/machine.ts` (patrón ya adoptado, viable)

> ⚠️ **Este spec documenta y planifica un refactor. NO lo ejecuta.** Queda Draft hasta que el PO lo priorice. Es trabajo de **ciclo completo** (spec → plan → build con TDD → verify → review → ship) bajo el estándar "desarrollo profesional, no un parche" — explícitamente **no** un fix puntual ni atajo.

## 1. Objective

Cerrar la brecha narrativa-vs-realidad del finding 🔴 de ADR-004: hoy `packages/trip-state-machine` es un **stub vacío** y la lógica de transiciones del trip lifecycle vive **dispersa inline en `apps/api/src/services/`**. El objetivo es **materializar el lifecycle del viaje como una máquina de estados explícita y verificable en el package**, tal como ADR-004 lo prometió, y reconducir los call-sites de los services a esa máquina — eliminando la lógica de transición inline.

## 2. Why now (por qué importa)

- **Verificado empíricamente 2026-06-02** (inventario ADR-vs-prod):
  - `packages/trip-state-machine/src/index.ts` = **stub de 7 líneas**: comentario `TODO: implementar según ADRs relacionados` + un único `export const PACKAGE_NAME`. `dependencies: {}`. **Cero referencias a XState** en su `src`.
  - Los **estados canónicos SÍ existen** como Zod enum en `packages/shared-schemas/src/domain/trip.ts` (`tripStateSchema`: `requested`, `offered_to_carrier`, `accepted`, `driver_assigned`, `driver_en_route`, `pickup_completed`, `in_transit`, `delivered`, `confirmed_by_shipper`, `completed_rated` + estados de excepción), pero **sin máquina que enforçe las transiciones/guardas**.
  - Las **transiciones se aplican inline y dispersas** en services, entre ellos:
    - `apps/api/src/services/offer-actions.ts` (aceptar/rechazar oferta → transición)
    - `apps/api/src/services/asignar-conductor-a-assignment.ts` (assign driver)
    - `apps/api/src/services/confirmar-entrega-viaje.ts` (delivered → confirmed)
    - `apps/api/src/services/emitir-certificado-viaje.ts` (cierre)
    - `apps/api/src/services/reportar-incidente.ts` (→ failed/disputed)
    - `apps/api/src/services/liquidar-trip.ts` (contiene incluso un `TODO` que admite que el trigger ideal `confirmed_by_shipper` aún no se modela: líneas 15-18)
    - `apps/api/src/services/matching.ts`, `seed-demo.ts` (setean estado directamente)
- **ADR-004 promete** explícitamente (validation checklist): *"El trip lifecycle es una máquina XState con transiciones verificables"* y *"Cada transición tiene guardas (precondiciones), emite eventos al Pub/Sub `trip-events`, persiste snapshot en PostgreSQL"*. La realidad no cumple esa promesa.
- **Viola la regla de arquitectura de CLAUDE.md**: la lógica de dominio (transiciones de estado = algoritmo) debe vivir en `packages/`, no inline en services. El ADR-004 mismo declaró que el lifecycle se modela como state machine *"no como flags ad-hoc en BD"* — hoy es exactamente eso.

## 3. Naturaleza del riesgo (clasificación)

- **NO es un agujero de seguridad externo.** No hay vector explotable desde afuera. Es **deuda arquitectónica** + **narrativa-vs-realidad** (el sistema afirma tener algo que no tiene).
- **Riesgo real (medio, interno)**:
  - Transiciones inválidas posibles: sin guardas centralizadas, un service podría setear un estado inalcanzable o saltarse precondiciones (ej. `delivered` sin pasar por `in_transit`). El riesgo crece con cada nuevo call-site.
  - Mantenibilidad: la lógica del lifecycle no es auditable en un solo lugar (contradice el objetivo TRL 10 de "reconstruir cualquier viaje histórico").
  - Drift de documentación: ADRs y onboarding describen una máquina que no existe.

## 4. Success criteria (del estado-objetivo; se afinan en /plan)

- [ ] **SC-1**: `packages/trip-state-machine` exporta una máquina de estados real (XState, consistente con el precedente `apps/whatsapp-bot/src/conversation/machine.ts`) que modela `tripStateSchema` + estados de excepción, con **guardas por transición** y tipado fuerte (sin `any`).
- [ ] **SC-2**: la máquina es la **única fuente de verdad** de las transiciones; cada transición válida está enumerada y las inválidas son rechazadas por la máquina (no por checks ad-hoc en services).
- [ ] **SC-3**: los call-sites inline en `apps/api/src/services/` (lista §2) se reconducen a la máquina: el service **orquesta** (DB/transacción/Pub/Sub) pero **delega la decisión de transición** al package.
- [ ] **SC-4**: cada transición emite evento a Pub/Sub `trip-events` + persiste snapshot (como promete ADR-004), centralizado, no duplicado por service.
- [ ] **SC-5**: cobertura 80%+ en el package (líneas/branches/funciones); tests de máquina cubren transiciones válidas **y** rechazo de inválidas (afecta integridad de datos → TDD mandatorio per `agent-rigor:31`).
- [ ] **SC-6**: `git grep` no encuentra mutación directa de estado de trip fuera del package (salvo `seed-demo`/fixtures, documentado).
- [ ] **SC-7**: el comentario/promesa de ADR-004 queda satisfecho o, si se desvía del diseño XState, se documenta en un ADR nuevo que lo explique.

## 5. Out of scope

- Cambiar los **nombres de estados** o el contrato del dominio (`tripStateSchema`) — el refactor preserva el comportamiento observable; no redefine el lifecycle.
- Cambiar el schema de BD de `viajes`/`trip_events` salvo lo estrictamente necesario para snapshots (si aplica, va con migración Drizzle propia).
- La máquina de conversación de `whatsapp-bot` (ya existe y es correcta; solo se usa como **referencia de patrón**).
- Cualquier cambio de UX/flujo de negocio del viaje.

## 6. Approach (esbozo — se detalla en /plan, NO se ejecuta aquí)

Migración incremental, cada paso un commit verde, sin cambio de comportamiento observable:

1. **Inventario exhaustivo de call-sites**: mapear cada lugar donde se lee/escribe estado de trip y qué transición representa (extender la lista §2 a cobertura total).
2. **Modelar la máquina** en `packages/trip-state-machine` con XState: estados de `tripStateSchema` + excepción, transiciones, guardas, eventos. Derivar tipos de los schemas Zod del domain (sin `any`).
3. **TDD de la máquina**: tests de transiciones válidas + rechazo de inválidas ANTES de conectar services.
4. **Migrar call-sites uno a uno**: cada service pasa a invocar la máquina; se borra la lógica de transición inline. Un service por commit, suite verde entre cada uno.
5. **Centralizar side-effects** (emit `trip-events` + snapshot) en la capa de transición.
6. **Verify + review** (code-reviewer + devils-advocate; security-auditor no aplica salvo que toque auth) + ADR si el diseño se desvía de lo prometido.

## 7. Risks and mitigations

| Risk | L | I | Mitigation |
|---|---|---|---|
| Refactor introduce regresión en flujos de viaje productivos | M | H | Migración incremental + TDD + integration tests por flujo + suite verde entre commits. Comportamiento observable preservado (§5). |
| Estados/transiciones no documentados emergen al mapear call-sites | M | M | Paso 1 (inventario exhaustivo) antes de modelar; los hallazgos amplían SC. |
| Snapshots/eventos `trip-events` duplicados o perdidos al centralizar | L | H | Tests que verifican exactamente-un-evento por transición; comparar contra comportamiento actual. |
| Scope creep hacia rediseñar el lifecycle | M | M | §5 explícito: preservar contrato; rediseño = ADR separado. |

## 8. Open questions

- **OQ1**: ¿XState v5 (consistente con whatsapp-bot) o se evalúa otra librería? Default: XState, por precedente en el repo.
- **OQ2**: ¿La máquina persiste su snapshot en la tabla `viajes` existente o en `trip_events`? Depende del inventario paso 1.
- **OQ3**: ¿Algún call-site setea estados fuera del enum canónico (drift)? A confirmar en paso 1.

## 9. Decision log

- 2026-06-02 — Draft inicial. Originado por el finding 🔴 de ADR-004 en el inventario ADR-vs-prod (verificación empírica 2026-06-02). Documentado como spec de refactor de ciclo completo, **no ejecutado**; pendiente de priorización por el PO. Trabajo a realizar bajo el estándar "desarrollo profesional, no un parche".
