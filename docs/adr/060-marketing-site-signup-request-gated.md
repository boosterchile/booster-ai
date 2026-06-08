# ADR-060 — Sitio de marketing alineado al registro gateado: supersede ADR-010 §signup y §checkout

- **Status**: Proposed (se promueve a Accepted al cerrar SHIP de `marketing-site-signup-request`)
- **Date**: 2026-06-08
- **Deciders**: Felipe Vicencio (PO)
- **Linked**:
  - Spec/plan/review: `.specs/marketing-site-signup-request/{spec,plan,review}.md`
  - Supersede (parcial): [ADR-010](./010-marketing-site-and-commerce.md) §"Onboarding por rol" y §"Checkout y pagos"
  - Depende de: [ADR-052](./052-signup-migration-admin-sdk-gate.md) (signup admin-approval gate + IdP self-signup OFF)
  - Followups: `.specs/_followups/onboarding-flow-redesign.md` (path approve→dueño), `.specs/_followups/marketing-lighthouse-blocking.md`

## Contexto

ADR-010 (Accepted, 2026-04-23) diseñó `apps/marketing` con un `/signup` que **crea cuentas directamente** (wizard por rol → Firebase Auth client-side → empresa+usuario) y un **checkout** con Flow.cl. Ese sitio **nunca se construyó** — fue la causa real de "no se pueden crear cuentas desde la web pública".

Entre tanto, la auditoría SEC-001 cambió el modelo de registro de producción (ADR-052):

- Self-signup email/password **OFF** en Identity Platform.
- Self-onboarding de empresas **OFF** por flag (`EMPRESA_SELF_ONBOARDING_ENABLED=false`), con invariante de servicio (`SelfOnboardingDisabledError`).
- Único path: `POST /api/v1/signup-request` (anónimo, rate-limit Redis, 202 idempotente anti-enumeration) → fila `pendiente_aprobacion` → **aprobación admin** que recién ahí crea la identidad vía Admin SDK.

Un intento previo (rama `feat/contratacion-y-alta-cuentas`) construyó el sitio con **alta directa** sobre un `main` stale; ese modelo **contradice** SEC-001/ADR-052 (es el vector de auto-provisión que se cerró deliberadamente) y quedó descartado. Esta decisión documenta el sitio reconstruido y alineado al modelo gateado.

## Decisión

Se construye `apps/marketing` siguiendo el **stack, estructura, SEO y separación de ADR-010** (Next.js 15, Tailwind + ui-tokens, dominios `www`/`boosterchile.com`), pero se **supersede** lo siguiente de ADR-010:

1. **§"Onboarding por rol" → reemplazado.** `/signup` es un formulario mínimo de **`{email, nombreCompleto}`** que hace `POST /api/v1/signup-request` (ADR-052) y muestra "solicitud en revisión". No hay wizard por rol, no se pide RUT/razón social/industria, no se crea cuenta ni se autentica al prospecto. El rol y los datos de empresa se determinan en el **onboarding post-aprobación** (followup `onboarding-flow-redesign`, fuera de scope).
2. **§"Checkout y pagos" → descartado del sitio.** Sin Flow.cl/Stripe, sin rutas de checkout, sin emisión de DTE en marketing. Un test estructural (`no-checkout.test.ts`) lo hace cumplir. La contratación de planes pagos se coordina fuera de línea al activar la cuenta.
3. **Sin Firebase client-side en marketing.** El signup-request es anónimo; el sitio no necesita el SDK de auth (menos superficie que el diseño original de ADR-010).

**Kill-switch + defensa de doble nivel.** El `/signup` funcional vive detrás de `NEXT_PUBLIC_SIGNUP_ENABLED` (default `false` → "próximamente"; el chunk del form se code-splittea). La defensa real contra captación prematura es de **doble nivel**: (1) flag off **y** (2) ausencia de `www.boosterchile.com` en `CORS_ALLOWED_ORIGINS` del api — aunque se forzara el submit, el POST cross-origin falla. La habilitación (flip + CORS + deploy) requiere el readiness del downstream (notifier real + cierre del bug 409 approve↔onboarding).

**Lo que de ADR-010 NO se supersede** y sigue vigente: la decisión de dos apps separadas (marketing vs producto) con auth compartido, el stack, la estructura de rutas de contenido, los objetivos de SEO/performance/accesibilidad y el modelo de pricing como contenido informativo.

## Consecuencias

### Positivas

- El sitio comercial/SEO existe y es desplegable **sin** depender del downstream de registro (valor independiente).
- El registro respeta la postura de seguridad de SEC-001: no reabre el vector de alta directa.
- Menos superficie (sin Firebase, sin PSP) → menos riesgo y mantenimiento.

### Negativas

- El alta no es end-to-end self-service: el prospecto envía una solicitud y espera aprobación (UX con latencia). Mitigado por el copy y por mantener `/signup` en "próximamente" hasta que el flujo de aprobación esté completo.
- ADR-010 queda parcialmente superseded: futuros lectores deben leer este ADR para el modelo vigente de signup/checkout.

### Riesgo residual

- **Buzón muerto si se habilita antes de tiempo**: aprobar una solicitud hoy produce un usuario zombie (bug 409 approve↔onboarding activo; notifier solo loguea). Mitigado por el kill-switch + el gate §11; el cierre vive en `onboarding-flow-redesign`.
- **Contrato del 202 sin red compartida**: el front depende del shape `{email, nombreCompleto}`; mitigado derivando el schema cliente vía `signupRequestSchema.pick(...)` de `@booster-ai/shared-schemas`.

## Alternativas consideradas

- **Mantener el alta directa de ADR-010.** Rechazada: contradice SEC-001/ADR-052; es el vector de auto-provisión cerrado a propósito.
- **Extender `signup-request` para capturar rol/segmento.** Rechazada: toca superficie revisada por seguridad (anti-enumeration, rate-limit) y agrega migración; el rol se resuelve mejor post-aprobación.
- **No construir el sitio hasta que el onboarding-redesign cierre.** Rechazada: el contenido/SEO entrega valor ya; el riesgo está en *activar* el `/signup`, no en construirlo (gateado).

## Notas

- Al cerrar `onboarding-flow-redesign` (path approve→dueño + notifier real) y habilitar el sitio (§11), revisar este ADR para reflejar el estado "registro end-to-end operativo".
- El gate Lighthouse bloqueante se activa con contenido real (followup `marketing-lighthouse-blocking`).
