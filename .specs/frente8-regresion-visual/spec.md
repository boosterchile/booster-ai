# Frente 8 — Capturas de regresión visual a 1.280 y a 390 px

**Estado**: aceptada (goal del PO del 2026-11-25: «hay capturas de regresión visual a 1.280 y a 390 px de los Inicios, Flota y Certificados»; criterio «Hecho cuando» del frente 8 en `docs/design/rediseno-2026-11-25/FRENTES.md`).

## Objetivo

Que un cambio que altere la forma de los Inicios, Flota o Certificados haga fallar el CI, comparando cada pantalla con una captura de referencia a 1.280 y a 390 px.

## Entradas

- El E2E con API local, emulador de Auth y siembras (`apps/web/e2e-conductor`, job «E2E conductor Playwright» de `e2e-pr.yml`, que corre en cada PR que toca `apps/web`).
- Las siembras de `una-sola-verdad.spec.ts` (empresa transportista con servicio completo, con Booster Fleet solo y mixta) y el generador del seed de flujos.
- El armazón con menú superior (#1103) y los botones compartidos (#1104): las referencias se toman sobre eso.

## Salidas

`apps/web/e2e-conductor/regresion-visual.spec.ts` y sus referencias en `regresion-visual.spec.ts-snapshots/`, una por pantalla y ancho:

| Pantalla | Ruta | Siembra |
|---|---|---|
| Inicio con servicio completo | `/app` | completo |
| Flota | `/app/booster-fleet` | completo |
| Inicio con Booster Fleet solo | `/app/booster-fleet` (el Inicio lleva ahí) | fleet |
| Inicio de empresa transportista y generadora | `/app` | mixta |
| Certificados | `/app/certificados` | mixta |
| Inicio del generador | `/app` | seed de flujos |

Cada una a 1.280 × 900 y a 390 × 844, página completa, animaciones apagadas.

**Lo que se neutraliza antes de capturar**, porque cambia entre corridas sin que cambie la pantalla: los dígitos (vencimientos, «hace N minutos», cifras sembradas con fecha relativa) pasan a 0; días y meses, a una palabra fija; el saludo según la hora, a «Hola»; y los mapas se ocultan (el E2E no tiene clave de Google Maps). La comparación mira la forma: armazón, componentes, columnas, colores y sellos.

**Umbral**: hasta 1 % de píxeles distintos (`maxDiffPixelRatio: 0.01`), para absorber diferencias de suavizado entre corridas del mismo runner.

**Referencias**: se generan en Linux con el Chromium del job del CI (`ubuntu-24.04`), no en macOS, porque el CI compara contra el sufijo `-chromium-linux`. Para regenerarlas tras un cambio visual deliberado se corre el job con `--update-snapshots` o se toman las capturas reales que el job sube como artefacto cuando falla.

## Criterios de éxito

1. Hay 12 referencias: 6 pantallas por 2 anchos.
2. El job «E2E conductor Playwright» compara contra ellas y pasa sobre `main` con este cambio.
3. Un cambio visual en una de esas pantallas lo hace fallar: se comprueba alterando a propósito el armazón en una corrida y viendo el diff en el artefacto.
4. `pnpm run ci` en verde.

## Fuera de alcance

- Las demás pantallas y el conductor.
- Comparar los mapas.
- Si el runner no puede instalar las fuentes del sistema (el paso cae a «Chromium sin dependencias» cuando apt no responde), las capturas pueden diferir: el job lo avisa con un warning y la corrida se repite.
