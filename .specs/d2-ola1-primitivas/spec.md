# D2 — Ola 1: 5 primitivas (Button, Badge, Card, Input, Toast)

**Estado**: aceptada (goal del PO, 2026-07-09). Modal fuera (depende del spike React Aria).
**Prereq**: Ola 0 (#577) + DESIGN.md (#578) en main — `cn()`, `RegisterProvider`, registro/densidad CSS-driven ya existen.
**Ancla**: DESIGN.md §4.5 (tres grupos de componentes) + D-15/D-16 (eje no universal, primitivas tontas) + D-17 (React Aria, no en esta ola).

## Marco sellado (no reabrir)

- **Grupos**: duales = Button/Card/Input (responden a `data-register`/`data-density` vía custom properties de Ola 0); semántico-fijo = Badge (no lee acento ni registro); Toast = dual-sistema.
- **Cero personalidad** en las primitivas (los "momentos humanos" son otra capa, D-16).
- a11y **real verificada** — no hay runner axe/Playwright en el repo: se agrega **`vitest-axe`** a ui-components (ya con jsdom + testing-library por Ola 0). No traer Playwright.

## Entradas

- Tokens D1 (`@booster-ai/ui-tokens`): color (`accent-*`, `neutral-*`, semánticos `success/warning/danger/info`), `zIndex.toast`, `registerScales`.
- Custom properties de Ola 0: `--touch-min`, `--pad-y`, `--pad-x`, `--gap`, `--density-scale` (de `theme.css`).
- `cn()` + `RegisterProvider` (Ola 0).

## Salidas / criterios de éxito

**Globales**: tokens D1 por nombre real, **cero hardcode** (hex/px/rgb en las primitivas = vacío); duales responden al registro **vía custom properties** (no reimplementan tamaños); Badge no lee `--accent-*` ni registro; sin personalidad; **vitest-axe corre de verdad** por componente e integrado a `test:coverage`; coverage ≥80% con los nuevos; todos los gates ci.yml verdes en clean-install.

**Por componente**:
- **Button** (dual): variants `primary`/`secondary`/`ghost`/`danger`; touch conductor ≥44px (vía `--touch-min`, token `registerScales.conductor.touchMin`=56px); estados default/hover/active/disabled/loading; `disabled` nativo real, `aria-busy` en loading; blindaje #576 (text-white).
- **Badge** (semántico-fijo): `success`/`error`/`warning`/`info`/`neutral` (pares `statusXxxBg/Fg` de D1, `error`→danger); estado por texto; sin acento/registro.
- **Card** (dual): envoltura + Header/Body/Footer; padding por registro; sin lógica.
- **Input** (dual): `<input>` puro; `aria-invalid` en `invalid`, `aria-describedby` reenviado; labeling por el consumidor. **FormField NO se migra acá** (PR aparte).
- **Toast** (dual-sistema): `ToastProvider`+`useToast`; portal; `role=alert`/`assertive` si `error`, si no `role=status`/`polite`; timers, dismiss por teclado (botón Cerrar nativo); **sin focus-trap**, no roba foco; z-index `zIndex.toast`.

**Demostrable**: los 5 en `/apariencia`, dentro del `RegisterProvider` (responden al toggle de registro/densidad) y con el acento activo (el `primary` del Button tematiza).

## Decisiones tomadas (sabor / *(lean)* resueltos)

- **`primary` del Button usa el ACENTO** (`bg-accent-600 text-white`), no `primary-600`: `#576` fue el fix del botón de acento y `accent-presets.ts` verificó contraste para "botón ~600 + blanco". Así el `primary` tematiza por rol (demostrable en /apariencia). `danger` = semántico fijo.
- **`@source` en `apps/web/styles.css`** → `../../../packages/ui-components/src`: Tailwind 4 no escanea node_modules/workspaces; sin esto las clases usadas dentro de las primitivas no se generan en el bundle. Verificado: `bg-success-50`, `border-success-500`, etc. presentes en el CSS build.
- **Foco visible**: lo aporta el `*:focus-visible` global de la app (token `focusRing` de marca) sobre los elementos nativos focusables; no se hornea un ring por componente (evita doble-ring y hardcode).
- **Blindaje #576**: jsdom no soporta `@layer` ni aplica el CSS de Tailwind (y no traemos Playwright) → no se puede computar "text-white=blanco" en unidad. Se blinda en dos mitades: guard de fuente en `apps/web/styles-reset.test.ts` (el reset sigue en `@layer base`) + `button.test` (Button aplica `text-white`).
- **vitest-axe**: el `extend-expect` de la lib augmenta el namespace global `Vi` (API vieja) que **vitest 4 no lee** → tipos vía `declare module 'vitest'` (`src/vitest-axe.d.ts`) + registro runtime en `vitest.setup.ts`. `color-contrast` deshabilitado en axe (jsdom sin layout/canvas; el contraste ya lo cubre `ui-tokens/contrast.test.ts`).

## Verificación

- Vinculante: **CI clean-install** (Install·Lint·Typecheck·Test+Coverage≥80%·Build·Integration·Docker). Local: node 24 (el repo lo pinnea).

## Fuera de alcance

- Modal (goal siguiente, con POC de React Aria).
- Migrar `FormField.tsx` a `Input` + `cn()` (PR aparte).
- Personalidad / momentos humanos (otra capa, D-16).

## Condición de término

5 componentes con todos los criterios en verde con evidencia fresca del CI. PR abierto contra `main`, **no mergeado** (gate PO, ADR-072). El agente termina turno.
