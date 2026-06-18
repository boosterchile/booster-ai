# Followup: gate Lighthouse BLOQUEANTE para apps/marketing

**Status**: Stub — NOT started. Diferido desde `marketing-site-signup-request` T9 (2026-06-08).
**Priority**: P2 — no bloquea el sitio gateado; se activa al habilitarlo.

## Por qué existe (y por qué NO se hizo ahora)

El plan T9 contemplaba un job Lighthouse "en modo reporte (no bloqueante)". El devils-advocate (review P2-2) objetó que un job no-bloqueante que nunca se vuelve bloqueante es **CI theater**: corre, reporta, nadie gatea. Hoy además:

- El sitio está **gateado** (`NEXT_PUBLIC_SIGNUP_ENABLED=false`) y **sin desplegar** (§11): la señal Lighthouse no es accionable todavía.
- El contenido editorial/legal es **stub** (spec §5): medir SEO/perf sobre stubs da números no representativos y un gate frágil (un `<img>` sin dimensiones en un stub futuro rompe el build sin valor real).

Por eso T9 **no agregó el job** (evita tocar `ci.yml`, un archivo de quality-gate, sin valor) y dejó este follow-up con criterio de activación concreto.

Nota: el resto del CI de marketing (lint Biome, typecheck, test + coverage ≥80%, build) **ya corre** vía los jobs monorepo-wide de turbo + `biome check .` — verificado en T9 (marketing está en el grafo turbo de `build`/`typecheck`/`test:coverage`). No requirió cambios en `ci.yml`.

## Criterio de activación (cuándo hacerlo)

Activar cuando se cumplan AMBOS:

1. **Contenido real** en las rutas de conversión (`/`, `/soluciones/*`, `/precios`, `/esg`) — no stubs (cierre del trabajo de contenido/MDX de ADR-010).
2. **El sitio se está habilitando** per `marketing-site-signup-request` §11 (CORS + `NEXT_PUBLIC_SIGNUP_ENABLED` flip + deploy a Cloud Run / DNS).

## Scope cuando se haga (ciclo propio: spec → plan → build → review → ship)

- Job CI nuevo (`.github/workflows/ci.yml` o workflow dedicado) que:
  - Hace `pnpm --filter @booster-ai/marketing build` + sirve el app (`next start` o export estático).
  - Corre Lighthouse contra las rutas clave (home + `/precios` + una de soluciones) con `@lhci/cli` o `treosh/lighthouse-ci-action`.
  - **Bloqueante** con los umbrales de ADR-010 §Validación / spec §6.6:
    - SEO = 100
    - Performance ≥ 90 (mobile)
    - Accessibility ≥ 95
  - Se suma a `ci-success.needs` (a diferencia del modo reporte).
- Definir presupuesto de performance (bundle <200KB inicial, ADR-010) como assertion adicional.

## Referencias

- `.specs/marketing-site-signup-request/spec.md` §6.6 (constraints SEO/perf/a11y), §11 (gate de habilitación), §SC6.
- `.specs/marketing-site-signup-request/review.md` P2-2.
- ADR-010 §Validación (Lighthouse SEO=100 / Perf≥95 / A11y≥95).
