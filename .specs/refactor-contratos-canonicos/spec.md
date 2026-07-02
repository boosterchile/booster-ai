# Spec: refactor-contratos-canonicos

- Author: Felipe Vicencio (with agent-rigor)
- Date: 2026-06-11
- Status: Approved
- Linked: Auditoría 2026-06-09, riesgos ALTOS "contrato telemetry-events duplicado a mano" y "domain de trips desalineado (doble fuente de verdad)"; follow-up `.specs/_followups/shared-schemas-contratos-canonicos.md`.

## 1. Objective

(1) El wire format REAL del topic `telemetry-events` vive duplicado: interface en el gateway (`pubsub-publisher.ts`) + espejo Zod copiado a mano en el processor (`persist.ts`) — un cambio en el publisher sin actualizar el espejo = descarte silencioso de mensajes. Moverlo a `@booster-ai/shared-schemas` como contrato único con test de serialización en el gateway. (2) Eliminar el vocabulario MUERTO de ADR-004: `tripStateSchema` (17 estados en inglés que ninguna tabla ni código usa), `tripSchema` (shape de una tabla que no existe), `telemetryEventSchema` y los events que los envuelven — cero consumidores fuera de sí mismos; su existencia induce a error (la spec TSM draft se construyó sobre ellos).

## 2. Why now

Prerequisito del refactor trip-state-machine (#18): la máquina debe derivar del enum REAL (`estado_viaje`), y mientras el vocabulario muerto exista, compite como "canónico". El contrato de telemetría es el riesgo alto restante de la auditoría en datos.

## 3. Success criteria

- [ ] `packages/shared-schemas/src/events/telemetry-record.ts` define `telemetryRecordMessageSchema` (el wire REAL) y es la única definición; processor la importa (re-export de compat en persist.ts).
- [ ] El gateway construye el body con `buildWireRecordMessage()` exportado y un test valida que su output (con BigInt/Buffer reales) parsea con el schema compartido — el drift se vuelve un test rojo, no un descarte silencioso en prod.
- [ ] `domain/telemetry.ts`, `domain/trip.ts`, `events/telemetry-events.ts`, `events/trip-events.ts` eliminados; index y all-schemas.test alineados; `git grep tripStateSchema` → 0.
- [ ] La dep shared-schemas del gateway (declarada sin uso — hallazgo de auditoría) pasa a usarse de verdad.

## 4. User-visible behaviour

Ninguno. El wire format no cambia de shape (refactor de dónde vive, no de qué es).

## 5. Out of scope

- Definir el vocabulario canónico de estados de viaje (lo hace el ciclo TSM #18 con su ADR — ahí se documenta formalmente la desviación de ADR-004).
- Los ~18 schemas domain faltantes para otras tablas (gradual; regla CLAUDE.md se reevalúa en el ADR del TSM).
- Tocar el topic/atributos de Pub/Sub.

## 6. Constraints

1. El shape del schema compartido = byte-a-byte el del espejo actual del processor (cero cambio de wire).
2. Compat: `persist.ts` re-exporta `recordMessageSchema`/`RecordMessage` (main.ts, tests y panic-events del branch hermano no se tocan).
3. Eliminar exports públicos del package es seguro: consumidores verificados = 0 (grep repo completo).

## 7. Approach

Mover schema a shared-schemas/events; processor importa; gateway extrae el builder del body (hoy inline en `publish()`) a función pura exportada + test de contrato con datos bigint/Buffer reales; borrar los 4 archivos muertos + index + all-schemas.test.

## 8. Alternatives considered

- **A. Gateway valida su output con el schema en runtime (parse antes de publicar)** — Rechazada: costo por record en el hot path para detectar un drift que un test de CI detecta gratis; el processor ya valida al consumir (defensa real).
- **B. Deprecar los schemas muertos con @deprecated en vez de borrar** — Rechazada: cero consumidores = cero migración necesaria; mantenerlos prolonga la doble fuente de verdad que causó la spec TSM defectuosa.

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Algún consumidor externo no detectado de los schemas muertos | L | M | grep repo completo (apps+packages, 0 hits fuera de shared-schemas); CI typecheck de todos los workspaces lo confirmaría |
| El builder extraído difiere del inline original | L | H | Extracción mecánica + test de contrato con BigInt/Buffer + suite del gateway existente |

## 10. Test list

- T1: shared-schemas — telemetryRecordMessageSchema valida el mensaje canónico (casos del persist.test actual: válido, imei corto, vehicleId null, priority inválida).
- T2: gateway — buildWireRecordMessage con record bigint+Buffer → schema.parse OK (contrato anti-drift).
- T3: processor — suite existente verde sin cambios de comportamiento (re-export compat).
- T4: `git grep -l "tripStateSchema\|telemetryEventSchema"` → vacío.

## 11. Rollout

- Flag: no. Wire sin cambios. Rollback: revert.
- Monitoring: métrica de mensajes malformados del processor (ya existe vía logs) debe permanecer en 0 post-deploy.

## 12. Open questions

None as of 2026-06-11.

## 13. Decision log

- 2026-06-11 — Draft + mandato PO. Borrado (no deprecación) del vocabulario ADR-004 muerto; la desviación formal se documenta en el ADR del ciclo TSM.
