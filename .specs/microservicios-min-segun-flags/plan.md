# Plan: microservicios-min-segun-flags

- Spec: .specs/microservicios-min-segun-flags/spec.md
- Status: Complete (build). Apply pendiente del PO (spec §10).

### T1 [DONE]: verificar que nadie usa los servicios con los flags apagados
Código: `whatsapp-enrutado.ts` (modo `directo` no publica) y `matching-ranking.ts` (modo `local` no llama al remoto); el api es el único publicador de `notification-events` y el único llamador de matching-engine. Métricas de 30 días: 0 mensajes y 0 requests. Alertas y SLO: ninguno depende de que haya una instancia viva.

### T2 [DONE]: derivar `min_instances` de los flags
`infrastructure/compute.tf`: `local.matching_engine_min_instances` y `local.notification_service_min_instances`.

### T3 [DONE]: que el deploy no lo deshaga
`cloudbuild.production.yaml`: sin `--min-instances=1` en `deploy-notification-service` y `deploy-matching-engine`.

### T4 [DONE]: runbooks
Nota en `service-notification-service.md` y `service-matching-engine.md`: el mínimo sigue a los flags, y los flags se cambian con `terraform apply`.

### T5 [DONE]: evidencia
`terraform fmt`, tabla de verdad de las expresiones con `terraform console`, y plan real de la rama con el workflow `terraform-drift.yml` (cuenta de solo lectura). Resultados en `verify.md`.

### T6 [DONE]: revisión
code-reviewer y security-auditor (`.cursor/agents/`). Hallazgos y respuesta en `review.md`.
