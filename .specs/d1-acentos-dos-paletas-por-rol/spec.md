# D1.1 — Acento en dos paletas por rol + fix del botón

**Estado**: en implementación. Refina D1 (#575, ya en main) según lo que el PO vio en vivo.
**Ancla**: DESIGN.md D-4/D-5 — el conductor tiene paleta LED vibrante; los operadores, sobria.

## Decisiones del PO (implementar, no re-decidir)

- **Dos paletas por rol** (antes: un set único de 7):
  - **Operador** (sobria, 6): Índigo (default), Azul océano, Ciruela, Pizarra, Cobalto, Berenjena — reusa las rampas de D1 (se retira Terracota del set).
  - **Conductor** (LED vibrante, 7): Ámbar LED, Naranjo LED, Rojo LED, Azul LED (default), Verde LED, Fluor, Negro — rampas nuevas, hex generados y verificados.
- **Selección de paleta por rol**: el hook elige el set según el rol (conductor → LED, operadores → sobria). En `/apariencia` (pública, sin login) se toggle-ea para demostrar ambas.
- **Semánticos FIJOS**: success/warning/danger/info independientes del acento — no cambian con el preset. Elegir Rojo LED / Verde LED como acento NO pisa el rojo-error ni el verde-éxito (arquitectura: el acento es `--color-accent-*`, los semánticos son tokens aparte).
- **Tres verdes distintos que coexisten**: ambiental/marca (`primary #1FA058`), éxito (`success`, ahora distinto → emerald `#0E9F6E`), y Verde LED (acento conductor). Verificado por test.
- **Fluor**: el neón puro (`#12F0F0`) no pasa contraste con texto → vive solo en el swatch/glow decorativo; el fill del botón usa la versión oscurecida (`fluor-600 #0C7A7A`) con texto blanco.

## Bug arreglado — botón con texto negro (regresión global de D1)

El PO vio el botón de `/apariencia` con texto NEGRO ilegible. Diagnóstico: al reescribir `styles.css` en D1, el reset `button { color: inherit }` quedó **sin `@layer`**; en Tailwind 4 lo no-capado gana sobre `@layer utilities`, así que `text-white` era pisado por `color: inherit` (= neutral-900) en **TODO botón** de la app (login, solicitar-acceso, apariencia). Verificado por computed style. Fix: el reset va en `@layer base` → las utilities de texto vuelven a ganar. Fix global (no solo el demostrador).

## Requisito de contraste (D1, ahora sobre AMBAS paletas)

Test verifica todas las combinaciones (botón ~600 + BLANCO ≥4.5, tint ~50 + texto ~800 ≥4.5, UI ≥3, nunca negro sobre el fill del botón) en claro y oscuro, para los 7 LED + los 6 sobrios. Se agregó cobertura explícita del **botón (bg-600 + texto)** para ambas paletas — convierte el hallazgo del PO en cobertura permanente.

## Criterios de salida

- [ ] Test de contraste extendido pasando sobre ambas paletas, claro y oscuro.
- [ ] Botón de `/apariencia` legible (texto blanco, nunca negro), cambio en vivo funcionando.
- [ ] `pnpm ci` verde. PR abierto contra main, MERGEABLE, sin merge (gate PO).

## Fuera de alcance

Integración del selector en las surfaces reales por rol (settings del operador / configuración del conductor) — D2/D3. Acá el selector vive en `/apariencia` con toggle.
