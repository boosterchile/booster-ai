# Spec: onboarding-flow-redesign

- Author: Felipe Vicencio (con agent-rigor)
- Date: 2026-06-08
- Status: Approved (2026-06-08, v2 — post devils-advocate, P0 de seguridad resuelto)
- Linked: SEC-001 (`.specs/sec-001-cierre/`), ADR-052 (signup admin-approval gate), ADR-057 (Google boundary + reaper), `.specs/_followups/onboarding-flow-redesign.md` (stub origen), fundamento `wf_62beeb56-2a3`, review `review.md`
- **Naturaleza: PROGRAMA fraseado.** PLAN lo descompone en fases entregables.

---

## 1. Objective

Hacer **operativo el alta de cuentas end-to-end manteniendo el modelo gateado por admin de SEC-001**: prospecto solicita → admin aprueba → la persona obtiene una cuenta operativa con su rol. Cubre los cuatro caminos (decisión PO 2026-06-08): **dueño**, **conductor** (en transportista), **gestor de carga** (en generador) y **stakeholder** (desde admin), más **email real**. **No se reabre el self-service** (`EMPRESA_SELF_ONBOARDING_ENABLED` queda OFF para siempre).

## 2. Why now

El flujo está **roto en cadena**: `approveSignupRequest` precrea un `users` row (`signup-request.ts:222-234`) y `onboardEmpresa` lanza `409` si ese row existe (`onboarding.ts:114-121`) → **todo aprobado queda en limbo**. El notifier solo loguea. Y el signup-request anónimo solo captura `{email, nombreCompleto}` — sin punto de captura de empresa+rol. Sin esto, el marketing capta solicitudes que no se convierten en cuentas.

## 3. Success criteria

- [ ] SC1 — Un aprobado completa el alta de **dueño** sin chocar con el 409 (solicitud aprobada → user+empresa+membership `dueno`).
- [ ] SC2 — **(Frontera de seguridad)** La provisión exige un **token de un solo uso** emitido en el approve y **consumido atómicamente** al completar el onboarding. Verificado con negativos: (a) autenticado sin token → rechazado; (b) Google sign-in con email que tiene solicitud `aprobado` pero **sin token válido** → rechazado; (c) token ya consumido → rechazado.
- [ ] SC3 — `EMPRESA_SELF_ONBOARDING_ENABLED` permanece OFF; el alta gateada usa `authorizedBy='admin_provisioned'` (no consulta ese flag). El route nuevo tiene su propio kill-switch `ADMIN_PROVISIONED_ONBOARDING_ENABLED` (default OFF).
- [ ] SC4 — El aprobado recibe email real con login link (swap del notifier al proveedor real).
- [ ] SC5 — **Conductor**: alta dentro de transportista (membership, no self-serve).
- [ ] SC6 — **Gestor**: alta dentro de generador (endpoint nuevo — hoy no existe).
- [ ] SC7 — **Stakeholder**: alta con consentimiento (Ley 19.628), desde admin.
- [ ] SC8 — `SIGNUP_REQUEST_FLOW_ACTIVATED` se enciende solo cuando el camino dueño funciona end-to-end.

## 4. User-visible behaviour

- **Prospecto (dueño)**: envía `{email, nombreCompleto}` → email "en revisión" → admin aprueba → **email con login link + token** → entra → completa empresa (RUT, razón social, tipo, dirección, plan) → operativo como `dueno`. El token se consume al completar.
- **Conductor / Gestor**: el dueño/admin de la empresa lo da de alta dentro de su organización.
- **Stakeholder**: solicita acceso; el dueño del dato otorga consentimiento trazable; acceso read-only con scope.
- **Admin**: aprueba/rechaza solicitudes; gestiona stakeholders.

## 5. Out of scope

- Reabrir self-service (`EMPRESA_SELF_ONBOARDING_ENABLED` ON). Prohibido.
- Cambiar el endpoint público `signup-request` ni su anti-enumeration (sigue `{email, nombreCompleto}`).
- **Journey demo/exploratorio** (`demo.boosterchile.com` / cuenta de permiso mínimo para "conocer Booster"): el stub de origen exige NO colapsarlo con el alta-prod gateada. Se **difiere** como decisión de producto separada (no se borra; queda fuera de este spec).
- Auto-aprobación por reglas (domain allowlist) — futuro.
- Borrador/persistencia parcial del onboarding (all-or-nothing en esta entrega).

## 6. Constraints

1. **SEC-001 intacto.** Gate de admisión = aprobación admin; self-serve cerrado. Alta vía `authorizedBy='admin_provisioned'` (`onboarding.ts:108` no consulta el kill-switch SEC-001).
2. **Predicado = token de un solo uso (DECISIÓN, no pregunta).** El approve emite un token firmado con nonce, ligado a la solicitud, entregado en el email link. El route de onboarding **exige y consume** ese token atómicamente. NO se ancla en "existe fila `aprobado` por email" (eso reabriría SEC-001 vía Google sign-in con email colisionado — ver review P0-1). Requiere **migración**: estado de token (`token_hash`, `consumido_en`, `expira_en`) en `solicitudes_registro` (hoy sin `firebase_uid`, `schema.ts:2212-2226`).
3. **Kill-switch propio.** Route `admin_provisioned` detrás de `ADMIN_PROVISIONED_ONBOARDING_ENABLED` (default OFF), separado del flag SEC-001 — para tener reversión sin tocar el self-serve.
4. **`emailVerified=true`** requerido en el route (heredar la restricción de `me.ts:54-62`; `empresas.ts:43` hoy solo exige email presente).
5. **Clasificación boundary-audit (ADR-057 SC-G1b).** Las rutas nuevas (onboarding gateado, gestor) deben clasificarse en el harness default-deny o el CI falla.
6. **Atomicidad** (`onboardEmpresa` transaccional), **stack Booster** (Zod, zero any/console, logger, naming bilingüe, coverage ≥80%), **Ley 19.628** (stakeholder).

## 7. Approach

**Modelo (Opción A)**: el aprobado completa la empresa **post-login** vía un route de onboarding gateado que llama `onboardEmpresa(admin_provisioned)`. El admin solo aprueba sobre email+nombre; el dueño aporta los datos legales.

**Token (resuelve la frontera + el camino Google)**: `approveSignupRequest` emite un token de un solo uso (en el email link). El onboarding lo valida + consume. Como la autorización vive en el **token**, no en el email, el vector de Google-sign-in-con-email-colisionado (review P0-1/F2) queda cerrado: tener un Google user de ese email no basta — hace falta el token del link.

**409 (3.1)**: `approve` **deja de precrear el `users` row**; `onboardEmpresa` lo crea entero. **Efecto en `/me` (review F1)**: hoy `/me` (`me.ts:62-86`) usa el row precreado para re-vincular el uid de Google al email. Sin precreate, un aprobado-Google cae en `needs_onboarding` y va al onboarding con su token — el token (no el email-linking) lo autoriza. Se documenta y se testea el camino Google.

**Email (Fase 2)**: el contrato `SignupRequestNotifier` ya existe (`signup-request-email.ts:30-54`) — es **swap de implementación** (`EmailSignupRequestNotifier` con proveedor real, inyección condicional con degradación tipo Twilio), no construir infra desde cero.

**Fraseo (PLAN detalla; cada fase entregable + verificable):**
- **Fase 1 — Núcleo dueño**: token de un solo uso + 409 (3.1) + route gateado (`admin_provisioned` + kill-switch + emailVerified + clasificación boundary). Destraba el limbo. **Prerrequisito de todo.**
- **Fase 2 — Email real**: swap del notifier.
- **Fase 3 — Conductor**: cablear `POST /conductores` (existe) al alta dentro de transportista.
- **Fase 4 — Gestor**: endpoint nuevo (no existe) dentro de generador.
- **Fase 5 — Stakeholder**: alta con consentimiento (Ley 19.628).
- **Cierre — Flags**: encender `SIGNUP_REQUEST_FLOW_ACTIVATED` cuando Fase 1 (+email) funcione end-to-end.

## 8. Alternatives considered

- **Predicado por email (sin token)** — rechazado: reabre SEC-001 (review P0-1, vector Google sign-in).
- **Predicado por `firebase_uid` matcheado** — requiere migrar `solicitudes_registro` para guardar el uid del Admin-SDK user; más frágil que el token y no cubre el cambio de uid (Google vs Admin-SDK). El token es superior.
- **Captura de datos B (extender signup-request público)** / **C (admin tipea)** — rechazadas (anti-enumeration / data-entry frágil).
- **409 via 3.2 (`onboardEmpresa` reutiliza el row)** — rechazada: complica el invariante de seguridad del service.

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Predicado mal implementado reabre SEC-001 | M | **H** | Token de un solo uso (no email-matching); negativos T3 (Google + reuso); review obligatorio security-auditor + devils-advocate sobre el token |
| `/me` account-linking de aprobados-Google cambia con 3.1 | M | M | El token autoriza el onboarding sin depender del email-linking; test del camino Google añadido |
| Firebase user huérfano entre aprobación y onboarding | M | M | **El reaper NO lo limpia** (`reaper-predicate.ts:124-129` protege aprobados). Mitigación propia: `expira_en` del token + job de limpieza de tokens/cuentas expiradas (definir en PLAN) |
| Estado creado por un bug (user+empresa con RUT arbitrario) no se revierte con git | L | **H** | Kill-switch propio default OFF; el token cierra el vector; negativos de seguridad antes del flip |
| Scope amplio (4 roles + email) | **H** | M | Fraseo: Fase 1 destraba el 409 y es entregable; demás fases independientes |
| Gestor: superficie nueva sin gate | M | M | Fase 4 con diseño + review propio + clasificación boundary |

## 10. Test list

- T1 — `approve` ya no precrea `users` row (Firebase user + estado aprobado + token emitido + notify).
- T2 — `onboardEmpresa(admin_provisioned)` con token válido → user+empresa+membership, sin 409.
- T3 — **Negativos de seguridad** (SC2): (a) sin token → rechazado; (b) Google sign-in con email `aprobado` pero sin token → rechazado; (c) token ya consumido → rechazado; (d) token expirado → rechazado.
- T4 — `EMPRESA_SELF_ONBOARDING_ENABLED=false` no bloquea `admin_provisioned`; `ADMIN_PROVISIONED_ONBOARDING_ENABLED=false` SÍ lo bloquea (kill-switch).
- T5 — `emailVerified=false` → rechazado en el route.
- T6 — Camino Google: aprobado que entra por Google (uid distinto) completa onboarding con su token.
- T7 — Email: `EmailSignupRequestNotifier` envía (mock) en approve; degrada si faltan credenciales.
- T8 — Conductor: alta dentro de transportista crea membership conductor.
- T9 — Gestor: endpoint nuevo crea gestor dentro de generador; rechaza sin empresa generador.
- T10 — Stakeholder: alta exige consentimiento registrado; sin consentimiento → rechazado.

## 11. Rollout

- **Migración**: estado de token en `solicitudes_registro` (`token_hash`, `consumido_en`, `expira_en`); migración del endpoint gestor (Fase 4).
- **Flags**: `EMPRESA_SELF_ONBOARDING_ENABLED` NUNCA se enciende. `ADMIN_PROVISIONED_ONBOARDING_ENABLED` default OFF, kill-switch del route nuevo. `SIGNUP_REQUEST_FLOW_ACTIVATED` se enciende al cerrar Fase 1 (+email).
- **Nota (review R6)**: con `SIGNUP_REQUEST_FLOW_ACTIVATED=OFF` el **approve admin devuelve 503** — el lado admin está **congelado**, no operando en paralelo. El endpoint público de signup-request (no gateado por ese flag) sí acumula solicitudes; pero nadie las procesa hasta el flip.
- **Rollback**: por fase, detrás de su kill-switch. Fase 1 revertible (no toca el endpoint público). El estado creado por el route nuevo (si exploit) requiere data-cleanup, no solo revert → de ahí el kill-switch + los negativos antes del flip.
- **Monitoring**: `signup_email_sent`, tasa approve→onboarding completado, **tokens rechazados/expirados** (señal de abuso o de UX rota).

## 12. Open questions

- OQ1 — **TTL del token**: ¿cuánto vive el token de onboarding antes de expirar (24h, 72h, 7d)? + el job de limpieza de tokens/cuentas expiradas. (cierro con propuesta en PLAN Fase 1 + security-auditor).
- OQ2 — **Gestor (Fase 4)**: ¿el endpoint sigue el patrón de `POST /conductores`? Diseño en PLAN.
- OQ3 — **Stakeholder (Fase 5)**: ¿reutiliza `organizaciones-stakeholder`/`zonas-stakeholder` (ADR-034) para el consentimiento? Investigar en PLAN.
- OQ4 — **Email (Fase 2)**: ¿proveedor (SES/SendGrid/Resend)? ¿el mismo que confirma DTE? Decisión PO/infra.

## 13. Decision log

- 2026-06-08 — Draft v1 tras investigación `wf_62beeb56-2a3`. PO: Opción A, 4 caminos, email en scope.
- 2026-06-08 — **v2 tras devils-advocate**: P0-1 (reapertura SEC-001 por predicado-email + Google sign-in) → predicado redefinido como **token de un solo uso** (decisión en §6, no OQ). Incorporados: kill-switch propio (R2), `emailVerified` (R3), corrección del riesgo del reaper (R4), journey demo devuelto a out-of-scope (R5), corrección §11 admin-congelado (R6), clasificación boundary ADR-057, email como swap del contrato existente. SC2 reescrito alrededor del token (medible).
