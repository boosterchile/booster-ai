# Plan: security-blocking-hotfixes-2026-05-14 (v3.1)

- Spec: `.specs/security-blocking-hotfixes-2026-05-14/spec.md` (Status: Approved 2026-05-14T19:30Z, retool H1 19:45Z, OPS-Y 20:00Z, **4º UID + T9.x deferred + T5 fallback** 21:00Z)
- Created: 2026-05-14T20:00Z (v3); revisado **2026-05-14T21:00Z (v3.1)** post-PF-1..PF-5 + PF-5.1
- Status: **Draft v3.1** (pending Felipe approval; PF-1..PF-5 EJECUTADOS exitosamente — outputs en spec §13)
- Supersedes: `plan-v2-backup.md`

> **Cambios v2 → v3** (críticos, ya aplicados):
> 1. Phase A H1 orden invertido — T7 (flag flip) ahora PRIMERA. Race condition de cold-start eliminada.
> 2. T6 gana dep en T7; OPS-1 gana dep en T6.
> 3. OPS-Y nueva (monitoring 90d).
> 4. T-TTL-WARN nueva.
> 5. Secret naming refinado.
> 6. Phase B y C sin cambios estructurales.

> **Cambios v3 → v3.1** (post-pre-flights 2026-05-14T21:00Z):
> 1. **T2 expandido a 7 secrets** (era 6 en v3): añadido `demo-account-password-conductor` por hallazgo PF-5 (4 UIDs demo, no 3) + PF-5.1 (conductor demo usa fallback `signInWithEmailAndPassword` path; password directo es vector vivo, no bootstrap-only).
> 2. **T3 harden script + OPS-1 rotation aplicados a 4 UIDs** (era 3). Checkpoint state machine extendido.
> 3. **T10 governance doc + T12a forensia/spray + OPS-Y closure** todos extendidos a 4 cuentas.
> 4. **T9.0 + T9.x marcados explícitamente "DEFERRED hasta T8"** — PF-1 reportó 58 raw write endpoints, sobre threshold informal R1 (>50 sugiere considerar approach estructural). Decisión post-T8: middleware per-endpoint si N HIGH ≤ 15 / 16–30 (batching 5); pausa para discutir estructural (Drizzle hook / RLS / Hono HoC) si N HIGH > 30.
> 5. **T5 caveat añadido**: si terraform plan no aplica el campo de disable-signup correctamente durante /build, fallback inmediato a T5a (manual Console) + T5b (alert drift); sin penalty per spec §3 H1.2.
> 6. **OPS-Y closure punto 3** verifica los **4 `demo-account-password-*`** + `demo-seed-password`.
> 7. **PF-3** (era staging ack) ya está reemplazado por PF-3' (bucket dedicado check) en v3 prior.

> **Verificación cruzada PF-1..PF-5 + PF-5.1** (outputs literales en spec §13 decision log 2026-05-14T21:00Z):
> - PF-1: 58 raw endpoints → T9 deferred.
> - PF-2: ✅ `google_identity_platform_config` validate OK → T5 single IaC.
> - PF-3': ✅ bucket no existe (404) → T25 crea limpio.
> - PF-4: ✅ `expires_at` string ISO preservado.
> - PF-5: ⚠️ 4 UIDs demo, no 3 → conductor demo añadido al scope.
> - PF-5.1: conductor usa BOTH paths (custom token primario + password fallback). Tratamiento simétrico → 7º secret.

---

## Pre-flights (a ejecutar ANTES de `/build`, no son tasks)

PF-1 — **Ejecutar el grep estructurado de endpoints write** que estima T8, commitearlo al plan como artefacto. Si el resultado arroja >5 endpoints HIGH, T9 se splitea automáticamente en N tasks (uno por endpoint), sin opción de waiver. (Devils-advocate v2 #8.)

PF-2 — **Probar `google_identity_platform_config` resource** en la versión actual del Terraform provider contra el campo de signUp. Si IaC funciona: T5 single task. Si IaC NO funciona: T5 se divide en T5a (apply manual con captura) + T5b (alert Cloud Monitoring que dispara si detecta drift del setting) + OOB-X (tracker IaC). (Devils-advocate v2 #11.)

~~PF-3~~ — **Reemplazado por PF-3'** (resolución GAP 4 / aclaración 2026-05-14T20:30Z). PF-3 original asumía el approach de v2 de reusar staging; el plan v3 ya decidió bucket dedicado `booster-ai-documents-locktest-2026-05-14` en T25 incondicionalmente, así que el ack sobre staging es irrelevante.

PF-3' — **Verificar pre-existencia del bucket dedicado `booster-ai-documents-locktest-2026-05-14`**. Comando: `gcloud storage buckets describe gs://booster-ai-documents-locktest-2026-05-14 2>&1`. Outputs aceptables:
   - **404 NotFound** → bucket no existe; T25 lo crea limpio. Caso esperado.
   - **200 + bucket vacío** (`gcloud storage objects list --bucket=... | wc -l == 0`) → bucket ya creado en branch previa, sin objetos. T25 idempotente: actualiza props si difieren del módulo, no toca contenido.
   - **200 + bucket con objetos** → ABORTAR. Algún proceso previo dejó datos en el bucket pre-lock. Investigar antes de continuar: revisar `gcloud storage buckets get-iam-policy` y consultar a Felipe si esos objetos son seguros para lockar 6 años o si hay que crear un bucket fechado distinto (ej. `-2026-05-14b`).
**Autónoma.**

PF-4 — **Verificar `auth.revokeRefreshTokens` y `auth.setCustomUserClaims` con expires_at string** en la versión del Admin SDK instalada. Specifically: setear un claim string ISO-8601, leer el ID token resultante en el backend Hono, confirmar que `claims.expires_at` llega como string (no coerced a number). (Devils-advocate v2 #10, #12.)

PF-5 — **Re-verificar la lista de UIDs demo en el tenant** justo antes de `/build`. La snapshot Firebase 2026-05-14T18:14Z lista 3 UIDs; el plan **no debe asumir** que esa lista no cambió. Output: lista actualizada de UIDs con `is_demo=true` en customClaims.

Sin PF-1..PF-5 cerrados, `/build` no arranca.

---

## Módulos tocados (verificación skill §Step 2)

| # | Módulo / archivo | Razón | Hotfix |
|---|---|---|---|
| 1 | `infrastructure/variables.tf` | Flip `demo_mode_activated` default | H1.0 |
| 2 | `infrastructure/storage.tf` | `is_locked=true` bucket DTE + bucket validation locktest | H3 |
| 3 | `infrastructure/compute.tf` | Env vars rate-limiter + `DEMO_SEED_PASSWORD` wiring desde Secret Manager | H1.4, H2 |
| 4 | `infrastructure/monitoring.tf` | Alert policies `auth.pin.*` + `retention_policy.update` + `identity_platform_config.signUp` drift + `demo.account.ttl_remaining_days` + **`security.password_spray.*`** | H1, H2, H3 |
| 5 | `infrastructure/security.tf` (o `secrets.tf`) | 5 secrets demo (renombrados) + IAM por separado | H1.1, H1.4, H2 |
| 6 | `infrastructure/identity-platform.tf` (nuevo si T5 IaC viable) | self-signup OFF | H1.2 |
| 7 | `infrastructure/scheduler.tf` (nuevo o append) | Cloud Scheduler job para T-TTL-WARN | H1.1 |
| 8 | `infrastructure/scripts/preflight-retention-lock.sh` (nuevo) | Pre-flight H3 | H3 |
| 9 | `infrastructure/scripts/harden-demo-accounts.ts` + `unharden-demo-accounts.ts` (nuevos) | Admin SDK script idempotente con checkpoint | H1.1 |
| 10 | `infrastructure/scripts/forensia-demo-password.ts` (nuevo) | Forensia + spray retroactivo (OPS-X) | H1.5 |
| 11 | `infrastructure/scripts/demo-account-ttl-alerter.ts` (nuevo) | Cron T-TTL-WARN | H1.1 |
| 12 | `infrastructure/cloud-functions/password-spray-incident-trigger/` (nuevo) | OPS-Y monitoring sostenido 90d | H1.5 (R21) |
| 13 | `packages/rate-limiter/` (nuevo package) | Limiter Redis + fallback + HMAC | H2 |
| 14 | `apps/api/src/middleware/demo-expires.ts` (nuevo) | Enforce `claims.expires_at` | H1.1 |
| 15 | `apps/api/src/middleware/is-demo-enforcement.ts` (nuevo) | Policy `is_demo` en write endpoints | H1.3 |
| 16 | `apps/api/src/config.ts` | Schema PIN_RATE_LIMIT_*, HMAC_PEPPER, DEMO_SEED_PASSWORD | H1.4, H2 |
| 17 | `apps/api/src/main.ts` (o entrypoint Hono equivalente) | Wiring RateLimiter + middlewares demo | H1.1, H1.3, H2 |
| 18 | `apps/api/src/routes/auth-driver.ts` | Rate-limit + 429 + suspicious-success + remover comentario | H2 |
| 19 | `apps/api/src/routes/conductores.ts` | Reset counter en regenerar PIN | H2 |
| 20 | `apps/api/src/routes/<HIGH endpoints de T8>` | `is_demo` enforcement por endpoint | H1.3 |
| 21 | `apps/api/src/services/seed-demo.ts` + `seed-demo-startup.ts` | Sacar literal, leer Secret Manager, fail-closed | H1.4 |
| 22 | `apps/web/<conductor-login>` | UX 429 | H2 |
| 23 | `docs/qa/demo-accounts.md` (nuevo) | Governance | H1.1, H1.6 |
| 24 | `docs/qa/is-demo-enforcement-audit.md` (nuevo) | Audit tabla | H1.3 |
| 25 | `docs/qa/demo-accounts-inventory.md` (nuevo) | Inventario T1 | H1.4 |
| 26 | `docs/demo/guia-uso-demo.md` + handoff `2026-05-11-...` | Borrar literal | H1.0 |
| 27 | `docs/adr/031-dte-bucket-retention-lock-activated.md` (nuevo) | ADR Retention Lock | H3 |
| 28 | `docs/adr/040-git-history-password-compromise-opcion-c.md` (nuevo) | ADR R21 / OPS-Y | H1.5 |

28 módulos. **Waiver explícito**: spec §1 consolida 3 BLOCKING + retool H1 en una sola feature.

---

## Convenciones de tareas

- **Tn**: task de código. Produce diff a `main`. Gate: tests verdes + lint + typecheck. Mergeable solo.
- **OPS-N**: task operacional. Side-effect en infraestructura/Firebase/Secret Manager. NO produce diff a `main` (o solo IaC sin lógica). Gate: evidencia verificable en el PR (output de comandos pegado, audit logs, screenshots), firma humana explícita del operador nombrado. Cada OPS bloquea la próxima `Tn` que dependa de ella vía un "evidence gate" linkeado en el PR.

---

## Phase A — H1 (Demo mode flag OFF + hardening + governance + audit + seed migration + R21 monitoring)

**Phase A se ejecuta serializada con Phase B y Phase C.** El paralelismo entre Phase A y Phase B propuesto en v1 causaba conflictos garantizados en `config.ts`, `main.ts`, `compute.tf`, `security.tf`. Phase B arranca tras merge de T12b + arranque de OPS-Y. (Devils-advocate v2 #6.)

### Orden de ejecución H1 v3 (NO NEGOCIABLE — derivado de spec §7)

```
T1
 ↓
T7 ──┬──→ T11
     │         ↓
     │       T12a (incluye OPS-X-PASSWORD-SPRAY-RETROACTIVE)
     │         ↓
     └──→ T2 ──┬──→ T6
              │
              └──→ T3 ──→ OPS-1 ──┬──→ T4
                                 ├──→ T10
                                 ├──→ T-TTL-WARN
                                 └──→ T12b ──→ OPS-Y (90d, background)

  paralelo a OPS-1 una vez T7 mergeado:
   - T5 (deps PF-2)
   - T8 ──→ T9.0 ──→ T9.x (deps PF-1)
```

**17 entries base** en Phase A + N de T9.x (depende de PF-1).

### T1 — Inventario exhaustivo grep de literal y emails demo
- **Files**: `docs/qa/demo-accounts-inventory.md` (nuevo).
- **LOC estimate**: ~40.
- **Depends on**: ninguna.
- **Acceptance**: spec §3 H1.4 — listado `archivo:línea` de `BoosterDemo2026` + 3 emails demo cross-repo. Identifica seed source(s). Resultado commiteado.
- **Rollback**: revert.
- **Nota v3**: la investigación 2026-05-14T19:00Z ya hizo este grep; los hallazgos (`seed-demo.ts:86`, `seed-demo-startup.ts:142`, refs en `dist/main.js` y `demo-login.ts:257`) se commitean directamente en T1 sin re-ejecutar.

### T-EVIDENCE-GATE-CI — CI check para evidence gates (NUEVA post-devils-advocate F3)
- **Files**: `.github/workflows/security-hotfixes-evidence-gate.yml` (nuevo).
- **LOC estimate**: ~30.
- **Depends on**: T1 (necesita la lista de archivos H1 para configurar el filter del workflow).
- **Acceptance**: el workflow corre en PRs que toquen `apps/api/src/middleware/demo-expires.ts`, `apps/api/src/services/seed-demo*.ts`, `docs/qa/demo-accounts.md`, `infrastructure/scripts/demo-account-ttl-alerter.ts`. Falla con mensaje claro si el PR no incluye un archivo `evidence/ops-1-<fecha>.md` referenciando el output de OPS-1. Solo-dev mitigation: el CI no sustituye revisión humana pero atrapa el caso "olvidé commitear la evidencia".
- **Rollback**: revert workflow file.
- **Notas**: F3 ofrecía dos alternativas (CI check vs checklist firmado en docs). Default elegido = CI check por su efectividad mecánica para solo-dev.

### T7 — Flip `demo_mode_activated` default + apply prod (H1.0, PRIMERA crítica)
- **Files**: `infrastructure/variables.tf` (líneas 366-370 — flipear `default = true` → `default = false`, actualizar comentario de líneas 364-365).
- **LOC estimate**: ~10.
- **Depends on**: T1 (inventario para evidencia), spec approval (cumplido).
  - **REMOVIDAS deps de v2**: T4, OPS-1, T5, T6, T12a — ninguna es prerequisito real para apagar el flag.
- **Acceptance (tightened post-devils-advocate F1)**: spec §3 H1.0 — TODOS los siguientes deben pasar antes de marcar T7 done:
  1. `curl -s -o /dev/null -w '%{http_code}' -X POST https://api.boosterchile.com/demo/login` → **`404`**.
  2. `gcloud run revisions describe <rev-post-apply> --project=booster-ai-494222 --region=<region> --format='value(spec.containers[0].env[],spec.containers[0].envFrom[])'` muestra **`DEMO_MODE_ACTIVATED=false`** (literal o resuelto desde secret).
  3. **Cold-start forzado** vía `gcloud run services update-traffic api-prod --to-revisions=<new>=100 --region=<region>` + esperar que `gcloud run services describe api-prod --format='value(status.latestReadyRevisionName)'` retorne el nombre nuevo.
  4. Cloud Logging confirma el efecto: `gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="api-prod" AND (textPayload=~"ensureDemoSeeded skipped|DEMO_MODE_ACTIVATED=false" OR jsonPayload.msg=~"ensureDemoSeeded skipped")' --freshness=10m --limit=5` devuelve ≥1 entry dentro de 10 min post-cold-start.
  5. Smoke test post-deploy: `curl -s https://api.boosterchile.com/healthz` → 200; tráfico legítimo Wave 3 (telemetría drivers) sigue verde en dashboard.
- **Rollback**: revert + `terraform apply` restaura flag a true (~5 min). **No restaura passwords pre-T3** (passwords todavía son literal porque OPS-1 aún no corrió). **No restaura `is_demo` rol activation logic** (cambios H1.3 no aplicados aún).
- **Notas**: este task es el corte limpio. Una vez merged + applied, el seed deja de correr automáticamente y la race condition de cold-start desaparece. Cualquier intento de explotación pública del endpoint público responde 404. Las cuentas demo siguen siendo loginables con el literal hasta OPS-1 (esto es la ventana que T12a aprovecha).

### T11 — Sanitize docs y handoff del literal
- **Files**: `docs/demo/guia-uso-demo.md` (líneas 81, 85, 89, 113, 114, 115, 216) + `docs/handoff/2026-05-11-demo-features-night-sprint.md` (líneas 107, 108).
- **LOC estimate**: ~30.
- **Depends on**: T7 mergeado (el flag ya está OFF; sanitizar docs no rompe nada operativo).
- **Acceptance**: spec §3 H1.0 — `git grep -F 'BoosterDemo2026'` sobre HEAD en `docs/` = 0 matches. Texto reemplazado por instrucción "obtener password actual del operador o Secret Manager".
- **Rollback**: revert. No tiene side-effects.

### T12a — Forensia PRE-rotation + OPS-X-PASSWORD-SPRAY-RETROACTIVE
- **Files**: `infrastructure/scripts/forensia-demo-password.ts` (nuevo) + `docs/handoff/2026-05-14-forensia-demo-password.md` (reporte template) + `docs/incidents/<fecha>-password-spray-boosterdemo.md` (creado SOLO si match).
- **LOC estimate**: ~110. **Waiver de 100 LOC explícito**: el script combina (a) scan audit logs 60d, (b) spray retroactivo UNIVERSAL (no muestreo) y (c) reporting. Bajar de 100 LOC compromete cobertura.
- **Depends on**: PF-5 (UIDs verificadas), T7 mergeado (el flag está OFF, así que el spray no afecta tráfico legítimo demo).
- **Acceptance**: spec §3 H1.5 + §9 R21 —
  - Scan Cloud Logging audit logs 60d buscando logins sospechosos sobre UIDs **no-demo** (excluye las 4 cuentas demo del scope H1).
  - **OPS-X (sub-task)**: spray con literal `BoosterDemo2026!` contra TODO el universo no-demo del tenant (post-PF-5: total 10 users en tenant - 4 demo = **6 cuentas no-demo target del spray**). Tipo: `signInWithPassword` REST controlado con self-throttle del script (≤ 5 req/s) para no triggear alertas del propio tenant.
  - **Sanity check pre-spray**: verificar que el literal aún funciona contra las 4 cuentas demo (signin debe retornar 200). Si NO retorna 200 contra una cuenta demo → la rotación ya ocurrió accidentalmente o algo está mal; abortar y diagnosticar.
  - Reporte produce: (a) 0 matches no-demo → continuar a OPS-1. (b) ≥1 match no-demo → **pausa H1 entera, R17 incident response**, NO ejecutar OPS-1 (rotation destruye evidencia de cadena de ataque).
- **Rollback**: N/A (script read-only respecto a state — el spray es `signInWithPassword` con credenciales conocidas).
- **Notas**: ESTA es la única ventana válida para forensia. Post-OPS-1 el password ya no es válido contra demo y el spray no detecta nada. (Devils-advocate v2 #14.)

### T2 — Provisionar 7 secrets en Secret Manager + IAM (expandido post-PF-5.1)
- **Files**: `infrastructure/security.tf` (o `secrets.tf`) — **7 resources** (era 6 en v3 draft, era 5 en v3 original):
  1. `demo-account-password-shipper`
  2. `demo-account-password-carrier`
  3. `demo-account-password-stakeholder`
  4. **`demo-account-password-conductor`** (NUEVO post-PF-5.1 2026-05-14T21:00Z): para la 4ª cuenta demo `Gg9k3gIPa1cJZtgKC0RRkWQ0QHJ3` (`drivers+123456785@boosterchile.invalid`).
  5. `demo-seed-password`
  6. `pin-rate-limit-hmac-pepper`
  7. `sre-notification-webhook` (post-devils-advocate F2).
  
  Cada uno con `google_secret_manager_secret_iam_member` para SA del API + SA de QA donde corresponda + (para `sre-notification-webhook`) SA del Cloud Scheduler + SA de OPS-Y. **Version 1 inicial poblada con placeholder explícito** (`REPLACE_ME_BEFORE_DEPLOY` para los 5 password secrets + webhook; el pepper recibe `random_password { length=64, special=false }` real desde Terraform). (Devils-advocate v2 #2 + v3 F2 + PF-5.1.)
- **LOC estimate**: ~115 (era ~100 con 6 secrets; +15 LOC por el 7º).
- **Depends on**: ninguna (paralelo con T7).
- **Acceptance**:
  - `gcloud secrets list --project=booster-ai-494222` muestra los 5 secrets con el naming exacto.
  - `gcloud secrets versions access latest --secret=demo-account-password-shipper` retorna el placeholder `REPLACE_ME_BEFORE_DEPLOY`.
  - `gcloud secrets versions access latest --secret=pin-rate-limit-hmac-pepper` retorna 64 chars random.
  - IAM bindings verificados via `gcloud secrets get-iam-policy <name>`.
- **Rollback**: `terraform destroy -target=google_secret_manager_secret.<name>` por secret (~5 min por secret).
- **Notas v3**: naming refinado vs v2 (`demo-{persona}-password` → `demo-account-password-{persona}`). Si la doc o tests internos referencian el viejo naming, T1 inventory los flagged.

### T6 — Refactor `seed-demo*.ts` → leer `DEMO_SEED_PASSWORD` env desde Secret Manager (H1.4)
- **Files**: `apps/api/src/services/seed-demo.ts` + `seed-demo-startup.ts` + `apps/api/src/config.ts` + tests + `infrastructure/compute.tf` (montar env var `DEMO_SEED_PASSWORD` desde secret `demo-seed-password`).
- **LOC estimate**: ~95.
- **Depends on**: T2 (secret existe), **T7 mergeado y deployed** (NUEVA dep v3 — flag OFF garantiza que el seed no corre; si T6 deployea mientras flag=true y secret=placeholder, el seed CRASHEA y eso es feature pero rompe el servicio sin tener las cuentas rotadas). **Evidence gate de T7 commiteado en PR.**
- **Acceptance**: spec §3 H1.4 + H1.6 —
  - `apps/api/src/` no contiene literal (`git grep -F 'BoosterDemo2026' apps/api/src/` = 0).
  - Seed CRASHEA fail-fast si `DEMO_SEED_PASSWORD` unset y `DEMO_MODE_ACTIVATED=true`. Mensaje: `'DEMO_SEED_PASSWORD missing — refusing to seed with hardcoded literal'`.
  - Seed NO corre si `DEMO_MODE_ACTIVATED=false` (path actual ya cubre esto; mantener).
  - Tests unit + integration verdes.
- **Rollback**: revert + redeploy.
- **Notas**: el orden estricto v3 es **T2 → T7 → T6 → T3 → OPS-1**. Mergear T6 antes de T7 = riesgo de CrashLoopBackOff en cualquier deploy disparado por un PR unrelated mientras el seed encuentra `DEMO_MODE_ACTIVATED=true` y secret=placeholder.

### T3 — Script `harden-demo-accounts.ts` + simétrico `unharden-demo-accounts.ts` (código, no ejecución)
- **Files**: `infrastructure/scripts/harden-demo-accounts.ts` (nuevo) + `unharden-demo-accounts.ts` (nuevo) + `infrastructure/scripts/test/harden-demo-accounts.test.ts`.
- **LOC estimate**: ~110. **Waiver de 100 LOC explícito**: state machine de checkpoint + simétrico + tests cubriendo crash mid-loop. Bajar de eso pierde robustez. (Devils-advocate v2 #1, #12.)
- **Depends on**: T2.
- **Acceptance**:
  - Script con flags `--dry-run`, `--force-rotate`, `--uid <uid>`.
  - **State machine de checkpoint**: para cada UID (de las **4** del scope post-PF-5: shipper, carrier, stakeholder, **conductor**), antes de rotar, lee `customClaims.expires_at`. Si presente y `--force-rotate` ausente → skip + log `UID X: already_hardened`. Si ausente → ejecuta los 5 pasos (genera random 32 bytes base64url, updateUser password, version Secret Manager `demo-account-password-<persona>`, setCustomUserClaims con `expires_at = now + 30d`, revokeRefreshTokens) y verifica cada step con read-back. Crash mid-loop deja UIDs procesados en estado completo (no parcial).
  - **Mapping persona → secret name** explícito en el script: `{ shipper: 'demo-account-password-shipper', carrier: 'demo-account-password-carrier', stakeholder: 'demo-account-password-stakeholder', conductor: 'demo-account-password-conductor' }`.
  - `unharden-demo-accounts.ts` simétrico: rota password a placeholder (re-publica a Secret Manager) y limpia `expires_at` para los 4 UIDs.
  - Tests cubren: dry-run, crash entre step 3 y step 4 (verifica que 2 UIDs procesadas quedan completas + 2 sin tocar), re-run sin `--force-rotate` (no-op), re-run con `--force-rotate` (rota de nuevo), procesamiento del UID conductor en paralelo a los 3 owners.
- **Rollback**: revert código. El script queda en repo; no se ha ejecutado en prod (eso es OPS-1).

### OPS-1 — Ejecutar `harden-demo-accounts.ts` en prod (rotation = H1.1 core)
- **Operador**: Felipe Vicencio.
- **Depends on**: T3 mergeado, PF-4 verde, PF-5 verde, **T12a ejecutado y sin matches** (forensia debe correr ANTES de la rotation que destruye evidencia; si T12a encontró match → R17 incident response pausa H1 entero), **T6 mergeado y deployed** (NUEVA dep v3 — garantiza que cualquier cold-start posterior NO usará el literal aunque `DEMO_MODE_ACTIVATED` accidentalmente flipee).
- **Pre-condition checks**: `expires_at` = `now + 30 días` UTC ISO-8601 (cerrado spec §3 H1.1 OQ Q16).
- **Evidence required en el PR de T4 (gate posterior)**:
  - Stdout completo de `harden-demo-accounts.ts` con `{ uid, persona, expires_at, secret_version }` para **cada una de las 4 UIDs** (shipper, carrier, stakeholder, conductor).
  - `gcloud secrets versions list --secret=demo-account-password-shipper` muestra version ≥ 2; **mismo check para `-carrier`, `-stakeholder`, `-conductor`**.
  - `gcloud auth print-decoded-id-token` para una sesión QA fresca de cada persona muestra `expires_at` en customClaims (formato string ISO-8601, confirmado por PF-4).
  - Firma del operador (Felipe) en el PR de T4 confirmando ejecución sobre las 4 cuentas.
- **Rollback**: ejecutar `unharden-demo-accounts.ts` (~3 min). Restaura passwords placeholder y limpia claims. **Importante**: rollback solo recupera el estado "passwords desconocidas" — no resucita el literal viejo (eso es feature).
- **NO produce diff a main.**

### T4 — Middleware `demo-expires.ts` + unit tests + integration test E2E
- **Files**: `apps/api/src/middleware/demo-expires.ts`, `apps/api/src/main.ts` (wire post-firebaseAuth, pre-handlers), `apps/api/test/unit/demo-expires-middleware.test.ts`, `apps/api/test/integration/demo-expires-e2e.test.ts`.
- **LOC estimate**: ~115. **Waiver de 100 LOC explícito**: integration E2E (devils-advocate v2 #10 considera no-negociable) suma ~30-40 LOC adicionales.
- **Depends on**: T3 mergeado, OPS-1 ejecutado (los claims `expires_at` existen para que el integration test consulte uno real). **Evidence gate de OPS-1 commiteado en PR.**
- **Acceptance**: spec §3 H1.1 —
  - Unit: claim vivo (200), expirado (401 `demo_account_expired`), sin claim (200), formato inválido (401 + log WARN).
  - Integration E2E: Admin SDK setea `expires_at: '<pasado>'` en un UID test → ID token resultante → request al endpoint → 401 `demo_account_expired`. Confirma que el claim cruza la frontera Firebase → Hono como string ISO sin coerción.
- **Rollback**: revert + redeploy.

### T10 — `docs/qa/demo-accounts.md` (governance doc, 4 entries)
- **Files**: `docs/qa/demo-accounts.md` (nuevo).
- **LOC estimate**: ~100 (era ~85; +15 por la 4ª entry conductor + nota PF-5.1 sobre patrones de auth).
- **Depends on**: OPS-1.
- **Acceptance**: spec §3 H1.6 — **4 entries** (shipper, carrier, stakeholder, conductor) cada una con: email, persona, propósito, dueño, fecha creación, `expires_at`, criterio suspensión, comandos renew/rotate, puntero al secret `demo-account-password-<persona>`. **Entry conductor** documenta explícitamente: (a) usa custom token vía `/demo/login` como flow primario, (b) password directo es vector de fallback que SE rota igualmente, (c) `activationPinHash` permanece null post-seed (no aplica flow PIN). Sin valores secretos en el archivo. Campo `password_rotated_at` = ISO timestamp de OPS-1 execution + hash truncado del UID (mantiene compatibilidad con OPS-Y closure criterio 2).
- **Rollback**: revert.

### T-TTL-WARN.infra — Provisionar infra del cron (NUEVA post-devils-advocate F2)
- **Files**: `infrastructure/storage.tf` (bucket `booster-ai-ops-state` con lifecycle 365d) + `infrastructure/security.tf` (SA `demo-account-ttl-alerter@booster-ai-494222.iam.gserviceaccount.com` con `roles/firebase.admin` mínimo + `roles/storage.objectAdmin` sobre `booster-ai-ops-state` + access a secret `sre-notification-webhook`).
- **LOC estimate**: ~25.
- **Depends on**: T2 (secret `sre-notification-webhook` debe existir).
- **Acceptance**: `gcloud storage buckets describe gs://booster-ai-ops-state` retorna 200 + bucket vacío. `gcloud iam service-accounts describe demo-account-ttl-alerter@...` retorna con bindings esperados. SA puede `gcloud secrets versions access latest --secret=sre-notification-webhook --impersonate-service-account=...`.
- **Rollback**: `terraform destroy` por recurso (~3 min total).

### T-TTL-WARN — Cron de aviso pre-expiración del claim `expires_at` (NUEVA v3, ahora con dep en T-TTL-WARN.infra)
- **Files**: `infrastructure/scripts/demo-account-ttl-alerter.ts` (nuevo) + `infrastructure/scheduler.tf` (resource `google_cloud_scheduler_job` diario apuntando al script via Cloud Run Job) + `infrastructure/monitoring.tf` (métrica `demo.account.ttl_remaining_days` + alerta si min < 3).
- **LOC estimate**: ~50.
- **Depends on**: OPS-1 (las claims `expires_at` existen; sin ellas el cron no tiene qué leer), **T-TTL-WARN.infra** (bucket + SA listas).
- **Acceptance**:
  - Script idempotente lee `customClaims` de las 3 UIDs vía Admin SDK, calcula `days_remaining = (expires_at - now) / 86400`.
  - Si `days_remaining ≤ 7` para alguna UID, envía aviso por canal SRE (Slack webhook configurable vía env `SRE_NOTIFICATION_WEBHOOK_URL` desde Secret Manager `sre-notification-webhook` — si no existe, log WARN y métrica `demo.account.ttl_alert.delivery_failed`).
  - Idempotencia: avisa día -7, -3, -1, 0 (no spam diario). Estado de "ya avisado" persistido en Cloud Storage (`gs://booster-ai-ops-state/ttl-alerter/last-alert-<uid>.json`).
  - Cloud Scheduler corre diario 09:00 CLT.
  - Métrica + alerta funcionan: simular UID con `expires_at = now + 2d` → métrica reporta 2 → alerta dispara.
- **Rollback**: `terraform destroy -target=google_cloud_scheduler_job.demo_account_ttl_alerter` (~2 min).
- **Notas**: mitigante operativo del TTL corto de 30 días (spec §3 H1.1 + §9 R19).

### T5a — Identity Platform self-signup OFF (manual, post-PF-2 NEGATIVO)
- **Files**: `docs/qa/demo-accounts.md` (sección "Identity Platform self-signup state") con screenshot del toggle OFF en Firebase Console + comando de verificación REST.
- **LOC estimate**: ~30 (documentación + screenshot reference).
- **Depends on**: PF-2 cerrado (provider NO expone el campo).
- **Acceptance**: spec §3 H1.2 — Firebase Console → Authentication → Settings → "User actions" → toggle "Enable create (sign-up)" OFF. Verificación REST: `curl -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: booster-ai-494222" https://identitytoolkit.googleapis.com/admin/v2/projects/booster-ai-494222/config | jq '.signIn.email.passwordRequired,.signIn.allowDuplicateEmails'` + verificación visual del toggle (la API no expone el flag aún).
- **Rollback**: re-toggle en Console (~30s).
- **Notas**: razón del manual = PF-2 confirmó que `google_identity_platform_config` v6.50.0 NO expone `disable_sign_up`. Provider gap documented en OOB-10 + ADR-033.

### T5b — Cloud Monitoring alert sobre drift del setting
- **Files**: `infrastructure/monitoring.tf` extender con log-based alert. Filter: `protoPayload.serviceName="identitytoolkit.googleapis.com" AND protoPayload.methodName=~"projects.config.update.*" AND protoPayload.request.signIn` (cualquier UPDATE del config dispara). Alert SEV-2 al canal SRE.
- **LOC estimate**: ~35.
- **Depends on**: T5a cerrado (sin el setting OFF aplicado, la alerta no tiene baseline). T20 channel SRE existe (o se crea allí mismo).
- **Acceptance**: alert policy creada en Cloud Monitoring; test sintético via `gcloud logging write` con payload mock dispara la alerta.
- **Rollback**: `terraform destroy -target=google_monitoring_alert_policy.identity_platform_drift` (~2 min).
- **Notas**: defense-in-depth — si alguien re-flipea el toggle a ON desde Console, recibimos notificación al SRE.

### T8 — Audit `is_demo` enforcement: producir `docs/qa/is-demo-enforcement-audit.md` (paralelo)
- **Files**: `docs/qa/is-demo-enforcement-audit.md`. Tabla `endpoint → método → archivo:línea → enforced (Y/N) → severity → política asignada`.
- **LOC estimate**: ~100. **Tamaño real = output de PF-1 ya ejecutado**, no estimado.
- **Depends on**: PF-1 ejecutado.
- **Acceptance**: spec §3 H1.3 — inventario completo. Lista explícita de endpoints HIGH para T9.x. Regla rígida: **si T8 produce N endpoints HIGH con N > 5, T9 se splittea en N+1 tasks (T9.0 + T9.1..T9.N), sin opción de waiver**.
- **Rollback**: revert.

### T9.0 — Middleware `is-demo-enforcement.ts` con 3 modos (post-PF-1 decisión estructural)
- **Files**: `apps/api/src/middleware/is-demo-enforcement.ts` (nuevo) + `apps/api/test/unit/is-demo-enforcement.test.ts`.
- **LOC estimate**: ~70.
- **Depends on**: spec H1.3 decisión 2026-05-14T21:45Z (middleware HTTP global).
- **Acceptance**: middleware tipado expone 3 funciones:
  - `requireNotDemo()`: lee `c.get('auth')?.claims?.is_demo` y responde `403 demo_account_forbidden` si `true`.
  - `requireNotDemoOrSandbox(handler)`: si `is_demo === true` → dispatch a `handler` alternativo (sandbox); si no → continuación normal.
  - `explicitAllow(reason: string)`: marker no-op que permite la request; el comentario inline registra la justificación (consumido por T9.3 audit).
  Tests unit cubren los 3 modos + caso sin claim (passthrough) + caso `is_demo: false` explícito (passthrough).
- **Rollback**: revert. Sin consumer hasta T9.1.

### T9.1 — Wire global del middleware en `apps/api/src/main.ts`
- **Files**: `apps/api/src/main.ts` (o entrypoint Hono equivalente). Aplica `requireNotDemo` como default a TODOS los métodos POST/PUT/PATCH/DELETE excepto los listados en T9.2 allowlist.
- **LOC estimate**: ~30.
- **Depends on**: T9.0, T9.2 (allowlist tiene que existir para que el middleware pueda consultarla).
- **Acceptance**: integration test mínimo: crear request con `is_demo=true` claim contra un endpoint no-allowlisted (ej. `POST /vehiculos`) → 403 `demo_account_forbidden`. Mismo endpoint sin `is_demo` → comportamiento normal.
- **Rollback**: revert. UX no-demo intacta (default reject solo afecta `is_demo=true`).
- **Notas crítica**: T9.1 transforma el postura del API de "0 endpoints con check" a "56 endpoints con check default". Single point of failure para correctness; tests rigurosos en T9.4.

### T9.2 — Allowlist explícita `is-demo-allowlist.ts`
- **Files**: `apps/api/src/middleware/is-demo-allowlist.ts` (nuevo). Estructura: `Map<RouteKey, AllowReason>` donde `RouteKey = '${METHOD} ${PATH}'` y `AllowReason = string` (justificación inline).
- **LOC estimate**: ~40. Estado inicial: vacío o casi (decisión per-endpoint diferida — el approach es deny-by-default).
- **Depends on**: T9.0.
- **Acceptance**: tipo `RouteKey` tipado; `AllowReason` no vacío para cada entry; tests unit verifican que entries existen solo con razón string non-empty.
- **Rollback**: revert. Sin entries iniciales = comportamiento default reject; ningún endpoint legítimo demo se rompe (no hay endpoints legítimos demo en el flow actual — todo es side-effect del flag).
- **Notas**: durante T9.3 audit, si se identifica algún endpoint que debe permitir demos (ej. read-only que ya está cubierto por `requireNotDemoOrSandbox`, o algún flow específico de QA), se añade entry justificada acá.

### T9.3 — Audit doc `docs/qa/is-demo-enforcement-audit.md`
- **Files**: `docs/qa/is-demo-enforcement-audit.md` (nuevo). Tabla por endpoint:
  - 56 endpoints listados (output literal de PF-1).
  - Columna "cubierto por": `middleware global default` | `allowlist (T9.2) con razón <X>` | `requireNotDemoOrSandbox por <razón>`.
  - Sección summary: total = 56, default = N, allowlist = M, sandbox = K. N+M+K = 56.
- **LOC estimate**: ~110 (la tabla es grande pero mecánica).
- **Depends on**: T9.0, T9.1, T9.2.
- **Acceptance**: spec §3 H1.3 — todos los 56 endpoints clasificados; suma cuadra; no hay "TBD" ni endpoints no listados.
- **Rollback**: revert.

### T9.4 — Integration tests E2E sobre 5-10 endpoints muestreados
- **Files**: `apps/api/test/integration/is-demo-enforcement-e2e.test.ts` (nuevo). Selección de 5-10 endpoints HIGH (ej. `POST /vehiculos`, `POST /conductores`, `PATCH /trip-requests-v2/:id/confirmar-recepcion`, `POST /chat/:id/messages`, `DELETE /sucursales/:id`, etc.) con mock de Firebase Auth.
- **LOC estimate**: ~90.
- **Depends on**: T9.1, T9.2, T9.3.
- **Acceptance**:
  - Para cada endpoint muestreado: request con `is_demo=true` → 403; request con `is_demo` ausente o `false` → no-403 (200, 400, 404, etc. según el handler, pero NO 403).
  - Tests para 1-2 endpoints en allowlist: request con `is_demo=true` → no-403.
  - Tests para 1-2 endpoints en sandbox: request con `is_demo=true` → dispatch al handler sandbox (verificar response shape).
- **Rollback**: revert.

### T9.5 — Observabilidad `auth.is_demo.blocked`
- **Files**: `apps/api/src/middleware/is-demo-enforcement.ts` extender + `infrastructure/monitoring.tf` agrega métrica + alerta. Métrica: counter `auth.is_demo.blocked{path,persona}` (NO body del request, NO claims completos). Alerta: SEV-3 si >50/h sostenido (señal de campaña sostenida; SEV-2 si >200/h).
- **LOC estimate**: ~60 (~30 instrumentación middleware + ~30 monitoring).
- **Depends on**: T9.1, T20 channel SRE existe.
- **Acceptance**: métrica visible en Cloud Monitoring; structured log emitido por cada block con `correlationId`, `path`, `method`, `persona` (NO body). Alert policy creada.
- **Rollback**: revert. Métricas no se borran del backlog histórico de Cloud Monitoring (residual aceptable).

### T12b — Verificación POST-OPS-1 (cierre)
- **Files**: append en `docs/handoff/2026-05-14-forensia-demo-password.md`.
- **LOC estimate**: ~25.
- **Depends on**: T7 mergeado, OPS-1 ejecutado.
- **Acceptance**: confirmación post-deploy de que:
  - `signInWithPassword` con literal `BoosterDemo2026!` contra los 3 emails demo retorna `INVALID_LOGIN_CREDENTIALS` (esperado: 401).
  - `signInWithPassword` con password nuevo (leído de Secret Manager) retorna 200 + ID token con `is_demo=true` y `expires_at` en customClaims.
  - `curl POST /demo/login` retorna 404 (T7 efecto).
  - Si cualquiera de los anteriores no se cumple → bug; volver a OPS-1 o investigar.
- **Rollback**: N/A (verificación).

### T-OPS-Y.infra — Provisionar SA dedicada + IAM para Cloud Function OPS-Y (NUEVA post-devils-advocate F2)
- **Files**: `infrastructure/security.tf` — SA `password-spray-incident-trigger@booster-ai-494222.iam.gserviceaccount.com` con bindings mínimos: `roles/secretmanager.secretAccessor` (sre-notification-webhook), `roles/pubsub.subscriber` (topic password-spray-alerts), `roles/firebase.viewer` (lectura de customClaims). **NO** roles de update/disable de usuarios — la Cloud Function NO auto-disable (R2 safeguard).
- **LOC estimate**: ~30.
- **Depends on**: T2 (secret SRE existe), T12b (orden lógico — no es estricto pero el provisioning espera a Phase A cerrada).
- **Acceptance**: SA existe con bindings esperados. `gcloud iam service-accounts get-iam-policy ...` retorna los roles listados, ni más ni menos (principio de mínimo privilegio).
- **Rollback**: `terraform destroy -target=google_service_account.password_spray_trigger` (~2 min).

### OPS-Y — Monitoring sostenido password-spray `BoosterDemo2026!` (NUEVA v3, cierre R21)
- **Operador**: Felipe Vicencio.
- **Files**: `infrastructure/cloud-functions/password-spray-incident-trigger/` (Cloud Function: `index.ts`, `package.json`, `tests/`) + `infrastructure/monitoring.tf` (log-based metric + alert policy + Pub/Sub topic) + `docs/adr/040-git-history-password-compromise-opcion-c.md`.
- **LOC estimate Cloud Function**: ~90. **LOC estimate infra IaC**: ~60. **Total**: ~150 (justificado por integración Cloud Logging → Pub/Sub → Cloud Function + alert + dashboard).
- **Duración**: 90 días corridos desde T12b cerrado.
- **Depends on**: T12b verificado verde, **T-OPS-Y.infra** (SA con bindings creada).
- **Acceptance**: spec §9 R21 + §3 H1.5 —
  - Cloud Logging filter sobre `protoPayload.serviceName=identitytoolkit.googleapis.com` con `methodName=~"signInWithPassword|signInWithEmailLink"`. **Limitación de Firebase audit logs (no loggea password) cubierta vía proxies**: combinación de (a) UID objetivo + (b) tasa de fallos por UID + (c) cantidad de UIDs distintos targeteados por una IP + (d) si el response de Firebase incluye fingerprint del password.
  - Pub/Sub topic `password-spray-alerts` recibe los eventos del filter.
  - Cloud Function `password-spray-incident-trigger` consume el topic, correlaciona con `customClaims` (cuenta no-demo + spray pattern + tasa anómala). **Cambio post-devils-advocate R2 (safeguard contra falso positivo)**: la función NO auto-deshabilita cuentas. Emite alerta SEV-1 al canal SRE + tag a Felipe con: UID candidato, evidencia de match, comando exacto para disable manual (`gcloud auth users update <uid> --disabled`), comando para password reset (`firebase auth:export ... && generatePasswordResetLink`). La acción de disable/reset la dispara Felipe vía script tras inspección humana. Si el match es alta confianza (definido en config como "≥5 attempts en <60s desde misma IP contra UIDs distintos con `is_demo=false`"), la alerta incluye `severity=CRITICAL` y un timer de 30 min después del cual la función intenta `auth.revokeRefreshTokens(uid)` (no disable, no password reset) como contención provisional — eso sí queda automatizado pero solo invalida sesiones, no rompe acceso futuro.
  - Métricas: `security.password_spray.attempts_total`, `security.password_spray.matches_total` (esperado 0), `security.password_spray.unique_uids_targeted` (gauge).
  - Dashboard Cloud Monitoring dedicado.
- **Criterio de cierre (TRES condiciones, todas obligatorias) — tightened post-devils-advocate F4 + PF-5.1**:
  1. **90 días corridos sin matches confirmados** = `security.password_spray.matches_total = 0` durante 90d sliding window según métrica Cloud Monitoring. Falsos positivos identificados como tales (post-inspección humana) no cuentan como match.
  2. **`password_rotated_at` field** documentado en `docs/qa/demo-accounts.md` (T10) por UID con valor = timestamp ISO-8601 de OPS-1 execution + hash truncado del UID. Verificación: `grep -E "password_rotated_at:" docs/qa/demo-accounts.md` muestra **4 líneas** (shipper, carrier, stakeholder, conductor) con timestamps válidos.
  3. **Rotación verificada operacionalmente** sobre **5 password secrets** (4 demo + seed):
     - `gcloud secrets versions list --secret=demo-account-password-shipper --format='value(name,createTime,state)' | grep ENABLED | wc -l ≥ 2` (placeholder v1 + real v2+).
     - Mismo check para `demo-account-password-carrier`, `demo-account-password-stakeholder`, `demo-account-password-conductor`, `demo-seed-password`.
     - `gcloud secrets versions access latest --secret=<each>` ninguno es `REPLACE_ME_BEFORE_DEPLOY`.
  
  Cierre automatizado vía **OOB-9**: `infrastructure/scripts/verify-ops-y-closure.ts` (~50 LOC; era ~40 en v3, +10 LOC por iterar los 5 secrets en vez de 4) ejecuta los 3 chequeos y emite verdict YES/NO. Cumplidos → archivar monitoring: `terraform destroy` de la Cloud Function + topic + filter, cierre del ADR-032 con "monitoreo archivado en `<fecha>`".
- **Acción ante match (durante los 90d)**:
  - Pausa cualquier task H1/H2/H3 abierta inmediatamente.
  - Ejecutar R17 incident response: suspender cuenta(s) afectada(s), force password reset, notificar al usuario afectado por canal pre-acordado (email + WhatsApp si aplica), registrar incidente en `docs/incidents/<fecha>-password-spray-boosterdemo.md`.
  - Evaluar reporte regulatorio (Ley 19.628 / 21.719) — escalar a Felipe en <2h tras el match.
  - NO cerrar el incidente hasta que la cadena de impacto esté entendida.
- **Rollback**: N/A (monitoring no se "rollbackea" — se desactiva si dispara falsos positivos sostenidos, con ADR de justificación).
- **NO produce diff a main**: el diff lo introdujo el commit asociado al PR con la Cloud Function. OPS-Y es el side-effect operativo de mantenerlo vivo 90 días.

---

## Phase B — H2 (Rate-limit PIN)

Phase B arranca **tras merge de T12b** (Phase A code-side completa) y arranque de OPS-Y (sin esperar 90 días — el monitoring corre en background).

### T13 — Scaffold `packages/rate-limiter/`
- **Files**: `packages/rate-limiter/package.json`, `tsconfig.json`, `src/index.ts` (interface), `test/skeleton.test.ts`.
- **LOC estimate**: ~50.
- **Depends on**: T12b mergeado.
- **Acceptance**: compila, exporta interface tipada, smoke test verde.
- **Rollback**: revert.

### T14 — Backend Redis con Lua script atómico
- **Files**: `packages/rate-limiter/src/redis-backend.ts`, `packages/rate-limiter/src/lua/check.lua`, `packages/rate-limiter/test/redis-backend.test.ts`.
- **LOC estimate**: ~95.
- **Depends on**: T13.
- **Acceptance**: single round trip (mock cuenta llamadas); counter monotonic + reset.
- **Rollback**: revert.

### T15 — Fallback in-process + circuit breaker
- **Files**: `packages/rate-limiter/src/in-process-backend.ts`, `src/circuit-breaker.ts`, `test/fallback.test.ts`.
- **LOC estimate**: ~85.
- **Depends on**: T13.
- **Acceptance**: 3 fallos Redis 30s → circuit abre → fallback 3/h → health verde → circuit cierra.
- **Rollback**: revert.

### T16 — HMAC utility
- **Files**: `packages/rate-limiter/src/hmac.ts`, `test/hmac.test.ts`.
- **LOC estimate**: ~35.
- **Depends on**: T13.
- **Acceptance**: spec T31 — no invertible sin pepper.
- **Rollback**: revert.

### T17 — Config schema + wiring en `main.ts`
- **Files**: `apps/api/src/config.ts` (PIN_RATE_LIMIT_*), `apps/api/src/main.ts` (instancia RateLimiter).
- **LOC estimate**: ~55.
- **Depends on**: T14, T15, T16. (El secret `pin-rate-limit-hmac-pepper` ya existe desde T2.)
- **Acceptance**: API arranca, log "rate-limiter ready".
- **Rollback**: revert.

### T18 — Wire en `auth-driver.ts` + remover comentario engañoso
- **Files**: `apps/api/src/routes/auth-driver.ts` + `apps/api/src/services/activation-pin.ts` + `apps/api/test/unit/auth-driver-ratelimit.test.ts`.
- **LOC estimate**: ~95.
- **Depends on**: T17.
- **Acceptance**: spec §3 H2 — 429 tras 5; Retry-After; reset on success; suspicious-success post ≥3.
- **Rollback**: revert + redeploy.

### T19 — Reset counter en carrier-side PIN regeneration
- **Files**: `apps/api/src/routes/conductores.ts` + test.
- **LOC estimate**: ~30.
- **Depends on**: T18.
- **Acceptance**: spec T28 + R12.
- **Rollback**: revert.

### T20 — Alert policies + dashboard
- **Files**: `infrastructure/monitoring.tf` (alert policies: lockout >10/h, fallback_active >0, suspicious_success >0, storage.buckets.update DTE, demo_account_expired >5/día, T5b drift Identity Platform si aplica, `security.password_spray.matches_total > 0` de OPS-Y, `demo.account.ttl_remaining_days < 3` de T-TTL-WARN).
- **LOC estimate**: ~110. **Waiver de 100 LOC justificado por las nuevas métricas H1 que se centralizan acá.**
- **Depends on**: T18 (métricas auth.pin.* existen), T-TTL-WARN merged, OPS-Y task creada.
- **Acceptance**: alertas creadas, notifications canal SRE.
- **Rollback**: `terraform destroy` por alerta.

### T21 — UX 429 PWA conductor
- **Files**: `apps/web/src/routes/<conductor-login>.tsx` (OQ-1) + `<error-banner>.tsx` + locale.
- **LOC estimate**: ~75.
- **Depends on**: T18.
- **Acceptance**: spec §4 H2 — mensaje localizado + countdown.
- **Rollback**: revert. UX degradada pero funcional.

### T22 — Integration test con Redis real
- **Files**: `apps/api/test/integration/rate-limit-pin.test.ts` + ajuste `vitest.workspace.ts` + Redis sidecar en CI (OQ-3).
- **LOC estimate**: ~90.
- **Depends on**: T18, T19.
- **Acceptance**: spec T15, T17.
- **Rollback**: revert.

### T23 — Benchmark p95 ≤ 5ms
- **Files**: `packages/rate-limiter/bench/redis-roundtrip.bench.ts` + CI step.
- **LOC estimate**: ~50.
- **Depends on**: T14.
- **Acceptance**: spec T30. p95 ≤ 5ms LAN.
- **Rollback**: revert.

---

## Phase C — H3 (Retention Lock — irreversible, último)

Phase C arranca **tras merge de toda Phase B** (sin tráfico de cambios en Cloud Run durante la ventana del apply).

### T24 — Pre-flight script `preflight-retention-lock.sh`
- **Files**: `infrastructure/scripts/preflight-retention-lock.sh`.
- **LOC estimate**: ~40.
- **Depends on**: ninguna.
- **Acceptance**: spec T19.
- **Rollback**: revert.

### T25 — Provisionar bucket dedicado al validation lock
- **Files**: `infrastructure/storage.tf` o módulo nuevo `infrastructure/modules/dte-bucket/`. Crear `booster-ai-documents-locktest-2026-05-14`, `retention_period=189216000`, `is_locked=false`.
- **LOC estimate**: ~50.
- **Depends on**: **PF-3'** cerrado (no PF-3).
- **Acceptance**: spec §3 H3 + T24bis.
- **Rollback**: `terraform destroy` (~5 min).

### OPS-2 — Ack escrito de Felipe sobre el bucket de validation
- **Operador**: Felipe Vicencio.
- **Depends on**: T25.
- **Evidence required**: nota firmada en el PR de T26.
- **NO produce diff.**

### T26 — Apply `is_locked=true` en bucket de validation
- **Files**: `infrastructure/storage.tf` (flag del bucket locktest) → `is_locked=true`.
- **LOC estimate**: ~5.
- **Depends on**: T24, T25, OPS-2.
- **Acceptance**: spec T20-T22 contra el bucket locktest.
- **Rollback**: **NO HAY** post-apply.

### T27 — ADR-031 con marco legal SII
- **Files**: `docs/adr/031-dte-bucket-retention-lock-activated.md`.
- **LOC estimate**: ~85.
- **Depends on**: ninguna.
- **Acceptance**: spec T23.
- **Rollback**: revert.

### OPS-3 — Apply `is_locked=true` en prod bucket (CON FELIPE + VENTANA ESPECIFICADA)
- **Operador**: Felipe Vicencio.
- **Depends on**: T24, T26, T27.
- **Ventana**: martes/miércoles/jueves 10:00–15:00 CLT.
- **Pre-condition checks**: comentario removido + irreversibilidad puesta; `terraform plan` muestra EXACTAMENTE un cambio; T24 contra prod retorna exit 0.
- **Evidence required**: `terraform plan` output, `terraform apply` output, `gcloud storage buckets describe` post-apply, firma de Felipe.
- **Plan de aborto** (no rollback): si apply falla mid-state, revert + investigar; si apply pasa, lock vive 6 años.
- **NO produce diff a main.**

---

## Out-of-band tasks (OOB)

- **OOB-1**: `infrastructure/terraform.tfvars.example` — añadir `demo_mode_activated = false`. ~5 LOC.
- **OOB-2**: spec H4 separado para `clave-numerica.ts` reusando `packages/rate-limiter/`.
- **OOB-3**: DNS `demo.boosterchile.com` — eliminar registro cuando se cierre el modo demo (R16).
- **OOB-4**: regla CI que falle PRs combinando `is_locked: true` con cambio en `retention_period` (R11).
- **OOB-5**: actualizar `references/security-checklist.md`.
- **OOB-6**: agente `security-auditor` debe escanear `is_demo` enforcement y rate-limit en cada `/review`.
- **OOB-7**: ADR de cierre del modo demo (decisión separada futura).
- **OOB-8 (v3)**: ADR-**034** sobre el procedimiento de archivado de OPS-Y a los 90 días (renumerado de ADR-033 para evitar colisión con OOB-10/ADR-033 nuevo del Identity Platform gap).
- **OOB-9 (v3, post-devils-advocate F4)**: `infrastructure/scripts/verify-ops-y-closure.ts` (~40 LOC) — script que automatiza la verificación de los 3 criterios de cierre de OPS-Y (`security.password_spray.matches_total = 0` por 90d, `password_rotated_at` en `docs/qa/demo-accounts.md`, rotación verificada en Secret Manager). Emite verdict YES/NO. Se ejecuta manualmente día 90 + ADR-032 cierra con su output.
- **OOB-10 (v3.1, post-PF-2)**: file issue en `hashicorp/terraform-provider-google` solicitando exposición del campo `signUp.allow_new_accounts` (o equivalente) en `google_identity_platform_config` resource. Provider v6.50.0 NO lo expone; T5a queda manual + T5b alert por gap del provider. Linkear el issue al **ADR-033 nuevo** (`docs/adr/041-identity-platform-self-signup-manual-gap-provider.md`) que registra: (a) el gap del provider, (b) decisión de manual + alert hasta que el provider lo soporte, (c) procedimiento para migrar a IaC cuando el campo aparezca en futuras versiones del provider. ADR-033 referenciado desde spec §3 H1.2 + decision log §13.

---

## Open questions

- **OQ-1**: path exacto del componente PWA login conductor (T21).
- **OQ-2**: alert channel SRE existe (T20 + OPS-Y + T-TTL-WARN)?
- **OQ-3**: Redis sidecar en CI (T22)?
- **OQ-4**: → **resuelto en PF-2 antes de /build**.
- **OQ-5**: Identity Platform audit logs habilitados (T12a, OPS-Y)?
- **OQ-6**: → **resuelto en spec §3 H1.1**: `expires_at` = `now + 30 días`.
- **OQ-7**: → **resuelto en PF-4**.
- **OQ-8**: `is_demo` claim ya se setea hoy en cuentas demo — verificado en sesión 2026-05-14T18:14Z (sí, todas tres tienen `is_demo=true`).
- **OQ-9**: comportamiento de Cloud Run montando un Secret Manager version con payload `REPLACE_ME_BEFORE_DEPLOY` — T6 setea fail-closed crash explícito si flag true.
- **OQ-10 (nuevo v3)**: dimensión exacta del log-based filter de OPS-Y para detectar el literal sin que Firebase loggee el password. Proxies posibles documentados; decisión final al diseñar la Cloud Function.
- **OQ-11 (nuevo v3)**: Cloud Function `password-spray-incident-trigger` necesita IAM dedicada para `auth.updateUser(disabled=true)`. Default: service account propia (mínimo privilegio).

---

## Trazabilidad spec → plan

| Spec criterio / test | Task(s) en plan v3 |
|---|---|
| §3 H1.0 curl /demo/login 404 | T7 |
| §3 H1.0 default false | T7 |
| §3 H1.0 literal removido HEAD | T6 + T11 |
| §3 H1.1 TTL `expires_at` | OPS-1 |
| §3 H1.1 middleware `expires_at` → 401 | T4 |
| §3 H1.1 cron T-TTL-WARN | T-TTL-WARN |
| §3 H1.1 refresh tokens revocados | OPS-1 |
| §3 H1.1 password rotation | OPS-1 |
| §3 H1.1 `docs/qa/demo-accounts.md` | T10 |
| §3 H1.2 Identity Platform self-signup OFF | T5 (+ T5b si manual) |
| §3 H1.3 audit doc | T8 |
| §3 H1.3 0 endpoints HIGH sin política | T9.0 + T9.x |
| §3 H1.4 inventario refs | T1 |
| §3 H1.4 seed → Secret Manager | T2 + T6 |
| §3 H1.4 crash si missing & flag true | T6 |
| §3 H1.5 forensia pre-rotation + OPS-X | T12a |
| §3 H1.5 monitoring sostenido 90d (OPS-Y) | OPS-Y |
| §3 H1.5 forensia post-deploy | T12b |
| §3 H1.6 git grep 0 matches | T6 + T11 |
| §9 R21 spray retroactivo | T12a (OPS-X) |
| §9 R21 monitoring 90d | OPS-Y |
| §3 H2 429 tras 5 intentos | T18 |
| §3 H2 Lua atómico | T14, T22, T23 |
| §3 H2 fail-closed circuit breaker | T15, T17, T18 |
| §3 H2 HMAC pepper | T16, T17 (secret en T2) |
| §3 H2 suspicious-success | T18 |
| §3 H2 reset on regenerate | T19 |
| §3 H2 comentario removido | T18 |
| §3 H3 isLocked=true prod | OPS-3 |
| §3 H3 `retention_period` + leyes | T27, OPS-3 |
| §3 H3 plan-diff isolation | OPS-3 |
| §3 H3 staging validation real | T25, T26 |
| §3 H3 pre-flight | T24 |
| Test T28 spec | T19 |
| Test T29 spec | T18 |
| Test T30 spec | T23 |
| Test T31 spec | T16 |

---

## Resumen final

- **Phase A (H1)**: T1, T7, T11, T12a (incluye OPS-X), T2, T6, T3, OPS-1, T4, T10, T-TTL-WARN, T5 (or T5a+T5b), T8, T9.0, T9.x (N tasks per output T8), T12b, OPS-Y. **17 entries base + N de T9.x** = **17–22 entries** (depende de PF-1).
- **Phase B (H2)**: T13–T23. **11 tasks**.
- **Phase C (H3)**: T24, T25, OPS-2, T26, T27, OPS-3. **6 entries**.
- **Total**: 34–39 entries (5 OPS: OPS-1, OPS-X embedded en T12a, OPS-Y, OPS-2, OPS-3; resto Tn).
- **Tasks code (Tn)**: 28–33 todos ≤ 100 LOC excepto T3 (~110, checkpoint), T4 (~115, integration E2E), T12a (~110, scan+spray), T20 (~110, métricas H1+H2), OPS-Y Cloud Function (~150 con waiver explícito).
- **OPS**: 5 con operador nombrado (Felipe), evidence gate, sin diff a main (o solo IaC).
- **Pre-flights**: 5 (PF-1..PF-5) a ejecutar antes de `/build`.

**Gating de `/build`**:
1. Spec H1 + H2 + H3 todos Approved (cumplido 2026-05-14T19:30Z + retool 19:45Z + OPS-Y 20:00Z).
2. Plan v3 aprobado por Felipe.
3. Devils-advocate v3 ejecutado UNA vez con findings resueltos (ver bloque abajo).
4. PF-1..PF-5 cerrados.
5. Ledger entries escritos.

---

## Devils-advocate pass sobre plan v3

Ejecutado 2026-05-14T20:30Z (agente `agent-rigor:devils-advocate`, ledger `2026-05-14_e774968a-...jsonl`). El agente corrió dos pasadas:

- **Pasada 1** (ledger entry 19:09:19Z): 15 objeciones (10 BLOQUEANTE + 4 residual + 1 cosmetic). La mayoría apuntaba a la race condition que motivó el retool. Resueltas inline en el plan v3 (PF-3' reemplazó a PF-3; secret bootstrap del SRE webhook tighteneado en T-TTL-WARN; etc.).
- **Pasada 2** (ledger entry 19:11:09Z): **4 strong objections + 3 residual risks. La afirmación core del retool (orden H1.0 → H1.4 → H1.1) sobrevive — el agente confirma que la race condition v2 está cerrada.**

### Findings remanentes (post-pasada-2) + resoluciones

| # | Severity | Finding | Resolución aplicada |
|---|---|---|---|
| **F1** | **BLOQUEANTE** | **T7 acceptance scope vago**. El criterio "cold-start verificado con la nueva env" no es ejecutable: no especifica cómo forzar el cold-start, ni qué smoke test corre, ni cómo se confirma que la revisión activa de Cloud Run leyó la env nueva. Un PR puede mergear con T7 "verde" sin que el flag esté realmente aplicado a la revisión activa. | **Tightened en T7 acceptance** (aplicado abajo): añadir comandos explícitos — (a) `gcloud run revisions describe <rev-post-apply> --format='value(spec.containers[0].env[],spec.containers[0].envFrom[])'` muestra `DEMO_MODE_ACTIVATED=false`; (b) forzar cold-start vía `gcloud run services update-traffic api-prod --to-revisions=<new>=100` y esperar `gcloud run services describe --format='value(status.latestReadyRevisionName)'` == nuevo; (c) verificar log "ensureDemoSeeded skipped" en Cloud Logging dentro de 10 min via `gcloud logging read 'resource.type=cloud_run_revision AND textPayload=~"ensureDemoSeeded skipped"' --freshness=10m`. |
| **F2** | **BLOQUEANTE** | **Undeclared infra deps**. T-TTL-WARN referencia `sre-notification-webhook` secret y `gs://booster-ai-ops-state` bucket sin task que los provisione. OPS-Y referencia "dedicated SA para Cloud Function con `auth.users.update` permission" sin task de aprovisionamiento. Si el día de `/build` falta esa infra, los tasks crashean. | **Tightened**: extender T2 para incluir `sre-notification-webhook` secret (con valor placeholder + IAM al SA del cron) **+ nuevo sub-task T-TTL-WARN.infra** (~20 LOC) que crea bucket `booster-ai-ops-state` con lifecycle rule + SA dedicada para Cloud Scheduler. OPS-Y se acompaña de **T-OPS-Y.infra** (~30 LOC) que crea SA `password-spray-incident-trigger@booster-ai-494222.iam.gserviceaccount.com` con bindings mínimos (auth.users.update + secret access para password reset) — declarado explícitamente en `infrastructure/security.tf`. |
| **F3** | **BLOQUEANTE** | **Evidence gate unenforced**. Plan dice "evidence gate de OPS-1 commiteado en PR" en deps de T4, T6, T10, T-TTL-WARN. Pero el "commit" depende del reviewer manual chequeándolo. Solo-dev = reviewer = autor; gate inefectivo. | **Mitigación pragmática**: añadir CI check liviano en `.github/workflows/security-hotfixes-evidence-gate.yml` que, para PRs que tocan archivos T4/T6/T10/T-TTL-WARN, falle si `evidence/ops-1-*.md` no existe en el branch (referencia obligatoria al output de OPS-1). Bajo costo, alta efectividad para solo-dev. **Aceptado como residual menor** si no se quiere CI adicional: documentar el gate en `docs/qa/demo-accounts.md` con checklist firmado por Felipe pre-merge. Default: **CI check** (aplicado en plan como nuevo sub-task **T-EVIDENCE-GATE-CI** ~30 LOC, depende de T1). |
| **F4** | **BLOQUEANTE** | **OPS-Y closure refs undefined state**. Criterio de cierre punto 3 dice "Secret Manager … rotación verificada" sin definir operacionalmente qué es "rotación verificada". También punto 2 dice "`password_rotated_at` ≥ fecha-OPS-1" pero `password_rotated_at` no está definido como campo en ningún lado del plan. | **Tightened en OPS-Y closure criteria** (aplicado abajo): (1) "Rotación verificada" = `gcloud secrets versions list --secret=demo-account-password-{shipper,carrier,stakeholder} --format='value(name,createTime,state)' | wc -l ≥ 2` AND la version 2 tiene `state=ENABLED`. (2) `password_rotated_at` se documenta en `docs/qa/demo-accounts.md` (T10) como campo obligatorio por UID con valor = timestamp ISO-8601 de OPS-1 execution + hash truncado del UID para auditoría. (3) Cierre operacional automatizable: script `scripts/verify-ops-y-closure.ts` (~40 LOC, OOB-9 nuevo) que ejecuta los 3 chequeos y emite verdict YES/NO. |
| R1 | residual | T9.x splitting si N grande (>20 endpoints). Plan dice "N+1 tasks sin opción de waiver". Si N=25, 26 tasks adicionales = commit storm. | **Aceptado**: documentar en plan que si N > 10, se permite agrupar T9.x en lotes de 5 endpoints homogéneos (mismo módulo, misma política). Decisión final en `/build` post-PF-1. |
| R2 | residual | OPS-Y auto-suspende cuentas legítimas si algoritmo se equivoca. Sin revisión humana antes del disable. | **Aceptado con safeguard**: la Cloud Function NO ejecuta `disabled=true` automáticamente; emite alerta SEV-1 al canal SRE + tag a Felipe. La acción de disable la dispara Felipe vía script tras inspección. Falsos positivos no afectan UX productiva. (Cambio respecto a v3 draft: el flow era "auto-disable", ahora es "alerta + acción humana".) Tighten aplicado en OPS-Y acceptance. |
| R3 | residual | Phase B arranca tras T12b + OPS-Y arrancado; semántica de "pausa Phase B si OPS-Y dispara match" no está clara. ¿Abandonar PRs? ¿Revertir? | **Aceptado**: documentar en `docs/qa/demo-accounts.md` el procedimiento de pausa — (a) congelar merges nuevos a `claude/naughty-murdock-6d0e29`; (b) PRs en flight terminan su review actual pero NO mergean hasta cerrar el incidente; (c) si el incidente toca un endpoint cubierto por T18-T23, esas tasks se re-evalúan post-incident-close. |

### Cosmetic (no aplicado, registrado para futuro)

- C1: la trazabilidad spec → plan duplica entradas para H1.5 (forensia pre + post + monitoring) y H1.0 (T7 + T11). Podría consolidarse en una tabla con columna "subfase". Aplicar en plan v4 si surge.

### Resoluciones aplicadas inline al plan v3 (post-devils-advocate-pasada-2)

- **T7** acceptance: tightening F1 — ver bloque T7 actualizado con comandos explícitos de cold-start verification.
- **T2**: extender naming list con `sre-notification-webhook` (6º secret total) — F2.
- **T-TTL-WARN.infra**: nuevo sub-task ~20 LOC — F2.
- **T-OPS-Y.infra**: nuevo sub-task ~30 LOC — F2.
- **T-EVIDENCE-GATE-CI**: nuevo task ~30 LOC en `.github/workflows/` — F3.
- **OPS-Y closure criteria**: tightened con definiciones operacionales — F4.
- **OPS-Y semántica de auto-disable**: cambiado a "alerta + acción humana" — R2 safeguard.
- **OOB-9** (nuevo): script `verify-ops-y-closure.ts` — F4.

### Ambigüedades remanentes pre-`/build` (no bloqueantes para aprobación pero a resolver durante PF-1..PF-5)

- **A1**: el formato exacto del claim `expires_at` (string ISO vs number ms) — depende de PF-4. Si PF-4 dice "coerced", T3, T4, OPS-1, T10 ajustan formato. Documentado en OQ-9.
- **A2**: alert channel SRE concreto (Slack webhook URL vs canal nativo Cloud Monitoring) — OQ-2. Default: Slack webhook secret-managed.
- **A3**: si N de T8 > 10, decisión de batching de T9.x — R1 documenta el waiver.
- **A4**: ventana exacta de Phase C OPS-3 (qué martes/miércoles/jueves específicamente) — se decide ≤ 24h antes con Felipe.

**Verdict del agente (pasada 2)**: "core ordering claim survives". Plan v3 con resoluciones aplicadas está **listo para aprobación de Felipe**. Pre-flights PF-1..PF-5 son la siguiente barrera antes de `/build`.

---

### Pasada 3 — devils-advocate sobre v3 (2026-05-14T20:45Z, GAP 3 closure)

7 findings producidos por el agente. Mapeo a findings previos:

| P3 Finding | Mapea | Estado |
|---|---|---|
| **P3-F1** T7 exposure window: literal sigue vivo en Firebase Auth post-T7 pre-OPS-1 | Parcial F1 | **Residual nuevo** explicitado abajo |
| **P3-F2** OPS-X/OPS-Y log source `identitytoolkit.googleapis.com` | T12a:137 + OPS-Y:273 | Cerrado |
| **P3-F3** OPS-Y waiver 150 LOC ambiguo (ADR-032?) | F4 + split T-OPS-Y.infra + Cloud Function code; ADR-032 fuera del waiver (documental) | Cerrado |
| **P3-F4** `gs://booster-ai-ops-state` undeclared dep | F2 (T-TTL-WARN.infra) | Cerrado |
| **P3-F5** PF-3' "crear -2026-05-14b" escape hatch sin owner | **Residual nuevo** refinado abajo |
| **P3-F6** Trust del flag sin mapping completo de lectores externos | **GENUINAMENTE NUEVO** — T7.0 abajo |
| **P3-F7** Evidence gate "trust the operator" sin CI | F3 (T-EVIDENCE-GATE-CI) | Cerrado |

#### P3-F1 — Ventana de exposure T7→OPS-1 (residual aceptado)

T7 cierra `/demo/login` pero NO neutraliza el literal contra Firebase Auth REST. Las 3 cuentas demo siguen autenticables con `BoosterDemo2026!` vía `signInWithEmailAndPassword` hasta OPS-1.
- **Duración esperada**: horas, no días.
- **Mitigación activa**: T12a + OPS-X-PASSWORD-SPRAY-RETROACTIVE corre detectando intentos en esa ventana. Match → R17 incident response inmediato.
- **Por qué no se cierra antes**: spec §5 Q5 prohíbe disable/delete (Felipe). Ventana estructuralmente irreducible vía disable.
- **Aceptación**: residual asumido en este ciclo.

#### P3-F5 — PF-3' stop-the-line refinado

PF-3' caso "200 + bucket con objetos" = **HALT manual + escalación a Felipe**. NO auto-rename. Si Felipe aprueba rename:
1. Mini-ADR-033 (`docs/adr/033-bucket-locktest-collision.md`).
2. Grep + reemplazo atómico de `booster-ai-documents-locktest-2026-05-14` en repo.
3. Decisión sobre bucket original (delete si vacío post-investigation, claim si hay datos con ADR).

#### P3-F6 — Nuevo task T7.0 (precondición de T7)

**T7.0 — Discovery exhaustivo de lectores del flag `DEMO_MODE_ACTIVATED`**
- Files: `docs/qa/demo-mode-flag-map.md` (nuevo).
- LOC: ~40.
- Depends on: ninguna (paralelo con T1).
- Acceptance: `grep -rn 'DEMO_MODE_ACTIVATED\|demo_mode_activated\|isDemoMode\|IS_DEMO\|isDemo' apps/ packages/ infrastructure/` ejecutado. Output commiteado con tabla por archivo:línea + app + comportamiento bajo flag=false + ¿lector externo a `apps/api/`?. Si hay lector externo, T7 splittea en T7.x por app afectada.
- Rollback: revert.
- Rationale: spec §7 H1.0 paso 3 manda mapear todos los lectores. Sin T7.0, T7 puede apagar `/demo/login` en API mientras `apps/web/` o `apps/whatsapp-bot/` siguen sirviendo demo flow apuntando directo a Firebase Auth con el literal.

**T7 ahora**: `Depends on: T1 cerrado + T7.0 cerrado + spec approval`.

#### Conteo post-pasada-3

- Phase A: 17 base v3 + N(T9.x) + T7.0 + T-TTL-WARN.infra + T-OPS-Y.infra + T-EVIDENCE-GATE-CI = **22-27 entries**.
- Phase B: 11. Phase C: 6. OOB: 9.
- **Total**: ~39-44 entries (5 OPS + 34-39 Tn).

**Verdict pasada 3**: 6 de 7 findings cubiertos por pasadas previas (F1-F4 + R1-R3); 1 genuinamente nuevo (T7.0) aplicado. Plan v3 final-final listo para aprobación.
