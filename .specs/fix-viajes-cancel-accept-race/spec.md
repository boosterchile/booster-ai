# Spec: fix-viajes-cancel-accept-race

- Author: Felipe Vicencio (with agent-rigor)
- Date: 2026-06-10
- Status: Approved
- Linked: Auditoría arquitectónica 2026-06-09, riesgo alto #2 (verificado independientemente)

## 1. Objective

Cerrar el race entre cancelación de viaje y aceptación de oferta: hoy `acceptOffer` no valida el estado del trip (solo el de la oferta), y la cancelación no invalida ofertas pendientes. Secuencia rota: shipper cancela → carrier acepta una oferta aún `pendiente` → el trip "resucita" de `cancelado` a `asignado`. También existe el race inverso: cancel que pisa un trip recién asignado, porque el UPDATE de cancel no re-verifica estado.

## 2. Why now

Es corrupción de estado de negocio en el flujo core del marketplace (un transportista puede quedar despachado a un viaje que el shipper canceló). Hallazgo de severidad alta verificado en la auditoría; el fix definitivo (trip-state-machine centralizada) viene en ciclo aparte (`.specs/arch-trip-state-machine-refactor/`), este es el cierre táctico.

## 3. Success criteria

- [ ] `acceptOffer` bloquea la fila del trip (`SELECT ... FOR UPDATE`) y exige `status === 'ofertas_enviadas'`; cualquier otro estado lanza `TripNotAcceptableError` → 409.
- [ ] La cancelación corre en transacción, bloquea la fila del trip y re-verifica `CANCELLABLE_STATUSES` post-lock; las ofertas `pendiente` del trip pasan a `expirada` en la misma transacción.
- [ ] Ambos lados serializados: cualquiera de los dos órdenes de llegada produce un solo ganador y un 409 limpio para el perdedor.
- [ ] Tests unitarios de ambos lados del race.

## 4. User-visible behaviour

- Carrier que acepta una oferta de un viaje cancelado recibe 409 `trip_not_acceptable` (antes: 201 con assignment fantasma).
- Shipper que cancela un viaje que acaba de ser asignado recibe 409 `trip_not_cancellable` (ya existía el código de error; ahora también cubre el race).
- Las ofertas de un viaje cancelado desaparecen como `expirada` para los carriers (antes quedaban `pendiente` y aceptables hasta su TTL).

## 5. Out of scope

- Máquina de estados centralizada (ciclo arch-trip-state-machine-refactor).
- Nuevo valor de enum `cancelada` para ofertas (requiere migración; ver §8.B).
- Notificar a carriers cuando sus ofertas se invalidan por cancelación (mejora UX, no corrección).

## 6. Constraints

1. Sin migraciones de BD (fix táctico; los estados existentes alcanzan).
2. Errores tipados mapeados en el route layer, patrón existente de offer-actions.
3. Compatible con el harness de mocks de test/unit (colas select/update/insert).

## 7. Approach

En `acceptOffer` (apps/api/src/services/offer-actions.ts): tras validar la oferta, `SELECT ... FOR UPDATE` del trip dentro de la tx + guard `status === 'ofertas_enviadas'`; nuevo error `TripNotAcceptableError` mapeado a 409 en routes/offers.ts. En el cancel (apps/api/src/routes/trip-requests-v2.ts): envolver en `db.transaction` con `SELECT ... FOR UPDATE` + re-check de CANCELLABLE_STATUSES, UPDATE de trips, UPDATE de offers pendiente→expirada y evento con `invalidated_offers` en el payload. El FOR UPDATE en ambos lados serializa: el segundo en llegar ve el estado final del primero.

## 8. Alternatives considered

- **A. Guard solo por WHERE condicional en los UPDATE (sin FOR UPDATE)** — Rechazada: cierra el lost-update pero deja ventanas de lectura sucia entre el SELECT inicial y el UPDATE; el FOR UPDATE da serialización completa por fila con costo despreciable a este volumen.
- **B. Nuevo estado de oferta `cancelada` via migración** — Rechazada para este fix: `expirada` ya modela "oferta que dejó de ser aceptable sin acción del carrier" y evita una migración; la distinción semántica fina queda para el refactor TSM.

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Deadlock entre accept y cancel por orden de locks | L | M | Ambos toman primero el lock del trip (mismo orden); accept toca offers después, cancel también |
| Harness de mocks no soporta `.for()` | M | L | Se agrega `for` al chain del mock (test-only) |
| Trips legacy en estados raros quedan no-aceptables | L | L | Es el comportamiento correcto: solo `ofertas_enviadas` es aceptable por diseño |

## 10. Test list

- T1: acceptOffer con trip `cancelado` → TripNotAcceptableError (el caso de la auditoría).
- T2: acceptOffer con trip `expirado`/`asignado` → TripNotAcceptableError.
- T3: acceptOffer con trip inexistente → TripNotAcceptableError(status='missing').
- T4: acceptOffer happy path sigue funcionando (trip `ofertas_enviadas` en la cola de selects).
- T5: cancel invalida ofertas pendientes (UPDATE offers → expirada) y registra invalidated_offers en el evento.
- T6: cancel con trip ya `asignado` (post-lock) → 409 trip_not_cancellable.
- T7: route /offers/:id/accept mapea TripNotAcceptableError → 409 trip_not_acceptable.

## 11. Rollout

- Feature-flagged? No — corrección de invariante; el comportamiento anterior es un bug.
- Migration needed? No.
- Rollback plan: revert del commit.
- Monitoring: logs `offer accepted` / `trip cancelled by shipper` existentes; alerta natural = aumento de 409 trip_not_acceptable (esperado solo en races reales).

## 12. Open questions

None as of 2026-06-10.

## 13. Decision log

- 2026-06-10 — Draft + aprobación del PO vía "ejecutar lo propuesto en el punto 6". Invalidación usa `expirada` (sin migración).
