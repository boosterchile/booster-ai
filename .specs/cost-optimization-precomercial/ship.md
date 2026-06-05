# Ship — Optimización de costos GCP pre-comercial

**Fecha:** 2026-06-05 · **ADR:** ADR-058 (supersede ADR-035)
**PR:** [#406](https://github.com/boosterchile/booster-ai/pull/406) — `chore/cost-optimization-precomercial` → `main`
**Estado:** PR abierto. **NO mergeado, NO aplicado a prod.**

## Commits
- `824d5cd` chore(infra): right-sizing pre-comercial de disponibilidad (ADR-058) — rama de costos.
- `d08c09b` docs(security): corrige cierre SEC-001 (falso negativo -target) — rama `docs/sec-001-post-ship-drift` (local, separada, no pusheada).

## Pendiente (decisión/acción humana)
1. **Merge del PR #406** (review humano + gate de aprobación `production` no aplica a infra manual, pero el merge a main sí requiere PR aprobado).
2. **Apply palanca por palanca** con `terraform apply -target` explícito (NO `apply` completo — arrastra drift SEC-001 + IAM). Orden: A3 → A2 → B1 → C → A1 → D.
   - A1 (Redis): ventana baja real; 503 transitorio en /auth/driver-activate + signup (rate-limit fail-closed) durante la recreación.
   - D (Cloud SQL): backup on-demand previo; abortar si plan muestra `replace`.
3. **A4**: rechazar CUDs 3 años en Centro de FinOps (manual).
4. **Reconciliar drift** SEC-001 (decomiso + métrica T4) e IAM Owner en sus propios flujos antes/separado del apply de costos.

## Checklist
- [x] CI local (pre-commit): gitleaks, biome, ADR numbering, spec-drift → verdes en `824d5cd`.
- [x] ADR-058 (Accepted) + ADR-035 Superseded.
- [x] Review (code-reviewer + devils-advocate) resuelto — `review.md` §Resolución.
- [x] Reversión trackeada — `_followups/revertir-ha-al-firmar-b2b-sla.md`.
- [ ] Merge + apply (humano).
- [ ] Monitoreo 2h post-apply de cada palanca (error rate, P95, logs).
