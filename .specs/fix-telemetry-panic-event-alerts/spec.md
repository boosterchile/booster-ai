# Spec: fix-telemetry-panic-event-alerts

- Author: Felipe Vicencio (with agent-rigor)
- Date: 2026-06-11
- Status: Approved
- Linked: Auditoría 2026-06-09, riesgo ALTO "alertas P0 de seguridad física muertas" (telemetry-monitoring.tf:139-189); decisión PO 2026-06-11: "processor emite eventName" (alcance mínimo real, notification-service queda como ciclo futuro).

## 1. Objective

Hacer disparables las alertas P0 `unplug_event_p0` y `gnss_jamming_p0`: sus log-metrics filtran `jsonPayload.eventName="Unplug"` / `"GnssJamming" + rawValue=2` y aceptan como fuente al `telemetry-processor`, pero ningún servicio emite esos campos — hoy un tamper o jamming de un vehículo NO genera alerta. El processor ya recibe y persiste esos records (AVL 252/318, incluidos los que entran por SMS fallback tras el fix #438): basta con que los detecte y emita el log estructurado con el contrato exacto que el Terraform espera.

## 2. Why now

Es cobertura anti-robo/anti-tamper que el runbook on-call asume; el PR #441 tuvo que marcar las secciones como "ALERTA HOY INOPERANTE". Decisión PO explícita de cerrar esto con el alcance mínimo honesto.

## 3. Success criteria

- [ ] Record con IO 252 (Unplug) valor 1 → `logger.warn` con `{eventName: 'Unplug', rawValue, avlId, imei, vehicleId}` — matchea el filtro del metric.
- [ ] Record con IO 318 (GNSS Jamming) valor ≥1 → warn con `{eventName: 'GnssJamming', rawValue}`; el metric filtra rawValue=2 (crítico) — valor 1 (warning) queda visible en logs sin disparar P0.
- [ ] Funciona para ambos paths de entrada (TCP records multi-IO y SMS fallback single-IO con valor string).
- [ ] Comentarios ⚠️ BLOQUEADO de telemetry-monitoring.tf actualizados (desbloqueado por este cambio) y secciones del runbook on-call vuelven a "operativa".
- [ ] Helper puro testeado + wiring de una línea en main.ts.

## 4. User-visible behaviour

Operador: ante unplug/jamming crítico de un device, la alerta P0 llega al canal de notificación (hoy email) en vez de silencio.

## 5. Out of scope

- notification-service real (fan-out WhatsApp/push de estos eventos) — ciclo futuro per decisión PO.
- Routing a los topics safety-p0/security-p1 (sin consumers; spec _followups).
- Crash (AVL 247): ya tiene path P0 propio vía crash-traces (gateway→GCS/BQ + métricas).
- Dedup/snooze de alertas repetidas mientras la condición persiste (el log se emite por record; la alert policy ya agrega por ventana).

## 6. Constraints

1. Los nombres de campo y valores son CONTRATO con telemetry-monitoring.tf (eventName, rawValue) — no renombrar.
2. La detección no puede bloquear ni romper el ack del record (mismo patrón que green-driving: side-effect de log puro).
3. Valores string (SMS path) se coercionan a número antes de comparar.

## 7. Approach

`apps/telemetry-processor/src/panic-events.ts`: `detectPanicEvents(msg)` puro (entries → eventos) + `logPanicEvents({logger, msg, messageId})` que loguea cada uno con el shape del contrato; main.ts lo invoca tras el parse Zod (antes del persist: el evento alerta aunque el device esté pendiente o el insert falle). TF: actualizar comentarios de desbloqueo. Runbook: secciones Unplug/Jamming vuelven a operativas citando este wiring.

## 8. Alternatives considered

- **A. Emitir desde el gateway (que ve el packet primero)** — Rechazada: el gateway no ve el path SMS fallback (entra directo a Pub/Sub); el processor es el único punto que ve AMBOS paths.
- **B. Gatear por eventIoId (solo el record-evento, no los periódicos)** — Rechazada: durante jamming sostenido los records periódicos siguen trayendo IO 318=2 y QUEREMOS que la métrica siga contando mientras la condición persiste; además el path SMS no siempre marca eventIoId.

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Ruido de warns durante condición sostenida | M | L | Deliberado (§8.B); la alert policy agrega por ventana; volumen acotado (1 record/min/device) |
| Drift futuro entre el log y el filtro TF | L | M | Test asserta los literales 'Unplug'/'GnssJamming'/rawValue; comentario cruzado en ambos lados |
| Falso positivo IO 252 en records sin evento | L | L | Solo valor==1 emite (0 = conectado) |

## 10. Test list

- T1: entries con {id:252, value:1} → un evento Unplug rawValue 1.
- T2: {id:252, value:0} → nada.
- T3: {id:318, value:2} → GnssJamming rawValue 2; {value:'2'} string (SMS) → ídem.
- T4: {id:318, value:0} → nada; valor no numérico → nada (sin throw).
- T5: record con ambos IOs → 2 eventos; logPanicEvents loguea con eventName/rawValue/imei/vehicleId exactos (spy).

## 11. Rollout

- Flag: no (emisión de logs; la alerta ya existe en TF).
- Migración: no. Rollback: revert.
- Monitoring: post-deploy, forzar un record de prueba con IO 318=2 (smoke-test-wave-3 --imei con IMEI de prueba o replay) y verificar que la métrica `telemetry/gnss_jamming_critical_events` produce serie y la policy dispara al canal.

## 12. Open questions

None as of 2026-06-11.

## 13. Decision log

- 2026-06-11 — Draft + decisión PO (alcance mínimo processor). Emisión por record (no solo evento) deliberada, §8.B.
