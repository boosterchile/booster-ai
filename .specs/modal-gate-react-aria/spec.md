# Modal parte 1 — GATE de encaje de react-aria-components (SPIKE)

**Estado**: gate/spike (goal PO 2026-07-09). **NO construye Modal**; verifica encaje y habilita (o no) la parte 2. El ejemplo vive en la rama `spike/modal-react-aria-fit` y **NO se mergea a main** como componente.

## Corrección de premisa (contra la realidad, no supuestos)

El goal dice "React 19 del repo". **Falso**: el repo es **React 18.3.1** (`apps/web` + `packages/ui-components`, resuelto 18.3.1; #579/#580 ya en main). No bloquea — solo cambia qué caveat de compat aplica.

## Resultados del gate

### 1. Versión fijada + compat
- **`react-aria-components@1.19.0`** (latest). Peer: `react: ^16.8.0 || ^17 || ^18.0.0 || ^19.0.0-rc.1` → **soporta React 18.3.1** del repo. Instalado, resuelto contra `react@18.3.1` (pnpm: `react-aria-components@1.19.0_react-dom@18.3.1_react@18.3.1__react@18.3.1`). Sin bloqueo de compat.

### 2. Install limpio en CI
- `pnpm install` agregó 8 paquetes (RAC + react-aria/react-stately). Verificado en CI clean-install (`--frozen-lockfile`) en el PR-spike.

### 3. Delta de bundle (SOLO primitivos de Modal, tree-shakeable)
- `import { Dialog, Modal, ModalOverlay }` con react externalizado, esbuild minify:
  - **minified: 49.7 KB** · **gzipped: 16.9 KB**.
- **Juicio: ACEPTABLE.** Trae focus-trap, retorno de foco, overlay/portal, scroll-lock y manejo de teclado accesibles — la "rueda difícil" que el goal quiere no hand-rollear. ~17 KB gzip es costo razonable (comparable a Radix Dialog) para el 6º dual. **No es bloqueo.**

### 4. Encaje con tokens (evidencia en Chromium, `e2e-local/spike-modal-fit.spec.ts`, 3/3)
- **Estado de RAC estilado con nuestra custom property**: `[data-hovered]` del botón RAC pintado con `var(--accent-100)` → computa `rgb(218,222,245)` (indigo-100). El modelo de estados de RAC (`[data-hovered]`/`[data-entering]`/…) **no pelea** con nuestros tokens.
- **Bajo `[data-register]` + `data-accent`**: el modal usa `var(--accent-600)` (borde) y `var(--pad-y)` (padding) sin conflicto.

### 5. Comportamiento del PORTAL (dato clave para parte 2)
RAC `ModalOverlay`/`Modal` portan al `body` (fuera del ancestro del registro). Verificado en browser:
- **Acento: SÍ reachea el portal.** `data-accent` vive en `:root`/`<html>`, así que `--accent-*` cascada a todos, incluido el portal. Borde del modal = accent-600. → **NO hay que re-aplicar el acento** mientras el acento sea global en `:root` (estado actual de Ola 0).
- **Registro: NO reachea el portal.** `RegisterProvider` setea `data-register` en un **wrapper div**; el portal (hijo de `body`) no lo hereda y cae al default de `:root` (operador). Prueba: el botón (dentro del wrapper conductor) tiene padding **14px**; el modal porteado tiene **8px** (operador), no 14px. → **Modal DEBE re-aplicar `data-register` en el portal** (RAC `ModalOverlay` acepta className/data-attrs; se le pasa el registro leído por `useRegister()`).
- Matiza la decisión sellada del goal completo ("el portal pierde registro *y acento*"): con el acento en `:root` (hoy), **solo pierde el registro**; re-aplicar acento solo haría falta si el acento pasara a ser scoped por wrapper.
- **Foco (bonus)**: RAC atrapa el foco en el modal al abrir y lo **retorna al trigger** al cerrar con Esc — verificado en Chromium. El comportamiento a11y difícil funciona out-of-the-box.

## Fricciones encontradas

Ninguna bloqueante. RAC compone con className/style estáticos y spreadea `data-*` al DOM (permite `data-testid` y re-aplicar `data-register`). El portal-pierde-registro es esperado y manejable (re-aplicar el atributo).

## Conclusión del gate

**Encaja.** react-aria-components 1.19.0 es compatible (React 18), el costo (~17 KB gzip) es aceptable para el comportamiento que aporta, y su styling juega con nuestros tokens bajo registro y acento. Recomendación: **habilitar parte 2** (Modal productivo en `ui-components`), con el plan de re-aplicar `data-register` en el portal (el acento se hereda solo).

## No incluido / parte 2

Modal productivo, backdrop configurable, scroll-lock declarado, matiz de DESIGN.md, variante operador-optimizada. RAC se moverá a `packages/ui-components` deps (donde vive Modal); en el spike está en `apps/web` para poder renderizar el ejemplo en browser.
