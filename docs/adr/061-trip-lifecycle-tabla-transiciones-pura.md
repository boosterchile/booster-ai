# ADR-061: Trip lifecycle como tabla de transiciones pura (supersede parcialmente ADR-004)

- **Estado**: Accepted
- **Fecha**: 2026-06-11
- **Contexto previo**: [ADR-004](004-uber-like-model-and-roles.md) §Trip lifecycle prometía "una máquina XState con transiciones verificables" que "emite eventos al Pub/Sub trip-events y persiste snapshot en PostgreSQL". El inventario adr-vs-prod (2026-06-02) y la auditoría arquitectónica (2026-06-09) verificaron que `packages/trip-state-machine` era un stub de 7 líneas, las transiciones vivían dispersas en 4+ services con guards locales, y de esa dispersión nacieron dos races reales (resurrección de trips cancelados — PR #436 y su residual en runMatching).
- **Spec del ciclo**: `.specs/arch-trip-state-machine-refactor/` (v2)

## Decisión

1. **El lifecycle del viaje se materializa como TABLA DE TRANSICIONES PURA** en `@booster-ai/trip-state-machine` (zero-dep): `TRANSICIONES`, `puedeTransicionar`, `assertTransicion`, guards semánticos (`esCancelablePorShipper`, `esAceptableOferta`, `esConfirmableEntrega`) y `esEstadoViaje`. Los services orquestan (transacción, `FOR UPDATE`, CAS por estado en el `WHERE`) y delegan al package la **legalidad** de cada transición.
2. **NO se usa XState** (desviación de la promesa literal de ADR-004). Racional: XState modela actores de larga vida con snapshot propio (el precedente del repo — la conversación del whatsapp-bot — es exactamente ese caso). Las transiciones de viaje son operaciones atómicas de BD donde el estado vive en la columna `estado_viaje` de Postgres: una "máquina interpretada" agregaría una dependencia runtime, un snapshot redundante con la columna, y cero capacidad adicional de verificación frente a una tabla pura con test exhaustivo (9×9 producto cartesiano).
3. **Precisión sobre la derivación de la tabla** (review 2026-06-11): la mayoría de las transiciones tiene escritor verificado en código; `borrador→esperando_match`, `borrador→cancelado` y `ofertas_enviadas→expirado` están MODELADAS SIN escritor actual (borrador existe como estado inicial alternativo del enum; el expirado-por-TTL-de-ofertas es un sweeper aún sin dueño — follow-up). Igual que `en_proceso`: la tabla las incluye para que el ciclo que las escriba no re-invente vocabulario, y el test exhaustivo obliga a justificar cualquier cambio.
4. **El vocabulario canónico de estados es el del enum DDL** (`estado_viaje`, 9 estados en español — regla de naming bilingüe del CLAUDE.md). El vocabulario aspiracional de ADR-004 (17 estados en inglés, `tripStateSchema`) tenía **cero consumidores** y fue eliminado (ciclo `refactor-contratos-canonicos`). El package es espejo deliberado del enum con **test de paridad** en apps/api que rompe ante drift.
5. **NO se publica a Pub/Sub `trip-events`** (segunda desviación de ADR-004). El topic existe en IaC sin un solo consumer; publicar eventos que nadie consume es exactamente el patrón de topics huérfanos que la auditoría marcó como anti-señal. La auditoría de transiciones se mantiene en la tabla `eventos_viaje` (append-only, 19 tipos, ya operativa). Si un consumidor real aparece (p.ej. notification-service), la publicación se agrega en ese ciclo con su consumer.
6. Estados `en_proceso` (pickup) quedan **modelados pero sin flujo que los dispare** — los escribirá el ciclo PoD-geofence. La tabla los incluye para que ese ciclo no re-invente transiciones.

## Consecuencias

- Toda transición inválida es imposible de expresar sin tocar la tabla (y su test exhaustivo + el fixture explícito obligan a justificarla en review).
- Los UPDATEs de estado en `runMatching` llevan CAS por estado. Precisión (review 2026-06-11): el CAS del PRIMER update (→emparejando) es el que cierra la carrera real con un cancel concurrente (residual #436); los CAS posteriores (→ofertas_enviadas, →expirado) corren dentro de la misma transacción que ya tiene el row lock — son defensa en profundidad (el invariante queda en el SQL si alguien refactoriza la tx), no cierre de carrera adicional. `emparejando` no es observable fuera de la tx hoy (runMatching es una tx única); si el matching se vuelve multi-paso asíncrono, estos supuestos deben revisarse.
- `confirmar-entrega-viaje` gana `FOR UPDATE` + CAS (review 2026-06-11): dos confirmaciones concurrentes (shipper+carrier) podían ejecutar dos veces la liquidación y el certificado.
- ADR-004 queda superseded SOLO en su §Trip lifecycle (XState + trip-events + snapshot); el modelo de 5 roles y el resto del ADR siguen vigentes.
- La promesa narrativa del repo vuelve a ser verdadera: `git grep` de mutación directa de estado fuera de services orquestadores = solo seed/fixtures (documentado).

## Validación

- `packages/trip-state-machine`: 33 tests (tabla exhaustiva 9×9, terminales, guards ≡ sets históricos, errores tipados); coverage sobre thresholds.
- `apps/api`: suite completa 1429 tests verde post-reconducción; test de paridad enum DDL ↔ package; test CAS de matching (cancel concurrente → `TripRequestNotMatchableError`).
