# Plan stub: sec-001-cierre — Sprint 2b

> **Status**: Stub. Requiere `/agent-rigor:plan plan-sprint-2b` propio + devils-advocate + PO approve antes de cualquier `/agent-rigor:build`.
> **Spec base**: `.specs/sec-001-cierre/spec.md` (Approved v3.2 2026-05-24).
> **Plan Sprint 2 META**: `.specs/sec-001-cierre/plan-sprint-2.md`.
> **Plan Sprint 2a**: `.specs/sec-001-cierre/plan-sprint-2a.md` — **DEBE estar shipped + 2h monitoring clean antes de iniciar Sprint 2b**.

## Razonamiento

Sprint 2 inicial intentó cubrir H1.1 + H1.3 + H1.2 + 3 discoveries en un solo plan (18 tasks, 4 waivers >100 LOC, ~37h ejecución ~3 semanas elapsed). Devils-advocate round 1 lo rechazó por sizing (P1-5) + paths inventados (P0-1, P1-3) + waivers que escondían vertical-slicing failures (P0-3, P1-2, P1-4) + contingency hand-waving (P0-4) + sprint-window infeasibility (P0-5).

PO decisión 2026-05-25: split en Sprint 2a (H1.1 + T17, plan activo) + Sprint 2b (H1.3 + H1.2 + T16 + T18, este stub). Discoveries reasignadas:
- T17 (Redis testcontainers) → Sprint 2a (dependencia natural de T5 demo-expires).
- T16 (Prometheus `rate_limit_pin_blocked_total{scope}`) → Sprint 2b PR H1.3 (mismo monitoring.tf surface).
- T18 (CodeQL custom queries auth-driver) → Sprint 2b PR H1.3 (defense-in-depth pattern del mismo middleware).

## Sub-fases Sprint 2b

| Sub-fase | SCs spec | Origen | Bloqueante |
|---|---|---|---|
| **H1.3** is-demo middleware enforcement | SC-1.3.1..SC-1.3.8 | Spec §3 H1.3 | Sprint 2a shipped (4 nuevas UIDs activas con claim `is_demo:true` para testear enforcement) |
| **H1.2** Signup migration a Admin SDK + IdP self-signup OFF | SC-1.2.0..SC-1.2.5 | Spec §3 H1.2 + O-1 expansión | Sprint 2a shipped + ADR-052 stub Proposed pre-PR |
| **D-T16** Prometheus `rate_limit_pin_blocked_total{scope}` + dashboard | SC-H2.1, SC-H2.4 follow-up | Discovery Sprint 1 PR #331 | H1.3 PR mergeado (mismo monitoring.tf surface) |
| **D-T18** CodeQL custom queries auth-driver | SC-1.3.6 pattern extension | Discovery Sprint 1 | H1.3 PR mergeado |

## Splits anticipados (per devils-advocate round 1)

Devils-advocate identificó que tres tasks del draft Sprint 2 inicial eran vertical-slicing failures. Sprint 2b debe respetar estos splits:

| Task original | Split correcto | Justificación devils-advocate |
|---|---|---|
| **T7** (~140 LOC, "middleware + allowlist + wire + audit doc atomic") | **T7a**: middleware + allowlist scaffolding (empty file with schema) + audit doc inventory (~70 LOC). NO wire global. **T7b**: allowlist populated + wire global en `main.ts` (~70 LOC) | El "intermediate broken state" risk que T7 citaba IS la razón para split: middleware-without-wire es no-op (safe), no estado roto. El audit doc deserves separate review. |
| **T12** (~150 LOC, "route + service + integration test atomic") | **T12a**: route + service + unit tests (~110 LOC). **T12b**: integration test against test DB (~40 LOC) | Repo convention (Sprint 1 T9/T10) ya separa middleware base + extension/integration. Bundling integration con route es regresión de disciplina. |
| **T14** (~50 LOC, "Terraform email/password OFF, Google fallback como contingency") | **T14a**: Terraform `google_identity_platform_config` email/password OFF (~25 LOC). **T14b**: backend `apps/api/src/routes/auth-google-callback.ts` rechaza primera sign-in Google sin matching `signup_request` approved (~50 LOC + 1 integration test). **AMBOS MANDATORY** | Verificado 2026-05-25: Terraform GA NO expone per-provider Google "allow new accounts to sign up" toggle. T14b NO es contingente — sin él SC-1.2.2 queda partial (Google self-signup gap). |

Adicional split que devils-advocate sugirió: **T15** del draft inicial bundled (a) synthetic monitor, (b) canary config, (c) enumeration test, (d) Cloud Armor cascade test. Mover (c) y (d) a T12a/T12b (tests del endpoint shipean con el endpoint). T15 final = synthetic monitor + canary config (~50 LOC, no waiver).

## Paths correctos (per devils-advocate verifications 2026-05-25)

- Drizzle schema: `apps/api/src/db/schema.ts` (monolithic, **NO** `db/schema/` subdir). Sprint 2b agrega `signupRequests` pgTable acá.
- Signup form: `apps/web/src/routes/login.tsx` (single-file login+signup combined via mode prop). NO `components/SignupForm.tsx`. Refactorizar acá.
- Admin signup-requests page: `apps/web/src/routes/platform-admin-signup-requests.tsx` (hyphenated single-file, **NO** `routes/platform-admin/signup-requests.tsx` nested subdir). Sigue el patrón existente (`platform-admin-matching.tsx`, `platform-admin-observability.tsx`, etc.).
- Cron pattern (si Sprint 2b necesita uno): `google_cloud_scheduler_job` invocando `POST /admin/jobs/<name>` via OIDC SA `internal-cron-invoker` — same pattern que Sprint 2a T6a.
- Signup-request endpoint: independiente de H1.3 middleware. Signup es path **sin auth** → no token → no claim `is_demo` → middleware no fires. Pero el endpoint SÍ debe estar en `is-demo-allowlist.ts` con comentario `// signup-request es path sin auth, no aplica is_demo enforcement // REVIEW_BY: <date>` para que CI lint pase (per SC-1.3.6).

## Estimación Sprint 2b

| PR | Sub-fase | Tasks estimados | LOC | Wall-clock |
|---|---|---|---|---|
| PR #1 Sprint 2b | H1.3 (T7a + T7b + T8 CI gates + T9 integration tests + T10 obs) | 5 tasks | ~340 LOC | ~8h ejecución |
| PR #2 Sprint 2b | H1.2 (T11 inventory + migration + T12a/T12b split + T13 frontend + T14a + T14b + T15 monitoring) | 7 tasks | ~530 LOC | ~14h ejecución |
| PR #3 Sprint 2b | Discoveries T16 + T18 (parallelizable con PR #1 o PR #2 según monitoring.tf conflict-likely) | 2 tasks | ~150 LOC | ~3h ejecución |
| **Total** | | **~14 tasks** | **~1020 LOC** | **~25h pure exec = ~7-9 días hábiles** |

Cero waivers planeados — todos los tasks ≤100 LOC tras splits anticipados. **14 tasks dentro del SKILL §Red Flags ≤15 threshold**.

## Sprint 2b interrupt points (per spec §14.2)

| Punto | Interruptible? | Razón |
|---|---|---|
| Pre-PR #1 (post T7a middleware scaffolding) | **SÍ** | middleware existe, allowlist vacía, sin wire global. No-op runtime. |
| Pre-PR #1 wire (T7b) | **NO** | Allowlist populated + wire = enforcement live. No interrupt mid-flight entre T7b y T8 CI gates. |
| Post-PR #1 (H1.3 fully shipped) | **SÍ** | Defense-in-depth deployed; PR #2 H1.2 inicia con seguridad agregada. |
| Mid-PR #2 entre T12 y T14 | **SÍ** | Endpoint nuevo + frontend nuevo desplegados, IdP self-signup aún ON. Path antiguo coexiste con nuevo. |
| Post-T14a (Terraform email/password OFF) pre-T14b (Google fallback) | **NO** | Window de Google self-signup gap (alguien puede crear cuenta via Google sin admin-approval). NO pausar hasta T14b shipped. |
| Post-PR #2 (canary 1% iniciado T15) | **NO** | per spec §14.2 "post-canary mid-flight no interrumpible". Full rollout o rollback explícito. |
| Post-canary full rollout | **SÍ** | sub-fase done. |
| PR #3 discoveries | **SÍ** en cualquier punto (independientes de runtime). |

## ADRs Sprint 2b

- **ADR-052**: Identity Platform self-signup OFF + signup migration a Admin SDK. Escribir como `Proposed` antes del primer commit de PR #2. Marcar `Accepted` al merge. Cubre decisión: por qué migrar a admin-approval gate vs OAuth-only; trade-off UX (sign-up immediato vs delay con email approval).

## Decisión a tomar antes de `/agent-rigor:plan plan-sprint-2b`

1. **PO**: ¿Confirmar orden PR #1 H1.3 → PR #2 H1.2 → PR #3 discoveries? (Stub Sprint 2 inicial preguntaba H1.1→H1.3→H1.2 order pero H1.1 ya en 2a, así que H1.3 va primero por defensa-in-depth landing antes de signup migration customer-facing).
2. **PO**: ¿T14b backend Google fallback dentro PR #2 o como sub-PR independiente dentro de Sprint 2b? Spec hermana suggest dentro mismo PR para SC-1.2.2 cierre atómico.
3. **PO**: ¿Sprint 2b inicia inmediatamente post-Sprint 2a deploy + 2h monitoring, o hay window deliberada (cooling-off >30min sí, semana de gap?)? Default razonable: 24h pause para confirm Sprint 2a estable antes de tocar middleware enforcement global.
4. **PO**: ¿Nuevos SCs descubiertos durante Sprint 2a build que deban incorporarse a Sprint 2b scope? Capturar en `_followups/` si emergen.

## Referencias

- Spec: [`spec.md`](spec.md) §3 + §13 + §14.
- Plan Sprint 2 META: [`plan-sprint-2.md`](plan-sprint-2.md).
- Plan Sprint 2a: [`plan-sprint-2a.md`](plan-sprint-2a.md).
- Plan Sprint 1: [`plan.md`](plan.md).
- Devils-advocate round 1 output: ver `plan-sprint-2a.md` §"Devils-advocate round 2 output" (round 1 fue sobre el draft inicial Sprint 2 unificado, output preservado en git history del archivo pre-split).
- Doc cron pattern: `infrastructure/scheduling.tf` §P3.d (Sprint 1 pattern).
- Doc rate-limit cascade: `docs/qa/rate-limit-cascade.md` (Sprint 1 T10).
- Doc migration ordering: `docs/qa/migration-ordering.md` (Sprint 1 T3).
- ADR-051 PII redaction: `docs/adr/051-pii-redaction-logger.md` (Sprint 1).
