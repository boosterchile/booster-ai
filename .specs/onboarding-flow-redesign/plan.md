# Plan: onboarding-flow-redesign

- Spec: .specs/onboarding-flow-redesign/spec.md (Status: Approved v2)
- Created: 2026-06-08
- Status: Approved (v2) — 2026-06-08 PO. BUILD Fase 1 en progreso.
- **Programa fraseado.** Fase 1 (núcleo dueño) en tareas atómicas; Fases 2-5 perfiladas (cada una se descompone + corre su propio devils-advocate al llegar).

## Decisión de diseño del plan (cierra P0-4 del review)
Todo el comportamiento nuevo de Fase 1 vive detrás del flag **`ADMIN_PROVISIONED_ONBOARDING_ENABLED` (default OFF)**. Con el flag OFF, `approve` mantiene el comportamiento viejo (precrea el row) y el sistema queda **deployable en cada commit**; con ON, emite token + no precrea. Así ningún commit intermedio deja aprobados en limbo, y el rollback es **flip de flag**, no revert coordinado. El flip a ON ocurre solo cuando T1.1–T1.8 están verdes.

## Módulos tocados (Fase 1, ≤10)
1. `apps/api/drizzle/` (migración: estado de token **+ `firebase_uid`** en `solicitudes_registro`)
2. `apps/api/src/db/schema.ts`
3. `apps/api/src/services/onboarding-token.ts` (nuevo: firmar/verificar)
4. `apps/api/src/services/signup-request.ts` (approve: token + firebase_uid + no-precrea, gateado)
5. `apps/api/src/services/onboarding.ts` (acepta + consume token atómicamente)
6. `apps/api/src/routes/empresas.ts` (route gateado)
7. `apps/api/src/config.ts` (flag)
8. `apps/api/src/routes/me.ts` (test del camino Google)
9. `apps/api/scripts/check-route-default-deny.ts` (ADR-057)
10. job de limpieza de huérfanos

---

## FASE 1 — Núcleo dueño (destraba el 409; prerrequisito de todo)

### T1.1 — Migración: estado de token + `firebase_uid` en `solicitudes_registro` [DONE 2026-06-08]
- Files: `drizzle/0040_solicitudes_onboarding_token.sql`, `meta/_journal.json`, `db/schema.ts`
- **Evidencia**: columnas `token_hash`/`consumido_en`/`expira_en`/`firebase_uid` (todas nullable) + índice único parcial `solicitudes_registro_token_hash_uq WHERE token_hash IS NOT NULL`. typecheck ✓; biome ✓; unit test importando schema ✓ (Drizzle construye tabla+índice en import). **Apply contra Postgres real: NO ejecutable localmente** (libpq sin binario `postgres`, sin docker) → se valida en CI integration (testcontainers) + al startup vía `migrator.ts`. SQL aditiva, estructuralmente idéntica a 0039.
- LOC: ~70 — **waiver: SQL+schema**.
- Depends: none
- Acceptance: columnas `token_hash`, `consumido_en`, `expira_en`, **`firebase_uid`** (nullable). Migración aplica; schema coincide (gate drift). El `firebase_uid` es lo que permite a T1.7 identificar el huérfano (review P0-5).
- Rollback: revert (drop columnas).

### T1.2 — Lib `onboarding-token` (firmar + verificar; expiración = control de acceso) [DONE 2026-06-08]
- Files: `services/onboarding-token.ts` + `.test`
- **Decisión PO**: panel de diseño recomendó token opaco+sha256 sin secreto (95/100) vs HMAC firmado (58/100); **PO eligió HMAC firmado** con secreto env (respeta plan/spec aprobados + ADR-001). Registrado en ledger (`design_decision T1.2`).
- **Evidencia**: `createOnboardingToken`/`verifyOnboardingToken`/`hashOnboardingToken` puras (secreto + `now` inyectados). Firma HMAC-SHA256 verificada ANTES de payload/exp; `timingSafeEqual`+length-guard; fail-closed si secreto <32 bytes; nunca lanza ante token atacante. El env `ONBOARDING_TOKEN_SIGNING_SECRET` lo cablea T1.3.
- **Review adversarial** (3 agentes + triage, `wf_8db4795c-481`): veredicto go-with-fixes. Bloqueante real confirmado = **maleabilidad del tag base64url** (varias cadenas decodifican a los mismos bytes → `token_hash` no 1:1). Fixes aplicados: guard de canonicalidad (tag + payload), doc corregido (consumo por `sid` firmado, no por hash recomputado), + endurecimiento (cota de tamaño, `sid` uuid, boundary del secreto). TDD final **21/21**, coverage 97.87%/**100%**/100%. Rechazados 3 falsos positivos (maleabilidad no es bypass vivo bajo consumo-por-sid; "caller sin escribir" = layering correcto; split expired/invalid = señal del reaper).
- LOC: ~90
- Depends: none
- Acceptance (SC2): `create`/`verify` (firma con nonce + `expira_en`); verify rechaza inválido/expirado. Unit puro. Firma con secret de Secret Manager. (La expiración acá es **rechazo de acceso**, distinta de la higiene del huérfano de T1.7 — review P1-3.)
- Rollback: eliminar lib.

### T1.4 — Flag `ADMIN_PROVISIONED_ONBOARDING_ENABLED` (kill-switch, default OFF) [DONE 2026-06-08]
- Files: `config.ts` + `test/unit/admin-provisioned-onboarding-flag.test.ts`
- **Evidencia**: `booleanFlag(false)` junto a (pero independiente de) `EMPRESA_SELF_ONBOARDING_ENABLED`. TDD rojo→verde (4/4): default OFF, `=true`/`=false` por env, independiente del self-service viejo. typecheck ✓.
- LOC: ~20
- Depends: none
- Acceptance (SC3): `booleanFlag(false)`, separado de `EMPRESA_SELF_ONBOARDING_ENABLED`. Va **antes** que T1.3 (que lo consume).
- Rollback: revert.

### T1.3 — `approve`: token + `firebase_uid` + no-precrea, **gateado por el flag** [DONE 2026-06-08]
- Files: `services/signup-request.ts` + `.test` (+ wiring: `config.ts`, `notifications/signup-request-email.ts`, `routes/admin-signup-requests.ts`)
- **Evidencia**: `approveSignupRequest` recibe opcional `adminProvisionedOnboarding{signingSecret,ttlMs}`. **Presente (flag ON)**: emite token, UPDATE `estado=aprobado`+`token_hash`+`expira_en`+`firebase_uid`, **NO precrea `users`**, pasa token al notify, `return {approved, firebaseUid, userId:null, onboardingToken}`. **Ausente (flag OFF)**: comportamiento viejo (precrea). Conserva `already_processed` (race). Config: `ONBOARDING_TOKEN_SIGNING_SECRET` (opcional, `min(32)`) + `ONBOARDING_TOKEN_TTL_HOURS` (default 72, OQ1 ratificable). Notifier: `onboardingToken` **redactado en logs** (`onboardingTokenIssued` bool). Route: wiring fail-closed (flag ON sin secreto → 503), token **nunca** en la respuesta al admin. TDD servicio **6/6** + route test sin regresión (17/17 combinado), typecheck+biome ✓.
- LOC: ~95
- Depends: T1.1, T1.2, T1.4
- Acceptance (SC1, T1): con flag ON, `approveSignupRequest` emite token, persiste `token_hash`+`expira_en`+**`firebase_uid`** del user Admin-SDK, marca `aprobado`, NO precrea `usuarios`, pasa token al notify. **Con flag OFF mantiene el comportamiento viejo** (precrea). Conserva `already_processed_race`.
- Rollback: **flip de flag a OFF** (no revert). (cierra review P0-4/P1-4)

### T1.5a — `onboardEmpresa` acepta + consume el token atómicamente (service core) [DONE 2026-06-08]
- Files: `services/onboarding.ts` + `test/unit/onboarding-service.test.ts` + `test/integration/onboarding-token-consume.integration.test.ts`
- **Evidencia**: nuevo opt `onboardingTokenConsumption{solicitudId,tokenHash}`. Como **paso 0** de la transacción, consume atómico `UPDATE solicitudes_registro SET consumido_en=now() WHERE id=? AND token_hash=? AND consumido_en IS NULL AND expira_en > now() RETURNING` — 0 filas ⇒ `OnboardingTokenNotConsumableError` ⇒ rollback total. `admin_provisioned` sin consumo ⇒ `OnboardingTokenRequiredError` (sin tocar DB). Localiza por **`sid` FIRMADO + `token_hash`** (review T1.2) + no-expirado (clock DB). Uniforme (sin oráculo). Unit **26/26** (consume/no-consumible/requerido/self_service-no-consume). **Concurrencia** (doble consumo → uno gana) + expirado + hash-mismatch en integration test (raw SQL, **corre en CI/testcontainers**; no ejecutable local: libpq sin server). typecheck (co-locados)+biome ✓. Suite unit completa 1441/0.
- LOC: ~90
- Depends: T1.1, T1.2
- Acceptance (SC1/SC2, T2/T3c/d): nuevo parámetro de consumo; dentro de la transacción, consume el token con **`UPDATE solicitudes_registro SET consumido_en=now() WHERE id=? AND consumido_en IS NULL RETURNING`** (patrón atómico ya usado en approve) — si no actualiza fila, rechaza (token ya consumido). Negativos a nivel service: token consumido, token expirado. **Test de concurrencia** (doble consumo → uno gana). (cierra review P0-3 + P1-2)
- Rollback: revert (el caller nuevo T1.5b aún no existe / gateado).

### T1.5b — Route `/empresas/onboarding-admin`: gate (flag + emailVerified + token) → delega [DONE 2026-06-08]
- Files: `routes/empresas.ts` + `test/unit/empresas-onboarding.test.ts` (+ wiring `server.ts`)
- **Evidencia**: route `POST /empresas/onboarding-admin`. Gates fail-closed en orden: claims/email → **flag OFF=403** `onboarding_disabled` → **flag ON sin secreto=503** `onboarding_misconfigured` → **emailVerified=false=403** `email_not_verified` (T5) → **token ausente (header `x-onboarding-token`)=401** `onboarding_token_required` (T3a). `verifyOnboardingToken` en try/catch (**secreto débil LANZA→503**). **Colapso sin oráculo**: invalid/expired (verify) + `OnboardingTokenNotConsumableError` (consume) → **misma** 403 `onboarding_token_invalid` (incluye T3b: Google con email aprobado sin token válido). En ok → `onboardEmpresa(admin_provisioned, consumption{solicitudId=sid firmado, tokenHash})`; token **nunca** en la respuesta. Token en **header** (bearer credential; `empresaOnboardingInputSchema` está refinado, no `.extend`). Helper `onboardingResponseBody` compartido. Route tests **9** (todos los gates + colapso + fail-closed + delega), suite empresas 22/22. typecheck+biome ✓. **Harness default-deny real OK** (sub-ruta del mount `/empresas` clasificado → CI-green). Suite unit completa 1450/0.
- LOC: ~90
- Depends: T1.5a, T1.3, T1.4
- Acceptance (SC1/SC2/SC3, T3a/b/T4/T5): route que exige `ADMIN_PROVISIONED_ONBOARDING_ENABLED` (sino 403), `emailVerified=true` (T5), verifica el token (T1.2) y delega a `onboardEmpresa(admin_provisioned, token)`. Negativos a nivel route: sin token (T3a), Google sign-in con email aprobado sin token (T3b).
- **Contrato lib (review T1.2)**: el route DEBE (a) validar el token como string vía Zod antes de pasarlo a `verifyOnboardingToken` (un no-string lanzaría en `.split`); (b) envolver `verifyOnboardingToken` en try/catch — un secreto débil/ausente **lanza** (fail-closed), que el route mapea a error de servidor genérico + métrica distinta, NO a la respuesta anti-enumeration; (c) **colapsar** `invalid`/`expired`/no-row/ya-consumido en UNA respuesta genérica (sin oráculo). El consumo atómico (T1.5a) localiza por `sid` FIRMADO, no por hash recomputado.
- Rollback: flag OFF lo desactiva; revert del route.

### T1.6 — Clasificación boundary-audit del route nuevo (ADR-057)
- Files: `scripts/check-route-default-deny.ts` / allowlist + test
- LOC: ~30
- Depends: T1.5b
- Acceptance (§6.5): route clasificado en el harness default-deny; CI pasa.
- Rollback: revert.

### T1.7 — Limpieza del huérfano (higiene; usa `firebase_uid`)
- Files: job + `.test`
- LOC: ~90
- Depends: T1.1, T1.5a
- Acceptance (riesgo huérfano, review P0-5): job que, para solicitudes con token `expira_en` vencido y `consumido_en IS NULL`, borra el Firebase user vía **`firebase_uid`** (de T1.1) + marca la solicitud. **Mecanismo de disparo declarado** (Cloud Scheduler/cron); si se shipea como script manual, se documenta como higiene operacional y el riesgo del huérfano queda **abierto** en §9 (no es mitigación de seguridad). Separado del rechazo-por-expiración (T1.2). (review P0-5 + P1-3)
- Rollback: deshabilitar job.

### T1.8 — Camino Google de `/me` (no auto-provisiona sin token)
- Files: `routes/me.ts` test (+ ajuste si hace falta)
- LOC: ~50
- Depends: T1.3, T1.5b
- Acceptance (T6, review P1-1): test que demuestra que un aprobado que entra por Google (uid distinto, sin `users` row tras T1.3) cae en `needs_onboarding` y completa vía token; y que el account-linking de `/me` NO auto-provisiona un dueño sin token. Produce el artefacto del gate de cierre.
- Rollback: revert.

### Cierre Fase 1 — flip de flags
Cuando T1.1–T1.8 verde: flip `ADMIN_PROVISIONED_ONBOARDING_ENABLED=ON` + `SIGNUP_REQUEST_FLOW_ACTIVATED=ON`. (gate de SHIP de la fase, con security-auditor sobre el predicado/token).

**Condiciones go-with-fixes ANTES del flip** (verificación adversarial emit+consume `wf_c46ee72a-a75`, veredicto GO / SEC-001 no reabierto):
1. **T1.7 desplegado** con mecanismo de disparo declarado (Cloud Scheduler) **y** fix del guard del reaper: el reaper vivo protege `aprobado` (reaper-predicate.ts:124-129), así que un huérfano Firebase de un token expirado-no-consumido no se recolecta hoy → T1.7 debe borrarlo vía `firebase_uid` (`expira_en<now() AND consumido_en IS NULL`) o sacar la fila de `aprobado`. Mientras el flag está OFF no se acumulan huérfanos.
2. **`ONBOARDING_TOKEN_SIGNING_SECRET` cableado** en Secret Manager + Cloud Run (Terraform): ≥32 bytes CSPRNG, NO reusado de otro subsistema. (Hoy fail-closed: flag ON sin secreto → 503.)
3. **TTL (OQ1) ratificado** (default actual 72h).
4. **Sign-off del security-auditor sobre el modelo bearer-token** (token entregado por email = trust anchor; residual: link interceptado dentro del TTL). Mantener el TTL corto.

---

## FASES 2-5 (perfiladas; descomposición + devils-advocate al llegar)
- **Fase 2 — Email**: swap `EmailSignupRequestNotifier` (contrato existe) + proveedor (OQ4) + degradación.
- **Fase 3 — Conductor**: cablear `POST /conductores` al alta dentro de transportista.
- **Fase 4 — Gestor**: endpoint nuevo + migración/role + boundary. **Su propio devils-advocate.**
- **Fase 5 — Stakeholder**: consentimiento (Ley 19.628, ADR-034). **Su propio devils-advocate.**

## Out-of-band tasks
- **Valor del TTL del token (OQ1)** — decidir ANTES del cierre de Fase 1 (no embebido en T1.7; review P2-2).
- Mecanismo de disparo del job T1.7 (Cloud Scheduler) — decisión infra.
- Proveedor de email (OQ4) antes de Fase 2.
- Secret para la firma del token (Secret Manager).
- **(hardening diferido, review emit+consume)** CHECK parcial en migración futura: `token_hash IS NULL OR expira_en IS NOT NULL` (hoy el código siempre setea ambos juntos; el consume falla-cerrado si `expira_en` fuera NULL). No-bloqueante.
- **(nota review)** Expiración multi-clock: el `expira_en` se computa con el clock JS al emitir y se gatea con `now()` de la BD al consumir (autoritativo). Sin bypass; depende de NTP de GCP (default). Documentado en `onboarding.ts`.

## Riesgo residual que el plan NO cierra (documentado)
El estado creado por un exploit del route (user+empresa con RUT arbitrario) requiere data-cleanup manual, no revert. El kill-switch previene nuevos pero no limpia existentes. El token + los negativos + el flag default-OFF lo minimizan; el cleanup operacional queda como runbook de SHIP.
