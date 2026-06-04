# Plan: sec-001-h1-2-google-boundary-closure

- **Spec**: [`.specs/sec-001-h1-2-google-boundary-closure/spec.md`](./spec.md) (Draft v2 — DA R2 APPROVE_WITH_RESERVATIONS)
- **Created**: 2026-06-04
- **Status**: Active
- **Branch sugerida**: `feat/sec-001-boundary-closure` (crear desde `main` al iniciar T1).

## Módulos tocados (≤10 ✓)
`apps/api/src/server.ts` · `apps/api/scripts/` (harness) · `apps/api/src/services|jobs/` (reaper) · `packages/<shared>/` (normalizer, condicional) · `apps/api/drizzle/` (backfill, condicional) · `infrastructure/*.tf` (scheduler + decomiso) · `cloudbuild.production.yaml` · `docs/adr/` · `apps/auth-blocking-functions/` (archivar) · `.specs/.../` (docs).

## Gates
- **Gate `/build`**: T1 + T2 + T3 + T4 + T5 completas (auditoría, harness, OQs resueltas, clasificación + decisión PO, ADR).
- **Gate primer run destructivo del reaper**: dry-run revisado + **sign-off PO** (C-G2). El modo destructivo NO se habilita hasta entonces.
- **Cross-cutting (SC-G9)**: ≥80% coverage en todo código nuevo; `@booster-ai/logger` + Zod + OTel.

---

## Tasks

### T1: Auditoría de boundary + fix de GAPs (SC-G1) — ✅ DONE 2026-06-04
> **Resultado**: cero GAP sin mitigar (ver `route-boundary-audit.md`). Todas ENFORCED o GATED-CLOSED; ninguna requiere fix. Confirma el hallazgo del DA R2.
- **Files**: `route-boundary-audit.md` (nuevo) + fixes puntuales en `server.ts`/`routes/*` si hay GAP.
- **LOC**: ~40 (doc) + ≤30 si hay fix.
- **Depends on**: none (read-only primero; gatea todo).
- **Acceptance**: cada route group de `server.ts` (incl. `app.route()` y `<router>.route()` sub-mounts) clasificado ENFORCED / INTENTIONAL-OPEN / GATED-CLOSED / GAP con su cadena de middleware. `/empresas/onboarding`=GATED-CLOSED, `/me`=GATED-CLOSED (allowlist, NO read-only). Cero GAP sin fix. Mapea a **T8** del spec (404 por grupo).
- **Rollback**: revertir el/los fix; el doc es inerte.

### T2: Harness CI default-deny (SC-G1b — resuelve P1-1) — 🔶 DISEÑO DONE, harness pendiente
> Diseño + enumeración completos en `t2-harness-design.md` (clasificar-por-factory, 36 factories + 3 router-mounts, mapa ROUTE_CLASSIFICATION del audit T1). Falta codear `check-route-default-deny.ts` + test (T15) + wire CI + verificar 6 mounts marcados. Chunk autónomo, ~100-120 LOC.
- **Files**: `apps/api/scripts/check-route-default-deny.ts` (nuevo, extiende el patrón `check-is-demo-wire-completeness.ts`) + `ONBOARDING_OR_PUBLIC_ALLOWLIST` + wiring en `.github/workflows/ci.yml` (o el job de checks).
- **LOC**: ~90.
- **Depends on**: T1 (la allowlist sale de la auditoría).
- **Acceptance**: el harness enumera `app.use` + `app.route()` + `<router>.route()` sub-mounts (cubre `/me/consents`, `/me/clave-numerica`); asserta userContext-wired O en allowlist con rationale; **falla el build** ante un mount nuevo sin clasificar. Mapea a **T15** del spec.
- **Rollback**: quitar el step de CI + el script (no bloquea otros checks).

### T3: Resolución de OQs (OQ-G1, OQ-G3, OQ-G6) (gate /build) — ✅ DONE 2026-06-04
> **Resultado** (`oq-resolution.md`, confirmado PO): G1 = `REAPER_GRACE_DAYS=30` (solicitudes_registro vacía → sin SLA, grace conservador justificado); G6 = **(b)** matchear forma degradada (lowercase+trim, inclusivo) — normalizador compartido+backfill → Stream B; G3 = **Google-only** + email-present + dual-match.
- **Files**: `oq-resolution.md` (nuevo).
- **LOC**: doc.
- **Depends on**: none (decisión/research; OQ-G1 necesita datos de latencia de onboarding; OQ-G6/G3 decisión PO).
- **Acceptance**: **OQ-G6** decidida (extraer normalizador+backfill **vs** matchear forma degradada guardada) con rationale + sign-off PO; **OQ-G3** decidida (Google-only vs email-present+dual-match); **OQ-G1** `REAPER_GRACE_DAYS` con valor atado a latencia observada (no SLA imaginada). Determina si T6 existe.
- **Rollback**: doc; re-decidir.

### T4: Clasificación de cuentas IdP existentes (SC-G2 — N2)
- **Files**: `apps/api/scripts/classify-google-idp-accounts.ts` (read-only) + `existing-google-accounts-classification.md`.
- **LOC**: ~80.
- **Depends on**: T3 (normalizador de OQ-G6 + scope de OQ-G3 para el cross-ref).
- **Acceptance**: cuentas IdP **regeneradas contra el estado actual** (Admin SDK `listUsers`, NO el CSV viejo) y cruzadas vs `users` + `solicitudes_registro` → LEGITIMATE/PENDING/INERT; decisión PO por cada INERT, auditable (timestamp+rationale). `dev@boosterchile.com` nunca reapable.
- **Rollback**: read-only; sin efecto.

### T5: ADR supersede ADR-054 (SC-G6 — "ADR before code")
- **Files**: `docs/adr/057-*.md` (nuevo) + anotar `054` Status (con permiso PO, precedente ADR-056).
- **LOC**: doc.
- **Depends on**: none.
- **Acceptance**: ADR nuevo registra: blocking function abandonada (Gen1 muerto/Gen2 no verificado), admisión en el boundary ADR-001, reaper de higiene; cross-ref lessons-learned. Mapea a **T10** del spec.
- **Rollback**: ADRs no se editan retroactivamente; el nuevo se marca superseded si cambia.

### T6: Normalizador compartido + backfill — ❌ DISUELTA (OQ-G6=(b), 2026-06-04)
> Por la decisión OQ-G6=(b) (matchear forma degradada), NO se extrae normalizador ni se hace backfill acá. La lógica de match lowercase+trim se absorbe en **T7**. El normalizador compartido real se difiere a Stream B. Texto original abajo (histórico, no ejecutar).

#### ~~T6 (original, no ejecutar)~~: Normalizador compartido + backfill (SC-G3 — CONDICIONAL a OQ-G6=extract)
- **Files**: `packages/<shared>/src/normalize-email.ts` + `.test.ts` + migración drizzle de backfill de `users.email`/`solicitudes`.
- **LOC**: ~90.
- **Depends on**: T3 (decisión). **Si OQ-G6 = matchear-degradado, esta task NO existe** (se absorbe en T7 con la forma lowercase+trim).
- **Acceptance**: **T11** del spec (cross-normalization) pasa contra el normalizador elegido; backfill aplicado → `users.email`/`solicitudes` consistentes con lo que el reaper busca; sin coupling con el package archivado (SC-G7).
- **Rollback**: el backfill es idempotente; revertir el package no afecta runtime hasta que T7 lo use.

### T7: Predicado del reaper (puro) + tests (SC-G3)
- **Files**: `apps/api/src/services/reaper-predicate.ts` + `.test.ts`.
- **LOC**: ~90.
- **Depends on**: T3, T6 (normalizador).
- **Acceptance**: predicado puro con dual-guard (uid + email), grace (creationTime + lastSignInTime), exclusión pending/aprobado. Tests del spec: **T1, T2, T2b, T3, T4, T5, T5b** (+ T11 vía T6). ≥80% coverage.
- **Rollback**: código nuevo aislado; revertir el archivo.

### T8: Runner del reaper — listado IdP paginado + dry-run + disable-before-delete + observabilidad (SC-G4)
- **Files**: `apps/api/src/jobs/reap-inert-idp-accounts.ts` + `.test.ts`.
- **LOC**: ~100.
- **Depends on**: T7.
- **Acceptance**: lista vía Admin SDK `listUsers` **paginado** (test tenant >1000 = **T12**); **dry-run default**, flag explícito para destructivo; **disable-before-delete** (disable reversible + 2º grace antes de delete); hard-guard `users` por uid+email; logs con email **hasheado** (**T7** del spec) + counter Cloud Monitoring. **T6** del spec (dry-run no escribe).
- **Rollback**: el job es invocable manual; mientras no se agenda (T9) no corre solo. Dry-run no muta.

### T9: Scheduling del reaper (SC-G5)
- **Files**: `infrastructure/<reaper>.tf` (Cloud Scheduler job + IAM, patrón `demo-account-ttl-alerter`).
- **LOC**: ~60.
- **Depends on**: T8 + **gate de primer run destructivo** (dry-run + sign-off PO antes de habilitar modo destructivo).
- **Acceptance**: scheduler wired 100% IaC; `terraform plan` limpio; cadencia documentada. Arranca en dry-run.
- **Rollback**: disable del Cloud Scheduler job (reaper para).

### T10: Decomiso de la blocking function (SC-G7 — P1-3) — independiente, puede paralelizar tras T2
- **Files**: remover `infrastructure/auth-blocking-functions.tf` + `auth-blocking-functions-monitoring.tf` + wire `blocking_functions` en `identity-platform.tf` + deploy lane/`_AUTH_BLOCKING_DEPLOY` en `cloudbuild.production.yaml`; **archivar** `apps/auth-blocking-functions/` (tag/`docs/archive/`).
- **LOC**: net negativo.
- **Depends on**: T2 (no remover el backstop de referencia antes de que el harness haga durable la enforcement). Funcionalmente independiente del reaper.
- **Acceptance**: **`terraform plan` limpio en dev/staging/prod** (per-entorno); enumerado `state rm` vs `destroy`; verificado que ningún IAM binding removido es referenciado por recurso no-blocking-function; fuente archivada. Mapea a **T9** del spec.
- **Rollback**: revert del commit restaura los `.tf`; `apps/auth-blocking-functions` recuperable del archive/tag.

### T11: Cierre del residual (SC-G8)
- **Files**: `.specs/sec-001-cierre/spec.md` (SC-1.2.2 → MET) + cerrar `_followups/sprint-2c-google-blocking-function.md` + decision logs.
- **LOC**: doc.
- **Depends on**: T1, T2, T8 (+ self-serve OFF verificado).
- **Acceptance**: SC-1.2.2 `TRACKED_RESIDUAL → MET` (boundary + reaper, no blocking function); consistente; followup cerrado con puntero. Mapea a **T10** del spec (doc check).
- **Rollback**: revert del doc.

## Orden de ejecución
1. **T1, T3, T5** arrancables en paralelo (read-only / decisión / doc; ninguno depende de otro).
2. **T2** tras T1; **T4** tras T3; **T6** tras T3 (si aplica).
3. **T7** tras T3+T6; **T8** tras T7.
4. **T10** en paralelo tras T2.
5. **T9** tras T8 + gate destructivo; **T11** al final (tras T1/T2/T8).

Highest-risk-early: T1 (audit, puede revelar GAPs reales) + T3/OQ-G6 (la decisión del normalizador, que el DA marcó como la trampa) van primero.

## Out-of-band tasks
- Resolver OQ-G1 requiere **datos de latencia de onboarding** (cuántos días entre solicitud y aprobación históricamente) — query a `solicitudes_registro` en T3.
- Anotar ADR-054 con marcador superseded requiere **permiso PO** (docs/adr ask-first), como en ADR-020.
