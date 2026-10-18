# Spec — Microservicios extraídos (T10-21)

**Programa**: TRL 10, fase D ([ADR-082](../../docs/adr/082-objetivo-trl10-supersede-precomercial.md)).
**Patrón**: [ADR-083](../../docs/adr/083-staging-gemelo-y-extraccion-con-shadow.md) §2, que supersede a ADR-048 §1 pasos 3–5, §3 y §4.
**Estado**: aceptada por el PO el 2026-10-08 ("realizar todos los cambios que sean necesarios… Habilitar staging").

## Criterio de término (`.specs/trl10/spec.md`)

> `matching-engine`, `notification-service` y `document-service` corren en Cloud Run con imagen propia (no `gcr.io/cloudrun/placeholder`), atienden tráfico de prod, tienen coverage ≥ 80 % y un rollback drill documentado.

## Entregas, en orden

1. **Habilitar staging**, este PR:
   - ADR-083;
   - `infrastructure/environments/staging/`;
   - `release-staging.yml`;
   - E2E nightly contra staging;
   - runbook `staging.md`.
2. **`document-service` primero.** Ya tiene 527 LOC reales (consumer de `document.uploaded`, decodificación TED). Le falta:
   - un paso de build/deploy en `cloudbuild.production.yaml`, que hoy no lo construye y sigue con imagen placeholder;
   - el flag de shadow, que no aplica: es un consumidor Pub/Sub propio y no lógica duplicada en el api;
   - el drill de rollback, que consiste en volver a la revisión anterior.
3. **`notification-service`.** Extraer el fan-out inline del api:
   - `notify-offer.ts` (`notifyOfferToCarrier`)
   - `notify-tracking-link.ts` (`notifyTrackingLinkAtAssignment`)
   - `notify-incident-shipper.ts` (`notifyIncidentToShipper`)
   - `dispatch-safety-notification.ts`
   - `web-push.ts`
   - `services/notifications/*` (emails y WhatsApp de activación)
   - **Contrato**: el topic `notification-events`, ya declarado en `messaging.tf`, con evento Zod en `shared-schemas`.
   - **Flags**: `NOTIFICATIONS_VIA_MICROSERVICE` y `NOTIFICATIONS_SHADOW`. En shadow, el servicio corre en `dry-run`: arma el mensaje y no lo envía. Se compara el hash de `{canal, destinatario, plantilla, variables}`.
4. **`matching-engine`.** Extraer `runMatching` (`apps/api/src/services/matching.ts:87`), que usa `packages/matching-algorithm` y `matching-v2-*`.
   - **Contrato**: evento `trip.request.created` → resultado de candidatos/ofertas.
   - **Flags**: `MATCHING_VIA_MICROSERVICE` y `MATCHING_SHADOW`. En shadow se compara el hash del ranking de candidatos (`empresa_id`, `score` redondeado a 3 decimales).

## Por servicio, criterios de salida

- [ ] Imagen propia construida y desplegada por `cloudbuild.production.yaml`, y `gcloud run services describe` muestra una imagen ≠ placeholder.
- [ ] Coverage ≥ 80 % en las cuatro métricas (gate de `ci.yml`).
- [ ] Drill de rollback en staging documentado en `docs/runbooks/rollback-drill-microservicios.md`: falla provocada, flag apagado y monitoreo retomado en menos de 5 min con datos consistentes.
- [ ] Shadow en prod de 3 a 7 días con `<servicio>_shadow_divergencias_total = 0` sin explicar (no aplica a document-service).
- [ ] Corte por flag y tráfico de prod atendido por el servicio. La evidencia son las métricas de requests o mensajes del servicio en Cloud Monitoring.

## Fuera de alcance

- Service mesh (ADR-048 §C, sigue rechazado).
- Versionado de API HTTP entre servicios: hay un solo consumidor, el api.
