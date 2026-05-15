# Demo Accounts Inventory — Pre-rotation Snapshot

- **Generado**: 2026-05-14T19:55Z
- **Task**: T1 (plan v3.1) — Inventory exhaustivo grep + Firebase + git history compromise
- **Spec**: `.specs/security-blocking-hotfixes-2026-05-14/spec.md` (Approved 19:30Z; retool H1 19:45Z; OPS-Y 20:00Z; 4 UIDs + T9 deferred + T5 fallback 21:00Z)
- **Plan**: `.specs/security-blocking-hotfixes-2026-05-14/plan.md` v3.1
- **Tenant**: `booster-ai-494222` (Firebase / Identity Platform)
- **Estado**: pre-rotation. Las 4 cuentas demo todavía tienen password `Boost***2026!` activo. Este doc es el snapshot que OPS-1 transforma.

> **Propósito**: consolidar lo que sabemos del estado actual de las cuentas demo antes de OPS-1 (rotation). Sirve de baseline para:
> - T3 (harden script): conocer UIDs target, persona → secret mapping, claims actuales.
> - T12a (forensia + OPS-X spray retroactivo): sanity-check que el literal aún funciona contra las 4 demo + scope de spray no-demo.
> - T12b (post-rotation verification): diff contra el estado nuevo.
> - OPS-Y closure: punto 2 del criterio (`password_rotated_at` por UID).
> - Auditoría futura.

---

## 1. Cuentas demo en scope de hardening H1.1 (4 UIDs)

Las 4 cuentas con `customClaims.is_demo=true` en el tenant. **Todas siguen activas (`disabled=false`)** con uso de QA interno reciente (lastLogin todas en últimas 24h, IPs server-side o Movistar CL — sin sospecha externa, ver spec §13 entry 2026-05-14T18:14Z).

| # | UID | Email | Persona | Created | Last login (UTC) | `is_demo` | `expires_at` | Disabled | Providers |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `nQSqGqVCHGUn8yrU21uFtnLvaCK2` | `demo-shipper@boosterchile.com` | shipper | 2026-05-12T20:51:01Z | 2026-05-14T13:27:16Z | true | (no claim — pre-hardening) | false | password |
| 2 | `s1qSYAUJZcUtjGu4Pg2wjcjgd2o1` | `demo-carrier@boosterchile.com` | carrier | 2026-05-12T20:51:02Z | 2026-05-14T12:21:45Z | true | (no claim — pre-hardening) | false | password |
| 3 | `Uxa37UZPAEPWPYEhjjG772ELOiI2` | `demo-stakeholder@boosterchile.com` | stakeholder | 2026-05-12T20:51:03Z | 2026-05-14T12:22:08Z | true | (no claim — pre-hardening) | false | password |
| 4 | `Gg9k3gIPa1cJZtgKC0RRkWQ0QHJ3` | `drivers+123456785@boosterchile.invalid` | conductor | 2026-05-12T20:55:28Z | 2026-05-14T12:21:57Z | true | (no claim — pre-hardening) | false | password |

### 1.1 Pattern de auth por persona

| Persona | Flow primario (con `DEMO_MODE_ACTIVATED=true`) | Flow fallback / secundario | Password directo seteado en Firebase | Activation PIN |
|---|---|---|---|---|
| shipper | `signInWithPassword` (email + password directo) | n/a | **Sí** (`Boost***2026!`) | n/a |
| carrier | `signInWithPassword` (email + password directo) | n/a | **Sí** (`Boost***2026!`) | n/a |
| stakeholder | `signInWithPassword` (email + password directo) | n/a | **Sí** (`Boost***2026!`) | n/a |
| conductor | Custom token vía `POST /demo/login` (mintea `firebaseAuth.createCustomToken` en `apps/api/src/routes/demo-login.ts:121`) | `signInWithEmailAndPassword` con email sintético + password directo (`apps/web/src/routes/login-conductor.tsx:85` fallthrough cuando `/auth/driver-activate` responde `already_activated`) | **Sí** (`Boost***2026!` seteado por `apps/api/src/services/seed-demo-startup.ts:148`) | **null** — borrado por `seed-demo-startup.ts:176` |

**Conclusión PF-5.1 (2026-05-14T21:00Z)**: el conductor demo NO es "bootstrap-only" respecto al password directo — el `signInWithEmailAndPassword` está activo como fallback path en la PWA y es vector explotable del spray attack. Tratamiento simétrico a los 3 owners: rotation + TTL + revoke + secret en Secret Manager.

### 1.2 Risk classification + rotation order (input para T3 / OPS-1)

Las 4 cuentas se rotan en una sola pasada idempotente del `harden-demo-accounts.ts`. El orden interno no afecta seguridad (cada rotation es independiente), pero el orden lexicográfico por persona facilita revisión de stdout:

| Orden de rotation | Persona | UID | Secret target | Risk (pre-rotation) | Risk (post-rotation) |
|---|---|---|---|---|---|
| 1 | carrier | `s1qSYAUJZcUtjGu4Pg2wjcjgd2o1` | `demo-account-password-carrier` | **HIGH** (literal compartido + login productivo de owner empresa demo) | LOW (random 32B + TTL 30d + claim enforce) |
| 2 | conductor | `Gg9k3gIPa1cJZtgKC0RRkWQ0QHJ3` | `demo-account-password-conductor` | **HIGH** (literal compartido + fallback path en PWA conductor) | LOW |
| 3 | shipper | `nQSqGqVCHGUn8yrU21uFtnLvaCK2` | `demo-account-password-shipper` | **HIGH** (literal compartido + login productivo de owner empresa demo) | LOW |
| 4 | stakeholder | `Uxa37UZPAEPWPYEhjjG772ELOiI2` | `demo-account-password-stakeholder` | **HIGH** (literal compartido + login productivo de org demo) | LOW |

### 1.3 Estado post-rotation esperado (verificable en T12b)

Para cada UID:
- `customClaims.expires_at` = ISO-8601 string, `now + 30 días` (PF-4 confirmó preservation como string).
- `customClaims.is_demo` = true (unchanged).
- `customClaims.persona` = unchanged.
- Password Firebase = random 32B base64url (almacenado solo en Secret Manager `demo-account-password-<persona>` version ≥ 2).
- Refresh tokens revocados (`auth.revokeRefreshTokens(uid)` ejecutado pre-password-update).
- `disabled` = false (no se deshabilitan, son fixtures de QA).

---

## 2. Cross-check con outputs de PF-1, PF-5, PF-5.1

### 2.1 PF-1 — Inventory write endpoints `apps/api/src/routes/`

Ejecutado 2026-05-14T20:30Z. Comando: `grep -rEn "^\s+app\.(post|put|patch|delete)\(" apps/api/src/routes --include='*.ts'`.

**Resultado raw**: 58 HTTP write routes (38 POST + 11 PATCH + 8 DELETE + 0 PUT, 3 falsos positivos Drizzle `.delete(tabla)` excluidos).

**Por archivo (top)**: `documentos.ts` (6), `site-settings.ts` (4), `chat.ts` (4), `assignments.ts` (4), `vehiculos.ts` (3), `trip-requests-v2.ts` (3), `sucursales.ts` (3), `conductores.ts` (3), `admin-stakeholder-orgs.ts` (3), `admin-jobs.ts` (3).

**Files admin-* (7)**: `admin-cobra-hoy.ts`, `admin-dispositivos.ts`, `admin-jobs.ts`, `admin-liquidaciones.ts`, `admin-matching-backtest.ts`, `admin-seed.ts`, `admin-stakeholder-orgs.ts` — probable `isAdmin` guard ya presente, audit T8 lo confirma.

**Files user-facing (16)**: `assignments.ts`, `chat.ts`, `cobra-hoy.ts`, `conductores.ts`, `documentos.ts`, `empresas.ts`, `me-clave-numerica.ts`, `me-consents.ts`, `me.ts`, `offers.ts`, `site-settings.ts`, `sucursales.ts`, `trip-requests-v2.ts`, `trip-requests.ts`, `vehiculos.ts`, `webpush.ts`.

**Endpoints públicos (2)**: `auth-driver.ts:65 driver-activate` (cubierto por H2 rate-limit), `demo-login.ts:75 /login` (muere con T7 flag flip).

**Implicación en plan v3.1**: T9.0 + T9.x **DEFERRED hasta T8**. Threshold informal R1: si T8 produce N HIGH > 30, PAUSA para discutir approach estructural (Drizzle hook / RLS / Hono HoC). 58 raw is over the threshold; expected ~30-45 HIGH después de excluir admin-* (isAdmin gate) y endpoints sin tabla productiva.

### 2.2 PF-5 — UIDs demo en tenant

Ejecutado 2026-05-14T20:30Z (re-verificado 19:55Z). Comando: `POST identitytoolkit.googleapis.com/v1/projects/booster-ai-494222/accounts:query`.

**Resultado**: 10 users totales en tenant; **4 con `customClaims.is_demo=true`** (no 3 como spec inicial asumía). El 4º UID (`Gg9k3gIPa1cJZtgKC0RRkWQ0QHJ3`, persona conductor) fue añadido al scope H1 → T2, T3, OPS-1, T10, T12a, OPS-Y todos extendidos.

### 2.3 PF-5.1 — Pattern de auth del conductor demo

Ejecutado 2026-05-14T21:00Z. Investigación de archivos: `seed-demo-startup.ts` (100-191), `seed-demo.ts` (refs a `DEMO_CONDUCTOR_RUT`), `activation-pin.ts`, `clave-numerica.ts`, `login-conductor.tsx`, `demo-login.ts`.

**Hallazgo**: conductor demo usa AMBOS paths (custom token primario + password fallback). Detallado en §1.1 arriba. **Tratamiento simétrico aprobado** → 7º secret + harden simétrico.

**Caveat de superficie**: el RUT del conductor demo `12345678-5` está hardcoded en `seed-demo.ts:75` y el email sintético es derivable de la fórmula (`drivers+<RUT-sin-puntos>@boosterchile.invalid`). Ambos están en git history público — no son secretos, pero sí superficie reconocible. Rotación del password cierra el vector explotable; el RUT/email pueden quedar visibles sin riesgo.

### 2.4 PF-1.bis — Inventory cross-repo del literal `Boost***2026`

Ejecutado 2026-05-14T19:45Z (investigación pre-aprobación retool H1). Archivos con el literal en HEAD:

| Archivo | Línea | Contexto |
|---|---|---|
| `apps/api/src/services/seed-demo.ts` | 86 | `const DEMO_PASSWORD = 'Boost***2026!';` |
| `apps/api/src/services/seed-demo-startup.ts` | 103 | Comentario `/** El password sintético Boost***2026! ... */` |
| `apps/api/src/services/seed-demo-startup.ts` | 140 | Comentario `// password fijo Boost***2026! consistente ...` |
| `apps/api/src/services/seed-demo-startup.ts` | 142 | `const password = 'Boost***2026!';` |
| `apps/api/dist/main.js` | 4771 | `var DEMO_PASSWORD = "Boost***2026!";` (artefacto compilado; `dist/` está en `.gitignore`, no commiteado) |
| `docs/demo/guia-uso-demo.md` | 81, 85, 89, 113, 114, 115, 216 | Doc de uso del demo expone el password al lector |
| `docs/handoff/2026-05-11-demo-features-night-sprint.md` | 107, 108 | Handoff expone password |

**Tasks que limpian estos**:
- `apps/api/src/services/*.ts` literal → **T6** (refactor → Secret Manager + fail-closed crash).
- `docs/demo/guia-uso-demo.md` + `docs/handoff/2026-05-11-...` → **T11** (sanitize, replace con instrucción de obtener password vía operador).
- `apps/api/dist/main.js` no se commitea, se regenera limpio al próximo `pnpm build` post-T6.

**Resto del repo** (`packages/`, `scripts/`, `infrastructure/`, `.github/workflows/`, `.env.example`, `*.tfvars*`): 0 matches del literal. Verificado.

---

## 3. Comprometidos en git history (R21 — Opción C aplicada)

7 commits introducen o tocan el literal `Boost***2026` en `main` del repo público `boosterchile/booster-ai` (GitHub). Antigüedad del primero: **3 días 15 horas** al momento de PF-5.1 (2026-05-14T21:00Z). Repo confirmado **PÚBLICO** vía `curl -sI https://api.github.com/repos/boosterchile/booster-ai → HTTP 200 anónimo`. 0 forks detectados por `gh api repos/.../forks`, pero el dato NO captura clones directos, mirrors externos, GitHub Archive (BigQuery export), ni cache de agentes AI.

| # | SHA corto | SHA completo | Timestamp (CLT) | Subject |
|---|---|---|---|---|
| 1 (oldest) | `8400542` | `840054218135dfdddc65c58c44a7195749e03731` | 2026-05-10T23:01:00-04:00 | `feat(demo): seed demo en producción + IMEI espejo (D1)` |
| 2 | `8afe234` | `8afe23471b3323e4560e884893b094c9f4fd5c7e` | 2026-05-10T23:13:09-04:00 | `docs(handoff): sprint nocturno demo features 2026-05-10 → 11` |
| 3 | `03771e9` | `03771e9e413d54bb58a7aaa85b3fbde030644f1f` | 2026-05-10T23:35:17-04:00 | `docs(demo): guía completa de uso del demo con todos los usuarios` |
| 4 | `50671bb` | `50671bb4e85416159e6ad32acf82e5dfeac7dc58` | 2026-05-10T23:48:03-04:00 | `feat(rut+stakeholder): RUT canonical sin puntos + user stakeholder en seed` |
| 5 | `d7085a9` | `d7085a901cb26acb625424dbea1d580475457001` | 2026-05-10T23:55:40-04:00 | `feat: sprint demo features Booster — 12 features end-to-end (#157)` |
| 6 | `7fd623b` | `7fd623bebcbe5bf08beee76fec0253aef67e9085` | 2026-05-13T15:19:10-04:00 | `feat(api): ensureDemoSeeded startup hook` |
| 7 (newest) | `ec86cfd` | `ec86cfd664b3566072cd739a11b203d73e6aff40` | 2026-05-13T15:43:57-04:00 | `feat(demo): subdominio demo.boosterchile.com operativo con 4 personas click-to-enter (#206)` |

**Decisión registrada en spec §9 R21 + ADR-032**: **Opción C** — aceptar compromise permanente del literal en historia git (no se hace `git filter-repo` por costo de coordinación). Mitigación:
- (a) Pre-rotation: **OPS-X password-spray retroactivo** una sola vez contra el universo no-demo (§4 abajo) — captura cualquier abuso ya ocurrido.
- (b) Post-rotation: **OPS-Y monitoring sostenido 90 días** — Cloud Function que dispara alerta SEV-1 a Felipe ante intentos de `signInWithPassword` con el literal contra cuentas no-demo. La auto-disable de cuenta NO está habilitada (R2 safeguard); acción la dispara Felipe tras inspección humana.

---

## 4. Scope OPS-X password spray retroactivo (6 UIDs no-demo)

Universo no-demo del tenant = 10 users totales - 4 demo = **6 cuentas target del spray**. OPS-X corre **una sola vez antes de OPS-1** (la única ventana válida — post-OPS-1 el literal ya no es credencial válida y el spray no detecta nada).

| # | UID | Email | Created | Last login (UTC) | Notas |
|---|---|---|---|---|---|
| 1 | `9iTEKErBinemdNhRK9GGXdr3uxt2` | `contacto@boosterchile.com` | 2026-05-04T21:25:27Z | 2026-05-13T18:43:56Z | Cuenta operacional de Felipe (alias) — bajo riesgo de password-reuse, pero se sprayer igual por completitud. |
| 2 | `eMSaQTM7TbMWpOpTCOwfV7vnvzp1` | `dev@boosterchile.com` | 2026-05-11T04:47:57Z | 2026-05-14T01:39:35Z | Cuenta dev de Felipe — login activo último día. |
| 3 | `1F33HE4oisVIGlGtYopQYWOHa4r2` | `gobe00@gmail.com` | 2026-05-08T10:56:52Z | 2026-05-08T10:56:52Z | Created == lastLogin → registro único, sin actividad subsecuente. Probable user externo de prueba. |
| 4 | `SlEjGxefAXMXcz7pgn98yTBXtB52` | `edio.pinilla@gmail.com` | 2026-05-08T11:48:20Z | 2026-05-08T11:48:20Z | Created == lastLogin, mismo pattern que (3). |
| 5 | `rCY9ZKFbfPWCh6XOJQxkIaUhwxZ2` | `pensando@fueradelacaja.co` | 2026-05-02T15:49:17Z | 2026-05-07T17:12:34Z | Sign-in múltiple, último hace 1 semana. Posible early-access user. |
| 6 | `tBZtLbhurnWyCdTObdMiUKkhllE3` | `fvicencio@gmail.com` | 2026-05-02T04:12:50Z | 2026-05-04T19:11:11Z | Otra cuenta personal de Felipe. |

### 4.1 Procedure OPS-X (referencia para T12a)

```text
para cada UID en {los 6 de arriba}:
  intentar signInWithPassword(email, 'Boost***2026!') vía REST
  esperar 200ms (self-throttle ≤ 5 req/s)
  si response == 200 (auth exitosa):
    → MATCH POSITIVO: pausa H1 entera, NO ejecutar OPS-1
    → R17 incident response: suspender cuenta, force password reset, notificar usuario, registrar incidente
  si response == INVALID_LOGIN_CREDENTIALS / EMAIL_NOT_FOUND:
    → continuar
output: reporte por UID + verdict global (0 matches = continuar; ≥1 match = escalate)
```

### 4.2 Sanity check pre-spray (parte de T12a)

Antes de spray los 6 no-demo, verificar que el literal AÚN funciona contra las 4 demo (`signInWithPassword` debe retornar 200). Si NO retorna 200 contra alguna demo → la rotación ya ocurrió accidentalmente o algo está mal; abortar T12a y diagnosticar antes de continuar.

---

## 5. Configuración esperada post-OPS-1 (input para OPS-Y closure)

Per spec §3 H1.1 + plan v3.1 OPS-Y closure criterio 3:

### 5.1 Secrets en Secret Manager (4 demo + 1 seed = 5 verificables)

| Secret name | Versions esperadas post-OPS-1 | Valor v2+ esperado |
|---|---|---|
| `demo-account-password-shipper` | ≥ 2 (v1 placeholder + v2 real) | Random 32B base64url (no `REPLACE_ME_BEFORE_DEPLOY`) |
| `demo-account-password-carrier` | ≥ 2 | Random 32B base64url |
| `demo-account-password-stakeholder` | ≥ 2 | Random 32B base64url |
| `demo-account-password-conductor` | ≥ 2 | Random 32B base64url |
| `demo-seed-password` | ≥ 2 | Random 32B base64url o uno de los 4 anteriores (decidir en T2) |

### 5.2 `password_rotated_at` en `docs/qa/demo-accounts.md` (post-T10)

| UID | persona | password_rotated_at (esperado tras OPS-1) | Hash truncado |
|---|---|---|---|
| `nQSqGqVCHGUn8yrU21uFtnLvaCK2` | shipper | `<ISO timestamp de OPS-1 execution>` | `<sha256(uid)[:8]>` |
| `s1qSYAUJZcUtjGu4Pg2wjcjgd2o1` | carrier | idem | idem |
| `Uxa37UZPAEPWPYEhjjG772ELOiI2` | stakeholder | idem | idem |
| `Gg9k3gIPa1cJZtgKC0RRkWQ0QHJ3` | conductor | idem | idem |

`docs/qa/demo-accounts.md` (creado por T10) tendrá una entry por UID con este campo + comandos de renovación de TTL + comandos de re-rotation manual.

### 5.3 Criterio de cierre OPS-Y (90 días post-deploy)

Verificación automatizable vía `infrastructure/scripts/verify-ops-y-closure.ts` (OOB-9):
1. `security.password_spray.matches_total = 0` en ventana 90d sliding window.
2. `grep -E "password_rotated_at:" docs/qa/demo-accounts.md` retorna **4 líneas** con timestamps válidos.
3. Para cada uno de los 5 secrets de §5.1: `gcloud secrets versions list --secret=<name> --format='value(state)' | grep ENABLED | wc -l ≥ 2` AND `gcloud secrets versions access latest --secret=<name>` ≠ `REPLACE_ME_BEFORE_DEPLOY`.

Si los 3 verifican → archivar OPS-Y, cerrar ADR-032 con "monitoreo archivado en `<fecha>`".

---

## 6. Anti-pattern y aprendizajes para post-mortem

Documentado acá para que la lección sobreviva al cierre del feature:

1. **Password literal compartido en seed**: 4 cuentas (3 owners + 1 conductor) terminaron con el mismo password `Boost***2026!` literal porque (a) `seed-demo.ts:86` lo declara como constante, (b) `seed-demo-startup.ts:142` lo duplica inline. Lesson: secrets compartidos en código → 1 leak compromete N cuentas. OOB-5 actualiza `references/security-checklist.md`.

2. **Seed corre en cold-start sin gate adicional**: `apps/api/src/index.ts:11` importa `ensureDemoSeeded()` y se invoca incondicionalmente al levantar el API si `DEMO_MODE_ACTIVATED=true`. Race condition con rotation manual era inevitable hasta el retool H1 (orden H1.0 → H1.4 → H1.1).

3. **`is_demo` claim presente pero sin policy enforcement**: las 4 cuentas tienen `is_demo=true` desde 2026-05-12, pero ningún endpoint write del API verifica el claim hoy. T8 + T9.x cierra esto.

4. **Repo público sin redaction enforcement**: gitleaks no estaba bloqueando el commit del literal; CI rule queda como OOB-1.

---

## 7. Trazabilidad de este inventory

- Outputs literales de PF-1, PF-5, PF-5.1 → spec §13 decision log entry 2026-05-14T21:00Z.
- Comandos ejecutados verificables:
  - PF-1: `grep -rEn "^\s+app\.(post|put|patch|delete)\(" apps/api/src/routes --include='*.ts'`
  - PF-5: `POST identitytoolkit.googleapis.com/v1/projects/booster-ai-494222/accounts:query`
  - PF-5.1: `grep -nE "demo|drivers\+|BoosterDemo|DEMO_" apps/api/src/services/{activation-pin,clave-numerica,seed-demo*}.ts apps/api/src/routes/{auth-driver,demo-login}.ts apps/web/src/routes/login-conductor.tsx`
  - Git history: `git log --all -S "Boost***2026" --format='%H | %aI | %s' --no-merges`
- Snapshot raw del tenant Firebase guardado en `/tmp/_t1_fresh.json` (efímero, no commiteado).
- Próxima revisión: PF-5 se re-ejecuta antes de OPS-1 (es parte del pre-condition de OPS-1 en plan v3.1).
