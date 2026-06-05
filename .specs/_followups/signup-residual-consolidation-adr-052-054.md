# Follow-up — Consolidación del residual de signup (ADR-052/054) + 2 detalles net-new

**Origen**: inventario ADR-vs-prod 2026-06-03 (cierre, findings ADR-052 🔴 y ADR-054 🔴).
**Tipo**: seguridad/operativo. **Estado**: **mayormente YA trackeado** — este stub consolida y corrige, no abre trabajo nuevo salvo 2 detalles.

## ⚠️ Corrección de encuadre (el inventario lo sobre-dimensionó)

Los agentes del barrido marcaron "signup web roto" + "Google federated sin gate" como residuales urgentes sin ver el contexto SEC-001. La realidad:

- **El vector explotable está CERRADO**: `sec-001-empresa-onboarding-gate-hotfix` puso `EMPRESA_SELF_ONBOARDING_ENABLED=false` → `POST /empresas/onboarding` responde 403 (no auto-provisiona `dueño`). Self-service onboarding cerrado; pilotos provisionados a mano.
- **La blocking function OFFLINE es DELIBERADA**: el PO eligió **Alternativa G** (enforcement en API-boundary `user-context.ts:51-56` 404 `user_not_registered` + inert-account reaper) sobre la blocking function (2026-05-29, ver `alt-d-vs-g-comparison.md`). La dirección blocking-function (sec-001-h1-2-google-blocking `-a`/`-b`/`-c`) quedó **superseded**. Que `beforeCreate` esté OFFLINE NO es un olvido.

## Ya trackeado (NO duplicar)

- `.specs/sec-001-h1-2-google-boundary-closure/spec.md` — **Alt G**, Draft **NOT approvable** (devils-advocate Round 1 DO_NOT_APPROVE; necesita gate de admisión en onboarding + reaper hardening + harness default-deny). **Este es el driver real del residual Google.**
- `.specs/_followups/onboarding-flow-redesign.md` — P1 stub. Cubre: 409 approve↔onboarding, email solo-logging (`LoggingSignupRequestNotifier`), flips de `SIGNUP_REQUEST_FLOW_ACTIVATED`/`EMPRESA_SELF_ONBOARDING_ENABLED`, estrategia prospects demo vs prod.
- `.specs/_followups/sprint-2c-google-blocking-function.md` — contexto histórico del leg Google (superseded por Alt G).
- `.specs/sec-001-cierre/spec.md` §3 SC-1.2.2 — Google leg = `TRACKED_RESIDUAL`.

## Net-new del inventario (NO cubierto explícitamente arriba)

1. **`login.tsx` signup email/password huérfano** (ADR-052 🔴): `login.tsx:141-147` (mode `sign-up`) llama `signUpWithEmail` → `createUserWithEmailAndPassword` **client-side, sin gate, sin pasar por `/signup-request`**. Con `disabledUserSignup=true` en el IdP, ese path falla con `auth/operation-not-allowed`. Es una superficie **distinta** del endpoint `/empresas/onboarding` (que el hotfix cerró) y del flujo `signup-request`: es la UI legacy de email/password en la pantalla de login. Decisión: ocultar/eliminar el modo `sign-up` de `login.tsx`, o cablearlo al flujo `signup-request`. → cae naturalmente dentro de `onboarding-flow-redesign` pero no estaba nombrado.
2. **ADR-054 necesita amendment** (lo dice el propio `google-blocking-c` §7): su Status=Proposed describe un enfoque (blocking function Gen 1) **abandonado** en favor de Alt G. Además contiene un dato factual falso (`firebase-functions@^3.x`; el repo usa `^6.6.0` y el handler ni lo importa). Anotar/superseder ADR-054 cuando se cierre Alt G.

## Acción

No abrir trabajo nuevo: **el trabajo vive en `onboarding-flow-redesign.md` (P1) + `google-boundary-closure` (Draft, espera decisión PO)**. Este stub solo: (a) corrige la sobre-afirmación del inventario, (b) agrega el detalle `login.tsx` al scope del redesign, (c) recuerda el amendment de ADR-054. Relacionado: [[onboarding-flow-redesign]].
