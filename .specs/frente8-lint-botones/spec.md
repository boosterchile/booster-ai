# Frente 8 — Ningún botón pintado a mano en apps/web

**Estado**: aceptada (goal del PO del 2026-11-25: «una regla de lint falla si un archivo de apps/web pinta un botón a mano fuera de los componentes compartidos»; criterio «Hecho cuando» del frente 8 en `docs/design/rediseno-2026-11-25/FRENTES.md`).
**Ancla**: D-18 (`DESIGN.md` §8.1, `.specs/d18-boton-verde-y-sello/`): un solo color para la acción principal, el verde `primary-600` del `Button` compartido.

## Objetivo

Que cada botón de `apps/web` salga de `@booster-ai/ui-components`, y que una regla en `pnpm lint` impida volver a pintarlos a mano.

## Entradas

- Los 284 `<button>` nativos de `apps/web/src` (96 archivos, sin contar tests) al 2026-11-25.
- `Button` de `ui-components` (variantes `primary`, `secondary`, `ghost`, `danger`).

## Salidas

**Componentes compartidos** (`packages/ui-components`)

- `Button` suma la variante `link` (texto verde, subrayado al pasar, sin relleno) y la prop `size`: `md` (defecto, sigue el registro), `sm` (acción secundaria en una fila, mínimo 2rem), `icon` (cuadrado del tamaño táctil, con `aria-label`) e `inline` (dentro de un texto, sin alto mínimo ni relleno).
- `PressableArea` (nuevo): zona que se presiona y no es un botón (fila de tabla, tarjeta elegible, patente que abre su ficha). Aporta el `<button>` nativo con `type="button"`, foco visible y texto a la izquierda; quien lo usa pone solo el layout.

**Regla** (`scripts/lint-botones.mjs`, en `pnpm lint` como `lint:botones`, con sus tests `node --test`)

Falla, con archivo y línea, si un `.tsx` de `apps/web/src` que no es test:

1. escribe un `<button>` nativo;
2. pone `role="button"` a otro elemento;
3. pinta un `PressableArea` como botón: relleno de color de acción (tono 400 o más) con `text-white`.

Lee el árbol sintáctico de TypeScript: un `<button>` dentro de un comentario o de un string no cuenta.

**Migración**: los 284 botones pasan a `Button` o `PressableArea`.

- Relleno de color con texto blanco → `Button` `primary` (o `danger` si destruye). Los rellenos ámbar, azul o del acento pasan al verde, como fija D-18.
- Borde y fondo blanco → `secondary`. Sin borde ni fondo → `ghost`. Texto verde o subrayado → `link`.
- Íconos solos → `size="icon"` con `aria-label`. Filas y tarjetas que se presionan → `PressableArea`.
- Se conservan el texto, `type`, `onClick`, `disabled`, los atributos `aria-*` y `data-testid`.

## Criterios de éxito

1. `node scripts/lint-botones.mjs` termina en 0 sobre `main` con este cambio, y en 1 si se agrega un `<button>` en `apps/web/src` (salida en el PR).
2. Los tests de la regla cubren los tres casos que fallan y los que no (Button, PressableArea de layout, comentario, string, otro rol).
3. Tests de `Button` (variante `link`, tamaños) y de `PressableArea` (no pinta, axe).
4. Las capturas de regresión visual del frente 8 se toman después de esta migración.
5. `pnpm run ci` en verde.

## Fuera de alcance

- `apps/web` fuera de `src` (e2e, configuraciones) y los otros paquetes.
- Enlaces (`<a>`, `Link`) con forma de botón: la regla cubre `<button>` y `role="button"`.
