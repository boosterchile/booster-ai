# Shell bajo la barra de estado de iOS (PWA standalone): safe-area insets

**Estado**: aceptada · **Fecha**: 2026-09-14 · **Pedido por**: PO (captura desde iPhone en `/app/conductores`: «no puedo acceder al menú de Booster»)

## 1. El problema

La web se instala como PWA (`manifest.display = standalone`) y declara
`viewport-fit=cover`. En iPhone la página se extiende bajo la barra de estado y,
como ningún elemento reservaba `env(safe-area-inset-top)` (0 usos en todo
`apps/web`), el header del shell operador —y con él la hamburguesa que abre el
menú— quedaba tapado. El mismo patrón afecta al drawer móvil (`fixed inset-y-0`),
al header del Modo Conductor y a los cinco headers del shell platform-admin.

## 2. Entradas y salidas

- Dos utilities Tailwind 4 en `apps/web/src/styles.css`:
  `pt-safe` = `padding-top: env(safe-area-inset-top, 0px)` y
  `pb-safe` = `padding-bottom: env(safe-area-inset-bottom, 0px)`.
  Fuera de iOS (Safari con barra propia, escritorio, Android sin inset) el inset
  vale 0 y el layout no cambia en un píxel.
- `Layout.tsx`: el `<header>` conserva fondo y borde y reserva `pt-safe`; el
  contenido (hamburguesa + título) pasa a un `div` interno con el padding de
  siempre. El drawer móvil reserva `pt-safe pb-safe` (barra de estado arriba,
  indicador home abajo).
- `conductor.tsx` (`ConductorHeader`) y los headers de `platform-admin*.tsx`:
  `pt-safe` en el `<header>` externo (todos ya tenían el padding en un div
  interno, así que es una clase agregada, sin reestructurar).
- Sin cambios de contrato: ni API, ni rutas, ni manifest.

## 3. Criterios de salida

- [x] Rojo exhibido: tests unitarios de `Layout` y del dashboard del conductor
      que exigen `pt-safe` en el `<header>` (rol `banner`) y `pt-safe pb-safe`
      en el drawer.
- [x] Verde: esos tests + suite completa de `apps/web`, typecheck, biome, build
      (el CSS compilado contiene `.pt-safe{padding-top:env(safe-area-inset-top,0px)}`).
- [x] Preview `/apariencia/shell?rol=transportista` a 375×812: header y
      hamburguesa intactos con inset 0 (Chrome no reporta inset; la prueba del
      inset real es en el iPhone del PO).
- [ ] En producción (iPhone, app instalada): la hamburguesa queda bajo la barra
      de estado, no debajo de ella, y el menú abre.

## 4. Fuera de alcance

- `apple-mobile-web-app-status-bar-style` y el color de la barra de estado: no
  se tocan (el manifest y `theme-color` siguen igual).
- Pantallas públicas (login, landing): no tienen header fijo arriba; si el PO
  reporta lo mismo ahí, se aplica la misma utility.
