# Spec — Telemetry monitoring observability fix

**Estado**: DEFINE
**Fecha**: 2026-06-08
**Autor**: Claude (agente) + Felipe Vicencio (PO)
**Gatillo**: incidente 2026-06-07/08 — telemetría Teltonika→Booster caída ~26h sin que ninguna alerta sonara.

## 1. Contexto / problema

El 2026-06-07 19:09 UTC el `telemetry-processor` (Cloud Run, consumidor Pub/Sub
StreamingPull) dejó de consumir `telemetry-events-processor-sub` al escalar a cero
(`min-instances=0` + `cpu-throttling=true` incompatibles con un consumer pull). La
ingesta a `telemetria_puntos` estuvo caída **~26h** y **ninguna alerta disparó**.

Investigación (datos en vivo, ver §Evidencia) reveló **tres** problemas, no uno:

1. **No existe alerta de "consumer detenido".** La única señal cercana
   (`pubsub_backlog_p2`, umbral conteo 1000) es estructuralmente lenta: de noche el
   fleet estaciona → casi no llega telemetría → el backlog se mantuvo en ~100-120 toda
   la madrugada y **recién cruzó 1000 a las ~09:30 (14h tarde)**. El conteo absoluto
   enmascara al consumer caído.

2. **🔴 Bug sistémico: todos los log-based metrics de telemetría están rotos.** El
   logger Booster (Pino) emite el mensaje en el campo `message` (`messageKey: 'message'`
   en `packages/logger/src/createLogger.ts:66`), pero los filtros usan
   `jsonPayload.msg=...`. Verificado: el filtro real de `device_records_per_minute`
   matchea **0** entradas en 20 min; con `jsonPayload.message` matchea **30**. Afecta a
   `device_records_per_minute`, `tcp_connection_resets`, `parser_errors`, `crash_events`
   (telemetry-monitoring.tf) y `crash_trace_persistence_failures` (crash-traces.tf).

3. **`unplug_events` y `gnss_jamming_critical_events` están doblemente bloqueados**: su
   filtro usa `jsonPayload.eventName`, pero **nada emite ese campo** — el
   `notification-service` es un skeleton (`apps/notification-service/src/main.ts:10`).
   No se arreglan con un rename; dependen de implementar el pipeline de ruteo de eventos.

## 2. Objetivo

Que la capa de observabilidad de telemetría **funcione de verdad** y que un corte de
ingesta o de consumo **dispare una alerta en < ~35 min**, sin falsos positivos por el
parking nocturno.

## 3. Alcance (decidido por PO: "fix completo")

### IN
- **A. Fix `msg`→`message`** en los 5 metrics realmente emitidos (telemetry-monitoring.tf)
  + 1 en crash-traces.tf (`crash_trace_persistence_failures`). + sweep de queries
  `jsonPayload.msg` muertas en el runbook y en api-cost-guardrails.tf (doc).
- **B. Alerta nueva P1 — consumer detenido**: `oldest_unacked_message_age` sobre
  `telemetry-events-processor-sub` > 30 min. Métrica **nativa** de Pub/Sub
  (independiente del bug de logs). Baseline 0, sin FP nocturnos, habría disparado a
  ~35 min del inicio. (Post-review: se acotó a UNA sub — sacar `crash-traces-processor-sub`,
  que es bursty y podía flapear; su stall lo cubren `pubsub_dlq` + `crash_trace_persistence_failures`.)
- **D. Documentar honestamente** unplug/jamming como BLOCKED-on-notification-service,
  y corregir el comentario falso "push consumer" en compute.tf (el processor es PULL).
- **E. Runbook**: secciones nuevas en `docs/runbooks/oncall-telemetry-incidents.md`.
- **F. Validación**: `terraform fmt` + `validate` + `plan`.

### OUT (movido a follow-up por el review)
- **C. Alerta de ingreso detenido** — DIFERIDA. La versión sobre `device_records_per_minute`
  (REDUCE_SUM + missing-data) se descartó: en un apagón total las series por-IMEI
  desaparecen y la serie reducida no tiene identidad estable → podría NO disparar (el
  review lo marcó blocking). El detector correcto es un liveness POSITIVO del pod del
  gateway (`kubernetes.io/container/uptime`), que requiere validación empírica (parar
  el gateway en prueba) antes de confiar en él. → follow-up `telemetry-gateway-liveness-alert`.
- Implementar el `notification-service` / ruteo de eventos (desbloquea unplug/jamming).
- **Codificar `min-instances=1` + CPU always-on del processor en IaC** — chip aparte
  (`telemetry-processor-min-instances`). ⚠️ El fix de runtime YA está aplicado (rev 00312)
  pero la IaC sigue en `min=0`: un `terraform apply` lo revierte. Documentado en compute.tf.
- Añadir canales de notificación nuevos (PagerDuty/Slack). Se reutiliza `email_alerts`.

## 4. Diseño de las alertas

| Alerta | Métrica | Tipo | Umbral | Ventana | Sev | Caza |
|---|---|---|---|---|---|---|
| `telemetry_consumer_stalled_p1` | `subscription/oldest_unacked_message_age` (nativa) | threshold GT | 1800s (30m) | 300s | ERROR/P1 | consumer caído (el incidente) |
| ~~`telemetry_ingress_stopped_p2`~~ | DIFERIDA → follow-up gateway-liveness | — | — | — | — | ingreso/gateway down |

**Por qué `oldest_unacked_message_age` y no el conteo de backlog**: la antigüedad del
mensaje más viejo sin ack sube +60s/min apenas muere el consumer, **independiente del
volumen** → cruza 30 min incluso de madrugada con poco tráfico. El conteo depende del
volumen y de noche tarda horas. Evidencia en vivo: durante el incidente (Cloud Run en
CERO instancias) la métrica subió lineal 0.8h→25.6h sin volverse sparse — por eso es
threshold positivo, no detección por ausencia. `pubsub_backlog_p2` se conserva como
señal secundaria (processor lento pero vivo / backpressure parcial).

**Por qué la alerta de ingreso se difiere** (cambio post-review): detección por ausencia
de un log-metric por-IMEI con REDUCE_SUM es poco confiable justo en el apagón total que
busca cazar (series desaparecen → la reducida no tiene identidad estable). Además los
Network Pings no cuentan como records, así que de noche puede dar 0 legítimo. El detector
correcto (liveness positivo del pod, `kubernetes.io/container/uptime`) necesita validación
empírica antes de shipear. Una alerta de ingreso que no dispara es peor que ninguna.

## 5. Criterios de aceptación

1. `terraform validate` OK; `fmt` sin diff.
2. Los 6 filtros corregidos usan `jsonPayload.message` y matchean logs reales; sin
   queries `jsonPayload.msg` muertas en runbook/docs de telemetría.
3. Existe la alert policy `telemetry_consumer_stalled_p1` apuntando a `email_alerts`,
   con `documentation` linkeando el runbook. `plan` = 1 add + 6 change + 0 destroy.
4. unplug/jamming quedan con comentario explícito de bloqueo (no se fingen arregladas);
   compute.tf ya no rotula al processor como "push consumer".
5. Runbook actualizado: sección consumer-stalled (con alerta) + ingress (playbook
   manual, alerta diferida) + nota del fix de campo.
6. PR con sección Evidencia (incidente + outputs de validación + landmine min-instances).

## 7. Revisiones post-review (devils-advocate / 4 lentes adversariales)

- **[blocking]** alerta de ingreso device_records no dispararía en apagón total → DIFERIDA.
- **[major]** consumer alert acotada a `telemetry-events-processor-sub` (saca crash-sub).
- **[major]** comentario falso "push consumer" en compute.tf corregido + landmine
  min-instances documentado (apply revierte el fix de runtime hasta que el chip IaC entre).
- **[major]** queries `jsonPayload.msg` muertas del runbook + api-cost-guardrails corregidas.
- **[minor]** header acotado (no overclaim sobre unplug/jamming); `trigger { count=1 }`
  explícito; caveat de pings corregido (Network Pings no cuentan como records).

## 6. Evidencia (datos en vivo, 2026-06-08)

- Backlog 26h: ~100-120 toda la madrugada; cruzó 1000 a las ~09:30 (14h tarde).
- `oldest_unacked_message_age`: lineal 0.8h→25.6h desde ~20:00; baseline post-fix = 0s.
- `device_records_per_minute` con filtro real (`msg`) = 0 matches/20m; con `message` = 30.
- `notification-service/src/main.ts:10` = "starting (skeleton)"; `eventName` no se loguea.
