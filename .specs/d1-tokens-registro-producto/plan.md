# D1 · H1 — Plan de arquitectura de tokens

Estado verificado del punto de partida, decisiones de arquitectura, y plan de ejecución H2–H5.
**Nada de esto se ejecuta hasta OK del PO** (toca el source-of-truth con apps/web en prod).

## 0. Estado real verificado (read-only)

- `packages/ui-tokens/src/*.ts` — sistema de tokens TS, zero-dep, con `tokens.test.ts` (vitest). Es "canónico por declaración".
- `apps/web/src/styles.css` — Tailwind 4 CSS-first (`@tailwindcss/vite`). Un bloque `@theme { --color-*: … }` **re-declara los tokens a mano**. Además: `@source inline(...)` (safelist Tremor), defaults `:root`, `*:focus-visible` (ring verde), resets de `input/button`.
- **Hallazgo clave**: `apps/web` **NO importa** `@booster-ai/ui-tokens` en TS en ningún punto de runtime. La única referencia es el comentario de `styles.css`. → El CSS `@theme` es la fuente **de facto** que Tailwind consume; el TS es una copia paralela **no cableada**.
- No hay dark mode implementado (`dark:` solo aparece dentro del safelist de Tremor; ningún componente lo usa).

Consecuencia: "resolver la duplicación" = elegir UNA fuente y **cablearla** a lo que Tailwind lee.

## 1. Arquitectura A — Fuente única de verdad: TS → CSS (codegen)

**Dirección: TS canónico → CSS generado.** (No CSS→TS.)

Razones: el TS ya es el canónico declarado + brief de Claude Design + tiene tests tipados y es zero-dep; el propio comentario de `ui-tokens` ya proponía "generar este bloque desde los tokens TS via build script"; y el test de contraste debe correr sobre **los mismos valores** que producen el CSS.

Piezas:
1. `packages/ui-tokens/src/css.ts` — función pura `renderThemeCss(tokens) → string` que emite:
   - el bloque `@theme { … }` con los tokens **fijos** (neutrales cálidos, primario carbón, semánticos, tipografía, spacing, radius, shadow, breakpoints, z-index) — mapeados 1:1 desde los objetos TS;
   - el mapeo del **acento** a variables swappables (ver Arquitectura B);
   - los 7 bloques de preset de acento.
2. `packages/ui-tokens/scripts/generate-theme-css.ts` — escribe `packages/ui-tokens/theme.css` (artefacto **commiteado**).
3. `apps/web/src/styles.css` — reemplaza el `@theme` hecho a mano por `@import "@booster-ai/ui-tokens/theme.css";`, **conservando** las partes hechas a mano (safelist Tremor, `:root` defaults, `focus-visible`, resets). El paquete expone el CSS vía `exports["./theme.css"]`.
4. **Drift-guard en CI** (mismo patrón que `check-adr-numbering` / `spec-canonical-drift` del repo): un check que regenera y **diffea** contra `theme.css` commiteado; falla si hay drift. Garantiza "una sola fuente" de forma durable.

Por qué codegen commiteado + drift-guard (en vez de generar en build): CI y el build de Docker leen el archivo sin depender del step de codegen; el drift-guard hace imposible editar el CSS a mano sin tocar el TS. Determinista.

## 2. Arquitectura B — Theme-able en runtime (solo el acento)

Fijos (base cálida + primario carbón + semánticos) = valores **estáticos** en `@theme`.
Acento = variables CSS **swappables**, patrón Tailwind 4:

```css
@theme {
  --color-accent-50: var(--accent-50);
  /* … */
  --color-accent-900: var(--accent-900);
}
/* preset default (Índigo) + uno por familia */
:root, [data-accent="indigo"]    { --accent-50: …; … --accent-900: …; }
[data-accent="terracota"]         { --accent-50: …; … --accent-900: …; }
/* … 7 presets */
```

`bg-accent-600` → `var(--color-accent-600)` → `var(--accent-600)` → lo setea el bloque `[data-accent]` activo. **Cambiar el acento en runtime = `document.documentElement.dataset.accent = '<preset>'`.** Cero rebuild, cero recarga. Los 7 presets salen del codegen (una sola fuente TS).

Persistencia de la preferencia (localStorage) + hook `useAccentPreset()`: mínimo en D1 (soporta el selector); la UI "linda" es D2/D3.

## 3. Modelo de tokens del registro "producto" (qué cambia vs hoy)

| Rol | Hoy | D1 (target del brief) |
|---|---|---|
| `neutral` (cálido) | existe | **sin cambio** (reusar) |
| `primary` | **verde `#1FA058`** | **redefinir → neutral oscuro (carbón)** |
| verde ambiental | no existe como token aparte | el verde `#1FA058` se **reserva** para el registro ambiental (ramp propia, no `primary`) |
| `success` | `#1FA058` (= ambiental) | verde **distinto** del ambiental (distinguible por construcción + test) |
| `warning`/`danger`/`info` | existen | sin cambio (revalidados por contraste) |
| `accent` | no existe | **7 rampas 50→900** nuevas, theme-ables (default Índigo) |

## 4. Test de contraste WCAG (dominio crítico a11y — TDD)

- Vive en `packages/ui-tokens/src/contrast.test.ts` (+ util `contrast.ts` con `contrastRatio(hex, hex)` — relative luminance WCAG 2.x). Zero-dep, framework-agnóstico, corre en el `pnpm test` del monorepo → entra al CI.
- Verifica **todas** las combinaciones exigidas, para acento (×7) + semánticos + neutrales:
  - botón `~600` + blanco ≥ 4.5:1; tint `~50` + texto `~800` ≥ 4.5:1; texto normal ≥ 4.5:1; UI/borde/ícono ≥ 3:1; **negro sobre color = prohibido** (assert explícito).
  - **Claro y oscuro**: define los pares de superficie clara (fondo `neutral-50/0`) y oscura (fondo `neutral-900/1000`) y verifica ambos.
- TDD: primero el test con los pares y umbrales (rojo si una rampa no cumple), luego se ajustan los hex de las rampas hasta verde. El output del rojo→verde va en la Evidencia (H2).

## 5. Plan de ejecución H2–H5 (tras OK del PO)

- **H2**: escribir `contrast.ts` + `contrast.test.ts` (rojo), generar las 7 rampas + carbón + success-distinto, iterar hasta verde en claro y oscuro. Solo TS en `ui-tokens`, **cero cambios en apps/web** todavía → blast radius nulo en la app.
- **H3**: codegen (`css.ts` + script + `theme.css`) + drift-guard CI; cablear `styles.css` al `@import`. **Sin regresión visual del refactor** (ver §6).
- **H4**: hook `useAccentPreset` + selector mínimo (una ruta o un panel de settings) que setea `data-accent` en vivo.
- **H5**: `pnpm ci` verde (con el test de contraste) + PR sin merge.

## 6. Tensión a confirmar por el PO (por qué paro acá)

**"Sin regresión visual" (H3) vs "primario verde→carbón" (identidad fijada).** Redefinir `primary` de verde a carbón **repinta todos los botones** de apps/web (~21 archivos usan `bg-primary-600`) — es un cambio visual **intencional del brief**, no una regresión, pero NO es "sin cambios en pantalla".

Mi interpretación propuesta (a confirmar):
- **"Sin regresión visual" aplica al refactor mecánico de duplicación**: el codegen TS→CSS debe producir un `@theme` que renderiza **idéntico** a hoy (verificable byte-a-byte / screenshot) — prueba de que unificar la fuente no rompe nada.
- **El repaint `primary`→carbón + el acento nuevo son el feature intencional**, aplicados deliberadamente encima, no "regresión".

**Decisión que necesito de vos (no re-decide identidad, decide alcance/secuencia de D1):**
- **(a)** D1 incluye el flip `primary`→carbón (repinta la app entera ahora), o
- **(b)** D1 entrega la **arquitectura + acento + contraste + selector** con `primary` **intacto (verde) por ahora**, y el flip a carbón se hace como paso propio revisado aparte (repaint global = su propia evidencia/screenshots).

Recomiendo **(b)**: aísla el refactor riesgoso (fuente única, verificable sin cambio visual) del repaint global (alto impacto visual, mejor revisado solo). Pero es tu llamada de alcance.

## 7. Riesgos y mitigaciones

- **`@import` de `@theme` desde un paquete**: Tailwind 4 procesa `@theme` de archivos importados, pero hay que validar que las utilities (`bg-primary-600`…) sigan generándose. Mitigación: el check de "sin regresión" de H3 (build + diff de CSS emitido / screenshot) lo cacha antes de merge.
- **Dark mode no existe hoy**: el test verifica contraste en oscuro definiendo las superficies oscuras, pero el **toggle** de tema es D3. Riesgo de sobre-construir: acotado — D1 solo define/verifica valores, no cablea UX de dark.
- **apps/web en prod**: por eso este gate. H2 no toca la app (solo `ui-tokens`); H3 es el único hito que toca `styles.css`, con drift-guard + verificación de no-regresión.
