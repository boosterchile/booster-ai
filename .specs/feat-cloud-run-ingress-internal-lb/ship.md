# Ship: feat-cloud-run-ingress-internal-lb

- Date: 2026-06-14
- ADR: docs/adr/062-cloud-run-ingress-posture.md

## Checklist
- [x] Spec/plan/verify/review artefactos en .specs/
- [x] Review adversarial (devils-advocate + security-auditor) + fix-round de O1 bloqueante (bot→api) y observaciones MEDIA/BAJA
- [x] terraform validate OK; fmt OK; diff atómico (solo ingress + bot re-apuntado)
- [x] ADR-062 (sin colisión de numeración); 2 follow-up stubs creados + padre actualizado
- [ ] terraform apply — **lo ejecuta el PO** (staged `-target` web→api, spec §11). NO en este ciclo.
- [ ] Validación empírica post-apply (schedulers + bot vía cron chat-whatsapp-fallback + bypass cerrado) — PO en la ventana.

## Cambio
- módulo cloud-run-service: `var.ingress` (default ALL = cero cambio para 8 servicios).
- api + web → INTERNAL_LOAD_BALANCER (cierra bypass *.run.app del XFF).
- bot→api re-apuntado a public_api_url (GCLB) — fix del bloqueante O1.
- sms-fallback → ALL explícito; comentario errado de networking.tf corregido.

## Pendiente del PO
1. PR review + `terraform apply` staged (spec §11).
2. Follow-ups: whatsapp-bot-ingress, private-services-ingress (stubs en .specs/_followups/).
