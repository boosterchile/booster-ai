# Spec: feat-retencion-posiciones-movil

- Author: Felipe Vicencio (with agent-rigor)
- Date: 2026-06-11
- Status: Approved
- Linked: Auditoría 2026-06-09, seguimiento BD ("posiciones_movil_conductor sin dedup ni retención, ~1 punto/10s por conductor activo; solo se consume el último punto"); migración 0025 prometía "políticas de retención independientes" que no existían.

## 1. Objective

Cron diario que purga `posiciones_movil_conductor` (GPS de browser) con retención de 30 días, PRESERVANDO siempre la última posición por vehículo: `/flota` usa esa tabla como fallback para vehículos sin Teltonika — purgar a ciegas dejaría vehículos inactivos sin posición alguna.

## 2. Why now

La tabla crece sin límite (bigserial, alto volumen) en una instancia de 1 vCPU/6GB y solo se consume el último punto por vehículo.

## 3. Success criteria

- [ ] `purgarPosicionesMovil({db, retentionDays=30})`: DELETE de filas con `timestamp_device` < cutoff EXCEPTO la más reciente por vehículo; retorna conteo.
- [ ] POST /admin/jobs/purgar-posiciones-movil (mismo patrón OIDC de los jobs existentes) + cron diario en scheduling.tf.
- [ ] Tests del service (SQL preserva-último + conteo) y del route.

## 4. User-visible behaviour

Ninguno: la última posición por vehículo sobrevive siempre; solo desaparece histórico >30d que nada consume.

## 5. Out of scope

- Partición/retención de telemetria_puntos (requiere ventana de mantenimiento — follow-up actualizado con plan).
- Reescritura LATERAL de /flota — DIFERIDA con condición de reapertura explícita (ver decision log y follow-up): tocar el endpoint más visible de la PWA al final de una ola larga es riesgo evitable; se reabre al superar 50 devices o P95 de /flota > 300ms.
- Dedup de posiciones (la migración 0025 lo descartó deliberadamente).

## 6. Constraints

1. El DELETE jamás elimina la última fila por vehículo (subquery DISTINCT ON).
2. Mismo patrón de seguridad que los 5 jobs existentes (OIDC internal-cron-invoker; el endpoint no es público).

## 7. Approach

Service puro-orquestador con SQL parametrizado + route en admin-jobs + `google_cloud_scheduler_job` diario 04:30 America/Santiago (valle de tráfico).

## 8. Alternatives considered

- **A. TTL por partición** — Rechazada acá: particionar esta tabla es parte del trabajo mayor de telemetría (follow-up); el DELETE diario es suficiente al volumen actual y reversible.
- **B. Purga sin preservar el último punto** — Rechazada: rompe el fallback de /flota para vehículos sin Teltonika inactivos >30d.

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| DELETE grande bloquea la tabla en el primer run | M | L | Hora valle + el DELETE usa el índice (vehiculo, ts); si el primer run es masivo, statement_timeout del job lo corta y reintenta el cron siguiente (idempotente) |
| Subquery preserva-último se rompe con cambios de schema | L | M | Test que verifica que el id más reciente por vehículo NO está en el set borrado |

## 10. Test list

- T1: filas viejas se borran; la más reciente por vehículo sobrevive aunque sea > cutoff de antigüedad.
- T2: tabla sin filas viejas → deleted 0 (idempotente).
- T3: route responde ok+deleted (OIDC middleware ya cubierto por tests existentes de admin-jobs).

## 11. Rollout

- Migración: no. Flag: no (cron nuevo; aplicar TF lo activa).
- Rollback: pausar/eliminar el scheduler job (los datos borrados >30d no se recuperan — son posiciones efímeras por diseño).
- Monitoring: log del job con deleted count; si deleted crece anómalo, revisar frecuencia de reporte del browser.

## 12. Open questions

None as of 2026-06-11.

## 13. Decision log

- 2026-06-11 — Draft + mandato PO. /flota LATERAL diferido con condición de reapertura (>50 devices o P95>300ms) — registrado también en `.specs/_followups/telemetria-particion-y-retencion.md`; la decisión se toma para proteger el endpoint más visible, no por falta de tiempo (drift-check: condición objetiva, no aplazamiento vago).
