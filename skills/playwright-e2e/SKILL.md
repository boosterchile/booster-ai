---
name: playwright-e2e
description: Workflow estructurado para validar UI con Playwright MCP y/o Playwright CLI
---

# Skill: playwright-e2e

> Validar el frontend `apps/web` con Playwright en sus dos modos: MCP interactivo (durante una sesión Claude Code) y scripts CI repetibles.

## When to use

- Validar feature de UI recién implementada antes de PR.
- Reproducir un bug reportado capturando evidencia.
- Auditar accesibilidad WCAG 2.1 AA.
- Generar specs nuevos para `apps/web/e2e/` cuando un flujo merece test recurrente.
- Smoke test post-deploy contra staging/prod.

## Core process

### Modo 1 — Interactivo con MCP (durante sesión Claude Code)

1. **Pre-check**:
   ```bash
   curl -fsS http://localhost:5173 || pnpm --filter @booster-ai/web dev
   ```
2. **Definir flujo**: URL inicial → acciones → aserciones → evidencia objetivo. Escribir esto **antes** de invocar el browser.
3. **Ejecutar**:
   - `browser_navigate` para abrir.
   - `browser_snapshot` (accessibility tree) en cada checkpoint relevante. Más eficiente que screenshot.
   - `browser_click` / `browser_type` / `browser_fill_form` para interactuar — usar `ref` del snapshot, no selectores brittle.
   - `browser_wait_for` con `text` o `selector` antes de leer estado.
   - `browser_console_messages` y `browser_network_requests` cuando sospechas error.
4. **Capturar evidencia**:
   - `browser_take_screenshot` con path absoluto en `apps/web/playwright-report/`.
   - Logs de consola filtrados por nivel (`error`, `warning`).
5. **Cerrar**: `browser_close`.

### Modo 2 — Spec persistido en `apps/web/e2e/`

Cuando el flujo merece test recurrente:

1. **Crear archivo** `apps/web/e2e/<feature>.spec.ts`:
   ```ts
   import { test, expect } from '@playwright/test';
   import AxeBuilder from '@axe-core/playwright';

   test.describe('<feature>', () => {
     test.beforeEach(async ({ page }) => {
       // setup: login, fixtures
     });

     test('<flujo>', async ({ page }) => {
       await page.goto('/');
       // ...
       await expect(page.getByText('...')).toBeVisible();
     });

     test('a11y WCAG 2.1 AA', async ({ page }) => {
       await page.goto('/');
       const results = await new AxeBuilder({ page })
         .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
         .analyze();
       expect(results.violations).toEqual([]);
     });
   });
   ```

2. **Locators robustos** (en orden de preferencia):
   - `getByRole('button', { name: 'Publicar' })` — preferido (a11y first).
   - `getByLabel('Email')` — formularios.
   - `getByText('...')` — textos visibles.
   - `getByTestId('...')` — solo si los anteriores no aplican.
   - **Evitar**: CSS selectors brittle, XPath, `nth-child`.

3. **Correr**:
   ```bash
   pnpm --filter @booster-ai/web test:e2e
   pnpm --filter @booster-ai/web test:e2e -- --grep "<feature>"
   pnpm --filter @booster-ai/web test:e2e --project=mobile-chrome
   pnpm --filter @booster-ai/web test:e2e --ui          # interactive
   pnpm --filter @booster-ai/web test:e2e --debug       # debugger
   ```

### Modo 3 — Smoke staging/prod

```bash
BASE_URL=https://staging.boosterchile.com pnpm --filter @booster-ai/web test:e2e -- --grep "smoke"
```

Specs marcados con `@smoke` en describe corren contra el environment apuntado.

## Cobertura mínima por surface (ADR-008)

| Surface | Tests requeridos |
|---------|------------------|
| `/login` | login OK, login KO, RoleGuard redirect, a11y |
| `/app/cargas` (shipper) | listar activas, crear, cancelar, ver detalle, a11y |
| `/app/ofertas` (carrier) | listar, aceptar, rechazar, a11y |
| `/cargas/:id/track` | live tracking renderiza mapa, ETA visible, a11y |
| `/vehiculos` (carrier) | CRUD completo, a11y |
| `/certificados` | listar, descargar PDF, verify, a11y |
| Chat realtime | enviar mensaje, recibir SSE, fallback WhatsApp visible |

## Anti-rationalizations

| Tentación | Por qué es un error |
|-----------|---------------------|
| Selectores CSS o XPath | Frágiles ante refactor, anti-a11y. Usa `getByRole`/`getByLabel`. |
| `setTimeout` para esperar | Race conditions garantizadas. Usa `browser_wait_for` o `expect.toBeVisible()`. |
| Solo Chromium | El 60% del tráfico es mobile. Mínimo: chromium + mobile-chrome. |
| Test sin a11y check | WCAG 2.1 AA es contractual con stakeholders ESG. |
| Datos de producción | Riesgo legal + flakiness. Fixtures dedicados. |
| Snapshot diff con `toMatchSnapshot` para todo | Snapshot diffs en CI son ruido. Usar solo para componentes visualmente críticos. |

## Exit criteria

- [ ] Flujo cubre golden path + ≥1 edge case.
- [ ] Locators usan `getByRole`/`getByLabel`/`getByText` (no CSS selectors).
- [ ] A11y check con `@axe-core/playwright` para la página principal del flujo.
- [ ] Tests pasan en `chromium` y `mobile-chrome` mínimo.
- [ ] Evidencia (screenshot, video, trace) en `apps/web/playwright-report/` para PR.
- [ ] Si era spec persistido: incluido en `apps/web/e2e/` y `pnpm test:e2e` pasa.

## Referencias

- Config: `apps/web/playwright.config.ts`
- Slash command: `.claude/commands/e2e.md`
- Workflow doc: `docs/CLAUDE-CODE-WORKFLOW.md` §11
- ADR-008 (PWA multi-rol): `docs/adr/008-pwa-multirole.md`
