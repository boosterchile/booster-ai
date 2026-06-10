# Spec: ops-eliminar-deploy-phase-2

- Author: Felipe Vicencio (with agent-rigor)
- Date: 2026-06-10
- Status: Approved
- Linked: Auditoría 2026-06-09, seguimiento "Tooling operacional fuera de CI/CD", riesgo alto; inventario adr-vs-prod Finding #1

## 1. Objective

Eliminar `deploy-phase-2.sh`: el script bypassea el pipeline completo (`git commit --no-verify` salta husky/commitlint, `git push origin main` salta PR/branch-protection — y hoy además apunta al remote GitLab muerto, ADR-056 — y `gcloud builds submit cloudbuild.production.yaml` desde laptop salta ci.yml y el gate humano del GitHub Environment production). Reemplazar su única referencia viva (procedimiento de rotación de la Maps API key en ADR-014 §Rotación) por un runbook correcto.

## 2. Why now

Es el vector que el Finding #1 del inventario cerró solo del lado GitHub: cualquiera con cloudbuild editor reproduce un deploy completo sin gates. Sin uso registrado desde 2026-05-03; residuo histórico de Phase 2 Teltonika.

## 3. Success criteria

- [ ] `deploy-phase-2.sh` eliminado del repo.
- [ ] `docs/runbooks/rotacion-maps-api-key.md` documenta la rotación vía `cloudbuild.production.yaml` substitution + pipeline normal (release.yml), reemplazando los pasos de ADR-014 que citaban el script.
- [ ] El runbook nota explícitamente que ADR-014 §Rotación queda superseded en sus pasos 2-3 (los ADRs no se editan).

## 4. User-visible behaviour

Ninguno (tooling de operador). La rotación de la Maps key tiene procedimiento vigente y correcto.

## 5. Out of scope

- Gatear la API de Cloud Build a nivel IAM (quién puede `builds submit`) — anotado como follow-up en el runbook; requiere decisión sobre el flujo de emergencia.
- `scripts/deploy-telemetry-gateway.sh` (vía manual GKE aún oficial hasta adoptar pipelines ADR-059; tiene bug REPO_ROOT anotado en specs P2/_followups).
- `scripts/db/agent-query.sh` guardrails (ADR-045 los difiere; riesgo documentado en el informe de auditoría).

## 6. Constraints

1. No editar docs/adr/014 (ADRs inmutables); la corrección vive en el runbook con referencia cruzada.
2. El sub-flujo GKE del script ya está cubierto por scripts/deploy-telemetry-gateway.sh.

## 7. Approach

`git rm deploy-phase-2.sh` + runbook nuevo con: contexto de la key (pública-por-diseño, restricción por referrer), procedimiento de rotación por PR (cambiar default de `_VITE_GOOGLE_MAPS_API_KEY` en cloudbuild.production.yaml → merge → deploy normal → borrar key vieja), y verificación.

## 8. Alternatives considered

- **A. Degradarlo a runbook de emergencia en docs/runbooks/** — Rechazada: sus pasos son los que NO deben existir (no-verify, push directo, submit desde laptop); un "runbook de emergencia" que documenta saltarse los gates invita a usarlo.
- **B. Dejarlo con banner de deprecación** — Rechazada: el archivo ejecutable sigue siendo el vector; el banner no impide `bash deploy-phase-2.sh`.

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Alguien necesitaba un paso del script no cubierto | L | L | Historia en git (`git show 40a1f16:deploy-phase-2.sh` o anteriores); el runbook y deploy-telemetry-gateway.sh cubren los flujos vivos |
| ADR-014/ADR-055 citan el script eliminado | — | L | Referencia cruzada en el runbook nuevo; los ADRs son históricos por diseño |

## 10. Test list

- T1: `deploy-phase-2.sh` no existe en el árbol.
- T2: runbook nuevo pasa lint de paths (referencias a archivos existentes).
- T3: ningún otro archivo del repo ejecuta/sourcea deploy-phase-2.sh (grep).

## 11. Rollout

- Feature-flagged? No. Migration? No.
- Rollback plan: `git revert` restaura el script.
- Monitoring: n/a.

## 12. Open questions

None as of 2026-06-10 (gating IAM de builds submit anotado como follow-up en §5).

## 13. Decision log

- 2026-06-10 — Draft + aprobación del PO vía "ejecutar lo propuesto en el punto 6". Eliminación total (no degradación), ver §8.
