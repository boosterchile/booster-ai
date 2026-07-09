# D2 — Ola 0: cimiento de `packages/ui-components`

**Estado**: aceptada (PO aprobó las dos decisiones abiertas en el checkpoint de reconocimiento, 2026-07-09).
**Ancla**: `DESIGN.md §4.2` — *"El sistema da simplicidad al conductor y potencia-sin-fricción al operador **con los mismos componentes base, configurados distinto**"*. Deriva de D1 (tokens theme-able en runtime vía `data-accent`). El agente implementa; la identidad ya está definida.

## Decisiones FIJADAS (no re-decidir)

- **Registro/densidad = CSS-driven por `data-attribute`**, replicando el patrón runtime de `data-accent` de D1: un ancestro setea `data-register` / `data-density` y las primitivas responden vía **custom properties** (no state JS). El Provider React **solo** setea el atributo y expone un hook de lectura para el caso raro.
- **`ui-components` = primitivas tontas, sin personalidad.**
- **Token home** (checkpoint 2026-07-09): los tokens CSS de registro/densidad viven en `ui-tokens/theme.css` vía **codegen** (misma fuente única + drift-guard que el acento). `ui-components` aporta el Provider React + `cn()`; `ui-tokens` sigue siendo dueño de todas las custom properties.
- **`tailwind-merge`/`clsx`** (checkpoint 2026-07-09): dueño único = `ui-components` con `tailwind-merge ^3` (línea compatible con Tailwind 4; la v2 es legacy). Se retira el dep colgante `^2.5.5` + `clsx` de `apps/web` (nadie lo importaba).

## Entradas

- `packages/ui-tokens/src/*.ts` (fuente de tokens) + `scripts/generate-theme-css.ts` (codegen) + `theme.css` (generado).
- `packages/ui-components/` (stub SKELETON: `index.ts` + smoke test, deps vacías).
- `apps/web/src/routes/apariencia.tsx` (demostrador runtime de D1; superficie para el toggle).
- React `^18.3.1`, Tailwind `4.3.0` (CSS-first, `@theme` en `theme.css`).

## Salidas / criterios de éxito verificables

1. **`cn()`** en `ui-components` (`clsx` + `tailwind-merge ^3`), con test unitario que incluye **≥1 conflicto de clases resuelto por `tailwind-merge`** (p.ej. `cn('px-2','px-4') === 'px-4'`) y ≥1 caso condicional. Pasa en CI (clean-install).
2. **Registro/densidad CSS-driven**: `theme.css` (regenerado desde TS) emite custom properties parametrizadas (`--touch-min`, `--pad-y`, `--pad-x`, `--gap`, `--density-scale`) con bloques `[data-register='operador'|'conductor']` y `[data-density='comoda'|'compacta']`. Densidad escala padding/gap vía `calc(base * --density-scale)`; `--touch-min` es piso por registro (a11y, no se escala por densidad).
3. **Provider React** `RegisterProvider` (setea `data-register`/`data-density` en un ancestro) + hook `useRegister()` (lectura). Las primitivas **no** leen state JS. Test jsdom: el ancestro lleva los atributos y `useRegister()` los devuelve.
4. **Demostrable en runtime**: en `/apariencia`, alternar `data-register`/`data-density` cambia el rendering de un elemento de muestra (consume `var(--touch-min)`/`var(--pad-y)`) **sin rebuild** — mismo patrón que `data-accent`. Test que verifica el flip del atributo.
5. **D1 intacto**: drift-guard (`css.test.ts`) y contrast test (`contrast.test.ts`) en verde tras regenerar `theme.css`. Sin regresión del codegen ni del acento.
6. **Higiene**: `apps/web` sin el dep colgante `tailwind-merge`/`clsx`; `ui-components` con `react`/`react-dom` como peerDeps. Coverage ≥80% en código nuevo. Lint (Biome, `noExplicitAny`/`useImportType`), typecheck y build verdes.

## Valores del sistema registro/densidad (Ola 0, ajustables)

| Custom property | operador (default) | conductor | notas |
|---|---|---|---|
| `--touch-min` | `44px` | `56px` | piso de target táctil por registro; conductor = guantes/movimiento/sol (§4.1, §6). No lo escala densidad (a11y). |
| `--pad-y-base` | `0.5rem` | `0.875rem` | base vertical, escalada por densidad |
| `--pad-x-base` | `0.75rem` | `1.25rem` | base horizontal, escalada por densidad |
| `--gap-base` | `0.5rem` | `0.75rem` | base de gap, escalada por densidad |

`--density-scale`: `comoda` = `1` (default) · `compacta` = `0.8`. Computados en `:root`: `--pad-y|--pad-x|--gap = calc(base * --density-scale)`.

## Verificación

- **Vinculante**: CI en clean-install (`pnpm install --frozen-lockfile` + `pnpm test:coverage`/`lint`/`typecheck`/`build`), no "verde local". Node 24 (el repo lo pinnea; local está en 26 → red/green de `apps/web` puede diverger, el binding es CI).
- Drift-guard: `pnpm --filter @booster-ai/ui-tokens gen:css` no debe producir diff tras commitear.

## Fuera de alcance (Ola 1+)

- Primitivas reales (Button, Input, Card…) — Ola 1 las consume sobre este cimiento.
- Migrar `FormField.inputClass` a `cn()` — Ola 1.
- Exponer el selector de registro/densidad al usuario final por rol — este PR solo lo demuestra en `/apariencia`.
- Modo una-mano, tamaño de letra dinámico, alto contraste (D3).

## Condición de término

Todos los criterios (1–6) en verde con evidencia fresca del CI. PR-B abierto contra `main`, **no mergeado** (gate PO, ADR-072). El agente termina turno.
