# D2 — Ola 2: Modal (react-aria-components)

**Estado**: aceptada (goal PO 2026-07-09). Cierra el 6º dual; fija el patrón RAC para Ola 3.
**Prereq**: gate de encaje (parte 1, PR-spike #581) pasó — RAC 1.19.0 compat React 18, ~17KB gzip, encaja con tokens. Playwright en main (Chromium).

## Decisiones selladas (no reabrir)

- **Click backdrop**: CONFIGURABLE (`isDismissable`, default `true`, `false` en destructivos).
- **Esc**: cierra SIEMPRE (RAC lo trae, no configurable).
- **Scroll-lock** del fondo con el modal abierto: SÍ (RAC).
- **Portal al body**: re-aplica SOLO `data-register`/`data-density` (leídos de `useRegister()`); el **acento se hereda de `:root`** (gate parte 1) — no se re-aplica.
- **Eje registro**: responde al registro (custom properties) PERO **optimizado operador**; sin variante-conductor elaborada (conductor voice-first ~90%, casi no ve modales). Matizar DESIGN.md §4.5.
- **Foco al abrir**: primer enfocable (RAC `autoFocus`); en confirmaciones, el orden pone el botón seguro (Cancelar) primero.
- **SOLO Modal.** La capa de momentos es pieza aparte.

## Salidas / criterios de éxito

1. Modal en `packages/ui-components`, RAC headless + tokens D1; cero hardcode (grep hex/px/rgb = vacío).
2. Responde a `data-register` vía custom properties (padding = `var(--pad-y)`), optimizado operador.
3. `isDismissable` (default true, forzable false); Esc cierra siempre; scroll-lock activo.
4. **Portal re-aplica `data-register`** — verificable en browser: bajo `[data-register=conductor]` el modal porteado usa padding conductor (14px), no cae a operador (8px). El acento se hereda solo.
5. Foco: al primer enfocable (o designado); trap mientras abierto; **retorna al trigger** al cerrar. En Chromium.
6. **E2E Modal en e2e-local (Chromium)**: abre, Esc cierra, foco atrapado, retorno al trigger, portal mantiene el registro re-aplicado, click-afuera respeta config. FALLA si se rompe trap/retorno/re-aplicación (no assert que pasa siempre).
7. vitest-axe sobre Modal pasa; coverage ≥80% con Modal.
8. DESIGN.md matizado (fila Modal + nota del portal) en este PR.
9. Gates ci.yml verdes en clean-install; e2e-pr verde no-required.
10. Demostrable en `/apariencia` (abrible, ambos registros + acentos).

## Verificación

- **Local (node 24 + Chromium)**: ui-components jsdom 9/9 + coverage 98%; Modal E2E 5/5. Revert-check: quitar la re-aplicación del registro → el E2E conductor cae a 8px (rojo). Restaurado.
- **Vinculante = CI clean-install**: Install·Lint·Typecheck·Test+Coverage(≥80%)·Build·Integration·Docker + e2e-pr (Chromium).

## Decisiones tomadas (implementación)

- RAC movido del spike (`apps/web`) a **dep productiva de `ui-components`** (donde vive Modal).
- API controlada (`isOpen`/`onOpenChange`); `title` (Heading) o `aria-label`; `children` ReactNode o `({close}) => …`; `data-testid` passthrough al box.
- Backdrop `bg-neutral-1000/50` (token D1); z-index `zIndex.modal`; padding por registro en el box; border/radius/shadow tokens.
- `aria-label` de RAC `Dialog` es `string` (exactOptionalPropertyTypes) → spread condicional.

## Fuera de alcance

- Capa de momentos (EmptyState/SuccessMoment). · Otros componentes RAC (Dropdown/Select/Tabs — Ola 3, mismo patrón). · Refresh del "estado actual" de DESIGN.md (deuda aparte).

## Condición de término

Todos los criterios en verde con evidencia fresca del CI (E2E de foco/portal que caería con trap o re-aplicación rotos). PR abierto contra `main`, **no mergeado** (gate PO, ADR-072). El agente termina turno.
