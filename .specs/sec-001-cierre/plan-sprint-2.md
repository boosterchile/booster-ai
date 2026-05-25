# Plan Sprint 2 — META: split into 2a + 2b

- **Status**: META document (no es plan ejecutable). Plan ejecutable activo: `plan-sprint-2a.md`.
- **Spec base**: `.specs/sec-001-cierre/spec.md` (Approved v3.2 2026-05-24).
- **Plan Sprint 1**: `.specs/sec-001-cierre/plan.md` (CERRADO 2026-05-25, 14 tasks shipped).
- **Created**: 2026-05-25 (split decision tras devils-advocate round 1).
- **Decision**: per PO 2026-05-25, post devils-advocate round 1 (5 P0 + 7 P1 + 4 P2), Sprint 2 inicial (~18-22 tasks, ~37h ejecución, ~9-12 días hábiles) se divide en **Sprint 2a** + **Sprint 2b** para honrar el SKILL `20-planning-and-task-breakdown` §Red Flags ("15+ tasks = feature too big") sin abusar de waivers ni mega-PRs.

## Razonamiento del split

El draft original `plan-sprint-2.md` (visible en git history del commit que crea este META) intentó cubrir H1.1 + H1.3 + H1.2 + 3 discoveries en un solo Sprint 2 con 18 tasks y 4 waivers >100 LOC. Devils-advocate identificó:

- **P0-1, P1-3**: paths inventados (`apps/api/src/db/schema/` no existe — es monolithic `schema.ts`; `routes/platform-admin/` no existe — es hyphenated single-file).
- **P0-3, P1-2, P1-4**: 3 de 4 waivers son vertical-slicing failures (bundling concerns por conveniencia, no atomicidad real).
- **P0-4**: T14 contingency hand-waving — verificado Terraform GA no expone Identity Platform per-provider Google toggle, por lo tanto T14b (backend Google fallback) es MANDATORY, no contingente.
- **P0-5**: T17 (Redis testcontainers) depende de T5 + T12 que están en PRs 1 y 3 — no entra en sprint window si PR #4 inicia post-PR #3.
- **P1-5**: 37h pure execution per spec §14.3 = ~3 semanas elapsed. Honestidad de calendario obliga a split.

PO decisión 2026-05-25: split en Sprint 2a + Sprint 2b, cada uno con su propio /plan, devils-advocate, PO approve. T14b in-scope Sprint 2b PR H1.2 (no follow-up).

## Distribución del scope

### Sprint 2a — `plan-sprint-2a.md` (PLAN EJECUTABLE ACTIVO)

- **Sub-fase**: H1.1 (recreate 4 UIDs demo).
- **Discovery in-scope**: T17 (Redis testcontainers fail-closed integration test) — movido a PR de Sprint 2a porque T17 primariamente valida SC-1.1.2c que es acceptance de T5 (demo-expires middleware). El test también valida fail-closed semantics de rate-limit-pin (T9/T10 Sprint 1 ya shippeados).
- **Estimación**: 7-8 tasks ≤100 LOC; ~4-5 días hábiles ejecución.
- **ADRs**: ADR-053 (Post-disclosure account replacement per SP-800-63) — stub Proposed pre-build, Accepted al merge.

### Sprint 2b — `plan-sprint-2b.md` (STUB)

- **Sub-fases**: H1.3 (is-demo middleware enforcement) + H1.2 (signup migration a Admin SDK + IdP self-signup OFF).
- **Discoveries in-scope**: T16 (`rate_limit_pin_blocked_total{scope}` Prometheus metric) + T18 (CodeQL custom queries auth-driver).
- **Estimación**: 10-12 tasks ≤100 LOC; ~7-9 días hábiles ejecución.
- **ADRs**: ADR-052 (Identity Platform self-signup OFF + signup migration a Admin SDK) — stub Proposed pre-build, Accepted al merge.
- **Splits anticipados per devils-advocate**:
  - T7 → T7a (middleware + scaffolding + audit doc) + T7b (allowlist populated + wire global)
  - T12 → T12a (route + service + unit) + T12b (integration test + enumeration + cascade)
  - T14 → T14a (Terraform email/password OFF) + T14b (backend `apps/api/src/routes/auth-google-callback.ts` Google fallback gate) — **MANDATORY** ambos.
- **Bloqueante**: Sprint 2a mergeada en prod + 2h monitoring clean ANTES de iniciar Sprint 2b PR #1.

## Sprint 3 (referencia, no se planea en Sprint 2)

- H1.5 (forensia 14d + monitoring 90d sostenido).
- H3 (`sec-h3-dte-retention-lock` spec hermano, su propio /plan).
- H1.6 (reactivación demo: `default = true` flip + smoke E2E Playwright).
- Flip prod `STRICT_MIGRATION_ORDERING=true` post-migrations Sprint 2a (0038) + Sprint 2b (0039).

## Referencias

- Spec: [`spec.md`](spec.md) §3 + §13 + §14.
- Sprint 1 plan: [`plan.md`](plan.md).
- Sprint 2a plan: [`plan-sprint-2a.md`](plan-sprint-2a.md).
- Sprint 2b stub: [`plan-sprint-2b.md`](plan-sprint-2b.md).
- Sprint 1 evidence: [`sprint-1-evidence/`](sprint-1-evidence/).
- Devils-advocate round 1 sobre draft inicial: ver git history de este archivo (commit pre-split contenía el draft + objections completas).
