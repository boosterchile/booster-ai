# Ship — Optimización de costos GCP pre-comercial

**Fecha:** 2026-06-05 · **ADR:** ADR-058 (supersede ADR-035)
**PRs:** [#406](https://github.com/boosterchile/booster-ai/pull/406) (código, merged), [#407](https://github.com/boosterchile/booster-ai/pull/407) (corrección SEC-001 docs, merged), [#408](https://github.com/boosterchile/booster-ai/pull/408) (DNS endpoint + B1/C + pipelines).
**Estado:** ✅ **6/6 palancas aplicadas a producción (2026-06-06).**

## Aplicación a prod (2026-06-06)

Cada palanca con `terraform apply -target` acotado (o kubectl vía DNS endpoint para K8s). Sin tocar SEC-001/IAM/drift. App sana (`/health` 200) tras cada apply.

| Palanca | Cómo | Verificación |
|---|---|---|
| **A3** logging SQL | `apply -target=google_sql_database_instance.main` (HA pineado para aislar de D) | flags `log_temp_files=-1`, sin conn/disconn; REGIONAL intacto; RUNNABLE, sin downtime |
| **A2** api min→0 | `apply -target=module.service_api...service` | `minScale=0`; health 200. Ahorro real ~0 (uptime checks 60s mantienen el api caliente), inocuo |
| **B1** gateway 2→1 | kubectl vía DNS endpoint (scale + patch HPA) | Deployment 1/1, HPA min 1 |
| **C** DR→cold | kubectl vía DNS endpoint (delete HPA + scale 0) | Deployment 0/0, HPA eliminado |
| **A1** Redis BASIC | `apply -target=redis + 7 services` (nuevo REDIS_HOST) | tier BASIC READY; recreación ~6m; 503 transitorio en auth durante la ventana; health 200 post |
| **D** Cloud SQL ZONAL | backup on-demand previo + `apply -target=...main` | update in-place (no replace); ZONAL RUNNABLE; restart 5m35s; IP privada intacta; health 200 |

Habilitador: **ADR-059** (DNS-based control plane endpoint en el cluster primary) destrabó el acceso K8s para B1/C.

## Pendiente (decisión/acción humana)
1. **Monitoreo 2h** post-apply: error rate, P95, logs limpios. Conviene una query real contra la BD (no solo `/health`) para confirmar lectura/escritura en ZONAL.
2. **A4**: rechazar CUDs 3 años en Centro de FinOps (manual) hasta tener baseline post-optimización (~3 meses).
3. **Reconciliar drift** SEC-001 (decomiso + métrica T4), IAM Owner y `helloTest` en sus propios flujos/PRs revisados (NO tocados en este trabajo).
4. **Gatillo de reversión**: al firmar el primer B2B con SLA, revertir A1/B1/C/D — ver [`_followups/revertir-ha-al-firmar-b2b-sla.md`](../_followups/revertir-ha-al-firmar-b2b-sla.md).

## Checklist
- [x] CI local (pre-commit): gitleaks, biome, ADR numbering, spec-drift → verdes en `824d5cd`.
- [x] ADR-058 (Accepted) + ADR-035 Superseded.
- [x] Review (code-reviewer + devils-advocate) resuelto — `review.md` §Resolución.
- [x] Reversión trackeada — `_followups/revertir-ha-al-firmar-b2b-sla.md`.
- [x] Merge (#406, #407) + apply de las 6 palancas a prod (2026-06-06).
- [ ] Monitoreo 2h post-apply de cada palanca (error rate, P95, logs).
