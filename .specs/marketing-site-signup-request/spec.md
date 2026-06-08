# Spec: marketing-site-signup-request

- Author: Felipe Vicencio (con agent-rigor)
- Date: 2026-06-08
- Status: Shipped (gateado) — 2026-06-08, PR a `main`; deploy/encendido pendiente (§11)
- Linked: ADR-010 (landing comercial), ADR-052 (signup admin-approval gate), `.specs/_followups/onboarding-flow-redesign.md`, diagnóstico de reconciliación `wf_6f246ce3-0c4` (rama abandonada `feat/contratacion-y-alta-cuentas`)

---

## 1. Objective

Construir `apps/marketing` — el sitio comercial público de Booster (`www.boosterchile.com` / `boosterchile.com`) en Next.js 15 — con el contenido y SEO de ADR-010, pero con el flujo de registro **re-cableado al modelo gateado de producción**: un formulario mínimo que envía `POST /api/v1/signup-request` (`{email, nombreCompleto}` → solicitud `pendiente_aprobacion`), en lugar de la creación directa de cuenta que ADR-010 §signup/§onboarding describía. El sitio capta prospectos y los encola para aprobación admin; **no** crea cuentas ni cobra.

## 2. Why now

ADR-010 se aceptó (2026-04-23) pero `apps/marketing` nunca se construyó — esa es la causa real de "no se pueden crear cuentas desde la web pública". Un intento previo (`feat/contratacion-y-alta-cuentas`) sí lo construyó, pero sobre un `main` 239 commits stale y con un modelo de **alta self-service directa** que SEC-001/ADR-052 **cerró deliberadamente** (self-signup OFF en el IdP, self-onboarding de empresas OFF por flag). Ese trabajo quedó superseded. Esta spec realinea el rescate (marketing shell + contenido) al modelo gateado vigente, partiendo del `main` real. Si no se hace: seguimos sin presencia comercial/SEO y sin un canal de captación de prospectos coherente con la postura de seguridad.

## 3. Success criteria (measurable)

- [ ] SC1 — `pnpm --filter @booster-ai/marketing build` produce build standalone Next.js sin errores; `lint` + `typecheck` 0 errores.
- [ ] SC2 — Con `NEXT_PUBLIC_SIGNUP_ENABLED=true`, el formulario de `/signup` envía `POST {API}/api/v1/signup-request` con body `{email, nombreCompleto}` y, ante 202, muestra estado "solicitud en revisión" (no redirige a la app).
- [ ] SC3 — El formulario mapea y muestra mensajes legibles para 422 (validación), 429 (demasiados intentos), 503 (servicio no disponible) **y fallo de red/CORS** ("no pudimos conectar"), sin filtrar detalle interno.
- [ ] SC4 — Test estructural CI: no existen rutas `checkout`/`pagar`/`api/checkout` y ningún archivo de `src` importa un PSP/DTE (Flow, Stripe, dte-provider).
- [ ] SC5 — `/ingresar` redirige a `app.boosterchile.com/login` (HTTP redirect o client redirect verificable en test).
- [ ] SC6 — Rutas de contenido renderizan con `metadata` (title + description) por ruta: `/`, `/soluciones/{transportistas,generadores,stakeholders-esg}`, `/precios`, `/esg`, `/casos`, `/sobre`, `/contacto`, `/blog`, `/legal/{terminos,privacidad}`.
- [ ] SC7 — Coverage ≥80% líneas / 75% branches / 80% funciones en `apps/marketing` (gate CLAUDE.md).
- [ ] SC8 — El `/signup` funcional está detrás de un kill-switch enforced: con `NEXT_PUBLIC_SIGNUP_ENABLED=false` (default) la ruta renderiza "próximamente" (sin formulario que envíe), verificado por test. El contenido/SEO del resto del sitio SÍ es desplegable con el switch off.

## 4. User-visible behaviour

**Visitante anónimo en `www.boosterchile.com`:**

- Home con propuesta de valor + CTA a `/signup` y a páginas de solución por segmento.
- Páginas de contenido/SEO (soluciones, precios, ESG, casos, sobre, contacto, blog, legal).
- `/signup`:
  - Con `NEXT_PUBLIC_SIGNUP_ENABLED=false` (default actual): pantalla "próximamente" — explica que el acceso se abrirá pronto + canal de contacto. **No** hay formulario que envíe (evita captar leads a un buzón que hoy nadie procesa — ver §9).
  - Con el switch en `true` (recién cuando el downstream esté listo, §11): formulario de **2 campos** (`email`, `nombre completo`) + textos de "acceso por aprobación". Al enviar:
    - **Éxito (202):** pantalla "Recibimos tu solicitud. Te contactaremos para activar tu cuenta." (sin login inmediato).
    - **429:** "Demasiados intentos. Intenta nuevamente en unos minutos."
    - **422:** errores de campo inline.
    - **503:** "No pudimos procesar tu solicitud ahora. Intenta más tarde."
    - **Fallo de red/CORS:** "No pudimos conectar. Intenta más tarde."
- `/ingresar`: redirección a `app.boosterchile.com/login`.

**BEFORE (ADR-010 / rama abandonada):** `/signup` preguntaba rol (shipper/carrier/stakeholder), pedía email+password+RUT+razón social, autenticaba con Firebase client-side y creaba empresa+usuario+membership dueño directo. **AFTER (esta spec):** `/signup` capta `{email, nombreCompleto}` anónimo → solicitud pendiente de aprobación admin. El rol/empresa se determinan **después**, en el onboarding post-aprobación (fuera de scope, ver §5).

## 5. Out of scope

- **Creación de cuenta directa / wizard por rol que crea cuentas.** Superseded por ADR-052. El rol se captura en onboarding post-aprobación.
- **El path approve→dueño (aprobación → empresa+membership operativos).** Estado real (verificado por devils-advocate): `approveSignupRequest` (`apps/api/src/services/signup-request.ts:164-296`) **ya existe** y precrea un `users` row con `status='pendiente_verificacion'`, pero el tramo empresa+membership falta **y el conflicto 409 está activo** — aprobar una solicitud hoy produce un **usuario zombie** que `onboardEmpresa` rechaza con `UserAlreadyExistsError`. Cerrarlo es el follow-up `onboarding-flow-redesign.md` (P1, su propio ciclo). Esta spec **solo** entrega la UI de captación + su kill-switch; no toca el backend.
- **UI admin de aprobación.** Ya existe en `main` (`platform-admin-signup-requests.tsx`), gateada por `SIGNUP_REQUEST_FLOW_ACTIVATED`. No se toca.
- **Notificación email real al prospecto/admin.** Hoy `LoggingSignupRequestNotifier` solo loguea (follow-up). Esta spec no lo cablea.
- **Checkout / pagos / Flow.cl / Stripe / emisión DTE.** ADR-010 §checkout queda superseded; sin `packages/payment-provider` y fuera del modelo gateado actual.
- **Cualquier cambio al endpoint `POST /api/v1/signup-request`, su schema `{email, nombreCompleto}`, o `solicitudes_registro`.** Es superficie revisada por seguridad; se consume tal cual.
- **R1 (estrechar `addressSchema.region` + `CHILE_REGIONS`) y R2 (columna `direccion_comuna`).** Mejoras aisladas en ramas/PRs separados, no acopladas a marketing.
- **Firebase client-side en marketing.** Innecesario: el signup-request es anónimo. Se elimina del scope (vs rama abandonada).
- **Contenido editorial real del blog/casos.** Stubs con metadata; el contenido MDX se llena en trabajo de contenido posterior.
- **Analytics (Plausible/GA4), A/B testing (GrowthBook).** ADR-010 los contempla; no son parte de este slice.

## 6. Constraints

1. **Seguridad/arquitectura:** no introducir un alta self-service ni un endpoint que cree cuentas. Único canal = `POST /api/v1/signup-request` (gateado por aprobación admin, ADR-052).
2. **No tocar el contrato gateado:** body `{email, nombreCompleto}`; respuesta 202 idempotente (anti-enumeration). El cliente no debe inferir si el email existe.
3. **Stack:** Next.js 15 App Router (ADR-010); Tailwind + `@booster-ai/ui-tokens`; formularios con react-hook-form + Zod; validación reutilizando/espejando el schema `{email, nombreCompleto}`.
4. **Type-safety / observabilidad (CLAUDE.md):** zero `any`, zero `console.*` (usar logger donde aplique en server actions), Zod en boundaries.
5. **Naming bilingüe:** identifiers TS en inglés; labels UI en español natural.
6. **Performance/SEO (ADR-010 §Validación):** Lighthouse SEO=100, Performance ≥90 mobile, Accessibility ≥95.
7. **Accesibilidad:** WCAG 2.1 AA — contraste ≥4.5:1 texto, focus visible, sin emojis como íconos (SVG), `prefers-reduced-motion`.
8. **CORS:** el `POST` cross-origin requiere `www.boosterchile.com` en `CORS_ALLOWED_ORIGINS` del api (dependencia de habilitación, §11).
9. **Coverage ≥80%** en código nuevo.

## 7. Approach

Nueva app `apps/marketing` (Next.js 15, App Router, build standalone para Cloud Run), partiendo del `main` real `517859a`. Se **re-portan** del trabajo previo solo las piezas agnósticas del modelo de alta: scaffold de hosting/build, rutas de contenido, `/precios`, `/ingresar`→login, y la remediación a11y/contraste ya hecha. Se **descarta** todo lo de alta directa (endpoint público, wrapper de onboarding, auth client-side Firebase, R3a/R3b, wizard por rol).

- **`/signup`** = gateado por el kill-switch `NEXT_PUBLIC_SIGNUP_ENABLED` (default `false` → renderiza "próximamente"; sin él, no hay submit posible). Con el switch on: un único formulario de 2 campos (`email`, `nombreCompleto`) con react-hook-form + Zod que llama `POST {NEXT_PUBLIC_API_URL}/api/v1/signup-request` (fetch directo o server action) y renderiza estado según el código (202/422/429/503) + un estado de fallo de red/CORS. Sin Firebase.
- **Gate enforced (no prosa):** el kill-switch es un mecanismo técnico — un test verifica que con el flag off la ruta no monta formulario. Habilitar `/signup` en prod requiere flip explícito del flag, que a su vez requiere el readiness de §11. Esto desacopla el valor SEO (desplegable ya) del riesgo de captar leads sin downstream.
- **Páginas de contenido** estáticas (SSG) con `metadata` por ruta para SEO. Las páginas de solución por segmento (`transportistas`/`generadores`/`stakeholders-esg`) son material comercial que enlaza al mismo `/signup`; el segmento NO viaja al backend (el endpoint solo acepta `{email, nombreCompleto}`).
- **Gate CI** (re-portado): test estructural "no checkout / no PSP/DTE import" + job Lighthouse/SEO.
- **ADR-060** (a crear en SHIP): supersede ADR-010 §signup/§onboarding y §checkout, alineando el sitio al modelo gateado de ADR-052.
- **Rubber-duck (por qué así):** (a) reusar el endpoint revisado por seguridad evita reintroducir el vector que SEC-001 cerró; (b) separar la captación (este slice) del onboarding post-aprobación (follow-up) entrega valor SEO/lead-capture sin esperar el rediseño completo; (c) eliminar Firebase del marketing reduce superficie y complejidad.

## 8. Alternatives considered (rejected)

- **A. Extender `signup-request` para capturar rol/segmento.** Rechazada: toca un endpoint y schema revisados por seguridad (anti-enumeration, rate-limit), agrega columna/migración y scope creep; el rol se determina mejor en el onboarding post-aprobación.
- **B. Construir el path completo approve→dueño ahora para que la cuenta funcione end-to-end.** Rechazada: es el follow-up `onboarding-flow-redesign` (P1) con su propio diseño de seguridad (resolver el conflicto 409 approve↔onboarding, notifier real, semántica de flags). El sitio entrega valor como captación sin bloquearse en eso.
- **C. Poner las páginas de marketing dentro de `apps/web`.** Rechazada por ADR-010 §separación: SEO/SSR vs SPA offline, cadencias de deploy y audiencias distintas.
- **D. Rebasar/rescatar la rama `feat/contratacion-y-alta-cuentas`.** Rechazada: 239 commits de divergencia y su modelo de alta directa conflictúa con la seguridad; el rescate se hace re-portando piezas concretas a una rama nueva.

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Lead a buzón muerto:** aprobar una solicitud hoy crea un usuario zombie (bug 409 activo); además no hay notifier real ni flag admin ON. Captar leads ahora quema prospectos reales y reputación comercial (no se revierte con git) | **Alta** si `/signup` se expone | **H** | **Kill-switch `NEXT_PUBLIC_SIGNUP_ENABLED=false` enforced** (no prosa): el form no se expone hasta que onboarding-flow-redesign cierre el 409 + haya notifier real. El contenido/SEO sí se entrega sin el form |
| CORS mal configurado → el POST falla cross-origin con error de navegador (no es 422/429/503) | **M** | **M** | Estado UI "no pudimos conectar"; añadir `www.boosterchile.com` a `CORS_ALLOWED_ORIGINS` + verificar preflight OPTIONS en e2e staging antes del flip |
| Re-introducir staleness al portar archivos de la rama vieja | M | H | Portar archivo por archivo sobre `main` real, no merge/rebase de la rama; CI (lint/type/test) como red |
| Rate-limit `rl:signup-request:<ip>` (5/15min **por IP**) compartido con la web app afecta a usuarios legítimos: una oficina B2B tras NAT comparte IP | **M** | M | Documentado; la mitigación real (separar/escalar el rate-limit) vive en su propio rediseño, no en "monitorear". No bloquea este slice (form gateado) |
| Sin contract test del 202 idempotente entre front y back → el front depende de un contrato anti-enumeration en otro paquete sin red compartida | M | M | T de contrato mínimo del shape de request `{email, nombreCompleto}`; riesgo residual aceptado documentado |
| Lighthouse/SEO no alcanza umbrales / gate frágil sobre stubs | M | M | SSG + bundle <200KB (ADR-010); Lighthouse como job **no bloqueante** (reporte) hasta que haya contenido real, luego bloqueante |
| Filtrado de enumeration si el cliente diferencia 202 submitted vs shadowed | L | H | El backend ya responde 202 idéntico; el front muestra el mismo estado siempre (T4) |

## 10. Test list

- T1 — Kill-switch: con `NEXT_PUBLIC_SIGNUP_ENABLED=false`, `/signup` renderiza "próximamente" y NO monta formulario que envíe. Con `true`, renderiza los 2 campos.
- T2 — Con el switch on: `/signup` renderiza los 2 campos + CTA; sin selector de rol ni campos de empresa.
- T3 — Submit válido → llama fetch a `/api/v1/signup-request` con `{email, nombreCompleto}` exactos; ante 202 muestra estado "solicitud en revisión".
- T4 — Validación cliente (Zod): email inválido / nombre vacío bloquean submit con error inline (no llega al backend).
- T5 — Mapeo de respuestas: 429 → "demasiados intentos"; 503 → "intenta más tarde"; 422 → errores de campo; **fallo de red/CORS → "no pudimos conectar"**. Mismo estado visible para cualquier 202 (no se infiere existencia de email).
- T6 — Contract test mínimo: el cuerpo enviado tiene exactamente las claves `{email, nombreCompleto}` y nada más (defensa del contrato anti-enumeration / shape).
- T7 — Estructural: no existen `app/checkout`, `app/pagar`, `app/api/checkout`; ningún archivo de `src` importa Flow/Stripe/dte-provider.
- T8 — `/ingresar` redirige a `app.boosterchile.com/login`.
- T9 — Cada ruta de contenido exporta `metadata` con `title` y `description` no vacíos.
- T10 — A11y: el formulario tiene labels asociados, focus visible, y el contraste de los CTAs cumple AA (verificación en review con ux-designer).

## 11. Rollout

- **Gate en dos niveles:** (a) el **contenido/SEO** es desplegable a Cloud Run + DNS en cuanto pase CI (entrega valor sin depender del downstream); (b) el **`/signup` funcional** queda detrás de `NEXT_PUBLIC_SIGNUP_ENABLED=false` (default) → "próximamente".
- **El flag es build-time** (var `NEXT_PUBLIC_*` inlinada en build): habilitar el form = **rebuild + redeploy** con la var en `true`, NO un toggle de runtime. El pipeline de prod debe hornear `false` por default. (review P1-1)
- **Condiciones del flip a `true`** (todas, en orden — CORS verificado ANTES del flag-on, review security):
  1. `www.boosterchile.com` en `CORS_ALLOWED_ORIGINS` del api **+ preflight OPTIONS verificado en staging**.
  2. `SIGNUP_REQUEST_FLOW_ACTIVATED=true` + bug 409 approve↔onboarding cerrado + notifier email real (follow-up `onboarding-flow-redesign`).
  3. **Ley 19.628**: `/legal/privacidad` con política definitiva publicada **+ consentimiento/finalidad en el form** (checkbox + link a privacidad). El form NO debe captar PII sin esto. (review security, BLOCKING para el flip)
  4. E2E de signup en staging + Lighthouse en verde (follow-up `marketing-lighthouse-blocking`).
- **Recordatorio (review P0-1)**: el endpoint `POST /api/v1/signup-request` ya es público (ADR-052); el flag/CORS controlan el form del sitio, no el endpoint. La inocuidad actual depende del downstream gateado.
- **Migration:** ninguna en este slice (no toca DB).
- **Rollback:** como no se expone a tráfico, "rollback" = no activar el deploy/DNS; revertir el merge del app si fuese necesario (app aislada, sin efectos en api/web).
- **Monitoring (cuando se habilite):** tasa de 202/429/503 del signup-request, `signup_email_sent` (cuando exista), Lighthouse CI.

## 12. Open questions

- OQ1 — ¿Capturar el segmento (transportista/generador/stakeholder) en la solicitud? **Recomendación: NO** en este slice (no tocar el endpoint gateado); si se quiere, va como spec/ADR propio que amplíe `solicitudes_registro`.
- OQ2 — El copy "próximamente"/"te contactaremos": ¿promete contacto por email o por WhatsApp/teléfono? Importa porque el notifier email real aún no existe — el copy no debe prometer un canal que no funciona. **Recomendación:** canal de contacto directo (mailto soporte / WhatsApp) en el estado "próximamente".
- OQ3 — **RESUELTA** (objeción devils-advocate O2): se construye **contenido + SEO desplegable** + el form `/signup` **gateado por kill-switch off por defecto**. No se capta tráfico de registro hasta que el downstream cierre. Esto entrega el valor SEO ya y elimina el riesgo de buzón muerto.
- OQ4 — Confirmar número de ADR (próximo libre = 060) y que supersede ADR-010 §signup/§onboarding + §checkout. (Trámite; se cierra en SHIP.)

## 13. Devils-advocate pass

Corrido el sub-agent `agent-rigor:devils-advocate` contra el draft. Output completo + tabla de resolución en [`review.md`](./review.md). Síntesis:

- **No objetó la coherencia de seguridad**: reusar `signup-request` (anónimo, no crea cuentas) no reabre el vector de alta directa; eliminar Firebase reduce superficie.
- **Corrección fáctica incorporada**: `approveSignupRequest` ya existe y precrea el `users` row → el bug 409 approve↔onboarding está **activo** (aprobar = usuario zombie). El downstream está más roto de lo escrito.
- **Objeción rectora (O1/O2/O3, P1)**: no captar leads a un buzón muerto. Resuelto subiendo el gate de §11 (antes prosa) a un **kill-switch técnico** `NEXT_PUBLIC_SIGNUP_ENABLED=false` con test; se entrega contenido/SEO (valor real) sin exponer el form.
- **Residuales (P2)**: estado UI de CORS (O4), rate-limit por IP compartido subido a M (O5), contract test del 202 idempotente (O6) — todos incorporados a §9/§10.

## 14. Approval

**Aprobado por Felipe Vicencio (PO) — 2026-06-08.** Caveat explícito: el `/signup` se construye **gateado por kill-switch `NEXT_PUBLIC_SIGNUP_ENABLED` off por defecto** (contenido+SEO desplegable, form en "próximamente"). El flip a captación pública requiere el readiness de §11.

## Decision log

- 2026-06-08 — Draft inicial. Reescritura del scope de la rama abandonada `feat/contratacion-y-alta-cuentas` para alinear al modelo gateado SEC-001/ADR-052: captación vía `signup-request` en vez de alta directa; sin Firebase client-side; sin checkout.
- 2026-06-08 — Tras devils-advocate: corregido el estado del downstream (bug 409 activo); OQ3 resuelta hacia "contenido+SEO desplegable + `/signup` gateado por kill-switch `NEXT_PUBLIC_SIGNUP_ENABLED` off por defecto"; gate de §11 convertido de prosa a mecanismo testeable; añadidos estado CORS, contract test y ajuste de rate-limit.
