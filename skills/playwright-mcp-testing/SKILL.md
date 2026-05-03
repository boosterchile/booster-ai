# Skill: Playwright MCP Testing

**Categoría**: core-engineering
**Relacionado**: `.claude/commands/test.md`, `apps/web/playwright.config.ts`, ADR pendiente sobre adopción Playwright MCP

## Overview

El servidor `@playwright/mcp` (Microsoft, oficial) le da al agente control de un navegador Chromium real desde Claude Code. El servidor expone ~70 tools (`mcp__playwright__browser_*`) que operan sobre **accessibility snapshots** (no screenshots) — determinístico, token-eficiente, sin necesidad de modelos de visión.

Este skill define **cuándo** usar el MCP en vivo, **cuándo** preferir `playwright codegen` o specs escritas a mano, y **cómo** mantener consistencia con la suite E2E del repo (`apps/web/e2e/`).

## When to Use

Usar Playwright MCP cuando:

- **Exploración de UI**: necesito entender un flujo nuevo o ajeno (ej. dashboard de stakeholder) y quiero "ver" la app sin spinear un dev server localmente.
- **Reproducir un bug reportado**: el ticket dice "el botón X no funciona en Y flujo" y quiero validar antes de escribir el fix.
- **Generar locators robustos**: con `--caps testing`, `browser_generate_locator` produce locators con la prioridad correcta (role > label > testid).
- **Auditar accesibilidad ad-hoc**: combinar `browser_snapshot` con `@axe-core/playwright` ya instalado en `apps/web`.
- **Smoke-test de un deploy preview** apuntando a una URL de staging/preview de Vercel/Cloud Run.
- **Iterar en un selector que falla**: cuando un spec E2E falla en CI y no es obvio por qué, abrir la página real con MCP y debugger.

**NO usar MCP cuando**:

- Voy a escribir un test E2E nuevo que vivirá en `apps/web/e2e/` → escribir el spec directo o usar `pnpm --filter @booster-ai/web exec playwright codegen <URL>`.
- Solo necesito correr la suite existente → `pnpm --filter @booster-ai/web test:e2e`.
- Voy a hacer scraping de un sitio externo (no es nuestro flujo) — no es lo que el MCP existe para hacer en este repo.

## Core Process

### 1. Verificar que el server MCP esté activo

```bash
# Desde el repo, Claude Code debería detectar .mcp.json automáticamente.
# Si no, validar:
ls .mcp.json && cat .mcp.json
```

Si los tools `mcp__playwright__*` no aparecen en la sesión, reiniciar Claude Code o ejecutar `/mcp` para listar servers conectados.

### 2. Navegar y tomar snapshot

Patrón canónico para empezar cualquier interacción:

1. `mcp__playwright__browser_navigate` con la URL objetivo (localhost o staging).
2. `mcp__playwright__browser_snapshot` — devuelve árbol de accessibility con refs estables.
3. Trabajar contra los `ref` del snapshot (NO contra coordenadas, NO contra screenshot).

### 3. Acciones determinísticas

Preferir siempre tools que reciben `ref`:

- `browser_click({ ref })` en lugar de `browser_mouse_click_xy`.
- `browser_fill_form({ fields: [...] })` en lugar de N `browser_type`.
- `browser_wait_for({ text | textGone | time })` en lugar de sleeps.

### 4. Verificación con `--caps testing`

- `browser_verify_element_visible({ ref })`
- `browser_verify_text_visible({ text })`
- `browser_verify_value({ ref, value })`
- `browser_generate_locator({ ref })` → produce el locator que pego en el spec.

### 5. Network mocking con `--caps network`

- `browser_route({ url, response })` para stub de APIs.
- `browser_network_requests()` para inspeccionar lo que disparó la app.
- `browser_network_state_set({ offline: true })` para simular sin red.

### 6. Storage / sesión con `--caps storage`

- `browser_storage_state()` exporta cookies + localStorage → guardar en `.playwright-mcp/auth.json`.
- `browser_set_storage_state({ path })` carga estado para skipear login en runs siguientes.

### 7. Convertir hallazgos a spec persistente

**Toda exploración con MCP termina en código tracked**. Si el hallazgo vale la pena:

1. Generar locators con `browser_generate_locator`.
2. Crear/actualizar `apps/web/e2e/<feature>.spec.ts` siguiendo el patrón ya configurado en `apps/web/playwright.config.ts:5-50` (4 proyectos: chromium, mobile-chrome, webkit, mobile-safari).
3. Correr `pnpm --filter @booster-ai/web test:e2e` y pegar evidencia en el PR.

## Configuración del MCP server

Definida en `.mcp.json` (raíz del repo, checked-in para todo el equipo). Versión actual: **completa** — todas las capabilities habilitadas.

| Flag | Valor | Razón |
|------|-------|-------|
| `--browser` | `chromium` | Match con projects de `playwright.config.ts`. |
| `--headless` | sí | Default seguro, no requiere display. |
| `--caps` | `vision,pdf,devtools,network,storage,testing` | Acceso completo a tools opt-in. |
| `--viewport-size` | `1920x1080` | Desktop full HD; mobile se cubre con specs E2E. |
| `--save-session` | sí | Persiste sesión en `--output-dir` para debug post-mortem. |
| `--output-dir` | `.playwright-mcp` | Gitignored. Traces, videos, screenshots aterrizan ahí. |

**Perfil persistente (default)**: el browser data vive en `~/.cache/ms-playwright/mcp-{channel}-{workspace-hash}` (Linux) / `~/Library/Caches/ms-playwright/...` (macOS). El hash se deriva del workspace root → aislamiento automático por proyecto. Cookies y login se preservan entre sesiones.

Para sesiones efímeras (tests aislados): añadir `--isolated` al `args` temporalmente o crear un segundo server entry en `.mcp.json` con sufijo `-isolated`.

## Permisos en Claude Code

`.claude/settings.json` (checked-in) preaprueba:

- `mcp__playwright` — wildcard, todos los tools del server sin prompt.
- `Bash(pnpm playwright:*)` — corre la suite local.
- `Bash(pnpm --filter @booster-ai/web test:e2e:*)`
- `Bash(npx playwright:*)`, `Bash(npx @playwright/mcp:*)`

Si querés permisos adicionales solo para tu máquina, ponelos en `.claude/settings.local.json` (gitignored).

## Anti-patterns

| Tentación | Por qué es un error |
|-----------|---------------------|
| Usar `browser_mouse_click_xy` porque "el ref no anduvo" | Indica que el snapshot está desactualizado o el elemento se movió. Re-snapshot antes de claudicar a coordenadas. |
| Tomar `browser_take_screenshot` para "ver" la página antes de actuar | El snapshot ya da la info estructurada. Screenshot es view-only y consume tokens innecesariamente. |
| Habilitar `browser_run_code_unsafe` para "ahorrar pasos" | RCE-equivalente en el proceso del MCP server. No tocar salvo necesidad documentada en ADR. |
| Hardcodear `ref="e123"` en specs | Los refs son efímeros (válidos solo dentro de un snapshot). Convertir a locator real con `browser_generate_locator`. |
| Saltarse `--allowed-origins` para apuntar a sitios random | El server no es security boundary, pero la allowlist evita exploración accidental fuera de Booster. |
| Dejar la exploración solo en chat (sin spec) | Hallazgo no reproducible = hallazgo perdido. Toda sesión MCP útil termina en código tracked. |

## Caveats de seguridad

- **El MCP no es un security boundary** (Microsoft lo dice explícito). Tratarlo como código del agente con privilegios de browser local.
- **`browser_run_code_unsafe`**: ejecuta JS arbitrario en el proceso del server (RCE-equivalent). No usar.
- **`--allow-unrestricted-file-access`**: NO está activado. Mantener así. El acceso a archivos está confinado al workspace.
- **`--no-sandbox`**: NO está activado. Solo activar si se corre en un container donde el sandbox de Chromium choca con el sandbox del runtime; documentar en ADR si se hace.
- **PII en sesiones persistentes**: si se hace login real (no fixture) en el browser persistente, las cookies quedan en `~/.cache/ms-playwright/...`. Limpiar periódicamente o usar `--isolated` para flujos sensibles.

## Exit Criteria

Para considerar una sesión MCP "cerrada con valor":

- [ ] El hallazgo está en código (spec, fix, o issue con repro pasos).
- [ ] Si se generaron locators, fueron consolidados en el spec correspondiente.
- [ ] No quedaron archivos sensibles en `.playwright-mcp/` (gitignored, pero igual revisar).
- [ ] Si se descubrió un bug, hay un test que lo reproduce antes del fix.
- [ ] Evidence block del PR incluye output de `pnpm --filter @booster-ai/web test:e2e`.

## Referencias

- Repo oficial: https://github.com/microsoft/playwright-mcp
- Playwright docs: https://playwright.dev/docs/intro
- Config local: `.mcp.json` (raíz)
- Permisos: `.claude/settings.json`
- Suite E2E del repo: `apps/web/playwright.config.ts`, `apps/web/e2e/`
- Skill relacionada: `skills/using-agent-skills/SKILL.md`
