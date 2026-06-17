# Spec: docs-runbooks-staleness

- Author: Felipe Vicencio (with agent-rigor)
- Date: 2026-06-10
- Status: Approved
- Linked: Auditoría 2026-06-09, seguimiento "Documentación operacional vs estado real" (riesgos altos dr-failover y wave-2-3; medios msg→message, región, oncall P0 muertas, guía demo)

## 1. Objective

Corregir o archivar la documentación operacional que daría instrucciones incorrectas en un incidente: el runbook de DR provoca outage total si se ejecuta hoy (asume DR caliente pre-ADR-058), dos runbooks verifican con filtros de log muertos (`jsonPayload.msg` vs `message`), el de secrets apunta a la región equivocada, el on-call documenta alertas P0 que no pueden disparar, la guía de demo lista cuentas retiradas, y 4 runbooks de eventos ya ejecutados siguen "Pendiente" fuera de `docs/archive/`.

## 2. Why now

Operador único + runbooks incorrectos = tiempo perdido o daño en el peor momento (un incidente). El costo del fix es solo edición.

## 3. Success criteria

- [ ] dr-failover-test.md con banner bloqueante post-ADR-058 + procedimiento real de reactivación DR cold referenciado.
- [ ] oncall-telemetry-incidents.md: secciones Unplug/Jamming marcadas "ALERTA HOY INOPERANTE" con referencia al TF; canal real (email) en vez de Slack/PagerDuty.
- [ ] load-content-sids.md usa `jsonPayload.message`.
- [ ] secret-init-runbook.md usa `--region=southamerica-west1`.
- [ ] wave-2-3-deploy, dns-migration, twilio-sender-registration y credential-rotation-2026-04 movidos a docs/archive/ con frontmatter de convención (git mv) + catálogo actualizado.
- [ ] guia-uso-demo.md lista las cuentas demo-2026-* reales (seed-demo.ts).
- [ ] goal-templates.md sin paths rotos (/Users/fvicencio → /Users/felipevicencio; settings.local.json).

## 4. User-visible behaviour

Solo documentación interna de operación.

## 5. Out of scope

- Crear el runbook completo de failover DR cold (requiere rehearsal real; el banner referencia dr-region.tf y ADR-058 como fuente).
- docs/specs/ y docs/plans/ legacy (PR-3 de ADR-049 pendiente — anotado en specs P2/_followups).
- Hacer disparables las alertas P0 muertas (requiere implementar notification-service — spec P2).

## 6. Constraints

1. Archivar = `git mv` + frontmatter YAML de docs/archive/README.md (history preservada).
2. No editar ADRs.
3. Las correcciones citan la fuente viva (TF/código) para que el próximo drift sea detectable.

## 7. Approach

Edición dirigida por archivo según los hallazgos verificados de la auditoría (cada uno con archivo:línea); archivado con la convención existente; catálogo del archive actualizado.

## 8. Alternatives considered

- **A. Borrar los runbooks obsoletos** — Rechazada: la regla del archive es NUNCA borrar (trazabilidad).
- **B. Reescribir dr-failover-test.md completo para DR cold** — Rechazada en este ciclo, con condición de reapertura explícita: un runbook de failover sin rehearsal real es teoría peligrosa; el banner + referencia a ADR-058/dr-region.tf es la fuente honesta hasta que el PO agende el rehearsal DR (al agendarlo, se escribe el runbook nuevo con evidencia del ensayo).

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Archivar algo aún citado por docs vivos | L | L | grep de referencias antes del mv; el archive preserva contenido |
| Banner insuficiente (operador igual ejecuta) | L | H | Banner al inicio con NO EJECUTAR + outcome explícito (outage total de ingesta) |

## 10. Test list

- T1: grep `jsonPayload.msg` en docs/runbooks → 0 resultados.
- T2: grep `us-central1` en secret-init-runbook → 0 resultados.
- T3: grep `/Users/fvicencio/` en docs/runbooks → 0.
- T4: los 4 archivados existen bajo docs/archive/2026-06-10-*.md con frontmatter y no en docs/runbooks/.
- T5: guia-uso-demo menciona demo-2026-shipper/carrier/stakeholder.

## 11. Rollout

- Rollback: git revert.
- Monitoring: n/a.

## 12. Open questions

None as of 2026-06-10.

## 13. Decision log

- 2026-06-10 — Draft + aprobación PO vía punto 6. §8.B registrado con condición de reapertura (rehearsal DR); el hook anti-drift bloqueó la redacción inicial y se reformuló (evento drift_blocked en ledger).
