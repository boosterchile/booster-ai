# ADR-060 — Sitio de marketing alineado al registro gateado: supersede ADR-010 §signup y §checkout

- **Status**: Accepted (2026-06-08 — SHIP gateado: el sitio se mergea a `main` con `/signup` en "próximamente"; el flip a captación lo gobierna §11 del spec)
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

**Kill-switch del form (build-time).** El `/signup` funcional vive detrás de `NEXT_PUBLIC_SIGNUP_ENABLED` (default `false` → "próximamente"; el chunk del form se code-splittea). Es una var `NEXT_PUBLIC_*`: **se inlina en build time**, así que habilitar el form = **rebuild + redeploy** con la var en `true`, NO un toggle de runtime en Cloud Run (review P1-1).

**Aclaración de seguridad (review P0-1): CORS NO es una defensa general de captación.** El endpoint `POST /api/v1/signup-request` es **anónimo y ya está montado en producción** (por diseño de ADR-052, solo rate-limited; `apps/api/src/server.ts`). Cualquier cliente no-browser (curl/script) puede postear; CORS solo bloquea el navegador cross-origin. Por tanto el kill-switch del marketing controla únicamente que **el sitio** muestre el form — no "cierra" el endpoint. Que una solicitud prematura no haga daño hoy se debe a que el **downstream está gateado**: la UI admin de aprobación responde 503 (`SIGNUP_REQUEST_FLOW_ACTIVATED=false`), el notifier solo loguea (no envía), y el bug 409 approve→onboarding deja la solicitud como fila inerte. Encender el form (§11) exige cerrar ese downstream + CORS + privacidad — no es solo un flip de flag.

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
- **Contrato sin red compartida real** (review P1-3): el front deriva el schema de *request* vía `signupRequestSchema.pick(...)` de `@booster-ai/shared-schemas`, pero el handler valida con un schema **duplicado** propio (`routes/signup-request.ts`, no-`strict`). El `.pick()` cubre solo el shape de request contra el schema de dominio — **no** el contrato del 202 (response) ni el schema real del handler. Acoplamiento por convención; residual aceptado (no se toca el backend).
- **Compliance Ley 19.628 al flip** (review security): el form capta PII (email + nombre) pero `/legal/privacidad` es stub y el form no tiene consentimiento/finalidad. Gap solo al **encender** el form; condición de §11 antes del flip.
- **`no-checkout.test` es denylist** (review P2-1): garantiza ausencia de los PSP/DTE catalogados, no de cualquier PSP futuro. La lista debe crecer si se agrega un PSP al monorepo.

## Alternativas consideradas

- **Mantener el alta directa de ADR-010.** Rechazada: contradice SEC-001/ADR-052; es el vector de auto-provisión cerrado a propósito.
- **Extender `signup-request` para capturar rol/segmento.** Rechazada: toca superficie revisada por seguridad (anti-enumeration, rate-limit) y agrega migración; el rol se resuelve mejor post-aprobación.
- **No construir el sitio hasta que el onboarding-redesign cierre.** Rechazada: el contenido/SEO entrega valor ya; el riesgo está en *activar* el `/signup`, no en construirlo (gateado).

## Notas

- Al cerrar `onboarding-flow-redesign` (path approve→dueño + notifier real) y habilitar el sitio (§11), revisar este ADR para reflejar el estado "registro end-to-end operativo".
- El gate Lighthouse bloqueante se activa con contenido real (followup `marketing-lighthouse-blocking`).
