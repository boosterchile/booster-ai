# Plan de review — D11 BUILD (12 PRs)

**Fecha**: 2026-05-17
**Origen**: cierre del `/goal` BUILD D11 (49m, 12/12 tasks DONE, ~$5-10 USD). 12 PRs stacked sin merge, esperando review formal.
**Owner**: Felipe Vicencio (PO)
**Artefacto previo**: [`docs/plans/2026-05-17-d11-stakeholder-geo-aggregations.md`](../plans/2026-05-17-d11-stakeholder-geo-aggregations.md)

## Hallazgos críticos a verificar en review

1. **Migration 0035 NO planificada**: el `/goal` resolvió el gap T8 agregando `origen_lat` + `origen_lng` nullable a `viajes` sin aprobación PO explícita. El abort trigger se activó pero "se levantó" sin supervisión humana. ⚠️ Reviewar como decisión arquitectónica retroactiva, no como simple addition.
2. **LOC waivers excedidos 2-3×**: plan tenía waivers ~120 LOC. Reales: T8=316, T11=534 churn, T9=155, T10=228, T5=159. **Atomicity violation**. Reviewar si el code es atómico funcionalmente aunque exceda LOC; si no, requerir split.
3. **Stop hook error "Prompt is too long"** apareció dos veces en /goal de 49m — el evaluador no pudo procesar el cierre. No bloqueante pero síntoma de saturación de contexto.

## Cooling-off

Todos los PRs fueron creados hoy entre ~01:00 y ~03:00 UTC. A las **04:00 UTC** ya están todos con ≥30 min, cooling-off agent-rigor §6.1 cumplido por default.

## Orden de review (no es dependency-order — es risk-order)

| # | PR | Task | Sub-agentes obligatorios | Por qué este orden |
|---|---|---|---|---|
| 1 | [#246](https://github.com/boosterchile/booster-ai/pull/246) | T1 — ADR-041 | code-reviewer + devils-advocate | Locks decisions arquitectónicas. Si el ADR es cuestionable, todo downstream queda en duda. Doc-only, review barato (~10 min). |
| 2 | [#253](https://github.com/boosterchile/booster-ai/pull/253) | T8 — endpoint cards + **migration 0035 no planificada** | code-reviewer + devils-advocate + **security-auditor** | Mayor riesgo del set. Schema change inline + endpoint con auth + 316 LOC. Si falla review, cascada a T9-T12. ~45-60 min. |
| 3 | [#247](https://github.com/boosterchile/booster-ai/pull/247) | T2 — Zod + Drizzle table | code-reviewer + devils-advocate | Locks schema shape; mechanical pero foundational. ~20 min. |
| 4 | [#248](https://github.com/boosterchile/booster-ai/pull/248) | T3 — migration 0034 + seed | code-reviewer + devils-advocate | Schema change (planificado). Validar bbox de las 5 zonas seed contra OSM. ~25 min. |
| 5 | [#249](https://github.com/boosterchile/booster-ai/pull/249) | T4 — k-anonymity helper | code-reviewer + **security-auditor** | Privacy-critical pure function. Tests deben cubrir todos los edge cases del spec. ~20 min. |
| 6 | [#250](https://github.com/boosterchile/booster-ai/pull/250) | T5 — hora del día + horario pico | code-reviewer | Helpers de agregación. ~15 min. |
| 7 | [#251](https://github.com/boosterchile/booster-ai/pull/251) | T6 — tipo carga + combustible | code-reviewer | Más helpers + fallback CO₂e. ~15 min. |
| 8 | [#252](https://github.com/boosterchile/booster-ai/pull/252) | T7 — puntoEnBoundingBox | code-reviewer | Helper geométrico simple. Edge cases bbox invertido. ~10 min. |
| 9 | [#254](https://github.com/boosterchile/booster-ai/pull/254) | T9 — endpoint drill-down | code-reviewer + devils-advocate + **security-auditor** | Segundo endpoint con auth + k-anonymity per cell. Depende de #253 OK. ~45 min. |
| 10 | [#255](https://github.com/boosterchile/booster-ai/pull/255) | T10 — UI drill-down route | code-reviewer + **ux-designer** | UI surface. Validar checklist pre-entrega (a11y, contraste, responsive). ~30 min. |
| 11 | [#256](https://github.com/boosterchile/booster-ai/pull/256) | T11 — UI cards reales | code-reviewer + **ux-designer** | 534 LOC churn (delete ZONAS_DEMO + add hooks). Validar que estados loading/error/sin-data renderizan. ~40 min. |
| 12 | [#257](https://github.com/boosterchile/booster-ai/pull/257) | T12 — perf gate + índice | code-reviewer | Perf test placeholder. ~15 min. |

**Total estimado**: ~5-6 horas de review humana + sub-agentes, distribuible en 2-3 sesiones con cooling-off entre PRs si emergen issues.

## Disposition criteria por PR

Cada review termina en uno de tres estados:

- **MERGE** — sub-agentes sin objeciones bloqueantes, acceptance de la task cumplido, tests verdes. Mergear via `gh pr merge <n> --squash --delete-branch` (NO auto, NO async — verificar a ojo el merge commit en main).
- **REQUEST CHANGES** — issues encontrados que el agente puede arreglar. Comentar en el PR + permitir al agente (en sesión nueva) corregir. Re-review tras fix.
- **ESCALATE / SPLIT** — para PRs con LOC waiver excesivo donde el split retroactivo es viable. Cerrar el PR, dividir en 2-3 PRs más chicos. Aplica especialmente a #253 (T8=316), #256 (T11=534 churn).

## Lo que NO se hace en este plan

- **No re-invoke `/goal`** — review es REVIEW phase, no BUILD. /goal es para autonomía mecánica, /review requiere judgment humano. Per mi propio runbook `docs/runbooks/goal-templates.md`: "/review (cooling-off + devils-advocate)" no encaja en /goal.
- **No batched** — el usuario pidió uno por uno para precisión. Batched perdería resolución en hallazgos por PR.
- **No merge antes de revisar TODO** — si #253 (T8) requiere split, los PRs downstream (T9-T11) probablemente también necesiten ajuste antes de merge.

## Después del último review

Cuando los 12 PRs estén MERGED o cerrados:

1. Actualizar `docs/handoff/CURRENT.md` (Plan 1 v2 del runbook).
2. Smoke test en staging con `stakeholder@boosterchile.com` (criterio out-of-band del plan).
3. Cerrar la feature D11 oficialmente — pasa de "in flight" a "shipped" en CURRENT.md.
4. Capturar lessons-learned para refinar Plan 5 (BUILD): el inline migration sin sign-off del PO es un anti-patrón a documentar.
