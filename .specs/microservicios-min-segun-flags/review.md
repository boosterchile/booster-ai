# Review: microservicios-min-segun-flags

- Spec: .specs/microservicios-min-segun-flags/spec.md
- Fecha: 2026-10-21
- Revisores: code-reviewer y security-auditor (`.cursor/agents/`), sobre el primer commit de la rama. Solo lectura.

## code-reviewer

| Severidad | Hallazgo | Respuesta |
|---|---|---|
| Advertencia | El rollback del runbook (`via_microservice=false`, con la sombra apagada) baja el mínimo a 0 en el mismo apply y deja varados los mensajes pendientes. La línea «lo entrega igual este servicio mientras siga vivo» deja de ser cierta | **Corregido.** El rollback del canal pasa ahora por `via_microservice=false` + `shadow=true` (`min=1`), espera `num_undelivered_messages = 0` y recién después apaga la sombra. También ajusté el drill N2/N3 |
| Advertencia | «No se puede encender un flag con el servicio en cero» no estaba garantizado: Terraform actualiza `service_api` en paralelo con los dos servicios; una revisión rota del servicio (imagen de un release con `allowFailure`) dejaría el flag del api encendido y el servicio sin mínimo | **Corregido.** `module.service_api` tiene `depends_on = [module.service_matching_engine, module.service_notification]`: el api se aplica después y no se aplica si el servicio falla. Sin ciclo; el módulo no tiene data sources. Comentario corregido |
| Advertencia | `plan.md` marcaba T5/T6 como hechos pero `verify.md` no estaba en el commit y `review.md` no existía | **Corregido** en este commit |
| Sugerencia | Docs desactualizadas: `runbooks/README.md` («Requiere min-instances≥1»), escala `1/5` y `1/10` en los runbooks, señal «revisar que no volvió a min=0» | **Corregido** |
| Sugerencia | La nota del runbook también debe prohibir `--min` (mínimo a nivel de servicio, que Terraform ignora) | **Corregido** |
| Sugerencia | Verificar `minScale` después del apply y del siguiente release | **Agregado** al rollout (spec §10) |
| Sugerencia | Precisar que cada deploy o apply levanta una instancia ≤15 min | **Corregido** el comentario de `compute.tf` |

Confirmado por la revisión: `gcloud run services update` sin `--min-instances` conserva el `minScale` del template; el `ignore_changes` del módulo no tapa el cambio; con `min=0` y `cpu_idle=false` el servicio escala a cero; ningún otro pipeline ni script fija el mínimo de estos dos servicios.

## security-auditor

Sin hallazgos críticos.

| Severidad | Hallazgo | Respuesta |
|---|---|---|
| Alto | Un flag encendido por fuera de Terraform, con `-target=module.service_api` o con un apply a medias deja los WhatsApp (también los de safety P0, que usan el mismo enrutador) sin consumidor y sin aviso: no hay alerta sobre `notification-events-sub`, la DLQ no se llena y los mensajes vencen a las 24 h | **Corregido.** Alerta CRITICAL `wave2_consumer_stalled["notification_events"]` (mensaje sin confirmar > 10 min, mismo patrón que las otras suscripciones), y el `depends_on` cubre el `-target` y el apply a medias |
| Medio | El rollback del runbook deja lo pendiente sin consumidor | **Corregido** (ver arriba) |
| Info | `telemetry-events-security-p1-notification-sub` no tiene consumidor ni publicador en el código (telemetry-processor solo publica en safety-p0), y su alerta nombra a notification-service. Los eventos antirrobo P1 no se notifican a nadie | **Fuera de alcance**: es un hueco previo que este PR no cambia. Se reporta al PO |

Confirmado: el cambio no toca IAM, ingress, secretos ni la verificación de identidad entre el api y matching-engine.

## Codex (revisión automática del PR, commit c2cf748)

| Severidad | Hallazgo | Respuesta |
|---|---|---|
| P1 | El cambio contradice dos specs aceptadas (`notification-service-t10-21` y `matching-engine-t10-21` fijan `min_instances = 1`); el contrato pide escalar, no resolver | **Escalado al PO y aceptado el 2026-10-21.** El conflicto está en §0 de la spec, con la aceptación registrada (fecha y frase del PO). Las dos specs T10-21 llevan la nota de enmienda aceptada |
| P1 | Un `terraform plan -target` seguido de un `apply` sin argumentos recalcula un plan completo y, sin `resend_api_key_ready = true`, quita `RESEND_API_KEY` del api (se caen los correos de activación y PIN) | **Corregido.** El rollout guarda el plan con `-out=pr822.tfplan` y aplica ese archivo |
| P2 | Al apagar el último flag, el `depends_on` baja el mínimo del servicio antes de cambiar el api | **Documentado.** Con el rollback del runbook (pasa por la sombra), en el último apply el api solo publica `modo: 'sombra'`, que nunca envía: no hay impacto en usuarios. Chequeo de `num_undelivered_messages` a los ~15 min y purga si quedan. Apagar los dos flags en un apply sigue prohibido. Un orden distinto para encender y apagar no se puede expresar con un `depends_on` fijo; el que hay protege el encendido, que es el caso con impacto |
