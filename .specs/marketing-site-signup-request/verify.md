# Verify: marketing-site-signup-request

- Fecha: 2026-06-08
- Rama: `feat/marketing-site-signup-request` (desde `main` real `517859a`)
- Fase: VERIFY

## Test results

| Tipo | Resultado |
|---|---|
| Unit (lib: env, signup-client) | ✓ |
| Component (signup-form, signup-feedback, coming-soon, PageShell, Hero) | ✓ |
| Route (home, signup gate on/off, ingresar redirect, content-metadata ×13) | ✓ |
| **Total vitest** | **59 / 59 (12 archivos)** |
| Integration / E2E | N/A en este slice (ver UI verification + BAJA-1) |

Gates de CI (todos vía turbo monorepo + biome, T9):
- **Build** (`next build`): ✓ — 18 rutas, todas prerenderizadas estáticas; `/signup` 133 kB (con form), resto ≤105 kB (objetivo <200 kB ADR-010).
- **Coverage** (v8): **100%** stmts (40/40), branches (32/32), funcs (10/10), líneas (40/40) sobre `src/lib` + `src/components`. ≥ gate 80/75/75/80.
- **Lint** (Biome): 0 errores / 0 warnings.
- **Typecheck** (`tsc --noEmit`): 0 errores.

## Mapeo SC (§3) → tests

| SC | Cubierto por |
|---|---|
| SC1 build/lint/typecheck | `next build` + CI gates |
| SC2 form postea `{email,nombreCompleto}` a signup-request, 202→revisión | `signup-client.test` + `signup-form.test` (submit + integración fetch) |
| SC3 mapeo 422/429/503 + red/CORS | `signup-client.test` (incl. 4xx no-mapeado) + `signup-feedback.test` + `signup-form.test` |
| SC4 sin checkout/PSP/DTE | `no-checkout.test` (deps + rutas + imports) |
| SC5 `/ingresar` redirect | `ingresar/page.test` (permanentRedirect 308 a app login) |
| SC6 metadata por ruta | `content-metadata.test` (13 rutas, title+description) |
| SC7 coverage ≥80% | gate de CI (coverage-summary, turbo) |
| SC8 kill-switch enforced | `signup/page.test` (off → ComingSoon; **on → monta form**) |

## Test-engineer findings (sub-agent) + resolución

| # | Sev | Hallazgo | Resolución |
|---|---|---|---|
| ALTA-1 | alta | El on-path del kill-switch (`flag=true`→monta form) no se testeaba; invertir el gate quedaba verde (control de seguridad central sin red en su rama positiva) | **Cerrado**: test on-path en `signup/page.test.tsx` (`true` → `findByLabelText('Email')`, ComingSoon ausente). `next/dynamic` resuelve en vitest. |
| ALTA-2 | alta | T4 solo probaba submit vacío; el `.email()` del resolver no era load-bearing | **Cerrado**: test con email malformado (`"ana"`) → error inline + `submitRequest` no llamado. |
| MEDIA-1 | media | El default del client solo se probaba con 500; un 4xx (401/403) mapeaba a `unavailable` sin test | **Cerrado**: casos 403/401 agregados a la tabla de mapeo. |
| MEDIA-2 | media | El JSDoc de `vitest.config` afirmaba que `src/app/**` se incluía en coverage; el `exclude` lo niega | **Cerrado**: comentario corregido a la verdad (app/** se cubre con `next build` SSG + tests de ruta, no unit coverage). |
| MEDIA-3 | media | Anti-enumeration end-to-end: no hay test de DOM idéntico del form entre dos `submitted` | **Aceptado (defensa en profundidad)**: el front nunca lee el body del 202 (testeado en `signup-client.test`) y `signupFeedback('submitted')` es determinista — la igualdad de salida está forzada por diseño. No se agrega test redundante. |
| BAJA-1 | baja | Defensa nivel 2 (CORS) no testeable en unit; no hay `e2e/` | **Gate de SHIP** (no unit): E2E de preflight OPTIONS / CORS en staging antes del flip del flag (§11). |
| BAJA-2 | baja | `isSubmitting` (botón disabled durante POST) sin aserción de efecto | **Aceptado (minor)**: el branch `disabled` está cubierto por coverage; el efecto anti-doble-submit es secundario al rate-limit por IP del backend. |

Lo sólido (no tocar): contrato anti-enumeration del client (202 no lee body), shape de 2 claves, gate fail-closed de env, guarda no-checkout.

## UI verification

Verificación basada en navegador (Lighthouse, axe-core, screenshots 375/768/1024/1440, screen reader) **DIFERIDA** al gate de habilitación (§11), porque el sitio está gateado y sin desplegar; se ejecuta con contenido real (followup `marketing-lighthouse-blocking`). No se reportan números de Lighthouse fabricados ni de laptop-only (regla VERIFY).

a11y verificada en este slice por diseño + lint:
- Biome reglas a11y: 0 violaciones (incl. `useSemanticElements` → `<output>` para el estado de éxito).
- Labels asociados (`htmlFor`/`id`) en los inputs del form; `role="alert"` en errores, `<output>` (status) en éxito.
- `:focus-visible` global, `prefers-reduced-motion` respetado (globals.css); sin emojis como íconos; `cursor-pointer` en clickables.

## Performance verification

Presupuesto ADR-010 (<200 KB inicial): cumplido en build — todas las rutas ≤133 KB First Load JS. Lighthouse formal diferido (ver UI verification).

## Veredicto

Suite verde (59/59), 100% coverage, gates limpios, hallazgos del test-engineer cerrados o aceptados con justificación. **Listo para REVIEW** (con cooling-off solo-dev de 30 min o waiver).
