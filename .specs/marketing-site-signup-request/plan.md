# Plan: marketing-site-signup-request

- Spec: .specs/marketing-site-signup-request/spec.md (Status: Approved)
- Created: 2026-06-08
- Status: Active
- Revisión: v2 (post devils-advocate — frontload de riesgo, fix P0 coverage + contrato)

## Módulos tocados (≤10)

1. `apps/marketing/` (nuevo) — app, config, rutas, componentes, libs, tests
2. `.github/workflows/ci.yml` — wiring del nuevo workspace + Lighthouse
3. `docs/adr/067-*.md` (nuevo) — supersede ADR-010 §signup/§checkout
4. `packages/shared-schemas` — **solo import** (derivar schema cliente, no editar)

Sin tocar el backend (`apps/api`), `apps/web`, DB. El sitio consume `POST /api/v1/signup-request` tal cual.

## Decisiones de diseño fijadas en el plan (cerrando ambigüedades del spec §7)

- **Mecanismo del POST: `fetch` directo desde el cliente** (no server action). Razón: el modelo de CORS browser cross-origin es el que el spec §9 analiza y el que `§11` debe verificar; un server action lo proxearía server-side y cambiaría el modelo. Fijado en T3.
- **Schema cliente derivado, no espejado**: `signupRequestSchema.pick({ email: true, nombreCompleto: true })` desde `@booster-ai/shared-schemas` (`domain/signup-request.ts`). Es la red de contrato más cercana sin tocar backend.
- **Kill-switch de doble nivel**: (1) `NEXT_PUBLIC_SIGNUP_ENABLED=false` → el form **ni se importa** (dynamic import gated), no solo "no se renderiza"; (2) defensa de respaldo = `www.boosterchile.com` ausente de `CORS_ALLOWED_ORIGINS` hasta el flip (§11). Un flag `NEXT_PUBLIC_*` solo es client-side y débil por sí mismo.

## Tasks (ordenadas para aprender lo riesgoso primero)

### T1: Scaffold `apps/marketing` + home stub + coverage acotado
- Files: `apps/marketing/{package.json, next.config.ts, tsconfig.json, tailwind.config.ts, postcss.config.mjs, vitest.config.ts, src/app/layout.tsx, src/app/page.tsx (stub), src/app/globals.css}`
- LOC estimate: ~130 — **waiver: config-heavy sin lógica** (ledger).
- Depends on: none
- Acceptance: `build` + `lint` + `typecheck` 0 errores (SC1) **Y** `coverage.include` acotado a archivos con lógica (excluye `app/`, config, `layout`) de modo que el smoke test del home alcance ≥80/75/80 — **T1 debe pasar el gate de CI sola** (fix P0-1).
- Rollback: `rm -rf apps/marketing`.

### T2: Gate estructural no-checkout (frontload SC4)
- Files: `apps/marketing/src/no-checkout.test.ts`
- LOC estimate: ~35
- Depends on: T1
- Acceptance: falla si aparece ruta `app/checkout|pagar|api/checkout` o un import de Flow/Stripe/`dte-provider` (SC4). Pasa desde ya (red de seguridad temprana).
- Rollback: eliminar el test.

### T3: `env` + `signup-client` (schema derivado, fetch directo)
- Files: `apps/marketing/src/lib/{env.ts, signup-client.ts}` + tests
- LOC estimate: ~85
- Depends on: T1
- Acceptance: `env.ts` parsea con Zod `NEXT_PUBLIC_API_URL` + `NEXT_PUBLIC_SIGNUP_ENABLED` (default false); `signup-client` deriva el body schema vía `signupRequestSchema.pick({email,nombreCompleto})` y postea por `fetch` exactamente esas claves (§10 T6 = client body-shape test, **no** "contract test del backend"). Sin Firebase.
- Rollback: eliminar las 2 libs.

### T4: `/signup` — kill-switch enforced + "próximamente" + render del form
- Files: `apps/marketing/src/app/signup/{page.tsx, signup-gate.tsx, coming-soon.tsx}`, `apps/marketing/src/components/signup-form.tsx` (solo render) + tests
- LOC estimate: ~100
- Depends on: T3
- Acceptance: con `NEXT_PUBLIC_SIGNUP_ENABLED=false` renderiza "próximamente" **y el módulo del form no se importa** (dynamic import gated) — verificado por test (SC8 enforcement, no solo render, fix P1-3); con `true` renderiza los 2 campos sin selector de rol/empresa (§10 T1/T2); a11y del form (§10 T10).
- Rollback: eliminar `/signup`.

### T5: `/signup` — submit + mapeo de respuestas + estado CORS
- Files: `apps/marketing/src/components/signup-form.tsx` (submit), `apps/marketing/src/app/signup/error-map.ts` + tests
- LOC estimate: ~100
- Depends on: T4, T3
- Acceptance: submit válido → `postSignupRequest({email,nombreCompleto})`; 202 → "solicitud en revisión" **y el handler NO lee `response.body`** (defensa anti-enumeration del lado cliente, fix P0-2 acceptance vacuo); 422/429/503 + **fallo de red/CORS** → mensajes legibles (SC2, SC3, §10 T3/T4/T5).
- Rollback: revertir la lógica de submit (form vuelve a render-only de T4).

### T6: Primitivos UI (PageShell + Hero) sobre `@booster-ai/ui-tokens`
- Files: `apps/marketing/src/components/{PageShell.tsx, Hero.tsx}` + tests
- LOC estimate: ~80
- Depends on: T1
- Acceptance: render ok; sin emojis como íconos (SVG), focus visible, contraste AA (§10 T10, §6.7).
- Rollback: eliminar los 2 componentes.

### T7: Contenido de conversión — home real + `/soluciones/*` + `/precios` + `/esg`
- Files: `apps/marketing/src/app/{page.tsx, soluciones/**, precios, esg}/page.tsx` + tests metadata
- LOC estimate: ~140 — **waiver: contenido SEO real (SC6 + §1), bajo riesgo** (ledger). Páginas con CTA a `/signup`.
- Depends on: T6
- Acceptance: rutas renderizan con `metadata` title+description no vacíos (SC6, §10 T9); CTAs enlazan a `/signup`.
- Rollback: eliminar esas rutas + restaurar home stub.

### T8: Contenido editorial/legal — `/casos`, `/blog`, `/sobre`, `/contacto`, `/legal/{terminos,privacidad}`, `/ingresar`
- Files: esas `page.tsx` + test de redirect
- LOC estimate: ~110 — **waiver: lote de contenido bajo riesgo** (ledger). Editorial = stubs con metadata (spec §5).
- Depends on: T6
- Acceptance: SC6 (metadata); `/ingresar` usa `redirect()` **server-side (308)** a `app.boosterchile.com/login` por SEO (SC5, §10 T8, fix P2-3).
- Rollback: eliminar esas rutas.

### T9: Wiring CI del workspace + job Lighthouse (reporte)
- Files: `.github/workflows/ci.yml`
- LOC estimate: ~60
- Depends on: T7, T8 (rutas existen)
- Acceptance: CI corre lint/type/test/coverage de `@booster-ai/marketing` (SC7); job Lighthouse en modo reporte. Se crea follow-up stub `.specs/_followups/marketing-lighthouse-blocking.md` con criterio concreto de activación bloqueante (fix P2-2 — no dejar "no bloqueante" sin ticket).
- Rollback: revertir `ci.yml`.

### T10: ADR-067 + `.env.example`
- Files: `docs/adr/067-marketing-site-signup-request-gated.md`, `apps/marketing/.env.example`
- LOC estimate: docs (~120, exento)
- Depends on: none (Status Accepted al mergear en SHIP)
- Acceptance: cierra OQ4; supersede ADR-010 §signup/§onboarding + §checkout; documenta el modelo gateado + kill-switch doble nivel; `.env.example` lista las 2 `NEXT_PUBLIC_*`.
- Rollback: eliminar el ADR.

## Out-of-band tasks

- Añadir `www.boosterchile.com` a `CORS_ALLOWED_ORIGINS` del api — paso de habilitación (§11), no de este ciclo.
- Flip `NEXT_PUBLIC_SIGNUP_ENABLED=true` — solo tras cerrar el bug 409 + notifier real (`onboarding-flow-redesign`) + E2E staging (incl. preflight OPTIONS).
- Deploy Cloud Run + domain mapping `www.boosterchile.com` (skill `booster-deploy-cloud-run`) — al habilitar.
- **Follow-up (P0-2 residual):** endurecer `signupRequestBodySchema` del backend a `.strict()` — hoy descarta claves extra silenciosamente. Stub aparte, no toca este slice.
- Follow-up Lighthouse bloqueante (creado en T9).

## Open questions (resolver durante /build)

- OQ-copy (spec OQ2): texto de "próximamente" — canal de contacto directo (mailto soporte / WhatsApp), sin prometer email automático. Se decide en T4.
- Confirmar que `pnpm-workspace.yaml` ya incluye `apps/*` (si sí, T1 no lo edita).

## Devils-advocate pass (PLAN)

Output completo + resolución en [`review.md`](./review.md) (sección PLAN). P0-1 (coverage gate) y P0-2 (contrato mal etiquetado / acceptance vacuo) resueltos en T1/T3/T5; reorden de riesgo (P1-1), split de contenido por valor (P1-2) y enforcement del kill-switch (P1-3) incorporados; residuales P2-1..P2-4 cerrados o documentados.
