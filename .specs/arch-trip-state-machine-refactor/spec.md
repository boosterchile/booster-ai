# Spec: arch-trip-state-machine-refactor

- Author: Felipe Vicencio (with agent-rigor / v1 Opus 4.8 2026-06-02; v2 Fable 5 2026-06-11)
- Date: 2026-06-02 (v1 Draft) / 2026-06-11 (v2 Approved)
- Status: Approved (ejecución autorizada por el PO 2026-06-10: "después de mergear los P0" → esta sesión)
- Linked:
  - Origen: inventario adr-vs-prod §ADR-004 finding 🔴 + auditoría 2026-06-09 (riesgos altos: TSM placeholder con transiciones dispersas; resurrección vía runMatching como tercer escritor — residual del review de #436)
  - ADR-004 §Trip lifecycle (promesa XState) — la desviación se documenta en ADR-061 (este ciclo)
  - CLAUDE.md §Reglas de arquitectura ("algoritmos viven en packages")
  - Prerequisito ejecutado: `refactor-contratos-canonicos` eliminó el vocabulario muerto de 17 estados en inglés (tripStateSchema) sobre el que la v1 de esta spec se había construido

## 1. Objective

Materializar el lifecycle del viaje como **tabla de transiciones explícita y verificable** en `packages/trip-state-machine` (hoy stub de 7 líneas) y reconducir los call-sites inline de `apps/api/src/services/` a esa única fuente de verdad. La máquina modela el **enum real** `estado_viaje` (9 estados en español, `apps/api/src/db/schema.ts:211`) — NO el vocabulario aspiracional de ADR-004 (eliminado por el ciclo de contratos canónicos). Además cierra el residual del review de #436: los UPDATEs de `runMatching` sin guard de estado podían resucitar un trip cancelado durante la ventana de matching.

## 2. Why now

Los dos races de estado encontrados (cancel/accept en #436; matching como tercer escritor, residual aceptado) son consecuencia directa de transiciones dispersas en 4+ archivos con guards locales. El fix táctico cerró el primero; esta es la causa raíz. El PO autorizó este ciclo para esta sesión.

## 3. Success criteria

- [ ] SC-1: el package exporta `ESTADOS_VIAJE`, `TRANSICIONES` (tabla completa), `puedeTransicionar`, `assertTransicion` (+`TransicionViajeInvalidaError` tipado), `esEstadoViaje` (validación boundary) y guards semánticos (`esCancelablePorShipper`, `esAceptableOferta`, `esConfirmableEntrega`, `esTerminal`). Zero-dep, puro, sin `any`.
- [ ] SC-2: las transiciones válidas están enumeradas en UN lugar; toda transición inválida es rechazada por la tabla, no por checks ad-hoc.
- [ ] SC-3: matching.ts, offer-actions.ts, confirmar-entrega-viaje.ts y el cancel de trip-requests-v2.ts derivan sus guards del package (cero Sets locales de estados); los contratos de error HTTP existentes se preservan.
- [ ] SC-4 (v2): los UPDATEs de estado de `runMatching` llevan **guard de estado en el WHERE** (CAS) — un cancel concurrente gana y el matching aborta limpio, cerrando la resurrección por tercer escritor.
- [ ] SC-5: cobertura ≥80% del package; tests de TODAS las transiciones válidas y rechazo de inválidas (TDD — integridad de datos).
- [ ] SC-6: test de paridad en apps/api: `ESTADOS_VIAJE` ≡ `tripStatusEnum.enumValues` (el espejo deliberado tiene test que rompe ante drift — patrón que la auditoría pidió para los packages espejo).
- [ ] SC-7: ADR-061 documenta la desviación de ADR-004: tabla pura en vez de XState, y eventos de auditoría vía `eventos_viaje` (existente) en vez de publicar al topic `trip-events` (sin consumers; evita otro topic huérfano).

## 4. User-visible behaviour

Ninguno: refactor con comportamiento observable preservado. Único cambio externo posible: 409s más consistentes en races extremos (matching vs cancel) que antes corrompían estado.

## 5. Out of scope

- Estados de ASIGNACIONES (asignado/recogido/entregado) — mini-lifecycle propio; el PoD-geofence (spec en DEFINE) lo retomará.
- Escribir las transiciones a `en_proceso` (pickup) — la tabla las MODELA (asignado→en_proceso→entregado) pero ningún flujo las dispara aún; las escribirá PoD-geofence.
- Publicar a Pub/Sub `trip-events` (desviación documentada en ADR-061).
- `seed-demo`/fixtures que setean estado directo (fixtures exentos, documentado).
- `asignar-conductor-a-assignment.ts` (MUTABLE_STATUSES es de assignments, no de trips).

## 6. Constraints

1. Package zero-dep (patrón matching-algorithm/carbon-calculator); el enum DDL sigue viviendo en schema.ts (Drizzle) — espejo con test de paridad, no import.
2. La concurrencia se resuelve en los services (FOR UPDATE + CAS en WHERE); el package decide LEGALIDAD, no atomicidad — separación orquestación/algoritmo del CLAUDE.md.
3. `export const PACKAGE_NAME` se conserva (smoke test del ciclo ci-tooling lo consume); vitest.config idéntico al de ese ciclo para merge limpio.

## 7. Approach

Tabla `TRANSICIONES` (la FSM real verificada en código):
```
borrador         → esperando_match | cancelado
esperando_match  → emparejando | cancelado
emparejando      → ofertas_enviadas | expirado | cancelado
ofertas_enviadas → asignado | cancelado | expirado
asignado         → en_proceso | entregado
en_proceso       → entregado
entregado / cancelado / expirado → ∅ (terminales)
```
Guards semánticos = los Sets que hoy viven inline (CANCELLABLE_STATUSES, STATUS_CONFIRMABLE, check de accept). Services: reemplazan sus checks por el package y agregan CAS de estado en los WHERE de matching (3 UPDATEs: →emparejando, →ofertas_enviadas, →expirado).

## 8. Alternatives considered

- **A. XState (promesa literal de ADR-004; precedente whatsapp-bot)** — Rechazada: XState modela actores de larga vida con snapshots persistidos (la conversación del bot); las transiciones de trip son operaciones atómicas de BD donde el estado vive en Postgres y la decisión es una consulta a una tabla. XState agregaría dep runtime, interpretación de máquina y un snapshot redundante con la columna `estado`. ADR-061 formaliza la desviación (ADR-004 se supersede parcialmente, no se edita).
- **B. Enum + tabla DENTRO de shared-schemas** — Rechazada: CLAUDE.md declara el package en el stack core (ADR-001) y la lógica de transición es algoritmo, no schema.
- **C. Trigger/constraint SQL de transiciones** — Rechazada: invisible al código TS, no testeable unitariamente, anti-patrón del repo.

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| La tabla modela transiciones que el código real no hace (drift narrativo inverso) | M | M | Tabla derivada SOLO de call-sites verificados (auditoría + lectura 2026-06-11); en_proceso documentado como modelado-no-disparado |
| CAS en matching rompe el happy path (0 filas por carrera benigna) | L | M | returning + error tipado existente (TripRequestNotMatchableError) — mismo contrato HTTP |
| Conflicto de merge con ci-tooling (mismos archivos stub) | M | L | vitest.config/package.json byte-idénticos; tests reales en archivos nuevos; PACKAGE_NAME conservado |
| Regresión en flujos de viaje productivos | M | H | TDD del package antes de reconducir; suites de matching/offers/cancel/confirmar verdes; contratos de error preservados (riesgo heredado v1) |

## 10. Test list

- T1: cada transición válida de la tabla → puedeTransicionar true; TODAS las demás combinaciones (9×9) → false (producto cartesiano exhaustivo).
- T2: assertTransicion lanza TransicionViajeInvalidaError con from/to/permitidas correctos.
- T3: terminales no transicionan; esTerminal correcto.
- T4: guards semánticos ≡ sets históricos (cancelable: 4 estados; confirmable: asignado+en_proceso; aceptable: solo ofertas_enviadas).
- T5: esEstadoViaje rechaza strings fuera del enum.
- T6 (apps/api): paridad ESTADOS_VIAJE ≡ tripStatusEnum.enumValues.
- T7 (apps/api): matching con CAS 0 filas (cancel concurrente) → TripRequestNotMatchableError; suites existentes verdes sin cambio de contrato.

## 11. Rollout

- Flag: no (refactor de comportamiento preservado + endurecimiento CAS). Migración: no.
- Rollback: revert del PR completo.
- Monitoring: errores tipados existentes; sin logs nuevos.

## 12. Open questions

None as of 2026-06-11 (OQ1 resuelta: tabla pura, ADR-061; OQ2 resuelta: sin snapshot — el estado ES la columna; OQ3 resuelta: cero estados fuera del enum, verificado).

## 13. Decision log

- 2026-06-02 — v1 Draft (basada en tripStateSchema de ADR-004). Pendiente de priorización.
- 2026-06-11 — v2: la v1 estaba construida sobre vocabulario MUERTO (17 estados en inglés, cero consumidores — eliminado en refactor-contratos-canonicos). Base nueva: enum real `estado_viaje`. XState → tabla pura (ADR-061). SC-4 nuevo: CAS en matching (residual #436). Sin publicación a trip-events (topic sin consumers; ADR-061). Ejecución autorizada por el PO.
