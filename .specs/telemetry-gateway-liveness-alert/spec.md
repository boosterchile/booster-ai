# Spec — Alerta de ingreso de telemetría (gateway down)

**Estado**: SHIP (alerta) + validación post-deploy pendiente
**Fecha**: 2026-06-08
**Gatillo**: follow-up diferido en el review de `.specs/telemetry-monitoring-observability`.
**Stack**: sobre la rama del PR #429.

## Problema

El consumer-stall (`telemetry_consumer_stalled_p1`, #429) caza "el processor no
consume", pero NO el modo "el gateway está caído" (sin mensajes entrando, oldest_unacked
se queda en 0 → el consumer-stall nunca dispara). Falta una alerta para "no entra
telemetría" (pod del gateway muerto, evicción, OOM, etc.). Es el modo del outage
2026-05-07 (LB/DNS).

## Por qué liveness del pod y no `device_records == 0`

El review descartó `device_records_per_minute` en 0 porque:
1. En apagón total las series por-IMEI desaparecen; un REDUCE_SUM sin inputs no se
   marca como ausente de forma confiable → podría no disparar.
2. Falso positivo nocturno: con el fleet estacionado los AVL records caen a 0
   legítimamente (los Network Pings 0xFF no cuentan como records).

El detector correcto es `kubernetes.io/container/uptime` del container `gateway`:
serie estable 24/7 (verificada en vivo: **0 huecos en 96h**) que sólo desaparece si
el pod muere — sin enmascaramiento nocturno.

## Diseño

`google_monitoring_alert_policy.telemetry_gateway_down_p1`:
- `condition_absent` sobre uptime del gateway, `duration=600s` (10 min).
- Agregación `REDUCE_COUNT` agrupando por cluster/namespace/container → **colapsa
  `pod_name`**: un rolling restart (pod_name nuevo) mantiene la serie presente y no
  falsea; sólo dispara si NO hay ningún pod del gateway.
- Severidad ERROR/P1: es el ÚNICO detector de un apagón total de ingreso.

## Validación (gate real — correr post-deploy)

Una alerta por ausencia no se confía sin verla disparar. Test: `kubectl scale
deployment/telemetry-tcp-gateway --replicas=0` en horario de bajo tráfico (~3 min;
los devices buffean y reenvían → pérdida ≈ 0), confirmar que la policy abre,
restaurar. Procedimiento en el runbook §Telemetry ingress stopped.

## Alcance / no-alcance

- Único modo cubierto: gateway/pod down. Degradación parcial (algunos devices) o
  LB/DNS con pod sano NO la dispara (el pod sigue reportando uptime) — diagnóstico
  manual en el runbook.
- No toca otros servicios.

## Criterios de aceptación

1. `terraform validate` OK; `fmt` limpio; `plan` = 1 add (la alerta), 0 destroy.
2. Alerta con `condition_absent` + colapso de `pod_name`, apuntando a `email_alerts`.
3. Runbook actualizado: métrica + razón del diseño + procedimiento de test.
4. PR con Evidencia. **Validación empírica marcada como paso post-deploy obligatorio.**
