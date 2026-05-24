# Plan: sec-001-cierre — Sprint 1

- Spec: `.specs/sec-001-cierre/spec.md` (Status: Approved v3.2 2026-05-24)
- Created: 2026-05-24
- Status: **Active** (2026-05-24, PO approve sobre v3 post 2 rondas devils-advocate; 8 P0 cerrados; listo para /agent-rigor:build T0)
- Scope: **Sprint 1 only**. Cubre prereqs P1-R4-1..R4-4 (round 4 deuda definida) + primeros 3 PRs minimum-viable-merge del spec §14 (H4 PII redaction + H1.4 Secret Manager seed + H2 rate-limit PIN). Sprints 2-3 documentados como "Future sprints" requiriendo /plan separados (ver §"Future sprints").
- Spec hermano: `.specs/sec-h3-dte-retention-lock/spec.md` requiere su propio /plan independiente. H3 mergea ANTES de H1.6 final (Sprint 3).

## Razonamiento del scope Sprint 1

El spec v3.2 cubre 8 sub-fases (H1.0-H1.6 + H2 + H4) con ~50 SCs. Si se planeara como un solo plan, generaría 25-30 tareas ≤100 LOC — supera el límite "15+ tasks = feature too big" del SKILL §Red Flags. Solución per el §14 del spec mismo (minimum-viable-merge order): cada PR del §14 puede planearse independientemente. Sprint 1 cubre los PRs #1-3 del §14 + las 4 prereq tasks de round 4. Después de Sprint 1, prod está mejorada en compliance (PII redaction) + literal eliminado del código + PIN endpoint endurecido — sin demo reactivada (esperado, sigue OFF).

## Modules touched en Sprint 1

- `packages/logger/src/` (PII redaction H4)
- `packages/shared-schemas/src/primitives/` (normalizePhone helper P1-R4-3)
- `infrastructure/variables.tf` (T0: flip `demo_mode_activated` default true→false per SC-1.0.1)
- `infrastructure/data.tf` (verify Redis instance HA tier — la instancia vive acá per devils-advocate evidence, no en `main.tf`/`redis.tf`)
- `infrastructure/main.tf` o `secrets.tf` (Secret Manager `demo-seed-password` H1.4 — verificar en T7.0 sub-step naming convention existente)
- `infrastructure/compute.tf` (env var Cloud Run + STRICT_MIGRATION_ORDERING flag)
- `apps/api/src/services/seed-demo.ts` + `seed-demo-startup.ts` (H1.4)
- `apps/api/src/middleware/rate-limit-pin.ts` (new, H2)
- `apps/api/src/routes/auth-driver.ts` (H2 wire)
- `apps/api/src/db/migrator.ts` (P1-R4-4 — archivo existente con `runMigrations(pool, logger)` línea 75; NO `migrate.ts`)
- `apps/api/src/main.ts` (wire startup sequence ordering)
- `apps/web/src/routes/maintenance.tsx` (new, SC-INT-1)
- `apps/web/src/router.tsx` (route maintenance)
- `docs/qa/migration-ordering.md`, `docs/qa/rate-limit-cascade.md`
- `docs/adr/05X-pii-redaction-logger.md` (new)

13 áreas — un poco sobre SKILL ≤10 guidance pero aceptable por: la mayoría son IaC + docs (cambios pequeños), y el spec ya fue Approved con scope 25+ módulos potenciales en sus 8 sub-fases.

## Tasks

### T0: Reconciliar drift IaC — flip `demo_mode_activated` default a `false` [T0a DONE 2026-05-24 PR #315 / T0b HCL imported 2026-05-24 — apply deferred]

- **Files**: `infrastructure/variables.tf` (línea ~365, cambiar `default = true` a `default = false`); evidence en `.specs/sec-001-cierre/sprint-1-evidence/t0-drift-reconcile.md`.
- **LOC estimate**: ~3 LOC (1 línea de cambio + comentario aclarando "construcción period; restored a true en H1.6 SC-1.6.1").
- **Depends on**: ninguna. Es el FIRST task del sprint.
- **Acceptance** _(reforzado en v3 per round 2 P0-A)_:
  - SC-1.0.1: `infrastructure/variables.tf` declara `variable "demo_mode_activated" { default = false }`.
  - **Strict gate (P0-A)**: `terraform plan` desde main muestra **EXACTAMENTE 1 línea de diff** correspondiente al flag flip. Cualquier otro resource diff — especialmente en `google_cloud_run_v2_service.api` env vars referenciando `DEMO_SEED_PASSWORD` o `DEMO_MODE_ACTIVATED`, IAM bindings, secrets — **bloquea el apply**. Reconcile de otros recursos drift queda diferido hasta T7+T7.5+T8 mergeados (entonces el drift se cubre por las tasks siguientes, no por T0). Si plan muestra >1 diff → STOP, document en evidence, escalate al PO + considerar split T0 en T0a (flag flip solo) + T0b (otros drifts post-T8).
  - `terraform apply` desde main aplicado a prod SOLO si gate pasa. Resultado: env var Cloud Run sigue `false`, state file reconcilia.
  - SC-1.0.2: `curl POST /demo/login` → 404 verificado post-apply.
- **Rollback**: revertir commit → variables.tf vuelve a `default = true`. Pero importante: el state remoto sigue `false` (drift cierra in main, pero apply revertido en cualquier momento podría flipear estado a `true` activando demo con literal y UIDs viejos). **Mitigation**: T0 es prerequisito de cualquier otra task que toque infra (T1, T7) — durante el resto de Sprint 1, `terraform apply` desde main NO flipea el demo flag involuntariamente. Si T0 se revierte, el riesgo de auto-revert vuelve.
- **Spec trace**: §3 H1.0 SC-1.0.1, SC-1.0.2; §7.4 drift categórico; round 4 P0-3.

### T1: Memorystore HA — verify state vs config (modificado en v2 per P0-1)

- **Files**: `infrastructure/data.tf:312` (existing `resource "google_redis_instance" "main"` — verificar tier setting); `infrastructure/variables.tf:redis_tier` (default ya es `"STANDARD_HA"` per evidence devils-advocate); evidence en `.specs/sec-001-cierre/sprint-1-evidence/t1-redis-state.md`.
- **LOC estimate**: ~0-30 LOC (rango porque puede ser no-op).
- **Depends on**: T0.
- **Acceptance**:
  - **T1.0 sub-step (verificación)**: `terraform state show google_redis_instance.main | grep tier` retorna actual tier. Si retorna `STANDARD_HA`, T1 es **no-op** (state ya cumple R-DA-REDIS-SPOF mitigation) — documentar en evidence + marcar task done sin cambio de código.
  - **T1.1 si state es BASIC**: revisar dónde el override venía (probablemente tfvars o legacy state); ajustar `infrastructure/terraform.tfvars` (si existe override) o explicit set en `data.tf` con `tier = var.redis_tier`; aplicar en staging primero + smoke `redis-cli PING`; apply prod en maintenance window 30min programada.
  - SC traceability: §9 R-DA-REDIS-SPOF mitigation aplicada (o confirmada como ya-aplicada). Round 4 P1-R4-2 cerrado.
- **Rollback**: si T1 fue no-op, sin rollback necesario. Si T1.1 ejecutó cambio, revertir commit → tier vuelve al estado previo (BASIC → recreate downtime). **Mitigation**: maintenance window programada; smoke test pre/post.
- **Spec trace**: §9 R-DA-REDIS-SPOF; round 4 P1-R4-2.

### T2: normalizePhone helper en shared-schemas — P1-R4-3

- **Files**: `packages/shared-schemas/src/primitives/chile.ts` (extend; ya tiene `normalizeRut`), `packages/shared-schemas/src/primitives/chile.test.ts` (extend).
- **LOC estimate**: ~60 (impl ~25 + tests ~35).
- **Depends on**: ninguna.
- **Acceptance**:
  - Función `normalizePhone(input: string): string | null` con normalization step ANTES de regex match: strip whitespace + dashes + parens; si 9-digit y starts with `9`, prepend `+56`; si 11-digit y starts with `56`, prepend `+`; if resultado matches `+56[2-9]\d{8}` (móvil) OR `+56[2-9]\d{7}` (fijo) retorna E.164 string; else `null`.
  - Tests: `+56 9 1234 5678` → `+56912345678`; `912345678` → `+56912345678`; `56912345678` → `+56912345678`; `+56-9-1234-5678` → `+56912345678`; `+56 (9) 12345678` → `+56912345678`; `not-a-phone` → `null`; `+56 1 2345678` → `null` (invalid prefix `1`).
  - Coverage 100% lines + branches.
  - SC traceability: H4 SC-H4.1 phone normalization step explícita; round 4 P1-R4-3 cerrado (helper en location correcto, NO en `apps/web/src/lib/two-factor.ts:69` que era docstring stale).
- **Rollback**: revertir commit. Sin consumers todavía (T5 lo consume), zero impact.
- **Spec trace**: §3 H4 SC-H4.1 phone normalization; round 4 P1-R4-3.

### T3: Drizzle migration ordering protocol — P1-R4-4 (modificado en v2 per P0-2 + P0-4)

- **Files**: `apps/api/src/db/migrator.ts` (existing — agrega gating + integration test path; función `runMigrations(pool, logger)` ya existe línea 75; NO crear `migrate.ts` que el plan v1 erróneamente referenciaba), `apps/api/src/main.ts` (modificar startup sequence), `docs/qa/migration-ordering.md` (new), `apps/api/test/integration/migration-ordering.integration.test.ts` (new), `infrastructure/compute.tf` (env var `STRICT_MIGRATION_ORDERING`).
- **LOC estimate**: ~90 (impl ~40 + integration test ~30 + doc ~10 + tf env var ~5 + main.ts wire ~5).
- **Depends on**: ninguna.
- **Acceptance**:
  - En startup de api server, migrations corren en orden estricto ANTES de cualquier seed/scheduler hook. Sequence: `(1) DB connect → (2) runMigrations → (3) ensureDemoSeeded (si flag ON) → (4) start router → (5) listen`.
  - **Gating env var (nuevo per P0-4, reforzado en v3 per round 2 P0-B)**: nuevo env var `STRICT_MIGRATION_ORDERING`. **Staging Cloud Run = `true` desde el merge de T3 en Sprint 1** (fail-closed code path running real cold-starts en staging por toda la ventana Sprint 1→2; surfaces bugs antes del flip prod). **Prod Cloud Run = `false` durante Sprint 1**, flip a `true` en Sprint 2 cuando Drizzle migrations nuevas (demo_accounts, signup_requests) entren. Si `STRICT_MIGRATION_ORDERING=true` y `runMigrations` falla, server NO arranca (process exits != 0, fail-closed). Si `STRICT_MIGRATION_ORDERING=false`, log error pero continue (preserva behavior previo).
  - Integration test cubre AMBOS paths: gated `true` → crash; gated `false` → log + continue (no swallow — error sigue siendo loggeable a nivel ERROR).
  - **Canary deploy (nuevo per P0-4)**: T3 PR merge usa Cloud Build canary 1 réplica antes de full rollout para detectar migration bugs antes de full-outage.
  - **Evidence Sprint 1**: smoke test cold-starts en staging con `STRICT_MIGRATION_ORDERING=true` muestran arranque normal por 7+ días sin incidents — concentrates outage risk fuera de Sprint 2 prod flip.
  - SC traceability: round 4 P1-R4-4 cerrado. P0-2 cerrado (correct file). P0-4 cerrado (gating env var preserva backward compat).
- **Rollback**: revertir commit. Si `STRICT_MIGRATION_ORDERING` set true en alguna revision, env var vuelve a default false en revert → behavior previo restaurado en < 1 minuto.
- **Spec trace**: round 4 P1-R4-4 + P0-2 + P0-4. Sprint 2 SCs dependientes: SC-1.1.8 (demo_accounts), SC-1.2.1 (signup_requests).

### T4: PII redaction core (email/RUT/JWT/password) en `@booster-ai/logger`

- **Files**: `packages/logger/src/redaction.ts` (new), `packages/logger/src/createLogger.ts` (wire redaction), `packages/logger/src/redaction.test.ts` (new).
- **LOC estimate**: ~80 (impl ~40 + tests ~40).
- **Depends on**: ninguna.
- **Acceptance**:
  - Logger redacta automáticamente en structured logs: emails (regex RFC 5322 simplificada), RUTs (regex + módulo-11 validación reuso de `shared-schemas`), JWT (3 segments base64), passwords (cualquier key matchee `/pass|secret|token|key/i`).
  - Output: valores reemplazados con `[REDACTED:email]`, `[REDACTED:rut]`, `[REDACTED:jwt]`, `[REDACTED:password]`.
  - Tests cubren cada tipo + nested objects + arrays.
  - **No incluye phone** — eso es T5 (depends on T2).
  - SC traceability: H4 SC-H4.1 base (sin phone).
- **Rollback**: revertir commit. Logs vuelven a no redactar PII — compliance Ley 19.628 regression pero no customer-facing.
- **Spec trace**: §3 H4 SC-H4.1 base.

### T5: PII redaction phone (usa T2 normalizePhone)

- **Files**: `packages/logger/src/redaction.ts` (extend), `packages/logger/src/redaction.test.ts` (extend).
- **LOC estimate**: ~50 (extension impl ~20 + tests ~30).
- **Depends on**: T2 (normalizePhone helper), T4 (redaction infrastructure).
- **Acceptance**:
  - Logger redacta phone strings vía `normalizePhone()` step (T2): si input matchea o normaliza a E.164 chileno, reemplaza con `[REDACTED:phone]`.
  - Tests cubren 5+ formatos (con spaces, dashes, parens, sin prefix, etc.) — todos redactados.
  - SC traceability: H4 SC-H4.1 phone normalization completa.
- **Rollback**: revertir commit. Phone no se redacta pero T4 (email/RUT/JWT/password) sigue funcionando — degradación parcial aceptable.
- **Spec trace**: §3 H4 SC-H4.1 phone.

### T6: PII redaction fixtures + threshold validation + ADR

- **Files**: `packages/logger/test/fixtures/legit-1000.json` (new), `packages/logger/test/fixtures/adversarial-100.json` (new), `packages/logger/src/redaction-thresholds.test.ts` (new), `docs/adr/05X-pii-redaction-logger.md` (new, número asignado durante T6 chequeando `docs/adr/` next free).
- **LOC estimate**: ~30 LOC test code (las fixtures son data, no contadas como LOC functional). ADR ~50 líneas markdown.
- **Depends on**: T4, T5.
- **Acceptance**:
  - SC-H4.1 thresholds verificados: false positives ≤1% sobre `legit-1000.json` (1000 entries de datos reales sanitizados); false negatives ≤5% sobre `adversarial-100.json` (typos, formatos exóticos, encoding obfuscation, phones with spaces).
  - Test corre en CI workflow (`pnpm --filter @booster-ai/logger test:thresholds`).
  - ADR documenta: política PII redaction, scope (qué se redacta y qué no), cómo extender con nuevos patterns, threshold definitions, REVIEW_BY date.
  - SC traceability: H4 SC-H4.1 thresholds + SC-H4.4 ADR.
- **Rollback**: revertir commit. Tests y ADR son documentación; runtime no afectado.
- **Spec trace**: §3 H4 SC-H4.1, SC-H4.4.

### T7: Secret Manager `demo-seed-password` (Terraform + IAM)

- **Files**: `infrastructure/main.tf` o `infrastructure/secrets.tf` (resource `google_secret_manager_secret` + version + `google_secret_manager_secret_iam_member`), `infrastructure/compute.tf` (env var mount al service api).
- **LOC estimate**: ~35 (HCL: 1 secret + 1 version + 2 IAM bindings + env var mount).
- **Depends on**: ninguna (independent de T1 — Secret Manager NO usa Redis).
- **Acceptance**:
  - SC-1.4.2 — secret `demo-seed-password` existe en Secret Manager.
  - IAM binding solo al service account del API (`secretmanager.secretAccessor`) + cuenta PO (`secretmanager.admin` para rotation).
  - Cloud Run service api tiene env var `DEMO_SEED_PASSWORD` mountada desde secret latest version.
  - Verificación: `gcloud secrets describe demo-seed-password` retorna OK; `gcloud secrets get-iam-policy demo-seed-password` muestra solo SA api + PO; `gcloud run services describe booster-ai-api --format='value(spec.template.spec.containers[0].env)' | grep DEMO_SEED_PASSWORD` muestra mount correcto.
  - **Inicialización**: una vez creado, set initial password con `gcloud secrets versions add demo-seed-password --data-file=-` (script run-once manual; documentar en runbook).
- **Rollback**: revertir commit → secret destroyed por terraform. **Cuidado**: si algún Cloud Run revision sigue referenciado al env, fallará en restart. Mitigation: aplicar revert SOLO si T8 también revertido (orden coordinado).
- **Spec trace**: §3 H1.4 SC-1.4.2.

### T7.5: Set initial Secret Manager version + CI gate (nuevo en v2 per P0-5)

- **Files**: `infrastructure/scripts/init-demo-seed-password.sh` (new, ~10 LOC); `infrastructure/scripts/check-secret-version-exists.sh` (new, ~20 LOC); `infrastructure/main.tf` o `secrets.tf` (add `google_secret_manager_secret_iam_member` para `github-deployer` SA, ~5 LOC HCL); `docs/runbooks/secret-init-runbook.md` (new); `.github/workflows/security.yml` (modify, add `check-secret-version-exists` job ~25 LOC YAML).
- **LOC estimate**: ~70 (scripts + IAM grant + runbook + workflow job).
- **Depends on**: T7.
- **Acceptance** _(reforzado en v3 per round 2 P0-C)_:
  - Script `init-demo-seed-password.sh` ejecuta `openssl rand -base64 32 | gcloud secrets versions add demo-seed-password --data-file=-`. Idempotente: si version ya existe, no agrega (chequea con `gcloud secrets versions list demo-seed-password --limit=1`).
  - PO ejecuta el script post-T7 merge (run-once setup); evidence en `.specs/sec-001-cierre/sprint-1-evidence/t7-5-secret-init.md`.
  - **T7.5.1 sub-step (nuevo per round 2 P0-C) — IAM grant via WIF**: Terraform añade `google_secret_manager_secret_iam_member` resource: `roles/secretmanager.viewer` sobre `demo-seed-password` para el SA existente `github-deployer@booster-ai-494222.iam.gserviceaccount.com` (definido en `infrastructure/iam.tf:162-166`). NO crea nuevo SA — reusa el deployer WIF SA existente (per `release.yml:77` que ya usa `google-github-actions/auth@v2`).
  - **CI gate (reforzado P0-C)**: workflow `security.yml` añade job `check-secret-version-exists`. Steps: (1) `actions/checkout@v4`; (2) `google-github-actions/auth@v2` con `workload_identity_provider: ${{ vars.WIF_PROVIDER }}` + `service_account: ${{ vars.WIF_SERVICE_ACCOUNT_DEPLOY }}` (mismo pattern release.yml); (3) `google-github-actions/setup-gcloud@v3`; (4) script `infrastructure/scripts/check-secret-version-exists.sh demo-seed-password` exits 1 si version count == 0 OR si auth falla (fail-closed loudly, NO silent fail-open). Workflow corre on PRs touching `apps/api/src/services/seed-demo*.ts` (gate activa solo cuando relevante; pre-T7.5 merge, gate no existe en main → PRs anteriores no afectados).
  - Runbook `secret-init-runbook.md` documenta: cuándo correr, comandos exactos, verificación, rotación futura, troubleshooting auth failures (link a SEC-2026-04-01 incident sobre WIF sin SA keys).
- **Rollback**: revertir commit → CI gate desaparece. Secret version sigue existiendo (no se borra). T8 puede mergear sin verification — pero entonces P0-5 reaparece (seed crashea en cold-start si flag ON). Solo revertir si bug crítico en el CI gate mismo.
- **Spec trace**: round 4 P0-5; spec §3 H1.4 SC-1.4.2 reforzado.

### T8: seed-demo.ts + seed-demo-startup.ts leen DEMO_SEED_PASSWORD

- **Files**: `apps/api/src/services/seed-demo.ts` (modificar línea 86, eliminar literal `BoosterDemo2026!`), `apps/api/src/services/seed-demo-startup.ts` (modificar línea 142, mismo cambio), `apps/api/src/services/seed-demo.test.ts` (extend).
- **LOC estimate**: ~50 (refactor ~20 + tests ~30).
- **Depends on**: T7 (Secret Manager existe + env var mount) + T7.5 (secret version >= 1 verificado por CI gate, per P0-5).
- **Acceptance**:
  - SC-1.4.1 — `apps/api/src/services/seed-demo.ts:86` y `seed-demo-startup.ts:142` leen `process.env.DEMO_SEED_PASSWORD` en vez del literal.
  - SC-1.4.3 — si `DEMO_MODE_ACTIVATED=true` y env ausente, seed CRASHEA al startup con error claro (no fallback). Si flag OFF, seed skip sin crash (path actual).
  - SC-1.4.4 — `git grep -F 'BoosterDemo2026'` en HEAD post-merge retorna **0 matches** en código, docs, infra.
  - Tests: SC-H4 path (ausente + flag ON → throw); (ausente + flag OFF → skip); (presente + flag ON → seed runs).
- **Rollback**: revertir commit → literal vuelve a HEAD. Operational impact: ninguno si flag está OFF (estado actual de prod). Pero `git grep` test del CI fallaría si volvemos al estado pre-merge — coordinated revert con T7.
- **Spec trace**: §3 H1.4 SC-1.4.1, SC-1.4.3, SC-1.4.4.

### T9: Rate-limit-pin middleware base (RUT normalize + per-RUT counter)

- **Files**: `apps/api/src/middleware/rate-limit-pin.ts` (new), `apps/api/src/middleware/rate-limit-pin.test.ts` (new), `apps/api/src/routes/auth-driver.ts` (wire middleware antes del handler).
- **LOC estimate**: ~90 (middleware ~50 + tests ~30 + wire ~10).
- **Depends on**: T1 (Memorystore HA — middleware usa Redis, fail-closed si down).
- **Acceptance**:
  - SC-H2.1 — `POST /auth/driver-activate` retorna `429 too_many_attempts` tras 5 intentos en 15min por RUT, con header `Retry-After: 900`.
  - SC-H2.1c — RUT normalizado via `normalizeRut()` de `@booster-ai/shared-schemas` ANTES de construir Redis key `rl:pin-activate:<rutNormalizado>`.
  - SC-H2.2 — counter en Redis HA (T1).
  - SC-H2.3 — integration test: 5 intentos OK; 6º → 429; mock Redis clock 15min → counter reset.
  - SC-1.3.8 — integration test que valida el order is-demo middleware fires BEFORE rate-limit (rate-limit counter no incrementa si is-demo retorna 403). _(NOTA: is-demo middleware aún no existe en main; este test verifica el ORDER de wire en main.ts mediante mock middleware fixture)_.
- **Rollback**: revertir commit → middleware desconectado del wire de auth-driver.ts → endpoint vuelve a comportamiento pre-spec (sin rate-limit). Riesgo: regresión seguridad H2 reverso. Mitigation: solo revertir si bug crítico encontrado en T10.
- **Spec trace**: §3 H2 SC-H2.1, SC-H2.1c, SC-H2.2, SC-H2.3 + §SC-1.3.8 interaction.

### T10: Rate-limit IP-based + fail-closed Redis + Cloud Armor cascade docs

- **Files**: `apps/api/src/middleware/rate-limit-pin.ts` (extend con IP-based + fail-closed), `apps/api/src/middleware/rate-limit-pin.test.ts` (extend), `docs/qa/rate-limit-cascade.md` (new).
- **LOC estimate**: ~60 (extension ~25 + tests ~25 + doc ~10).
- **Depends on**: T9.
- **Acceptance**:
  - SC-H2.1b — Redis unreachable → 503 service_unavailable con `Retry-After: 30`. Integration test simula Redis client `connect()` reject → middleware retorna 503.
  - SC-H2.4 — IP-based global limit 30/15min/IP across todos los RUTs. Returns 429 con header `X-RateLimit-Scope: ip`. Integration test: attacker rota 20 RUTs distintos → IP-based fires a los 30 intentos.
  - SC-1.2.5 (Cloud Armor cascade docs): `docs/qa/rate-limit-cascade.md` documenta layer order (Cloud Armor 1000/min/IP → Redis 5/15min/RUT + 30/15min/IP) + casos: Cloud Armor ban antes que Redis (counter no incrementa); Redis down (503 incluso si Cloud Armor allowed).
- **Rollback**: revertir commit → solo per-RUT rate-limit queda (T9 funcional pero sin IP defense ni fail-closed). Degradación parcial aceptable.
- **Spec trace**: §3 H2 SC-H2.1b, SC-H2.4 + SC-1.2.5 cascade docs.

### T11: Maintenance page demo.boosterchile.com (SC-INT-1)

- **Files**: `apps/web/src/routes/maintenance.tsx` (new), `apps/web/src/router.tsx` (modificar para incluir route), `apps/web/src/routes/demo.tsx` (modificar para check flag `DEMO_MODE_ACTIVATED` desde `/feature-flags` y conditional render maintenance vs landing).
- **LOC estimate**: ~50 (component ~30 + router wire ~5 + demo.tsx fetch+conditional ~15).
- **Depends on**: ninguna.
- **Acceptance**:
  - SC-INT-1 — durante el período de construcción (mientras `demo_mode_activated: false` en `/feature-flags`), `demo.boosterchile.com/` muestra explicit maintenance page con copy: _"Modo demo en mantenimiento. Volvemos pronto. Para producción, app.boosterchile.com."_ + link.
  - Manual smoke: abrir `https://demo.boosterchile.com/` (con flag OFF) → maintenance page, NO alert "Hubo un problema entrando a la demo".
  - Cuando flag ON (Sprint 3 H1.6), check pasa true → landing normal (no maintenance).
  - Component design responde a brand Booster (logo + verde Booster) per `agent-rigor:34-frontend-ui-engineering` checklist (si la skill aplica).
- **Rollback**: revertir commit → demo.boosterchile.com vuelve a renderizar landing con alert error. Customer-facing degradation aceptable (es regresión a estado actual).
- **Spec trace**: §3 §SC-INT-1.

### T12: CURRENT.md + Sprint 1 evidence + Sprint 2 plan stub

- **Files**: `docs/handoff/CURRENT.md` (modificar §SEC-001 cierre con sección "Sprint 1 cerrado"), `.specs/sec-001-cierre/plan-sprint-2.md` (stub con outline de tareas H1.1, H1.3, H1.2, H1.5, H1.6), `.specs/sec-001-cierre/sprint-1-evidence/` (directory con evidencia por task: outputs de tests + screenshots + curls).
- **LOC estimate**: ~50 (CURRENT.md ~20 + plan-sprint-2 stub ~20 + evidence index ~10).
- **Depends on**: T1..T11 todos mergeados a main.
- **Acceptance**:
  - CURRENT.md menciona Sprint 1 completo con tabla de PRs mergeados + apuntador a plan-sprint-2.md.
  - `pnpm ci` desde main pasa: typecheck + lint + tests (coverage 80/80/80/80 en packages modificados) + build.
  - `git grep -F 'BoosterDemo2026'` retorna 0 matches en main HEAD.
  - Smoke E2E manual: `curl POST /demo/login` sigue 404 (esperado, flag OFF); maintenance page renderiza; `gcloud secrets describe demo-seed-password` OK; Redis HA endpoint responde.
  - plan-sprint-2.md stub identifica próximas tareas H1.1, H1.3, H1.2, H1.5, H1.6 sin enumerar acceptance detalles (eso es para /plan posterior).
- **Rollback**: revertir commit → CURRENT.md sigue mencionando solo el spec Approved (no Sprint 1 completo). Plan-sprint-2.md ausente — operationally fine.
- **Spec trace**: §3 SC-IAC.1 (parcial — Sprint 1 partial milestone, no full SEC-001 mitigated).

## Out-of-band tasks

Items no en el critical path de Sprint 1 pero que no se deben olvidar:

- ~~Run-once script para set initial password del Secret Manager~~ → **MOVIDO a T7.5 como task explícita con CI gate** (per round 1 devils-advocate P0-5).
- **`scripts/check-adr-numbering` verification** antes de T6 (PR del ADR PII redaction): correr el script para asegurar que el número 05X asignado no colisiona.
- **Cooling-off 30min entre BUILD y REVIEW** (CLAUDE.md §6.1) — aplica a cada task. Pre-/build coordination: agendar reviews tras la cooling-off.
- **Coverage gate** (PR #232): cada PR merge debe pasar `pnpm coverage` con thresholds 80/80/80/80.
- **Backup Redis snapshot pre-T1** (si T1.1 ejecuta recreate): `gcloud redis instances export gs://<bucket>/redis-backup-<timestamp>` antes de apply para minimizar data-loss risk durante recreate. Memorystore es cache, no persistente, pero precaución.
- **🚨 INCIDENTE SEPARADO 2026-05-24 — SMS fallback gateway WEBHOOK_PUBLIC_URL vacío**: descubierto durante investigación T0b. Bug CRITICAL activo desde 2026-05-07 (commit 4c7ccc2). Webhook Twilio retorna 503 → mensajes Panic SMS de FMC150 sin GPRS potencialmente perdidos. **Fix one-line**: `terraform apply -target=module.service_sms_fallback_gateway.google_cloud_run_v2_service.service -var-file=terraform.tfvars.local` (tfvars.local YA tiene la URL correcta). Tracked como `.specs/_followups/sms-fallback-webhook-url-incident.md` (a crear) + invoke `booster-skills:incident-response` skill. Owner: PO. **Acción inmediata sugerida**: fix antes del cierre completo de SEC-001 dado el blast radius operativo (panic SMS perdidos en producción).
- **IAP TCP forwarding setup para GKE master** (per PO decisión 2026-05-24 al investigar T1): runbook `docs/runbooks/gke-iap-access.md` + verificar que `gcloud compute start-iap-tunnel` funciona para GKE master. Reemplaza el patrón viejo `gke_operator_authorized_cidrs` (DHCP brittle). Sin urgencia inmediata salvo que se necesite kubectl directo. Owner: PO.
- **`terraform apply` T0c (T0 cosmetic + alignments)**: cuando sea necesario aplicar IaC desde main (probablemente próximo a H1.6 Sprint 3 reactivation flip), el plan mostrará: 2 changes esperados (monitoring dashboard JSON + SMS env var) + cualquier nuevo cambio acumulado. Strict gate categórico §7.4 aplicaba en ese momento.

## Future sprints (referencia, NO se planean acá)

| Sprint | PRs del §14 del spec | Foco | Plan separado |
|---|---|---|---|
| Sprint 2 | #4 H1.1 + #5 H1.3 | Recreate demo accounts + is-demo enforcement middleware | `.specs/sec-001-cierre/plan-sprint-2.md` (futuro /plan call) |
| Sprint 3 | #6 H1.2 + #7 H1.5 + #9 H1.6 | Signup migration to Admin SDK + forensia + reactivación | `.specs/sec-001-cierre/plan-sprint-3.md` (futuro /plan call) |
| H3 spec hermano | #8 sec-h3-dte-retention-lock | Bucket DTE retention lock | `.specs/sec-h3-dte-retention-lock/plan.md` (futuro /plan call, INDEPENDIENTE de sec-001-cierre) |

Cada Sprint requiere su propio /agent-rigor:plan + devils-advocate + PO approve.

**Orden de Sprints**: 1 → 2 → 3 secuencial. Sprint 3 H1.6 requiere H3 sibling mergeado (SC-1.6.5 state assertion). Sprint 3 puede iniciarse después de Sprint 2 mergeado + H3 spec aprobado y mergeado.

## Open questions

Anything que emergió durante planning y debe resolverse antes de /build:

- **OQ-PLAN-1**: ¿Cuál es el name actual del `google_redis_instance` en Terraform? T1 requiere referencia exacta. Verificar con `terraform state list | grep redis`.
- **OQ-PLAN-2**: ¿Existe ya `apps/api/src/db/migrate.ts` o se crea nuevo en T3? Verificar con `ls apps/api/src/db/`.
- **OQ-PLAN-3**: ¿El secret Manager naming preferido es `demo-seed-password` o `booster-demo-seed-password` (consistencia con otros secrets)? Verificar con `gcloud secrets list | head`.
- **OQ-PLAN-4**: ¿El número del ADR PII redaction (T6) es 051 o el próximo libre? Verificar con `ls docs/adr/ | tail -3` cuando T6 esté listo.
- **OQ-PLAN-5**: ¿Sprint 1 incluye creación de las branches feature por adelantado o se crean on-demand? Recomendación: on-demand (una branch por task PR).
- **OQ-PLAN-6**: ¿Hay ventana de maintenance preferida por PO para T1 Memorystore HA recreate (downtime ~5-10min) **SI T1.1 aplica** (state actual no es STANDARD_HA)? Probablemente weekend o late-night.
- **OQ-PLAN-7** (nuevo en v2): ¿Qué hacer con audit logs existentes en Cloud Logging que tienen el literal `BoosterDemo2026!` referenciado? Defer a Sprint 3 H1.5 forensia (round 4 P2-R4-2) — explicit OOS de Sprint 1.
- **OQ-PLAN-8** (nuevo en v2): ¿State actual del Redis instance es `BASIC` o `STANDARD_HA`? Resolver con `terraform state show google_redis_instance.main | grep tier` en T1.0 ANTES de ejecutar cualquier cambio.

## Total estimate

**v2 (post 5 P0)**: 14 tasks × promedio ~50 LOC = ~700 LOC Sprint 1. Versus v1 12 tasks = +2 tasks (T0 drift reconcile + T7.5 secret init CI gate). §14.3 del spec estimaba 16h pure execution para PRs #1-3 (H4 + H1.4 + H2); con prereqs T0-T3 + T7.5 = ~22-26h pure execution Sprint 1. Calendar (per §14.3 disclaimer): 6-8 días working con 4h/day focused.

## Decision log

- 2026-05-24 — Plan v1 producido cubriendo Sprint 1 (12 tasks).
- 2026-05-24 — Devils-advocate round 1 sobre plan v1. Verdict DO_NOT_APPROVE. 5 P0:
  - P0-1: T1 Memorystore HA — config ya tiene STANDARD_HA default. T1 posiblemente no-op.
  - P0-2: T3 referencia archivo `migrate.ts` inexistente; real es `migrator.ts` con `runMigrations` ya implementada.
  - P0-3: Plan no incluye task para flip `variables.tf demo_mode_activated default true→false` (SC-1.0.1 prereq). Drift IaC risk: cualquier terraform apply desde main revierte env var silenciosamente.
  - P0-4: T3 fail-closed startup sin gating env var introduce outage-class regression.
  - P0-5: T7 + T8 require manual gcloud secret init out-of-band; sin task explícita verificable, T8 puede mergear sin secret y crashear cold-start.
- 2026-05-24 — Devils-advocate round 2 sobre plan v2. Verdict APPROVE_WITH_RESERVATIONS. 3 P0:
  - P0-A: T0 acceptance no garantizaba que `terraform plan` post-T0 fuera EXACTAMENTE 1 línea diff — otros drifts no esperados podrían entrar al apply.
  - P0-B: T3 STRICT_MIGRATION_ORDERING=false durante Sprint 1 concentraba outage risk en Sprint 2 prod flip (fail-closed code no probado en cold-starts reales).
  - P0-C: T7.5 CI gate usaba "ADC token" sin spec del SA/WIF concreto — silent fail risk si auth misconfigura.
- 2026-05-24 — **PO Active approve** sobre plan v3. Status → Active. Next: `/agent-rigor:build` arranca con T0 (drift reconcile) next-session. Fresh session recomendado por context fatigue actual (~160 tool calls).
- 2026-05-24 — **T0 build iniciado** (`/agent-rigor:build T0`). variables.tf editado: `demo_mode_activated default true→false` + comentario justificando drift reconcile. `terraform fmt`: clean. `terraform validate`: Success. PR feature branch `feat/sec-001-t0-drift-reconcile`. **Pending**: PO runs `terraform plan` post-merge (strict gate exactly 1 diff line per T0 SC-1.0.1) + `terraform apply` + `curl POST /demo/login → 404` verification per SC-1.0.2. T0 marked `[DONE]` solo post-verify.
- 2026-05-24 — **T0a DONE** vía PR #315 squash-merged a main (commit `a899e14`). variables.tf default flipped en main. Strict gate post-merge **FAILED** con `Plan: 0 to add, 4 to change, 29 to destroy` — drift IaC severo: 29 destroys son los 7 secrets `hotfix_2026_05_14_*` (`demo-seed-password`, `pin-rate-limit-hmac-pepper`, 4× `demo-account-password-*`, `sre-notification-webhook`) + IAM bindings + versions + random_password creados por el apply huérfano de la rama abandonada el 2026-05-15. Plus 4 cosmetic changes (GKE clusters CIDR add, monitoring dashboard JSON, SMS gateway env var). Evidence en `.specs/sec-001-cierre/sprint-1-evidence/t0-strict-gate-failure.md`.
- 2026-05-24 — **T0b plan**: per plan v3 §T0 P0-A "considerar split T0a + T0b", PO decisión: import HCL desde abandoned branch para hacer match state↔config sin recrear. Copiado `infrastructure/security-hotfixes-2026-05-14.tf` (145 LOC) de la rama. Re-run plan: `Plan: 0 to add, 4 to change, 0 to destroy` — destroys eliminados. **PO decisión adicional 2026-05-24**: removed stale GKE operator CIDR de tfvars.local (DHCP changed, comment says "eliminar cuando IAP-only"). Re-run plan: `Plan: 0 to add, 2 to change, 0 to destroy`.
- 2026-05-24 — **Bug crítico descubierto durante investigación T0b**: `WEBHOOK_PUBLIC_URL=''` en Cloud Run prod desde 2026-05-07 (commit 4c7ccc2 Wave 2/3 hotfix). Logs CRITICAL recientes (último 2026-05-24T20:18) confirman: `"TWILIO_AUTH_TOKEN o WEBHOOK_PUBLIC_URL faltante en producción — rechazando todos los webhooks"` (return 503 a todos los webhooks Twilio). SMS fallback gateway está silentemente roto hace ~17 días. **PO decisión**: scope discipline — abrir incidente SMS-fallback como follow-up SEPARADO; T0b queda minimal (HCL import only, NO apply).
- 2026-05-24 — **T0b: HCL imported (NO apply)**. PR a abrir contiene: (a) `infrastructure/security-hotfixes-2026-05-14.tf` (145 LOC, drop-in del abandoned branch); (b) evidence en `.specs/sec-001-cierre/sprint-1-evidence/`. Post-merge: `terraform apply` queda **deferred** hasta que sea necesario (e.g., H1.6 Sprint 3). State file actual ya consistente con main HEAD para los secrets (0 destroys verified); 2 cosmetic changes remain como drift residual aceptable. T0 cierre completo: T0a DONE + T0b HCL imported + T0c apply diferido. SMS-fallback fix follow-up tracked separadamente.
- 2026-05-24 — Plan v3 producido via 5 surgical Edits:
  - T0 acceptance: gate strict — exactly 1 line diff, otros drifts bloquean apply until T7+T7.5+T8 ready.
  - T3 acceptance: STRICT_MIGRATION_ORDERING=true en STAGING desde Sprint 1 merge (real cold-start coverage); prod queda false hasta Sprint 2.
  - T7.5 acceptance + files: nuevo sub-step T7.5.1 grant `roles/secretmanager.viewer` al SA existente `github-deployer` via Terraform; workflow security.yml usa `google-github-actions/auth@v2` con WIF (reusa pattern de release.yml); fail-closed loudly on auth failure.
  - T7.5 LOC bump ~50 → ~70 (IAM grant + workflow job realista).
  - 14 tasks totales sin cambios (no nuevas tasks).
- 2026-05-24 — Plan v2 producido via 8 surgical Edits:
  - **T0 NUEVO** (drift reconcile) ANTES de T1, flipea variables.tf `demo_mode_activated default = false`.
  - **T1 reescrito** (P0-1): verify state actual; no-op si ya STANDARD_HA; sub-step T1.1 si BASIC.
  - **T3 reescrito** (P0-2 + P0-4): archivo `migrator.ts` correcto + gating env var `STRICT_MIGRATION_ORDERING` con default false Sprint 1 + canary deploy.
  - **T7.5 NUEVO** (P0-5) entre T7 y T8: script init + CI gate verifica `demo-seed-password` tiene >= 1 version.
  - T8 depends actualizado para incluir T7.5.
  - Modules touched actualizado (variables.tf, data.tf, migrator.ts).
  - Out-of-band tasks limpiado (secret init movido a T7.5).
  - Open questions añade OQ-PLAN-7 (audit logs literal) y OQ-PLAN-8 (Redis state actual).

## Pre-build checklist (a verificar pre cada task)

- [ ] Cooling-off 30min cumplido entre fin de build prev y review (per CLAUDE.md §6.1)
- [ ] Branch creada con conventional naming
- [ ] Spec.md leído cold antes de empezar la task
- [ ] Tests existen ANTES del commit del feature (CLAUDE.md §Testing)
- [ ] Coverage gate pasa
- [ ] Sección "Evidencia" del PR llenada
