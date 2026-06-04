# Spec: sec-001-h1-2-google-boundary-closure (cerrar el residual Google self-signup en el boundary + reaper de cuentas inertes)

> ## v2 — re-centrado 2026-06-04 (resuelve devils-advocate Round 1; el vector vivo fue mitigado por el hotfix)
> El **P0-1** del DA Round 1 (que `POST /empresas/onboarding` auto-provisiona un token no aprobado a `dueño` activo sin gate) **fue cerrado** por el hotfix `sec-001-empresa-onboarding-gate-hotfix`: `EMPRESA_SELF_ONBOARDING_ENABLED` tiene **default de código `false`** (`config.ts:502`) y **no está seteado en prod** → self-serve onboarding **deshabilitado**, con doble defensa: route-level (`empresas.ts:53` → 403) + invariante de servicio (`onboarding.ts` → `SelfOnboardingDisabledError` si `authorizedBy='self_service' && !selfServiceEnabled`). **Verificado en prod 2026-06-04** (booster-ai-api: flag unset → default false). El **PO eligió proceder** con Stream A (este spec) el 2026-06-04. La **restauración del self-serve gateado** es **Stream B** (`_followups/onboarding-flow-redesign.md`) y queda **fuera de scope** acá. Esta v2 incorpora también las exigencias P0-2/P1-1/P1-2/P1-3/P2 del DA (ver §"Resolución DA Round 1" + `review.md`).

- **Author**: Felipe Vicencio (with agent-rigor)
- **Date**: 2026-05-29 (v1) · **2026-06-04 (v2 re-centrado)**
- **Status**: **Draft v2 — DA Round 2 = APPROVE_WITH_RESERVATIONS (2026-06-04). Lista para `/plan`** con OQ-G1/G3/G6 como gates pre-`/build`. (Bloqueante P0-1 verificado cerrado en prod; P0-2/P1/P2 + 2 objeciones de R2 incorporadas como criterios.) Pendiente: confirmación PO para transición a PLAN.
- **Linked**:
  - Parent: [`.specs/sec-001-cierre/spec.md`](../sec-001-cierre/spec.md) §3 SC-1.2.2 (Google leg = `TRACKED_RESIDUAL` → este spec lo lleva a `MET`)
  - **Mitigación P0-1**: [`.specs/sec-001-empresa-onboarding-gate-hotfix/`](../sec-001-empresa-onboarding-gate-hotfix/) (self-serve onboarding OFF)
  - **Stream B (fuera de scope)**: [`.specs/_followups/onboarding-flow-redesign.md`](../_followups/onboarding-flow-redesign.md) (restaurar self-serve gateado)
  - Decisión: [`.specs/sec-001-h1-2-google-blocking-c/alt-d-vs-g-comparison.md`](../sec-001-h1-2-google-blocking-c/alt-d-vs-g-comparison.md) (PO eligió Alternativa G + reaper)
  - Enfoque superseded: [`.specs/sec-001-h1-2-google-blocking/`](../sec-001-h1-2-google-blocking/) (`-a`/`-b`/`-c`) — toda la dirección blocking-function
  - ADR a superseder: [`docs/adr/054-google-blocking-function-signup-gate.md`](../../docs/adr/054-google-blocking-function-signup-gate.md) (precedente de supersede: ADR-056)
  - Boundary: `apps/api/src/middleware/user-context.ts:51-56` (404 `user_not_registered`)
  - DA Round 1: [`review.md`](./review.md)

## 0. Context

Sprint 2c construyó una blocking function `beforeCreate` para frenar self-signups Google no autorizados. Quedó **abandonada** (Gen 1 muerto por deprecación; Gen 2 requiere un spike no verificado y mutante de prod). El PO eligió **Alternativa G**: consolidar la autorización en el boundary ADR-001 + un reaper de higiene, sin Cloud Function ni Gen2.

**Corrección clave de la v1 (DA Round 1, P0-1)**: la premisa "el boundary YA enforcea la admisión en todas las rutas" era **falsa** — `/empresas/onboarding` está deliberadamente fuera de `userContextMiddleware` y `onboardEmpresa` auto-provisionaba un `dueño` activo sin gate de aprobación. Eso **no es inerte**: era una promoción de privilegio. **Ese vector fue cerrado por el hotfix** (self-serve OFF por flag default-false + invariante de servicio). Por lo tanto:

- La admisión hoy se enforcea por **dos capas reales**: (a) el boundary `userContext` (404 para tokens sin fila `users`) en rutas de negocio, y (b) el gate de self-serve onboarding (OFF) que impide la única ruta de auto-promoción.
- Este sprint **audita y endurece** esa enforcement (audit sistemático + harness CI default-deny), agrega el **reaper** de higiene para las cuentas IdP inertes, **decomisa** los artefactos de la blocking function, supersede ADR-054, y transiciona SC-1.2.2 → `MET`.
- "MET" significa: **no queda ningún camino de self-signup-a-cuenta-activa abierto** (no que el self-serve onboarding funcione — eso es Stream B).

## 1. Objective

Cerrar el residual SEC-001 H1.2 (Google) por: (a) **auditar y endurecer** el boundary para que toda ruta de negocio niegue acceso a cualquier usuario autenticado-pero-no-provisionado, respaldado por un **harness CI default-deny** que falle el build si una ruta nueva monta sin clasificar; (b) un **reaper fail-safe** que remueva cuentas IdP inertes (sin fila `users`, no pending/approved, añejas) con guardas anti-borrado-de-legítimos; (c) **decomisar** los artefactos de la blocking function; (d) superseder ADR-054; (e) transicionar el residual a `MET`.

## 2. Why now

El leg Google es el último vector abierto de SEC-001 H1.2. La blocking function está muerta/no-verificada; el vector de auto-promoción ya está cerrado por el hotfix; el boundary enforcea el resto. Cerrarlo ahora elimina la deuda del path Gen2 no probado. PO decidió proceder 2026-06-04.

## 3. Success criteria

- [ ] **SC-G1 (auditoría de boundary — reframe P0-1)**: auditoría enumerada de **todos** los route groups en `server.ts`. Cada ruta de negocio se clasifica **ENFORCED** (exige fila `users` vía `userContext`/membership), **INTENTIONAL-OPEN**, **GATED-CLOSED** o **GAP-FIXED**. `INTENTIONAL-OPEN` se define **estrictamente** (P2-1): *"no sirve datos ni otorga privilegio sin un check in-handler de aprobación/allowlist/flag"*. `/empresas/onboarding` clasifica **GATED-CLOSED** (self-serve OFF por flag + invariante de servicio), NO GAP.
  > ⚠️ **DA Round 2 — `/me` NO es read-only**: escribe (account-linking `me.ts:79-83` reescribe `firebaseUid`; **auto-provision platform-admin** `me.ts:102-123` INSERTa `users` con `isPlatformAdmin:true`). El INSERT admin está **gateado por la allowlist `BOOSTER_PLATFORM_ADMIN_EMAILS`** (`config.ts:611`, default vacío → un self-signup arbitrario NO lo dispara). Clasificar `/me` como **GATED-CLOSED (allowlist + email match)**, no "INTENTIONAL-OPEN read-only", o la auditoría shippea un error factual. Cualquier ruta de negocio en bare `firebaseAuth` sin requerir fila `users` y sin gate = **GAP** a corregir. Deliverable: `route-boundary-audit.md` con grupo, cadena de middleware y veredicto.
- [ ] **SC-G1b (harness CI default-deny — P1-1)**: un check CI que enumera **cada** ruta montada y asserta que es `userContext`-wired **o** está en un `ONBOARDING_OR_PUBLIC_ALLOWLIST` explícito y revisado, con **rationale por entrada**; **falla el build** cuando aparece un mount nuevo sin clasificar. Reemplaza el backstop creation-time por una invariante de wiring durable.
  > ⚠️ **DA Round 2 — el patrón citado NO alcanza.** `check-is-demo-wire-completeness.ts:43-80` escanea **solo `app.use('/path', …)`** (regex), y NO ve `app.route()` ni los **sub-mounts `<router>.route()`** — que es exactamente donde viven las rutas privilegio-relevantes fuera de userContext: `meRouter.route('/consents', …)` (`server.ts:304`) y `meRouter.route('/', …clave-numerica)` (`server.ts:309`). SC-G1b **debe extender** el harness para enumerar `app.use`, `app.route()` **y** `<router>.route()` sub-mounts; si no, da falsa cobertura justo en la clase de ruta del riesgo.
- [ ] **SC-G2 (clasificación de cuentas existentes)**: las cuentas IdP Google existentes — **regeneradas contra el estado IdP ACTUAL en `/plan`** (DA R2-N2: NO heredar el `ghost-users-dry-run.csv` viejo, que vive en `sec-001-h1-2-google-blocking-b/`, dir del enfoque superseded; sería un snapshot stale para una decisión destructiva) — cruzadas contra `users` + `solicitudes_registro` → LEGITIMATE/PENDING/INERT. El PO registra decisión por cada INERT, **auditable** (timestamp + rationale + reversibilidad). Ninguna LEGITIMATE (incl. `dev@boosterchile.com`) entra en scope del reaper. Deliverable: `existing-google-accounts-classification.md`.
- [ ] **SC-G3 (predicado del reaper — endurecido P0-2)**: una cuenta IdP es reapable **solo si TODO**: (1) **no existe fila `users` por `firebase_uid` NI por email** (dual-guard — cierra la race de account-linking de `/me`); (2) no hay fila `solicitudes_registro` con `estado IN ('pendiente_aprobacion','aprobado')` por email; (3) `creationTime` más viejo que `REAPER_GRACE_DAYS`; (4) **`lastSignInTime`** también más viejo que el grace (una cuenta activa sin linkear está casi seguro mid-onboarding). Tests: legitimate-by-uid, legitimate-by-email-mismatch-uid, pending, approved-transitional, inert-aged, inert-within-grace, lastSignInTime-within-grace, **+ los de normalización que defina OQ-G6**.
  > ⚠️ **DA Round 2 — el match de email NO puede asumir un `normalizeEmail` canónico único: no existe.** Verificado: `me.ts:66` (account-link) y `onboarding.ts:127` comparan **email crudo**; `signup-request.ts:52` guarda **lowercase+trim**; `auth-blocking-functions/src/email-normalize.ts:42` hace NFC+IDN **pero NO colapsa dots/plus-tags**. Las filas `users.email`/`solicitudes` **nunca se guardaron en forma canónica**, así que buscar por una forma canónica que el dato no tiene → **false-positive reap**. **OQ-G6 (bloqueante /build)**: decidir entre (a) extraer un normalizador compartido real **+ backfill** de `users.email`/`solicitudes`, o (b) que el reaper matchee con **la MISMA forma degradada con que se guardó** (lowercase+trim) y dropear las claims NFC/IDN/plus-tag. Nota de coupling: el normalizador de `email-normalize.ts` vive en el package que SC-G7 archiva → si se reusa, extraerlo a un package vivo primero.
- [ ] **SC-G4 (fail-safe + listado IdP — P0-2)**: el reaper (a) **lista desde el IdP** vía Admin SDK `listUsers` **paginado (1000/página)** con test de tenant >1000; (b) **dry-run por default**, modo destructivo tras flag explícito; (c) **disable-before-delete** (decisión, no OQ): primero `auth.updateUser(uid,{disabled:true})` reversible + segundo grace antes de delete; (d) **hard-guard**: rehúsa actuar si existe fila `users` por uid **o** por email normalizado, aunque otras condiciones matcheen; (e) logs estructurados (`signup.reaper.candidate`/`.disabled`/`.deleted`) + counter Cloud Monitoring; (f) primer run productivo dry-run con sign-off PO.
- [ ] **SC-G5 (scheduling)**: reaper vía Cloud Scheduler + Terraform (patrón `demo-account-ttl-alerter`), cadencia documentada.
- [ ] **SC-G6 (ADR)**: superseder/anotar ADR-054 con un ADR nuevo (precedente ADR-056): blocking function abandonada, admisión en el boundary, reaper de higiene. Cross-ref lessons-learned Gen1-vs-Gen2.
- [ ] **SC-G7 (decomiso — endurecido P1-3)**: remover/archivar los artefactos blocking-function con `terraform plan` limpio **en CADA entorno (dev/staging/prod)** (la wire `blocking_functions` "nunca aplicada" puede driftar por-entorno). Enumerar explícitamente qué va por `state rm` vs `destroy`; verificar que **ningún IAM binding removido sea referenciado** por un recurso no-blocking-function; enumerar la monitoring infra (no "la que solo servía…" — listarla). **Archivar** `apps/auth-blocking-functions` (tag/`docs/archive/`), no borrar (es la referencia deny-pure del invariante). Targets: `apps/auth-blocking-functions/`, `infrastructure/auth-blocking-functions.tf`, `auth-blocking-functions-monitoring.tf`, la wire `blocking_functions` en `identity-platform.tf`, el deploy lane + `_AUTH_BLOCKING_DEPLOY` en `cloudbuild.production.yaml`.
- [ ] **SC-G8 (cierre del residual — gated P0-1)**: `sec-001-cierre` §3 SC-1.2.2 transiciona `TRACKED_RESIDUAL → MET` **solo cuando**: self-serve onboarding OFF (verificado) + SC-G1 audit sin GAP + SC-G1b harness activo + reaper desplegado. "MET" = no queda path self-signup→activa abierto. Cierra el followup `sprint-2c-google-blocking-function.md` con puntero acá.
- [ ] **SC-G9 (coverage/stack)**: ≥80% en el código nuevo del reaper; `@booster-ai/logger` + Zod + OTel per booster-stack-conventions.

## 4. User-visible behaviour

- **Usuario Google autorizado** (con fila `users`): sin cambios — login Google, acceso completo.
- **Usuario Google no autorizado** (sin fila `users`): puede completar `signInWithPopup` (se crea cuenta IdP inerte) pero **toda ruta de negocio → 404 `user_not_registered`** (cero acceso), y **no puede auto-promoverse** (`/empresas/onboarding` self-serve OFF → 403/`SelfOnboardingDisabledError`). Tras grace sin aprobación, el reaper la deshabilita y luego borra. Sin cambio visible salvo la limpieza eventual.
- **Usuario pending-approval**: sin afectar (reaper excluye `pendiente_aprobacion`).
- **Onboarding self-serve**: **OFF** (pilotos provisionados a mano). Su restauración gateada es **Stream B**, no este sprint.
- Sin cambio al leg email/password (self-signup OFF desde Sprint 2b).

## 5. Out of scope

- **Restaurar el self-serve onboarding gateado** (Stream B / `onboarding-flow-redesign`): el 409 approve↔onboarding, el email notifier real, el flip de flags, el `login.tsx` con signup huérfano. **Explícitamente diferido.**
- La blocking function / Gen1 / Gen2 (abandonada; este spec la decomisa).
- El leg email/password (Sprint 2b).
- SEC-001 H1.5 (forensics) y H1.6 (demo reactivation).
- Migrar usuarios Google existentes (era Alternativa D, no elegida).
- Cambios a `approveSignupRequest`/Admin SDK provisioning (el path legítimo).

## 6. Constraints

- **C-G1**: ADR-001 JWT Zero-Trust es la única capa de autorización; no se introduce mecanismo paralelo.
- **C-G2 (seguridad destructiva)**: el reaper toca cuentas IdP **de prod** → fail-safe: dry-run default, hard-guard `users` por uid+email, grace, audit trail, **disable-before-delete**, sign-off PO antes del primer run destructivo.
- **C-G3 (grace ≥ latencia real — reframe P1-2)**: `REAPER_GRACE_DAYS` se ata a la **latencia de onboarding observada** (no a una SLA imaginada). Protege sobre todo a la población "self-signup sin solicitud"; justificar el valor contra datos, no contra una SLA inexistente.
- **C-G4 (IaC)**: scheduler + decomiso 100% Terraform; cero cambios out-of-band.
- **C-G5 (PII)**: logs del reaper con email hasheado (SHA-256) per Ley 19.628.
- **C-G6 (cooling-off)**: solo-dev REVIEW/SHIP cooling-off aplica; sin waiver.
- **C-G7 (normalización pinned)**: el dual-guard y el match de solicitudes usan **un único** `normalizeEmail` compartido (mismo que approve + email-normalize); testeado cross-normalization.

## 7. Approach

1. **Auditoría de boundary (read-only, primero)** + **harness default-deny** — enumerar cada `app.use`/`app.route`; clasificar; corregir GAPs; instalar el check CI (SC-G1 + SC-G1b). Gatea todo.
2. **Clasificación de cuentas existentes** (SC-G2) — read-only + decisión PO; gatea el primer run destructivo.
3. **Reaper** (SC-G3/G4) — predicado endurecido (dual-key, normalización pinned, lastSignInTime, paginación IdP), dry-run + disable-before-delete; unit-tested.
4. **Scheduling** (SC-G5) — Cloud Scheduler + Terraform.
5. **ADR** (SC-G6) — antes del código del reaper ("ADR before code").
6. **Decomiso** (SC-G7) — per-entorno, dependency-safe, archivar fuente.
7. **Cierre del residual** (SC-G8).

**Sequencing `/plan`**: (1) audit+harness y (2) classification son read-only y gatean; (3-4) reaper es el core nuevo; (6) decomiso independiente, en paralelo una vez el reaper cubre higiene.

## 8. Alternatives considered

- **G + reaper (este spec)** — elegida por PO. + **gate de onboarding** (P2-2): el hotfix ya hizo la versión mínima (self-serve OFF); la restauración gateada completa es Stream B.
- **D — remover provider Google** — rechazada (lockout de 5 usuarios incl. PO).
- **G sin reaper** — rechazada (cuentas inertes indefinidas).
- **Gen 2 blocking-function** — rechazada (spike no verificado).
- **Gen 1 / ticket GCP** — rechazada (deprecación permanente).

## 9. Risks and mitigations

| Risk | L | I | Mitigación |
|---|---|---|---|
| **R-G1**: reaper borra cuenta LEGITIMATE | L | **Crit** | hard-guard `users` por uid+email + dry-run + SC-G2 + sign-off + disable-before-delete + audit |
| **R-G2**: audit pierde una ruta en bare token | M | H | enumeración total (SC-G1) **+ harness CI default-deny (SC-G1b)** que falla el build en mounts nuevos |
| **R-G3**: pending reapado mid-approval | L | H | excluye `pendiente/aprobado` + grace > latencia (C-G3) |
| **R-G4**: decomiso rompe build/deploy | M | M | grep refs + `terraform plan` per-entorno + archivar fuente |
| **R-G5**: 2 `@gmail.com` externos son prospects | M | M | SC-G2 PO clasifica antes; default LEGITIMATE si dudoso |
| **R-G6 (re-rateado DA R2 — N1)**: cuentas inertes repobladas de continuo | **M** (no Low: es el flujo normal) | M | el botón "Continuar con Google" (`login.tsx:289-293` → `signInWithPopup`) **sigue vivo en prod durante Stream A** → cada click crea una cuenta inerte. Es coherente con el diseño (boundary 404 + reaper limpia), NO es escalada de privilegio, pero el reaper corre contra una población **activamente repoblada** hasta que Stream B re-diseñe el flujo. Mitiga: reaper + rate-limit/Cloud Armor + alerta de volumen. **Documentar explícito que el botón Google queda vivo durante Stream A.** |
| **R-G7 (P2-2)**: reaper revoca sesión activa de cuenta legítima mal-matcheada | L | M | dual-guard uid+email + lastSignInTime guard + disable-before-delete (reversible) |
| **R-G8 (P2-2)**: provider-agnostic + cuenta sin email (phone/SAML) matchea predicado (2) trivialmente | M | M | exigir email presente + match users/solicitudes; o filtrar Google-only (OQ-G3) |

## 10. Test list

- T1: INERT + aged + lastSignIn aged + sin users (uid+email) + sin pending/approved → reapable (dry-run).
- T2: fila `users` por **uid** → NUNCA reapada (hard-guard).
- **T2b: fila `users` por email (uid distinto, post account-linking) → NUNCA reapada** (dual-guard, cierra race `/me`).
- T3: `estado='pendiente_aprobacion'` → no reapada.
- T4: `estado='aprobado'`, users row aún no creada → no reapada.
- T5: inert pero dentro de grace (creationTime) → no reapada.
- **T5b: lastSignInTime dentro de grace → no reapada.**
- T6: dry-run default no escribe; flag destructivo requerido.
- T7: logs con email hasheado (PII).
- T8: token no provisionado → 404 en una ruta representativa **por grupo** (de la auditoría).
- T9: `terraform plan` post-decomiso en dev/staging/prod → sin destroys inesperados.
- T10: ADR + transición del residual presentes y consistentes.
- **T11 (P0-2): cross-normalization (Foo@x.cl/foo@x.cl, plus-tags, IDN) — el match usa el normalizeEmail pinned.**
- **T12 (P0-2): tenant >1000 cuentas → listado IdP paginado completo (sin orphans).**
- **T15 (P1-1): harness falla el build ante un `app.route` mount nuevo sin clasificar.**

## 11. Rollout

- **Flag**: modo destructivo del reaper tras flag; dry-run default.
- **Migración**: ninguna (decomiso es remoción de infra/código).
- **Rollback**: disable del Cloud Scheduler (reaper para); decomiso es revert normal; cuentas disabled restaurables (`disabled:false`).
- **Monitoring**: counter del reaper + alerta de volumen anómalo; review manual 24h post primer run destructivo.
- **Gate `/build`**: SC-G1 audit + SC-G1b harness completos; SC-G2 + decisión PO; ADR escrito.
- **Gate primer run destructivo**: dry-run revisado + sign-off PO.

## 12. Open questions

- **OQ-G1 (reframe P1-2)**: `REAPER_GRACE_DAYS` — atar a latencia de onboarding **observada** (no SLA imaginada). Propuesta 30d justificada contra la población "self-signup sin solicitud". Resolver con datos antes de `/build`.
- **OQ-G2 → DECIDIDA**: **disable-before-delete** (reversible + segundo grace). Ya no abierta (P0-2 lo exige).
- **OQ-G3**: scope del reaper — **decisión propuesta**: exigir **email presente + dual-match** (evita falsos positivos phone/SAML sin email, R-G8); confirmar que ningún provider legítimo crea cuentas sin fila `users`. Si hay duda, filtrar Google-only.
- **OQ-G4 → resuelta** por SC-G2.
- **OQ-G5 → DECIDIDA**: **archivar** `apps/auth-blocking-functions` (no borrar) — referencia deny-pure (P1-3).
- **OQ-G6 (NUEVA, DA R2, bloqueante /build)**: normalización de email del reaper — (a) extraer normalizador compartido real + **backfill** de `users.email`/`solicitudes`, o (b) matchear con la forma degradada efectivamente guardada (lowercase+trim) y dropear claims NFC/IDN/plus-tag. Resolver en `/plan`. (Ver SC-G3.)

## 13. Resolución DA Round 1 (mapa para Round 2)

| Finding | Resolución en v2 |
|---|---|
| **P0-1** (onboarding auto-promueve sin gate) | **Mitigado por hotfix** (self-serve OFF, flag default-false + invariante servicio; verificado prod). SC-G1 reframeado (`/empresas/onboarding` = GATED-CLOSED). SC-G8 gated en self-serve-OFF. Restauración gateada = Stream B (out of scope). |
| **P0-2** (reaper uid↔email split / race / pagination) | SC-G3 dual-guard uid+email + normalizeEmail pinned + lastSignInTime; SC-G4 listado IdP paginado + disable-before-delete decidido; T2b/T5b/T11/T12 agregados. |
| **P1-1** (regresión defense-in-depth) | **SC-G1b harness CI default-deny** (nuevo) + R-G2 actualizado + T15. |
| **P1-2** (grace sin SLA) | C-G3 + OQ-G1 reframeados a latencia observada. |
| **P1-3** (decomiso destructivo) | SC-G7 endurecido: `terraform plan` per-entorno, state-rm vs destroy enumerado, IAM-reuse check, archivar fuente. |
| **P2-1/P2-2** (SC inmensurables / riesgos faltantes) | INTENTIONAL-OPEN definido; SC-G2 auditable; R-G7/R-G8 agregados; "gate onboarding" en §8. |

## 14. Decision log

- **2026-05-29 (v1)** — Spec creado tras elección PO de Alternativa G + reaper. DA Round 1 → **DO_NOT_APPROVE** (P0-1: onboarding auto-promueve).
- **2026-06-04 (v2)** — Re-centrado: P0-1 **mitigado por el hotfix** (self-serve OFF, verificado en prod: `EMPRESA_SELF_ONBOARDING_ENABLED` default-false, unset). PO eligió proceder con Stream A (restauración gateada = Stream B, fuera de scope). Incorporados P0-2/P1-1/P1-2/P1-3/P2 como criterios (SC-G1 reframe, SC-G1b nuevo, SC-G3/G4 endurecidos, SC-G7 per-entorno, riesgos R-G7/G8). OQ-G2 (disable-before-delete) y OQ-G5 (archivar) **decididas**; OQ-G1 (grace) y OQ-G3 (scope provider) para `/plan`.
- **2026-06-04 (DA Round 2)** — Veredicto **APPROVE_WITH_RESERVATIONS** (vs DO_NOT_APPROVE en R1). P0-1 verificado cerrado en prod (flag default-false unset; único caller de `onboardEmpresa` gateado; sin path `admin_provisioned`; rutas hermanas fail-closed por `firebase_uid`). **2 objeciones fuertes incorporadas** (no eran cierre real en v2): (1) el "normalizeEmail único pinned" NO existe — 3 normalizadores divergentes + `users.email` guardado sin canonicalizar → **OQ-G6** + SC-G3 reframe + T11 corregido; (2) SC-G1b no veía `<router>.route()` sub-mounts → SC-G1b extendido. + reclasificación de `/me` (escribe, GATED-CLOSED por allowlist), R-G6 re-rateado (N1: botón Google vivo repuebla inertes en Stream A), SC-G2 regenera contra IdP actual (N2). **Residuales a aceptar/documentar**: drift TF per-entorno (probable solo en /plan), arbitrariedad del grace para población sin-solicitud (OQ-G1 con datos). **Estado: lista para `/plan`** (con OQ-G1/G3/G6 como gates pre-`/build`). Review completo en `review.md` §Round 2.
