# Review: feat-ingress-posture-round-2

- Date: 2026-06-14
- Revisores: devils-advocate + security-auditor (subagentes agent-rigor). Waiver de cooling-off registrado (IaC, mismo turno).

## Veredictos
- **devils-advocate**: BLOQUEADO — no por el cambio de Terraform (seguro), sino porque ADR-063 + el stub afirmaban una topología FALSA ("matching/notification/document son consumidores pull saliente"). Son skeletons de ~13 líneas. Evidencia fabricada en un artefacto inmutable = el patrón anti-rigor que el sub-agent existe para frenar.
- **security-auditor**: APROBADO con observaciones — el cambio de red es correcto y positivo (0 CRÍTICO/0 ALTO); mismo hallazgo MEDIO sobre la descripción "pull consumers"; MEDIO-2 sobre validación §11 vacua para skeletons.

## Hallazgo central (ambos convergen) y resolución
**Sobreventa de evidencia**: caractericé los 4 privados como "consumidores pull". Verdad verificada por ambos: solo telemetry-processor lo es; matching-engine, notification, document son skeletons (log + TODO, sin Pub/Sub ni HTTP). El cambio de red (INTERNAL_ONLY) sigue siendo correcto y seguro —y es lo que el PO pidió— pero la justificación mentía.

| Hallazgo | Resolución (fix-round) |
|---|---|
| devils BLOQUEANTE / security MEDIO-1: ADR-063 + spec + stub afirman "pull consumers" para 3 skeletons | CORREGIDO: ADR-063, spec §1/§9 y el stub ahora dicen la verdad (telemetry-processor = pull activo; los otros 3 = skeletons; INTERNAL_ONLY = secure-by-default) + §Re-evaluación en ADR-063 (al implementarlos, ajustar min_instances/cpu_idle si pull, re-evaluar ingress si agregan inbound). |
| security MEDIO-2: validación §11 "consumer ack-eando" vacua para skeletons | CORREGIDO: §11/§10 acotan el ack-check a telemetry-processor (+ red `telemetry_consumer_stalled_p1`); los otros 3 solo validan "arranca + run.app rechazado". |
| devils: incoherencia min_instances=0 + pull | DOCUMENTADO en ADR-063 §Re-evaluación (pull real necesita min=1+cpu_idle=false). |
| security BAJO-1 / devils: la descripción de `var.ingress` (de #457) dice que Cloud Scheduler cuenta como internal para INTERNAL_LOAD_BALANCER — el reviewer lo disputa | FUERA DE SCOPE de este diff (pertenece a #457). FLAG al PO: la validación empírica de #457 §11 (`gcloud scheduler jobs run reconciliar-dtes → 200` contra el api en INTERNAL_LOAD_BALANCER) es el gate que lo resuelve. Si fallara, el api vuelve a ALL. |
| security BAJO-2: comentario networking.tf:689 "public=false" desactualizado (bot/sms son public=true) | Anotado; fix menor candidato a otro ciclo (no de este diff). |

## Lo que ambos confirmaron sólido (sobrevive el ataque)
- bot → INTERNAL_LOAD_BALANCER: NEG/backend/path-matcher reales; firma HMAC sobre TWILIO_WEBHOOK_URL=dominio (si Twilio posteara al run.app, ya fallaría) ⇒ evidencia suficiente; rollback 1 línea.
- telemetry-processor → INTERNAL_ONLY: pull saliente, ingress no lo afecta.
- INTERNAL_ONLY > INTERNAL_LOAD_BALANCER para privados (sin NEG): correcto.
- update in-place (ingress mutable, no ForceNew); pull no afectado por ingress; health probes internos; sms-fallback en ALL bien justificado.

## Estado
Fix-round COMPLETO (artefactos corregidos a la verdad). Cambio de TF sin tocar (era correcto). Listo para PR stacked sobre #457.
