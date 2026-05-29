# Estado actual del proyecto — Booster AI

**Última actualización**: 2026-05-28 (SEC-001 **CI-CD outage 28h resolved** — T3-fix PR #392 `f744ef0` cloudbuild `--no-gen2` + auth-blocking substitution gate + state-drift guard; T13-fix PR #393 `11aab26` canary tag 46-char limit option-B inline short SHA; both fixes shipped after devils-advocate BLOCK_MERGE → P0+P1 closed; escape-hatch invocations × 2 tracked at `.specs/_followups/sprint-2c-b-gate-bypasses.md`; two new P1 followups created — substitution-canonicalization rule escalated P2→P1 + cloud-run-canary-tag-cleanup; Cloud Build `8f4ec780` running post-merge to verify canary lane end-to-end; ADR-052/054 still Proposed pending canary + 2h watch success)
**Documento vivo**: este archivo refleja el estado en `main` al momento de la última actualización. Para snapshots históricos ver `docs/handoff/YYYY-MM-DD-*.md`.
**Plan de referencia**: [`.specs/production-readiness/roadmap.md`](../../.specs/production-readiness/roadmap.md) (S0 cerrado, S1a Bloque A cerrado, pickup S1b) + [`docs/plans/2026-05-12-identidad-universal-y-dashboard-conductor.md`](../plans/2026-05-12-identidad-universal-y-dashboard-conductor.md) (plan histórico waves 1-6)

---

## Sesión 2026-05-28 — CI/CD outage 28h resolved + canary lane unblocked

### Descubrimiento

T8 prep gcloud check (verificar `SIGNUP_REQUEST_FLOW_ACTIVATED` prod + canary status) reveló: 15 Cloud Build runs consecutivos FAILURE desde 2026-05-27 15:46Z hasta 2026-05-28 19:14Z (28 h, primer build fallido inmediatamente después de merge de T3 PR #384). Root cause: **dos defectos shipping juntos en T3** + un tercer defecto en T13 enmascarado.

| Defecto | Quién shippeó | Cómo se manifestó | Fix |
|---|---|---|---|
| `cloudbuild.production.yaml:460` `--gen2=false` syntax inválida (gcloud boolean flags rechazan `=value`) | T3 PR #384 (2026-05-27 17:00Z) | `deploy-auth-blocking` exit code 2 → Cloud Build cancela todos los demás steps in-flight | T3-fix PR #392 — `--no-gen2` (forma documentada de force Gen 1) |
| `cloudbuild.production.yaml` auth-blocking 3 steps sin substitution gate, ejecutan en cada merge a main | T3 PR #384 | Bloqueó api/web/whatsapp/telemetry deploys por 28 h | T3-fix PR #392 — gate `_AUTH_BLOCKING_DEPLOY: 'false'` default; T6 runbook §2 Step 2 pasa `=true` para T8 manual |
| `cloudbuild.production.yaml:184` `canary-signup-${_COMMIT_SHA}` tag (14+40=54 chars) + service `booster-ai-api` (14) = 68 > 46 Cloud Run hard limit | T13 PR Sprint 2b (2026-05-26) — nunca corrió end-to-end por enmascaramiento de T3 | `deploy-canary` step error: `traffic tag ... and service name ... together are too long` | T13-fix PR #393 — option-B inline short SHA `${FULL_SHA:0:12}` en bash; sin substitución nueva, sin release.yml change |

### PRs shipped (2 cycles compressed solo-dev en single session)

| PR | Commit | Foco | DA verdict inicial | DA-resolved verdict |
|---|---|---|---|---|
| [#392](https://github.com/boosterchile/booster-ai/pull/392) | `f744ef0` | T3-fix cloudbuild `--no-gen2` + auth-blocking gate + state-drift guard (`gcloud functions describe \|\| exit 1` antes de deploy) | BLOCK_MERGE (2 P0 + 4 P1) | APPROVE post-resolutions commit `8ed4d8f` |
| [#393](https://github.com/boosterchile/booster-ai/pull/393) | `11aab26` | T13-fix canary tag length — option-B inline 12-char short SHA en `entrypoint: bash` para `deploy-canary` + `route-canary` + `canary-verify` | BLOCK_MERGE (1 P0 + 3 P1) | APPROVE post-resolutions commit `6cb2345` |

Ambos PRs:
- Spec amendment a plan existente (T3-fix → `.specs/sec-001-h1-2-google-blocking-b/plan.md`; T13-fix → `.specs/sec-001-cierre/plan-sprint-2b.md`).
- Squash merge a `main`.
- Cooling-off solo-dev §6.1 waiver explícito en session ledger (justificación: P0 CI/CD broken 28h outage).
- Build-gate (`Sprint 2c-B build gate (ADR-052 Accepted)`) bypassed vía documented escape-hatch (`gh workflow run sprint-2c-build-gate.yml -f force=true`) — circular dep: gate requiere ADR-052 Accepted, ADR-052 requiere canary, canary requiere estas fixes. Tracked en `.specs/_followups/sprint-2c-b-gate-bypasses.md`.

### Devils-advocate hardening lessons (BOTH PRs blocked initial drafts)

T3-fix DA v5 P0 findings que se materializaron en código:
- `env:` block + `$$VAR` pattern era redundante → cambiado a direct `${_AUTH_BLOCKING_DEPLOY}` Cloud Build substitution con comentario inline prohibiendo reintroducir el pattern.
- "PR's own Cloud Build = empirical proof" era ficción (cloudbuild.production.yaml solo corre en main, no PR branches) → rewrote verification path con (a) post-merge auto-build observation como única evidencia dispositive.
- Rollback claim "revert this PR" era anti-rollback (reintroduce el 28h outage) → rewrote como "forward-fix only".
- State-drift guard (`gcloud functions describe || exit 1`) ahora previene gcloud de CREATE outside terraform state si T8 Step 1 no corrió.

T13-fix DA v1 P0 que se materializó en código:
- Placeholder default `_COMMIT_SHA_SHORT: '0000000000aa'` era el mismo anti-pattern que T3-fix rechazó. Eliminado completamente vía option-B inline: cada canary step convertido a `entrypoint: bash`, computa `FULL_SHA='${_COMMIT_SHA}'; SHORT_SHA="$${FULL_SHA:0:12}"`, usa `$${SHORT_SHA}` en tag. No substitución nueva, no release.yml change, no T6 runbook addition.

### Followups creados (2 P1 nuevos)

| Followup | Priority | Trigger |
|---|---|---|
| [`.specs/_followups/cloudbuild-substitution-canonicalization.md`](../../.specs/_followups/cloudbuild-substitution-canonicalization.md) | Escalated P2 → **P1** | T13-fix segundo amendment en 48h (T3-fix fue primero). Rule violation: amendment >1 file. **Third amendment is now blocked** hasta producir process ADR. Tracking 2 items: (1) `_AUTH_BLOCKING_DEPLOY` strict-match brittleness (typo `True`/`1`/`yes` → silent SKIP); (2) amendment-vs-sub-spec exception note. |
| [`.specs/_followups/cloud-run-canary-tag-cleanup.md`](../../.specs/_followups/cloud-run-canary-tag-cleanup.md) | **P1** | DA v1 P1 finding. Cloud Run retiene canary tags en revisions inactivas; cadencia daily deploys → quota hit (1000 revisions/service) en semanas. Tres opciones (A clean-up en deploy-api step; B scheduled job; C rotating stable tag). Triggering condition P0 documentada. |

### Estado operacional post-session

| Lane | Pre-session | Post-session |
|---|---|---|
| Cloud Build auto-trigger main | 100% FAILURE 28h | T3-fix verificado: 3 auth-blocking steps echo SKIP con verbatim `_AUTH_BLOCKING_DEPLOY='false'`, builds + pushes SUCCESS. T13-fix pending verification via build `8f4ec780` (WORKING al cierre de sesión). |
| Sprint 2b T13 canary lane | DONE 2026-05-26 pero nunca corrió end-to-end por enmascaramiento | T13-fix mergeado; primer build `8f4ec780` post-merge debe ejecutar `deploy-canary` con tag `canary-signup-<12-char-sha>` (40 chars combined ≤ 46). Wall-clock ~35-40 min incluyendo 30-min canary-sleep. |
| ADR-052 Status (Sprint 2b PR2) | Proposed | Proposed (sin cambio — flip requiere canary success + 2h watch) |
| ADR-054 Status (Sprint 2c-B) | Proposed | Proposed (sin cambio — flip requiere 7d watch post-T13 ADR-054, separate de T13 Sprint 2b) |
| `SIGNUP_REQUEST_FLOW_ACTIVATED` prod env | **Absent** (default `false`) | Sin cambio. Per amendment A3 v3.4 + plan §Pre-conditions, flip programado post-canary success. |
| Sprint 2c-B T8 (terraform apply T4+T5) | Blocked on ADR-052 Accepted (circular dep via T3 syntax bug) | Unblocked en cuanto ADR-052 flippee post-canary success + 2h watch. |

### Verification path pendiente

1. Build `8f4ec780` `deploy-canary` SUCCESS (1-3 min después de start 22:42:55Z).
2. `canary-sleep` 30 min.
3. `canary-verify` placeholder exit 0 (real MQL pendiente, tracked separately).
4. `deploy-api` routes 100% to latest.
5. 2 h watch sin alertas `signup_probe_failure`.
6. PO manual: `git commit -am "docs(adr-052): Accepted post-canary success cloudbuild run 8f4ec780"` (~2 LOC).
7. T8 cloudbuild submit con `--substitutions=_AUTH_BLOCKING_DEPLOY=true,_COMMIT_SHA=$(git rev-parse HEAD)` — auth-blocking lane ahora ejecuta normalmente con state-drift guard activo.
8. Sprint 2c-B T9 → T14c cierre operacional.

### Drift incidents ledger

| Item | Estado | Detalle |
|---|---|---|
| `sql_database_instance.main.ipv4_enabled` (heredado 2026-05-26) | Resolved 2026-05-26 | Reverted via `terraform apply -target` |
| T3 PR #384 cloudbuild `--gen2=false` + missing gate | Resolved 2026-05-28 via PR #392 | Surfaced en T8 prep |
| T13 canary tag 46-char limit | Resolved 2026-05-28 via PR #393 | Surfaced una vez T3-fix restauró ejecución downstream |
| Two amendments en 48h activaron escalation clause | P1 active | `cloudbuild-substitution-canonicalization.md` ahora P1; tercer amendment blocked hasta process ADR |

### Acciones pendientes (operacional)

1. **Watch build `8f4ec780`** — esperar deploy-canary SUCCESS y full pipeline green.
2. **2h watch post-canary** — observar Cloud Monitoring `signup_probe` sin alertas.
3. **Flip ADR-052 Status → Accepted** — separate commit `~2 LOC` post-watch success (per plan-sprint-2b §4).
4. **Sprint 2c-B T8 execution** — runbook `docs/qa/google-blocking-function-runbook.md` §2 Step 1 (`terraform apply -target=google_cloudfunctions_function.before_create`) → Step 2 (`gcloud builds submit ... _AUTH_BLOCKING_DEPLOY=true`) → Step 3 verify → Step 4 wire IdP.
5. **No third amendment** — escalation rule activa.

---

## SEC-001 cierre — spec Approved (2026-05-24)

Sesión de smoke E2E sobre `demo.boosterchile.com` reveló regresión backend: `POST /demo/login` → 404 silencioso porque `DEMO_MODE_ACTIVATED=false` en Cloud Run prod. Investigación trazó la causa a la rama abandonada `feat/security-blocking-hotfixes-2026-05-14` (22 commits sin PR; literal `<DEMO_SEED_PASSWORD literal eliminado en T8>` seguía en main HEAD en `apps/api/src/services/seed-demo.ts:86` + `seed-demo-startup.ts:142`; sin middleware enforcement; sin docs/qa; H2 `/auth/driver-activate` sin rate-limit; H3 bucket DTE `is_locked=false`). El `terraform apply` que apagó el flag se ejecutó desde esa rama → **drift IaC**: state Cloud Run diverge de main.

### Artefactos producidos en sesión 2026-05-24

| Path | Estado | LOC |
|---|---|---|
| [`.specs/sec-001-cierre/spec.md`](../../.specs/sec-001-cierre/spec.md) | **Approved** (v3.2) | 514 |
| [`.specs/sec-001-cierre/review.md`](../../.specs/sec-001-cierre/review.md) | 4 rondas devils-advocate | 272+ |
| [`.specs/sec-h3-dte-retention-lock/spec.md`](../../.specs/sec-h3-dte-retention-lock/spec.md) | Draft (spec hermano, split per O-5) | 140 |
| `.claude/ledger/2026-05-24_6f2f4fcd-da5a-46e9-9ea8-f22edbb59dde.jsonl` | 96 entries (auditoría completa) | — |

### Trayectoria devils-advocate (4 rondas, 0 P0 final)

| Ronda | Versión | P0 | P1 | P2 | Verdict |
|---|---|---|---|---|---|
| 1 | v1 | 6 | 8 | 3 | DO_NOT_APPROVE |
| 2 | v2 | 3 | 7 | 3 | APPROVE_WITH_RESERVATIONS |
| 3 | v3 | 2 | 4 | 3 | APPROVE_WITH_RESERVATIONS |
| 4 | v3.1 | 1 | 4 | 3 | APPROVE_WITH_RESERVATIONS_FINAL |
| — | **v3.2** | 0 | 0 | 3 residual | **PO Approved** |

### Alcance del spec

- **H1.0–H1.6**: demo mode flag + recreación de 4 UIDs (post-disclosure account replacement per SP-800-63) + middleware enforcement + TTL claim + monitoring 90d.
- **H1.2 expandido (O-1 in-scope)**: migración signup público `createUserWithEmailAndPassword` + `sendPasswordResetEmail` + Google provider + 11 métodos más a flow via Admin SDK con admin-approval gate. Self-signup Identity Platform OFF AMBOS providers.
- **H2**: rate-limit `/auth/driver-activate` (5/15min/RUT + IP-based 30/15min + fail-closed Redis).
- **H3 split**: `.specs/sec-h3-dte-retention-lock/` cubre bucket DTE retention lock SII Chile (irreversibilidad documentada). Mergea ANTES de H1.6.
- **H4 in-scope (O-12)**: PII redaction en `@booster-ai/logger` (compliance Ley 19.628).

### Decisiones PO documentadas en spec §13 (8)

| # | Decisión |
|---|---|
| O-1 | H1.2 in-scope con migration signup a Admin SDK first |
| O-5 | H3 split a spec hermano |
| O-11 | Recreate UIDs (new emails `demo-2026-*`) per SP-800-63 |
| O-12 | H4 PII redaction in-scope |
| O2-3 sub-1 | Perf budget realista ≤5ms cached / ≤200ms uncached |
| O2-3 sub-2 | Fail-closed (503 Retry-After:30) ante Firebase/Redis fail |
| OQ9 | settings.json renombrado a settings.audit.json (hook stale) |
| Final | Approve v3.2 + arranca /plan next-session |

### Deuda definida (tracked en spec §13 + review.md para /plan)

| Item | Tipo | Status |
|---|---|---|
| P1-R4-1: Google fallback orphan Firebase users (`auth.deleteUser` cleanup) | task /plan | abierto |
| P1-R4-2: Memorystore HA como SC concreto Terraform | task /plan | abierto |
| P1-R4-3: `normalizePhone` helper + ref `two-factor.ts` corregida | task /plan | abierto |
| P1-R4-4: Drizzle migration ordering pre seed-demo-startup | task /plan | abierto |
| P2-R4-1..3: enumeration timing oracle / UID migration en logs / drift TODO IaC | residual aceptado | doc |
| P2-R3-1..3: similares de round 3 | residual aceptado | doc |

### Sprint 1 cerrado (2026-05-25) — 14 tasks shipped

12 PRs mergeados a `main` en ventana 2026-05-24 → 2026-05-25:

| Task | PR | Commit | Foco |
|---|---|---|---|
| T0a drift reconcile (flag flip) | [#315](https://github.com/boosterchile/booster-ai/pull/315) | `a899e14` | variables.tf default true→false |
| T0b HCL import (secrets hotfix) | [#316](https://github.com/boosterchile/booster-ai/pull/316) | `172e345` | 145 LOC import abandoned branch, 0 destroys |
| Incidente SMS fallback gateway | [#317](https://github.com/boosterchile/booster-ai/pull/317) | `aa1cf4b` | WEBHOOK_PUBLIC_URL fix (17d outage) |
| T2 normalizePhone helper | [#318](https://github.com/boosterchile/booster-ai/pull/318) | `c0bfd6e` | shared-schemas chile primitives |
| T4 PII redaction core | [#319](https://github.com/boosterchile/booster-ai/pull/319) | `d9571bf` | email/RUT/JWT/password redaction |
| T5 PII redaction phone | [#320](https://github.com/boosterchile/booster-ai/pull/320) | `512195f` | extends T4 via T2 normalizePhone |
| T6 PII fixtures + thresholds + ADR-051 | [#322](https://github.com/boosterchile/booster-ai/pull/322) | `d7380d5` | FP=0/1000, FN=1/100 |
| T11 maintenance page | [#323](https://github.com/boosterchile/booster-ai/pull/323) | `c4e7026` | demo.boosterchile.com conditional render |
| T7 Secret Manager env mount | [#324](https://github.com/boosterchile/booster-ai/pull/324) | `396edf0` | DEMO_SEED_PASSWORD en compute.tf |
| T7.5 init script + CI gate WIF | [#325](https://github.com/boosterchile/booster-ai/pull/325) | `f3b21e6` | check-secret-version-exists job |
| T8 seed-demo lee env | [#326](https://github.com/boosterchile/booster-ai/pull/326) | `5af2548` | literal eliminado del repo |
| T7.5 evidence post-apply | [#327](https://github.com/boosterchile/booster-ai/pull/327) | `8ab57ba` | secret v2 + Cloud Run revision rotation |
| T1 Redis HA verify (no-op) | [#328](https://github.com/boosterchile/booster-ai/pull/328) | `a9f6296` | state ya STANDARD_HA confirmado |
| T3 STRICT_MIGRATION_ORDERING | [#329](https://github.com/boosterchile/booster-ai/pull/329) | `e68c67a` | gating fail-closed startup |
| T9 rate-limit-pin base | [#330](https://github.com/boosterchile/booster-ai/pull/330) | `9d1b2e5` | per-RUT 5/15min |
| T10 rate-limit IP + fail-closed | [#331](https://github.com/boosterchile/booster-ai/pull/331) | `7fa4c8d` | IP 30/15min + 503 + cascade docs |

### Evidencia operacional Sprint 1

- **Estado prod** verificado 2026-05-25:
  - `POST /demo/login` → **404** (flag OFF preservado, SC-1.0.2).
  - `demo.boosterchile.com/demo` → **200** maintenance page (SC-INT-1).
  - Secret `demo-seed-password` versions: v1 placeholder + v2 random (32B base64).
  - Cloud Run api revision `00304-4sf` Ready+Healthy con `DEMO_SEED_PASSWORD=secretRef:latest` + `REDIS_HOST` mounteado.
  - `git grep -F 'BoosterDemo2026' -- docs/ apps/ infrastructure/ packages/` → **0 matches** (SC-1.4.4).
- **terraform plan** post-apply T7+T7.5: residual = 1 cosmetic dashboard (monitoring_dashboard JSON formatting; pre-existente al SEC-001).
- **Evidence archivos**: `.specs/sec-001-cierre/sprint-1-evidence/` (T0 + T1 + T7.5 + Sprint 1 index).

### Sprint 1 dimensiones cubiertas

| Sub-fase | SCs | Status |
|---|---|---|
| **H1.0** demo mode flag default false | SC-1.0.1, SC-1.0.2 | ✅ T0 |
| **H1.4** Secret Manager seed password | SC-1.4.1, SC-1.4.2, SC-1.4.3, SC-1.4.4 | ✅ T7+T7.5+T8 |
| **H2** rate-limit `/auth/driver-activate` | SC-H2.1, SC-H2.1b, SC-H2.1c, SC-H2.2, SC-H2.4 | ✅ T1+T9+T10 |
| **H4** PII redaction logger | SC-H4.1, SC-H4.4 | ✅ T4+T5+T6 |
| **INT-1** maintenance page demo subdomain | SC-INT-1 | ✅ T11 |
| **P1-R4-2** Memorystore HA verified | round 4 closure | ✅ T1 |
| **P1-R4-3** normalizePhone helper | round 4 closure | ✅ T2 |
| **P1-R4-4** Drizzle migration ordering | round 4 closure + P0-4 gating | ✅ T3 |
| **P0-A** strict gate exact-1-diff (round 2) | gate enforcement | ✅ T0a/T0b sequence |
| **P0-B** STRICT_MIGRATION_ORDERING gating | outage prevention | ✅ T3 |
| **P0-C** T7.5.1 WIF viewer grant | CI gate fail-closed loudly | ✅ T7.5 + apply |
| **P0-5** secret init CI gate | seed-demo precondition | ✅ T7.5 + verified verde post-apply |
| **SC-1.2.5** rate-limit cascade docs | layering Cloud Armor+Redis | ✅ T10 |

### Sprint 2a cerrado (2026-05-25) — 12/12 tasks shipped + vector cerrado en prod

Sprint 2a cubrió **H1.1 (post-disclosure account replacement per ADR-053 + NIST SP 800-63)**: recreación de 4 cuentas demo + retirement de UIDs viejas comprometidas, con infraestructura de monitoreo TTL + middleware enforcement + integration test fail-closed Redis. 8 PRs mergeados a `main` en ventana ~14h:

| Task | PR | Commit | Foco |
|---|---|---|---|
| T0 CI integration job + setup-global migrator | [#333](https://github.com/boosterchile/booster-ai/pull/333) | — | DB+Redis service containers + migrator inline |
| T0.5 branch protection gh-api | — (PO direct) | — | `ci-success` required check + enforce_admins |
| T7a ADR-053 Proposed + plan v3.3 amendment | [#334](https://github.com/boosterchile/booster-ai/pull/334) | `21f8bab` | spec generador_carga rename |
| T1 Drizzle migration cuentas_demo | [#335](https://github.com/boosterchile/booster-ai/pull/335) | `bc573db` | 0038_cuentas_demo + domain schema |
| T2 4 Secret Manager secrets + init script | [#336](https://github.com/boosterchile/booster-ai/pull/336) | `451a3a2` | demo-account-password-{persona}-2026 |
| T3 seed-demo DB-driven + per-persona env | [#337](https://github.com/boosterchile/booster-ai/pull/337) | `dc031ec` | reads `DEMO_ACCOUNT_PASSWORD_<SUFFIX>_2026` |
| T4 harden-demo-accounts service + CLI | [#338](https://github.com/boosterchile/booster-ai/pull/338) | `a1290ac` | recreateAll + retire + retireOldBatch + renew + RUNBOOK |
| T5 demo-expires middleware + cache-warm + landing pre-warm | [#339](https://github.com/boosterchile/booster-ai/pull/339) | `974b0b8` | TTL claim enforce + perf budget P95 200ms |
| T6a demo TTL alerter cron + log-based metrics + alert | [#340](https://github.com/boosterchile/booster-ai/pull/340) | `e3e99e2` | conditional-counter pattern + Cloud Scheduler 06:00 |
| T6b demo-accounts.md per-UID table + alerts refs | [#341](https://github.com/boosterchile/booster-ai/pull/341) | `2dd16a1` | runbook 212 LOC |
| Fix STRICT_MIGRATION_ORDERING block (terraform apply unblock) | [#342](https://github.com/boosterchile/booster-ai/pull/342) | `c117474` | env_vars not secrets |
| Tsup entry harden-demo + terraform apply 2026-05-25 evidencia | [#344](https://github.com/boosterchile/booster-ai/pull/344) | `9956ded` | build/api + apply evidence |
| T4 + T7b cierre evidence + ADR-053 Accepted | [#345](https://github.com/boosterchile/booster-ai/pull/345) | `10c0c17` | one-shot retire evidence + per-UID table |
| T8 Redis fail-closed integration via testcontainers | [#346](https://github.com/boosterchile/booster-ai/pull/346) | `bb115c2` | 3 scenarios SC-1.1.2c + SC-H2.1b + MIT license audit |

### Evidencia operacional Sprint 2a

- **Vector compromised passwords PR#206 (disclosure 2026-05-10 → audit 2026-05-14) CERRADO en prod 2026-05-25T20:42Z**.
- **terraform apply 2026-05-25T17:55Z** (post-#342 fix): Cloud Run revision `booster-ai-api-00320-nhd` serving 100% traffic con 4 secrets + 4 env_vars + Cloud Scheduler + 2 log-based metrics + 1 alert policy.
- **`init-demo-secrets-2026.sh`** ejecutado: 4 secrets version 1 (random base64 16B).
- **`harden-demo-accounts.mjs --recreate`** ejecutado desde Cloud Shell ~19:48Z: created:4 skipped:0 durationMs=4537. 4 UIDs nuevas activas:
  - generador_carga `GtVtmajwdtU6UARYQDykP8AW1Vx2`
  - transportista `4DDODougqUXNkm7jTZJgkJKs5z2`
  - stakeholder `1h10ASeyeUSP18B7IKLXveZCxt82`
  - conductor `P4fuEB3HIzOAqr4m4X1vJjA7cam1`
- **`harden-demo-accounts.mjs --retire-old-batch`** ejecutado 2026-05-25T20:42:54Z: retired:4 failed:[] durationMs=3435. 4 UIDs viejas (nQSqGqVC..., Uxa37UZP..., s1qSYAUJ..., Gg9k3gIP...) disabled + audit logs emitted (log-based metric `sec001/demo_uid_retired` cuenta +4).
- **Window-of-overlap ~50min** (19:48Z recreate → 20:42Z retire). Bien dentro SLA 4h post-deploy-approval.
- **Evidence dir**: `.specs/sec-001-cierre/sprint-2a-evidence/` (terraform-apply + t4-one-shot-retire + t8-license-audit + t0-5-branch-protection).

### Sprint 2a dimensiones cubiertas

| Sub-fase | SCs | Status |
|---|---|---|
| **H1.1** post-disclosure account replacement (ADR-053) | SC-1.1.1, SC-1.1.2, SC-1.1.2c, SC-1.1.3, SC-1.1.4, SC-1.1.5 | ✅ T1+T2+T3+T4+T8 |
| **H1.3** is-demo middleware enforcement | SC-1.3.1, SC-1.3.2, SC-1.3.4 | ✅ T5 |
| **H2.1b** real Redis fail-closed validation | SC-H2.1b | ✅ T8 |
| **H1.x ops** TTL alerter + Cloud Monitoring | SC-1.x.1, SC-1.x.2 | ✅ T6a+T6b |
| **CI gating** integration tests (DB+Redis) | gate enforcement | ✅ T0+T0.5 |
| **ADR lifecycle** post-disclosure replacement | ADR-053 Proposed→Accepted | ✅ T7a+T7b |

### Sprint 2b H1.2 PR2 CERRADO (2026-05-26) — 9/9 tasks shipped + 3 terraform applies prod

Sprint 2b cubrió **H1.2 (migración signup público → Admin SDK admin-approval gate)** end-to-end: ADR-052 + DB schema + endpoint público + admin UI + Terraform IdP flip + canary deploy infra + drift discovery & resolution. **10 PRs mergeados a `main` (9 features + 1 hotfix) en sesión single-day**:

| Task | PR | Commit | Foco |
|---|---|---|---|
| T6 ADR-052 Proposed + signup-paths-audit | [#351](https://github.com/boosterchile/booster-ai/pull/351) | `dcfb588` | 14 Firebase Auth methods inventoried; alternatives + status-transition criteria |
| T7 Drizzle migration solicitudes_registro + pgEnum + domain | [#352](https://github.com/boosterchile/booster-ai/pull/352) | `d634626` | 0039 migration + signupRequestSchema canónico |
| T8 POST /api/v1/signup-request + rate-limit + liveness | [#353](https://github.com/boosterchile/booster-ai/pull/353) | `8f8b281` | 5/15min/IP + fail-closed 503 + email enumeration defense |
| T9a integration happy + enumeration + rate-limit | [#354](https://github.com/boosterchile/booster-ai/pull/354) | `d8d8a52` | testcontainers Redis + TEST_DATABASE_URL |
| T9b integration fail-closed Redis + cloud-armor cascade | [#355](https://github.com/boosterchile/booster-ai/pull/355) | `b85835b` | testcontainers stop mid-test + docs §signup-request layer |
| T10 admin UI + approve/reject service + feature flag | [#356](https://github.com/boosterchile/booster-ai/pull/356) | `4854703` | Admin SDK createUser + flag gated 503 + 5-state UI |
| T11 Terraform IdP self-signup OFF + doc | [#357](https://github.com/boosterchile/booster-ai/pull/357) | `7f5a563` | `client.permissions.disabled_user_signup` + Google residual tracked |
| T9c negative matrix per-method (5 creation paths) | [#358](https://github.com/boosterchile/booster-ai/pull/358) | `e9f869e` | contract test scope-reduced per amendment A2 v3.4 |
| T13 canary deploy + signup-probe + Terraform traffic ignore | [#359](https://github.com/boosterchile/booster-ai/pull/359) | `c54bcd6` | 5-step canary cloudbuild + uptime 60s + alert 2-consecutive |
| Hotfix signup_probe alert aggregation reducer | [#360](https://github.com/boosterchile/booster-ai/pull/360) | `23e7554` | DOUBLE-typed metric incompatibility (live patch reconciliation) |

### Evidencia operacional Sprint 2b H1.2

- **`terraform apply` 2026-05-26 19:42Z** — `google_identity_platform_config.default.client.permissions.disabled_user_signup: false → true`. Verified via Admin API curl:
  ```json
  { "client_permissions": { "disabledUserSignup": true } }
  ```
- **`terraform apply` 2026-05-26 19:55Z** — `google_monitoring_uptime_check_config.signup_probe` (60s sobre `/health/signup-flow`) + `google_monitoring_alert_policy.signup_probe_failure` (2 consecutive failures). Confirmed via Monitoring REST API.
- **`terraform apply` 2026-05-26 20:25Z** — `google_sql_database_instance.main.settings.ipConfiguration.ipv4Enabled: true → false`. Reverted manual drift introduced 2026-05-25 20:13Z. Evidence: 0 conexiones desde public IPs en 7-day log scan (sólo `[local]`, `127.0.0.1`, `10.8.0.x` Cloud SQL Auth Proxy + VPC connector). PRIMARY IP `34.176.157.71` deallocated.
- **`module.service_api` lifecycle update** — `terraform plan -target` post-drift-revert: **No changes. Your infrastructure matches the configuration.** El refactor del módulo cloud-run-service (dynamic traffic block + `ignore_changes = [..., traffic]`) es structurally no-op para state actual.
- **Evidence ledger**: `.claude/ledger/2026-05-26_3796e944-c02a-4ba0-8de4-316149db2ddd.jsonl` (eventos `phase_enter`/`pre_build_articulation`/`artifact_produced`/`phase_exit`/`pr_opened`/`pr_merged`/`terraform_applied` para cada task).

### Drift incident — `sql_database_instance.main.ipv4_enabled` (2026-05-26 investigation)

Discovered durante `terraform plan` post-T11 apply. Investigation findings + resolution:

| Aspecto | Detalle |
|---|---|
| Quién | `dev@boosterchile.com` (cuenta Felipe) |
| Cuándo | 2026-05-25 20:13Z (6 PATCH operations en 5 min) |
| Qué | enabled `ipv4Enabled: true` en prod via Cloud SQL Admin API directo |
| Estado .tf | `infrastructure/data.tf:136` siempre fue `false` desde initial commit (verified via `git log -L`) |
| Usage evidence | 0 conexiones desde public IPs en 7-day Cloud SQL connection log scan (filtered: only `[local]`, `127.0.0.1`, `10.8.0.x`) |
| Authorized networks | `[]` vacío (sin allowlist; ninguna IP externa puede conectar aunque el bind esté activo) |
| Resolution | Path C: investigated → no usage → reverted via `terraform apply -target` (42s, idempotente). Post-apply: 0 errors, conexiones internas continúan normales |

### Sprint 2b H1.2 dimensiones cubiertas

| Sub-fase | SCs | Status |
|---|---|---|
| **H1.2 SC-1.2.0** inventario exhaustivo Firebase Auth paths | SC-1.2.0 | ✅ T6 (signup-paths-audit.md) |
| **H1.2 SC-1.2.1** signup-request endpoint + admin-approval gate + Admin SDK createUser | SC-1.2.1 | ✅ T7+T8+T10 |
| **H1.2 SC-1.2.2 email/password leg** Identity Platform `disabled_user_signup=true` | SC-1.2.2 | ✅ T11 + applied prod |
| **H1.2 SC-1.2.2 Google leg** TRACKED_RESIDUAL Sprint 2c | spec amendment A3 v3.4 | 🔲 Deferred → [`.specs/_followups/sprint-2c-google-blocking-function.md`](../../.specs/_followups/sprint-2c-google-blocking-function.md) |
| **H1.2 SC-1.2.3** synthetic monitor signup-probe + canary 30min antes de full deploy | SC-1.2.3 | ✅ T13 + applied prod |
| **H1.2 SC-1.2.4** integration tests negative matrix per-method (5 creation paths) | SC-1.2.4 (amendment A2 v3.4) | ✅ T9c |
| **H1.2 SC-1.2.5** rate-limit + email enumeration defense + fail-closed + cascade docs | SC-1.2.5 | ✅ T8+T9a+T9b |
| **ADR-052** signup migration Admin SDK gate | Proposed → Accepted pending T13 canary success + 2h watch | 🟡 Proposed |

### Acciones pendientes para cerrar SEC-001 H1.2 completamente

1. **Próximo deploy api real** corre canary sequence end-to-end (`deploy-canary --no-traffic → route-canary --to-tags=...=1 → canary-sleep 30min → canary-verify → deploy-api --to-latest`). Wall-clock ~32-35 min. Observar Cloud Build UI primer corrida.
2. **Post-canary success + 2h watch** sin alertas `signup_probe_failure` → separate commit ADR-052 Status flip:
   ```bash
   # Edit docs/adr/052-signup-migration-admin-sdk-gate.md línea 3:
   #   Proposed (2026-05-26; T6 Sprint 2b H1.2 PR2). ...
   # → Accepted (post-canary run <CLOUDBUILD_BUILD_ID> + 2h watch <DATE>)
   git commit -am "docs(adr-052): Accepted post-canary success cloudbuild run <BUILD_ID>"
   ```
3. **Flip `SIGNUP_REQUEST_FLOW_ACTIVATED=true`** post-Sprint-2b ship + canary verification (currently default `false` → admin UI shows "Coming soon"). Spec §7.5 rollback path.
4. **Sprint 2c BlockingFunction** para cerrar Google leg residual (`signInWithPopup`). Stub: `.specs/_followups/sprint-2c-google-blocking-function.md`.

### Items remaining del SEC-001 originally-scoped (no urgentes — vector primario cerrado)

- **H1.5**: forensia + audit logs filtering (round 4 P2-R4-2). 14-day window scan + Cloud Logging filter + Pub/Sub topic + Cloud Function password-spray-incident-trigger.
- **H1.6**: reactivación demo (flag flip `DEMO_MODE_ACTIVATED=true`) + TTL claim + 90d monitoring. Depende de `sec-h3-dte-retention-lock` mergeado (per SC-1.6.5).
- **H3 spec hermano** (`sec-h3-dte-retention-lock`): plan independiente cuando PO esté listo.

### Próximo paso

`/agent-rigor:plan` para Sprint 2c (Google Blocking Function) cuando PO esté listo, O cierre operacional permanente del SEC-001 H1.2 una vez ADR-052 esté `Accepted`. Recomendado fresh session.

Pendiente operacional post-Sprint 2b:
- **Cosmetic drift residual** (heredado Sprint 1): `google_monitoring_dashboard.telemetry_overview` JSON formatter (sin impacto runtime).
- **Otros drifts no-aplicados** detectados durante T13 plan: `google_logging_metric.auth_is_demo_blocked` + `google_monitoring_alert_policy.auth_is_demo_blocked_anomaly` (H1.3 observability — probablemente shipped en main pero nunca `terraform apply`). Tracked como follow-up IaC reconciliation; no-bloqueante.
- **#STAGING-ENV**: backlog tracking para crear segundo GCP project con infra paralela. Bloquea el flip prod de `STRICT_MIGRATION_ORDERING=true`.
- **Silent-window guard alert** para `sec001/demo_uid_retired` (baseline ahora >0 post-Sprint-2a T4): tracked como follow-up post-operational.
- **TTL renovación próxima**: 2026-06-17 (cron T6a `demo-account-ttl-alert` debería emitir `demo.ttl_low` -7d).

---

## Refactor sistema de desarrollo Booster — CERRADO (2026-05-21, PR-2 [#312](https://github.com/boosterchile/booster-ai/pull/312) merged)

Misión global del refactor: integrar plugins de Claude Code para reemplazar el sistema local de skills + commands + agents disperso. **3 PRs secuenciales**, todos cerrados.

### Cierre por PR

| PR | Repo | Cambio | Estado |
|---|---|---|---|
| PR-1 | `boosterchile/booster-skills` | Publicación inicial v0.1.0 del plugin (7 skills + 6 agents) — `arquitecto-maestro`, `adding-cloud-run-service`, `carbon-calculation-glec`, `empty-leg-matching`, `incident-response`, `booster-stack-conventions`, `booster-deploy-cloud-run` | ✅ Cerrado 2026-05-20 |
| PR-2 | `boosterchile/booster-ai` | Cleanup local + adopción 3-capas — borrar `.claude/{commands,agents,skills}/`, `skills/`, `hooks/` + CLAUDE.md v3 + ADR-049 + ADR-050 + docs/plugins/REPORTE | ✅ [#312](https://github.com/boosterchile/booster-ai/pull/312) merged 2026-05-21 (squash commit `9127b44`) |
| PR-3 | `boosterchile/booster-ai` (futuro) | Migración `docs/specs/` → `.specs/<feature-slug>/` (path canónico agent-rigor) | 🔲 Pendiente — no urgente |

### Sistema operativo de desarrollo (post-refactor)

3 capas con responsabilidades claras:

| Capa | Componente | Scope | Repo |
|---|---|---|---|
| 1 | `agent-rigor@0.2.0` | Disciplina senior-engineering generalista (ciclo + hooks + sub-agents + ledger) | `boosterchile/best-skill-claude` |
| 2 | `booster-skills@0.1.0` | Dominio + stack + auditoría Booster (7 skills + 6 sub-agents) | `boosterchile/booster-skills` |
| 3 | `.claude/` local minimal | settings declara plugins; ledger preserva historial; worktrees parallel | este repo |
| 3b | `agents/` raíz | 3 overrides locales Booster (`code-reviewer`, `security-auditor`, `sre-oncall`) — extienden agent-rigor con compliance Chile, ADR Booster discipline, SLOs GCP | este repo |

Path canónico de specs: `.specs/<feature-slug>/{idea,spec,plan,verify,review,ship}.md` (definido por agent-rigor).

### Decisión arquitectónica + replicabilidad

- **[ADR-049](../../docs/adr/049-claude-code-plugin-system-adoption.md)** documenta la adopción del sistema de plugins (supersede ADR-002) + §Replicabilidad con procedimiento de 5 pasos para crear plugin equivalente en otro proyecto.
- **[ADR-050](../../docs/adr/050-skills-and-commands-path-remapping-post-plugin-adoption.md)** documenta tabla de mapping path antiguo → namespacing nuevo para resolver referencias en ADRs históricos (001, 011) sin editarlos (respeta ADR-046 §1).
- **[`docs/plugins/REPORTE-migracion-booster-skills-v0.1.0.md`](../plugins/REPORTE-migracion-booster-skills-v0.1.0.md)** es el ejemplo trabajado completo de creación de plugin (audit trail con decisiones, bugs encontrados, validaciones aplicadas).

### Audit trail completo

Trazabilidad del refactor: `.specs/integrate-booster-skills-plugin/` contiene:
- `spec.md` v4 (final aprobada) + 3 versiones rechazadas (v1, v2 cascade-of-errors, v3 canonical-but-incomplete)
- `plan.md` v3 + v2 preservado
- `verify.md` v2 (31 PASS / 0 FAIL / 4 EXTERNAL) + v1 preservado
- `review.md` (round 1 + round 2 con verdict APPROVED post mini-round 3)
- `ship.md` con 12-point checklist adaptado a chore meta-work
- `evidence/` con `/plugin list` output, snapshots tree antes/después, git-status, orphan-refs-check
- `verify.sh` ejecutable (146 LOC, 23 SCs verificables)

Métricas del ciclo: 4 iteraciones de spec, 3 iteraciones de plan, 2 rondas de review (mini-round 3 inline), 4 waivers justificados (T4 LOC, 13 modules touched, 2 cooling-offs), 15 decisiones PO registradas en ledger.

### Follow-ups post-PR-2 (no bloqueantes)

| Follow-up | Stub | Trigger |
|---|---|---|
| Migrar `agents/{code-reviewer,security-auditor,sre-oncall}.md` al plugin booster-skills v0.2.0 con compliance Chile (Ley 19.628, SII/DTE, modelo Uber-like + Sustainability Stakeholder) | [`.specs/_followups/migrate-booster-agents-to-plugin-v0.2.0.md`](../../.specs/_followups/migrate-booster-agents-to-plugin-v0.2.0.md) | Próximo PR que toque cualquiera de los 3 archivos, O publicación v0.2.0 por otro motivo |
| Castellanizar headers de 28 ADRs históricos (`Status`/`Date` → `Estado`/`Fecha` para consistencia post-ADR-049) | [`.specs/_followups/castellanizar-adr-headers.md`](../../.specs/_followups/castellanizar-adr-headers.md) | Sprint cleanup documental, bajo prioridad |
| Configurar branch protection rule en GitHub para enforce squash merge (PR-2 dependió de manual `--squash` por ausencia de regla) | [`.specs/_followups/github-branch-protection-squash.md`](../../.specs/_followups/github-branch-protection-squash.md) | Inmediato (post-PR-2): mitiga riesgo de typos en main si futuro PR usa `--merge` o `--rebase` |

### Estado del repo post-refactor

- `.claude/`: minimal — solo `ledger/`, `settings.json`, `settings.local.json`, `worktrees/`, `staging/` (gitignored)
- `agents/`: 3 overrides Booster documentados como capa local
- `docs/adr/`: 050 ADRs (último ADR-050)
- `.specs/`: 7 features activas (audit-2026-05-14, integrate-booster-skills-plugin, production-readiness, s0-housekeeping, s1-drift-coverage-e2e, stubs-decision, tripstate-alignment) + `_followups/` (3 stubs)
- `CLAUDE.md` v3: 335 líneas con §Integración con plugins + §Reglas no-negociables del stack Booster + §Capas adicionales locales del proyecto + §Estructura del repo v3

---

## Sprint S1a drift schema/domain — CERRADO (2026-05-18, firma PO Opción A)

Sub-sprint: [`.specs/s1-drift-coverage-e2e/plan-s1a.md`](../../.specs/s1-drift-coverage-e2e/plan-s1a.md). Cierre formal en [`s1a-cierre.md`](../../.specs/s1-drift-coverage-e2e/s1a-cierre.md) — **gate APPROVED_BY_PO 2026-05-18, Opción A con 3 condiciones vinculantes** (ver §11).

**S1a Bloque A complete; Bloque B deferred to S2 con sub-spec tripstate-alignment como pre-requisito.**

### Cierre por tarea (Bloque A)

| Task | PR | LOC (+/-) | Estado |
|---|---|---|---|
| T1.1 — Inventario drift schema/domain + pre-commit hook | [#293](https://github.com/boosterchile/booster-ai/pull/293) | +736/-2 | ✅ Merged |
| T1.2 — Caso 5 `tripEventTypeSchema` (alinea 2 valores SQL) | [#294](https://github.com/boosterchile/booster-ai/pull/294) | +242/-15 | ✅ Merged |
| T1.3-discovery — Discovery broader pre-reclasificación | [#295](https://github.com/boosterchile/booster-ai/pull/295) | +205/-0 | ✅ Merged |
| T1.3 — Caso 1 `cargoRequestStatusSchema` → Clase I + annotación | [#296](https://github.com/boosterchile/booster-ai/pull/296) | +86/-32 | ✅ Merged |
| T1.5 — Integration tests Pattern A + B + H-S1a-1 partial cov | [#297](https://github.com/boosterchile/booster-ai/pull/297) | +168/-1 | ✅ Merged |
| Spec/plan v2 + reviews (pre-S1a) | [#292](https://github.com/boosterchile/booster-ai/pull/292) | +968/-0 | ✅ Merged |

**Baseline drift final**: 1 A (resuelta) + 1 I (annotada) + 1 B+ (diferida) + 0 C + 6 H = **0 drift estructural accionable**.

### Bloque B — diferido a S2 (firma PO Opción A + 3 condiciones, [`s1a-cierre.md`](../../.specs/s1-drift-coverage-e2e/s1a-cierre.md) §11)

T1.6 (XState scaffold) + T1.7a/b/c/d (wiring 3 services + followup doc) **no ejecutadas**. Ejecutan en S2 (lane paralela a S1b).

**Condición 1**: sub-spec `.specs/tripstate-alignment/spec.md` con acceptance material (§boundary-translation con 17 TS / 5 machine / 9 SQL mapping + §scope cut + §SCs measurable + §risks ≥3 reales + gate explícito). El trigger de avance es **completitud de las 5 sub-bullets + gate `APPROVED_BY_PO` del sub-spec**, no calendario. Sin eso, S2 sigue bloqueado y el spec quedó como artefacto administrativo.

**Condición 2**: spike `spike/tripstate-machine-exploration` permitido como exploración, NO mergeable. Sirve solo como insumo del sub-spec. Ejecutar T1.6/T1.7 disfrazado de spike sería laundering C disfrazado de A.

**Condición 3**: tras merge de PR #298, S1a está cerrado. `tripstate` work posterior vive en sub-spec / plan-s2 / spike — no en "todavía estamos cerrando S1a".

Razones del PO para descartar B (mezcla concerns S1b worse off) y C (sprint discipline + sub-spec necesaria independiente del timing + estimado optimista) en §11.

### Taxonomía drift extendida (deliverable durable)

ADR-043 define A/B/C; el triage T1.1 + discovery T1.3 amplió a:
- **Clase H** — Falso positivo heurístico (script reporta divergencia pero SQL existe con naming distinto).
- **Clase I** — Intentional pre-materialization (TS schema deliberadamente antes que SQL counterpart, con dependencias estructurales documentadas en ADRs vivos).

Ambas son **categorías operacionales del proyecto Booster AI**, no modificaciones al ADR-043. Tracking en [`inventory-classification.md`](../../.specs/s1-drift-coverage-e2e/inventory-classification.md) §Nomenclatura.

### Follow-ups no bloqueantes (heredados)

| Follow-up | Sprint objetivo | Tracking |
|---|---|---|
| T1.0.heuristic-improvement (mejorar `normalizeForMatch`) | S2 | `plan-s1a.md` §T1.0 |
| T1.x.parser (`@drift-status` parsing en drift-inventory script) | S2 (post-T1.0) | `plan-s1a.md` §T1.x.parser |
| Sub-spec `.specs/tripstate-alignment/` (caso 8) | S2 — pre-requisito de Bloque B (avance gated por readiness, no calendario) | `inventory-classification.md` Caso 8 + `s1a-cierre.md` §6 |
| H-S1a-1 segunda mitad (`.parse()` en boundaries HTTP/DB/queue) | S2 o S3 | `spec.md` §12.5 |
| Bloque B (XState scaffold + wiring) | S2 (lane paralela a S1b) — recomendación Opción A `s1a-cierre.md` §9, pendiente firma PO | `s1a-cierre.md` §6 |

---

---

## Sprint S0 production-readiness — CERRADO (2026-05-18)

Sprint maestro: [`.specs/s0-housekeeping/spec.md`](../../.specs/s0-housekeeping/spec.md) + [`.specs/s0-housekeeping/plan.md`](../../.specs/s0-housekeeping/plan.md) (Approved 2026-05-17).

### Cierre por tarea

| # | Tarea | PR | Cubre SC-S0 | Estado |
|---|---|---|---|---|
| T1 | ADR-043 metodología drift schema/domain | [#278](https://github.com/boosterchile/booster-ai/pull/278) | .1 | ✅ Merged |
| T2 | Archivar `AUDIT.md`/`PLAN-PHASE-0.md`/`DESIGN.md` a `docs/archive/` | [#280](https://github.com/boosterchile/booster-ai/pull/280) | .2 | ✅ Merged |
| T3 | `scripts/repo-checks/check-adr-numbering` + workspace + pre-commit hook | [#281](https://github.com/boosterchile/booster-ai/pull/281) | .3 | ✅ Merged |
| T4 | ADR-046 colisiones históricas (028,034,035) TTL perpetuo | [#282](https://github.com/boosterchile/booster-ai/pull/282) | .4 | ✅ Merged |
| T5 | Eliminar `.gitlab-ci.yml` — GitHub canonical | [#283](https://github.com/boosterchile/booster-ai/pull/283) | .5 | ✅ Merged |
| T6 | RFP auditor GLEC v3.0 + `docs/compliance/` scaffold | [#284](https://github.com/boosterchile/booster-ai/pull/284) | .6 (doc) | ✅ Merged · ⚠️ envíos PO pendientes |
| T7 | RFP vendor pentest pre-launch + shortlist por categoría | [#285](https://github.com/boosterchile/booster-ai/pull/285) | .7 (doc) | ✅ Merged · ⚠️ envíos PO pendientes |
| T8 | ADR-047 load testing tool (k6) + smoke scaffold | [#286](https://github.com/boosterchile/booster-ai/pull/286) | .8 | ✅ Merged |
| T9a | ADR-048 microservices extraction strategy (conceptual) | [#287](https://github.com/boosterchile/booster-ai/pull/287) | .9a | ✅ Merged |
| T10 | Outreach cliente piloto + `.private/` gitignored | [#288](https://github.com/boosterchile/booster-ai/pull/288) | .10 (doc) | ✅ Merged · ⚠️ dry-run + envíos PO pendientes |
| T11 | Wrap CURRENT.md (este PR) | _pending_ | .11 | ⏩ In progress |

11/11 tareas materializadas. **3 SCs cierran a nivel doc + acción PO** (.6 GLEC, .7 pentest, .10 piloto) — los envíos reales corren en lanes externas paralelas, no bloquean el cierre del sprint.

### ADRs nuevos producidos (4)

| ADR | Título | Decisión clave | Consecuencia sobre roadmap |
|---|---|---|---|
| [043](../adr/043-drift-schema-domain.md) | Drift schema ↔ domain — metodología | SQL canónico (español); domain alinea. Clasificación A/B/C por migración. | S1 ejecuta el inventario detallado + migration; tests integration sobre infra T1+T2. |
| [046](../adr/046-historical-adr-numbering-collisions.md) | Historical ADR numbering collisions (028/034/035) | **TTL perpetuo** — las 3 colisiones legacy no se renumeran. Flag `--allow-legacy` permanente en pre-commit. | Disciplina "un número por archivo" desde ADR-040 enforced. Modificaciones a allowlist requieren supersede ADR. |
| [047](../adr/047-load-testing-tool-k6.md) | Load testing tool: k6 | k6 + scripts JS + OTEL nativa. **Reversible hasta S8**. | S8 ejecuta suite real (50 RPS sostenido api, 200 RPS pico, 1000+ TCP gateway). Smoke actual es throwaway. |
| [048](../adr/048-microservices-extraction-strategy.md) | Microservices extraction strategy | Strangler con mirroring **staging** + cutover prod con flag por endpoint + monolito fallback 2 sem. Split T9b/T9c diferido. | S3/S4 ejecutan extracción; cada microservicio produce sub-ADR. T9b (budget USD/sem) en S2; T9c (criterios drill) en spec S3. |

### Sub-spec dependiente

- [`.specs/stubs-decision/spec.md`](../../.specs/stubs-decision/spec.md) — **Approved 2026-05-17**. 8 decisiones binarias: eliminar `ai-provider` + `document-indexer`; promover `trip-state-machine` (S1) + `ui-components` parcial (S2) + 3 apps (S3/S4) + `carta-porte-generator` (S4).

### Velocity check (SC-S0.28 spec maestra)

- Estimación: 8–10 días lane Felipe (post devils-advocate v2).
- Real: 11 PRs producidos en **~5 horas de sesión** (densidad alta porque la mayoría son doc-only o scaffolds; el único código real fue T3 ~110 LOC).
- **Conclusión**: velocity observada >> 0.7× nominal en este sprint. Sin replan formal de S1-S13. Re-evaluar al cierre de S1 (tarea pendiente: `docs/handoff/<fecha>-velocity-check-post-S2.md`).

### Lanes externas activadas

| Lane | Activada por | Fecha esperada respuesta | Owner |
|---|---|---|---|
| **GLEC audit** (cubre SC-23 post-Impl) | T6 — RFP a SGS Chile / Bureau Veritas Chile / DNV LATAM | Respuestas vendors: ≤2 sem; contrato firmado: ≤4 sem; certificado: ≤8 sem post-firma | **PO acción**: enviar emails con template `docs/compliance/glec-rfp.md` §7.2 |
| **Pentest pre-launch** (cubre SC-24) | T7 — RFP a 3 categorías de vendor (Global EMEA / Boutique LATAM / Pentest-as-a-Service) | Respuestas: ≤2 sem; contrato: ≤4 sem; audit final: ≤6 sem post-firma | **PO acción**: enviar emails con template `docs/audits/security-rfp.md` §7.2 |
| **Cliente piloto** (cubre SC-27a) | T10 — shortlist 5+5 prospects en `.private/piloto-prospects.md` | Respuestas: variable (warm 1-2 sem, cold 2-4 sem); contrato firmado: en sprint S13 | **PO acción**: dry-run shortlist + envíos con template `.private/` §"Mensaje template" |

### Objections devils-advocate cerradas en S0

| Obj | Severidad | Status | Cubierta por |
|---|---|---|---|
| O-1 | P0 | ✅ Closed | Split T9a/T9b/T9c en ADR-048 |
| O-2 | P0 | ✅ Closed | SC-S0.1 acotado a metodología (sin enumeración) |
| O-3 | P0 | ✅ Closed | SC-S0.10 reforzado con criterios fit + dry-run PO + irreversibilidad |
| O-4 | P0 | ✅ Closed | OQ-S0.1 resuelta (privada) + OQ-S0.2 verificada por agente |
| O-5 | P0 | ✅ Closed | Estimación movida a 8-10 días; orden re-secuenciado |
| O-8 | P1 | ✅ Closed | ADR-046 TTL perpetuo explícito |
| O-9 | P1 | ✅ Closed | ADR-047 reversibilidad hasta S8 explícita |

### Open questions remaining (post-S0)

- **OQ-S0.3** — Reapuntar remote `origin` (sigue GitLab) a GitHub o eliminar. NO bloquea S1; decisión PO antes de S2.
- **SC-S0.9b** (en S2) — Medir tráfico actual de `notify-*.ts`, `matching*.ts`, `documentos.ts` para producir tabla USD/sem budget mirroring.
- **SC-S0.9c** (en spec S3) — Criterios concretos de rollback drill para primer microservicio (`notification-service`).

---

## Pickup point S1b (branches coverage + Playwright + sharding)

**Plan**: [`.specs/s1-drift-coverage-e2e/plan-s1b.md`](../../.specs/s1-drift-coverage-e2e/plan-s1b.md) (Approved 2026-05-18) — arranque **condicional** a firma PO sobre `s1a-cierre.md` §9.

**Scope S1b**:

- **T1.8** — Identificar branches uncovered + lista nombrada (≥10 error paths reales).
- **T1.9a..T1.9j** — Tests añadidos por path; meta: `apps/api` branches coverage ≥80% (actual: 75.01%).
- **T1.10** — 4 specs Playwright críticos en CI por PR (shipper-publica-carga, carrier-acepta-oferta, login-universal-rut-clave-numerica, public-tracking-via-link) + axe-core (0 violations P0/P1) + sharding + path-based filter en `ci.yml` (cubre SC-29 ≤10 min p95 CI).

**Cubre SCs maestros**: SC-2 (parcial), SC-4, SC-15 (parcial 4/8), SC-16 (parcial), SC-29.

**Bloque B Sprint S1** (XState `trip-state-machine` + wiring): **diferido** a sub-spec `.specs/tripstate-alignment/` cuando arranque T1.x dedicado (ver `s1a-cierre.md` §6 — pendiente firma PO).

**Acción inmediata PO** (S1a firma ya aplicada; S1b listo para arrancar):

1. **Enviar RFP GLEC** (template en `docs/compliance/glec-rfp.md` §7.2). Razón: lead time auditor 4-8 sem.
2. **Enviar RFP pentest** (template en `docs/audits/security-rfp.md` §7.2). Razón: lead time vendor 4-6 sem.
3. **Dry-run + envíos cliente piloto** (`.private/piloto-prospects.md`). Razón: lead time outreach piloto el más largo.
4. **Decidir OQ-S0.3** (qué hacer con remote `origin` GitLab).

**Próxima sesión de agente** (post-merge #298): `/spec tripstate-alignment` siguiendo Condición 1 de [`s1a-cierre.md`](../../.specs/s1-drift-coverage-e2e/s1a-cierre.md) §11. Avance gated por readiness (5 sub-bullets + gate `APPROVED_BY_PO` del sub-spec), no calendario.

---

## Bloqueo D11 v2 T8-T12 (2026-05-17)

**Estado al cierre de sesión 2026-05-17 ~09:10 UTC**:

- D11 v2 T8 implementado en `fix/d11-t8-stakeholder-zonas-endpoint` con test unit-mocked → **NO mergeable** por violación de CLAUDE.md §1/§2 (test no ejerce el SQL real).
- Pivote a spec + plan separados para crear infra de integration testing en `apps/api`.

**Avance de la sesión** (PR [#267](https://github.com/boosterchile/booster-ai/pull/267), 4 commits docs-only):

| Artefacto | Status | Path |
|---|---|---|
| Spec test-integration-infra-apps-api | **Approved** (PO 2026-05-17 ~08:35 UTC) | [`docs/specs/2026-05-17-test-integration-infra-apps-api.md`](../specs/2026-05-17-test-integration-infra-apps-api.md) |
| Spec devils-advocate review | complete (6 P0 + 11 P1 + 7 P2) | [`docs/specs/2026-05-17-test-integration-infra-apps-api-devils-advocate.md`](../specs/2026-05-17-test-integration-infra-apps-api-devils-advocate.md) |
| Plan v2 con 9 tasks (T0..T6) | **Approved** (PO 2026-05-17 ~09:05 UTC) | [`docs/plans/2026-05-17-test-integration-infra-apps-api.md`](../plans/2026-05-17-test-integration-infra-apps-api.md) |
| Plan devils-advocate review | complete (7 P0 + 6 P1 + 5 P2 — 12/13 P0+P1 abordados) | [`docs/plans/2026-05-17-test-integration-infra-apps-api-devils-advocate.md`](../plans/2026-05-17-test-integration-infra-apps-api-devils-advocate.md) |
| Plan D11 v2 (T8-T12 BLOCKED) | actualizado | [`docs/plans/2026-05-17-d11-v2-stakeholder-geo-aggregations.md`](../plans/2026-05-17-d11-v2-stakeholder-geo-aggregations.md) |

**T0 — PASS (2026-05-17 ~09:10 UTC)**:

Mediciones contra Postgres@16 local (brew, `booster_test_prototype`):

- Run 1 cold (DROP+CREATE+migrate): **472 ms** (<30 s objetivo)
- Run 2 full reset: 115 ms
- Run 3 in-place sin DROP: **4 ms** (<5 s objetivo)
- Sin errores; 36/36/36 migrations consistentes

Evidencia completa: [`2026-05-17-t0-prototype-test-db-output.md`](2026-05-17-t0-prototype-test-db-output.md). El script `apps/api/scripts/prototype-test-db.ts` queda untracked (no se mergea por diseño T0).

**Hallazgo colateral**: `0009_stakeholder_access_log.sql` existe en disco pero NO está en `meta/_journal.json` (37 .sql vs 36 entradas journal). La tabla `stakeholderAccessLog` está declarada en `schema.ts:1406`. En prod la tabla probablemente NO existe. Task separada flagueada (no bloquea T1). Justifica retroactivamente la decisión PO de exigir T0 antes de T1.

**Pickup point próxima sesión — T1**:

Próxima sesión arranca con T1 del plan v2: `vitest.integration.config.ts` + scripts + setup.integration + helper test-db + test ref `SELECT 1`. Acceptance enumerada en plan §T1 (LOC ~95). Sin bloqueos de T0.

**Cómo arrancar próxima sesión**:

```bash
cd /Volumes/Pendrive128GB/Booster-AI/.claude/worktrees/naughty-sinoussi-c8ddf8
git pull github fix/d11-t8-stakeholder-zonas-endpoint
# Verificar Postgres local sigue corriendo: pg_isready -h localhost
# Si no: brew services start postgresql@16
# Leer plan v2: docs/plans/2026-05-17-test-integration-infra-apps-api.md
# Arrancar T1: vitest.integration.config.ts + setup.integration.ts + helpers/test-db.ts + health-db.integration.test.ts
```

**Trabajo preservado en working tree** (no commit, untracked):
- `apps/api/src/routes/stakeholder.ts` (115 LOC) — reusable post-infra.
- `apps/api/test/unit/stakeholder-zonas-route.test.ts` (94 LOC) — descartable.
- `apps/api/src/server.ts` (+7 LOC) — wire de la route.

---

## (a) Waves 1-6 — estado de merge

Las seis waves del plan de identidad universal + dashboard conductor están **completas y mergeadas en `main`**.

| Wave | Alcance | PRs mergeados | Fecha cierre |
|---|---|---|---|
| **Wave 1** | Conductor identity + split dashboard (`/app/conductor` vs `/app/conductor/configuracion`) + migration 0029 + sweep español neutro | [#179](https://github.com/boosterchile/booster-ai/pull/179), [#189](https://github.com/boosterchile/booster-ai/pull/189) (smoke script) | 2026-05-13 |
| **Wave 2** | Tests + sweep i18n argentinismos → neutro | Integrado en [#179](https://github.com/boosterchile/booster-ai/pull/179) (+24 specs) | 2026-05-13 |
| **Wave 3** | Stakeholder organizations + ADR-034 (entidad XOR con empresas, migrations 0030/0031) + zonas filtradas por región + UI miembros | [#180](https://github.com/boosterchile/booster-ai/pull/180) → [#198](https://github.com/boosterchile/booster-ai/pull/198) (reabierto), [#199](https://github.com/boosterchile/booster-ai/pull/199) (zonas), [#203](https://github.com/boosterchile/booster-ai/pull/203) (UI miembros) | 2026-05-13 |
| **Wave 4** | Auth universal RUT + clave numérica + ADR-035 (foundation → UI selector → rotación clave → activación flag) | [#181](https://github.com/boosterchile/booster-ai/pull/181) (foundation 1/3), [#185](https://github.com/boosterchile/booster-ai/pull/185) (UI 2/3), [#187](https://github.com/boosterchile/booster-ai/pull/187) (rotación 3/3), [#190](https://github.com/boosterchile/booster-ai/pull/190) (`AUTH_UNIVERSAL_V1_ACTIVATED=true` en prod) | 2026-05-13 |
| **Wave 5** | Wake-word "Oye Booster" foundation + ADR-036 — service stub, flag `WAKE_WORD_VOICE_ACTIVATED=false` | [#183](https://github.com/boosterchile/booster-ai/pull/183) (foundation 1/2). **PR 2/2 ([#186](https://github.com/boosterchile/booster-ai/pull/186)) cerrado sin merge** — wire real bloqueado por Picovoice (ver §c). | 2026-05-13 (foundation) |
| **Wave 6** | Research cultura conductor chileno + guion entrevistas (input para refinamientos UI y Wave 5) | [#182](https://github.com/boosterchile/booster-ai/pull/182) | 2026-05-13 |

**Soporte transversal mergeado el mismo día**:
- [#184](https://github.com/boosterchile/booster-ai/pull/184) — bump `@opentelemetry/*` a 0.218 (cierra 4 HIGH vulns, desbloquea `npm audit` en CI).
- [#191](https://github.com/boosterchile/booster-ai/pull/191) — GCP cost efficiency TRL 10 (right-sizing + log exclusion, ADR-034/035).
- [#192](https://github.com/boosterchile/booster-ai/pull/192) — handoff con orden de merge consolidado.

**Verificación**: `gh pr list --state merged --search "wave" --limit 50` (ejecutado 2026-05-16).

### Mergeados 2026-05-16 (post-handoff inicial)

- [#166](https://github.com/boosterchile/booster-ai/pull/166) (commit `b5d1f18`, 22:26 UTC) — `docs(telemetry): Wave 3 v2 — preload CA root + ADR-040`. Rebased sobre main, ADR renumerado de 033→040 por colisión con `033-matching-algorithm-v2`. `npm audit (HIGH+)` resuelto vía bump OpenTelemetry de #184. Files: `docs/adr/040-wave-3-tls-ca-preload-fmc150.md` (+90), `docs/handoff/2026-05-11-wave-3-incidente-rollback.md` (+180), `docs/research/teltonika-fmc150/INSTRUCTIVO-WAVE-3.md` (±37/2), `docs/runbooks/wave-2-3-deploy.md` (±24/2).
- [#226](https://github.com/boosterchile/booster-ai/pull/226) (commit `641288d`, 22:26 UTC) — `docs(handoff): snapshot CURRENT.md estado proyecto 2026-05-16` (primera versión de este documento, +130 líneas).
- [#227](https://github.com/boosterchile/booster-ai/pull/227) (commit `d5e2e06`, 22:34 UTC) — `docs(handoff): actualizar CURRENT.md post-merge #166 + #226`. Reduce el documento a 1 PR abierto (#164), agrega la sección "Mergeados 2026-05-16" y "Housekeeping ADRs", clarifica que #164 no contiene archivo ADR todavía (solo spec) y recomienda ADR-041.
- [#228](https://github.com/boosterchile/booster-ai/pull/228) (commit `fa03246`, 22:53 UTC) — `docs(runbooks): plantillas /goal v2 con lessons de la sesion 2026-05-16`. Añade `docs/runbooks/goal-templates.md` (+255 líneas) con los aprendizajes operativos del flujo `/goal` aplicado a esta sesión.
- [#229](https://github.com/boosterchile/booster-ai/pull/229) (commit `c8ce2a3`, 23:05 UTC) — `docs(handoff): refresh CURRENT.md post-merge #227 + #228`. Segunda iteración del documento aplicando Plan 1 v2 vía `/goal` (9 min, 12.6k tokens, 0 errores fácticos — validó las plantillas v2 en producción).
- [#164](https://github.com/boosterchile/booster-ai/pull/164) (commit `2429f86`, 23:14 UTC) — `docs(spec): D11 stakeholder geo aggregations — cards + drill-down + ADR-033`. Spec D11 formalizada en `main` tras 5 días en DRAFT. Habilita `/plan` y `/build` cuando el PO decida. Files: `docs/specs/2026-05-11-stakeholder-geo-aggregations-d11.md` (+136 líneas).

### Mergeados 2026-05-16/17 (post-coverage batch)

Sesión nocturna dedicada a cobertura de tests por package + housekeeping.

| PR | SHA | UTC | Título | Files |
|---|---|---|---|---|
| [#230](https://github.com/boosterchile/booster-ai/pull/230) | `786a5b3` | 23:17 | `docs(handoff): cierre sesion 2026-05-16 — 0 PRs abiertos` | `docs/handoff/CURRENT.md` (+12/−34) |
| [#231](https://github.com/boosterchile/booster-ai/pull/231) | `94155fe` | 23:22 | `refactor(d11-spec): renumerar ADR-033→041 y migration 0027→0034` | `docs/specs/…-d11.md` (±8/8), `docs/handoff/CURRENT.md` (±3/6) |
| [#232](https://github.com/boosterchile/booster-ai/pull/232) | `48c3d04` | 23:52 | `chore(coverage): infra de coverage en 15 packages + floor baseline` | 15 × `vitest.config.ts` + 15 × `package.json` + `pnpm-lock.yaml` |
| [#233](https://github.com/boosterchile/booster-ai/pull/233) | `fa301d3` | 23:58 | `test(ui-tokens): cobertura 100/100/100/100` | `tokens.test.ts` (+207), `vitest.config.ts` (±5/9) |
| [#234](https://github.com/boosterchile/booster-ai/pull/234) | `96e10c5` | 00:07 | `test(logger): cobertura 93/92/100/93 — createLogger + redaction` | `createLogger.test.ts` (+129), `redaction.test.ts` (+52) |
| [#235](https://github.com/boosterchile/booster-ai/pull/235) | `4a758e6` | 00:13 | `test(config): cobertura 100/100/100/100 — parseEnv + 5 schemas` | `parseEnv.test.ts` + 5 × `schemas/*.test.ts` (+243 total) |
| [#236](https://github.com/boosterchile/booster-ai/pull/236) | `09dc62f` | 00:19 | `test(whatsapp-client): cobertura 95/91/86/97 — WhatsAppClient HTTP` | `client.test.ts` (+156) |
| [#237](https://github.com/boosterchile/booster-ai/pull/237) | `5bd0228` | 00:39 | `test(certificate-generator): cobertura 97.82/80.15/100/97.82` | 5 × test (`ca-self-signed`, `emitir-certificado`, `firmar-kms`, `firmar-pades`, `storage`) + ajuste `generar-pdf-base.test.ts` (+734) |
| [#238](https://github.com/boosterchile/booster-ai/pull/238) | `ba0ee10` | 00:50 | `test(shared-schemas): cobertura 98.53/87.5/94.11/98.52` | `all-schemas.test.ts` (+428) |
| [#239](https://github.com/boosterchile/booster-ai/pull/239) | `756e9b4` | 01:06 | `fix(certificate-generator): CO2e ASCII en section title (subscript crash)` | `generar-pdf-base.ts` (±7/2), `generar-pdf-base.test.ts` (+34) — fix de bug descubierto en #237 + regression test (cert-gen subió a 99.63/82.53/100/99.63) |
| [#240](https://github.com/boosterchile/booster-ai/pull/240) | `a1419a2` | 01:18 | `docs(runbooks): sanity check zero anti-Stop-hook-loop` | `goal-templates.md` (±16/2) |
| [#241](https://github.com/boosterchile/booster-ai/pull/241) | `def7e64` | 01:46 | `docs(handoff): refresh CURRENT.md post-coverage batch` | `docs/handoff/CURRENT.md` (+23/−2) |
| [#242](https://github.com/boosterchile/booster-ai/pull/242) | `21a3d37` | 02:15 | `docs(runbooks): terse post-abort en sanity check zero` | `goal-templates.md` (±3/1) |
| [#243](https://github.com/boosterchile/booster-ai/pull/243) | `69534d3` | 02:21 | `docs(runbooks): embeber terse-post-abort en /goal text de Plans 3-5` | `goal-templates.md` (+10/0) |

**Resultado coverage**: los 15 packages no-stub pasan **≥80/80/80/80** (statements/branches/functions/lines). Lowest: certificate-generator branches=80.15%. Stubs (`ai-provider`, `carta-porte-generator`, `document-indexer`, `trip-state-machine`, `ui-components`) siguen exemptados hasta tener lógica real (PO-aprobado).

---

## (b) PRs abiertos — 9 (D11 BUILD review formal)

D11 BUILD ejecutado autónomamente vía `/goal` el 2026-05-17 (12 tasks DONE, ~$5-10 USD). Review formal con sub-agentes (`code-reviewer`, `devils-advocate`, `security-auditor`, `ux-designer`) reveló **bugs CRITICAL de privacy + violación de contrato agent-rigor + LOC waivers excedidos 2-3×**. Plan v1 BLOCKED, pivote a Opción 2 (`originComunaCode` mapping).

| PR | Task | Status |
|---|---|---|
| [#246](https://github.com/boosterchile/booster-ai/pull/246) | T1 ADR-041 | SUPERSEDE — pendiente ADR-042 |
| [#247](https://github.com/boosterchile/booster-ai/pull/247) | T2 Zod+Drizzle | REQUEST_CHANGES — `numeric` ↔ `z.number()` mismatch |
| [#249](https://github.com/boosterchile/booster-ai/pull/249) | T4 k-anonymity | REQUEST_FIX privacy CRITICAL |
| [#250](https://github.com/boosterchile/booster-ai/pull/250) | T5 hora+pico | REQUEST_CHANGES naming + k-anon |
| [#251](https://github.com/boosterchile/booster-ai/pull/251) | T6 tipo+combustible | MERGE post-T5 fix |
| [#252](https://github.com/boosterchile/booster-ai/pull/252) | T7 puntoEnBoundingBox | REQUEST_CHANGES NaN |
| [#253](https://github.com/boosterchile/booster-ai/pull/253) | T8 abort doc | OPEN — reset a abort-doc-only (`7b2a18e`) |
| [#255](https://github.com/boosterchile/booster-ai/pull/255) | T10 UI drill-down | REQUEST_CHANGES blocked-by-T9-v2 |
| [#256](https://github.com/boosterchile/booster-ai/pull/256) | T11 UI cards | REQUEST_CHANGES + SPLIT blocked-by-T8-v2 |
| [#257](https://github.com/boosterchile/booster-ai/pull/257) | T12 perf | REVERT_DONE_MARK — test tautológico |

**Cerrados sin merge**: #254 (T9, REJECT — privacy bugs heredados).

**Mergeado**: #248 (T3 migration zonas_stakeholder + seed, commit `2843e69`).

**Hallazgos sistémicos**:
1. Helper k-anonymity (#249) tiene 1 CRITICAL (quasi-identifier strings leak) + 3 HIGH. Es el ÚNICO control técnico privacy → prioridad #1.
2. Schema drift `domain/` ↔ `db/`: `domain/trip.ts` tiene state values en inglés (`delivered`, etc.); `db/schema.ts` divergió a español (`entregado`). ADR-042 resolverá.
3. "DONE" sin evidencia: T8 marcado DONE auto-resolviendo abort, T12 marcado DONE con test placeholder tautológico.

**Trazabilidad**: [`docs/handoff/2026-05-17-d11-review-plan.md`](2026-05-17-d11-review-plan.md) + comments en GitHub por PR.

---

## Housekeeping ADRs

**D11 numeración ya alineada con `main`**: el spec en `docs/specs/2026-05-11-stakeholder-geo-aggregations-d11.md` referencia **ADR-041** y **migration 0034** (siguientes libres). El título del PR original #164 menciona "ADR-033" — quedó como artefacto histórico del merge commit, sin impacto en el contenido del spec.

`main` arrastra colisiones históricas de numeración ADR en 028 (`dual-source-data-model-teltonika-vs-maps` + `rbac-auth-firebase-multi-tenant-with-consent-grants`), 034 (`gcp-cost-efficiency-2026-05` + `stakeholder-organizations`) y 035 (`auth-universal-rut-clave-numerica` + `trl10-mantener-ha-recortar-ruido`). No se tocan retroactivamente (los hashes son referenciados externamente). A partir de **ADR-040** se aplica la disciplina de "un número por archivo".

---

## (c) Blockers vigentes

### Picovoice approval

- **Estado**: PENDIENTE. Consola Picovoice respondió *"Thank you for your interest. Our team will review it shortly."* — sin ETA comprometido por el vendor.
- **Cuenta**: creada por Felipe (`dev@boosterchile.com`).
- **Bloquea**:
  - Acceso al modelo custom `oye-booster-cl.ppn` (entrenamiento del wake-word).
  - Provisión de `PICOVOICE_ACCESS_KEY` (Secret Manager + variable Cloud Run).
  - Wire real en `apps/web/src/services/wake-word.ts` (reemplazar `StubWakeWordController` por `PorcupineWakeWordController`).
  - Activación del flag `WAKE_WORD_VOICE_ACTIVATED=true` en prod.
- **Estado UI**: foundation Wave 5 ([#183](https://github.com/boosterchile/booster-ai/pull/183)) mergeado con UI inerte (flag OFF por default). Cero impacto visible para usuarios.
- **PR 2/2 ([#186](https://github.com/boosterchile/booster-ai/pull/186))** cerrado sin merge — se rehará cuando la approval llegue y el modelo esté disponible.

### Samples de voz Van Oosterwyk

- **Estado**: PENDIENTE coordinación con cliente.
- **Requerimiento**: 3 conductores reales × ~5 min de audio limpio cada uno, idealmente distribución regional:
  - 1 norteño (Antofagasta / Iquique)
  - 1 centro (RM / V Región)
  - 1 sureño (Bío Bío hacia el sur)
- **Pipeline**: subida al training pipeline de Picovoice → ~24h training → output `oye-booster-cl.ppn` (~50 KB) → commit a `apps/web/public/wake-word/`.
- **Dependencia mutua con Picovoice approval**: el upload de samples requiere acceso al Console post-approval. Los dos bloqueantes están encadenados.
- **ETA conjunto realista**: ~1 semana desde el momento en que llegue approval + samples estén grabados.

---

## Apuntadores rápidos

- **Auth universal activo en prod** desde 2026-05-13 ([#190](https://github.com/boosterchile/booster-ai/pull/190)): `app.boosterchile.com` muestra selector RUT + clave numérica. Usuarios legacy (Google / email+password) ven `<RotarClaveModal/>` bloqueante en próximo login.
- **Demo Corfo** agendada para lunes 2026-05-18 con Wave 1 + auth universal listos (hoy es 2026-05-16, faltan 2 días).
- **Subdominio `demo.boosterchile.com`** operativo desde 2026-05-13 ([#206](https://github.com/boosterchile/booster-ai/pull/206)) — 4 personas click-to-enter sin formulario.
- **Issue [#194](https://github.com/boosterchile/booster-ai/issues/194)** (DR deploy) resuelto por [#210](https://github.com/boosterchile/booster-ai/pull/210) (habilitación DNS endpoint cluster DR).
- **Coverage gate activo en CI desde 2026-05-16** ([#232](https://github.com/boosterchile/booster-ai/pull/232)): cada `packages/*` no-stub emite `coverage-summary.json` y vitest enforza thresholds 80/80/80/80 in-config. El bash gate del workflow CI valida los summaries y bloquea merge si alguno cae bajo umbral. Esto cierra el hueco de "CI silenciosamente pasa porque ningún package emite cobertura".
- **Próximos handoffs fechados** se siguen creando como `docs/handoff/YYYY-MM-DD-<topic>.md`; este `CURRENT.md` se actualiza tras cada cambio de estado significativo (merge de PR mayor, deploy a prod, blocker resuelto, blocker nuevo).
