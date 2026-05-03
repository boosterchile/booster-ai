---
description: Validar UI con Playwright MCP — navegar, snapshot, asserts, evidencia
---

# /e2e — Validación E2E con Playwright MCP

Usa el MCP de Playwright (configurado en `.mcp.json`) para navegar `apps/web` real, ejecutar flujos de usuario, capturar evidencia y opcionalmente persistir el flujo como spec en `apps/web/e2e/`.

## Cuándo usar

- Validar feature de UI recién implementada antes de PR.
- Reproducir un bug reportado y capturar evidencia visual.
- Auditar accesibilidad WCAG 2.1 AA con `@axe-core/playwright`.
- Smoke test post-deploy de staging/prod.
- Generar tests E2E nuevos (el agente explora, luego materializa el spec).

## Proceso

1. **Verificar dev server arriba**:
   ```bash
   curl -fsS http://localhost:5173 || pnpm --filter @booster-ai/web dev
   ```
   O configurar `BASE_URL=https://staging.boosterchile.com` para staging.

2. **Definir el flujo** explícitamente antes de tocar el browser:
   - URL inicial
   - Acciones (click, fill, navigate)
   - Aserciones esperadas
   - Evidencia objetivo (screenshot, snapshot a11y, network log)

3. **Ejecutar via Playwright MCP**:
   - Funciones disponibles: `browser_navigate`, `browser_click`, `browser_type`, `browser_fill_form`, `browser_select_option`, `browser_snapshot` (accessibility tree), `browser_take_screenshot`, `browser_console_messages`, `browser_network_requests`, `browser_wait_for`, `browser_evaluate`, `browser_press_key`, `browser_drag`, `browser_hover`, `browser_file_upload`, `browser_tabs`, `browser_resize`, `browser_close`.
   - Empezar con `browser_snapshot` (más eficiente que screenshot, retorna accessibility tree).
   - Capturar `browser_console_messages` y `browser_network_requests` si hay sospecha de error.

4. **Generar evidencia** en sección "Evidencia" del PR:
   - Screenshot de estados clave (`browser_take_screenshot` con path en `apps/web/playwright-report/`)
   - Output de console messages relevantes
   - Network requests relevantes (status, latencia)
   - Si hay a11y check: violations array de axe-core

5. **Persistir como spec si aplica**:
   - Si el flujo será regresión recurrente → escribir `apps/web/e2e/<flujo>.spec.ts`
   - Si era validación puntual → solo evidencia en PR, no persistir

6. **Cerrar browser** al terminar (`browser_close`).

## Patrones útiles

### Smoke test de surface

```
1. browser_navigate(http://localhost:5173/cargas)
2. browser_snapshot()  → verificar elementos clave en accessibility tree
3. browser_take_screenshot()  → evidencia visual
4. browser_console_messages()  → 0 errores
```

### Flujo end-to-end

```
1. browser_navigate(/login)
2. browser_fill_form([{Email, x@y.cl}, {Password, ***}])
3. browser_click(button "Ingresar")
4. browser_wait_for(text "Mis cargas")
5. browser_click(button "Publicar carga")
6. browser_fill_form(...)
7. browser_click(button "Publicar")
8. browser_wait_for(text "Carga publicada")
9. browser_take_screenshot()
```

### A11y audit

```
1. browser_navigate(/app/cargas)
2. browser_evaluate("await new AxeBuilder({page}).withTags(['wcag2aa']).analyze()")
3. Verificar violations === []
```

### Mobile viewport

```
1. browser_resize({ width: 393, height: 851 })   // Pixel 5
2. browser_navigate(...)
3. browser_snapshot()
```

## Anti-rationalizations

| Tentación | Por qué es un error |
|-----------|---------------------|
| "Solo screenshot, sin snapshot a11y" | El a11y tree es más eficiente y más útil para debug que un PNG de 1MB. |
| "No capturo console messages" | Errores de runtime en consola se pierden y aparecen como "bugs misteriosos" después. |
| "Skip cerrar browser" | Procesos huérfanos consumen recursos del sandbox. |
| "El test pasa en mi máquina, no necesito mobile-chrome" | El 60% del tráfico de Booster es mobile. |
| "Reuso fixtures de prod" | Nunca uses datos reales en E2E. Usa fixtures dedicados. |

## Exit criteria

- [ ] Flujo ejecutado end-to-end sin errores no esperados en consola.
- [ ] Evidencia (screenshot + snapshot + network) adjunta al PR.
- [ ] Si era flujo recurrente: spec persistido en `apps/web/e2e/<slug>.spec.ts`.
- [ ] `pnpm --filter @booster-ai/web test:e2e` pasa para los specs nuevos.
- [ ] Browser cerrado.

## Referencias

- Config: `apps/web/playwright.config.ts` (4 projects: chromium, mobile-chrome, webkit, mobile-safari)
- Skill detallado: `skills/playwright-e2e/SKILL.md`
- Workflow doc: `docs/CLAUDE-CODE-WORKFLOW.md` §5 y §11
