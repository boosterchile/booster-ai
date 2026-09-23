# Plan — Guardrail de km/L por trayecto

1. Test rojo en `segmentar-trayectos-teltonika.test.ts`: el trayecto 294,9 km / 24 L no trae `kmPorLitro`.
2. En `consumoCubierto`, después de las compuertas de cobertura y de muestra mínima, anular `kmPorLitro` si el redondeo a 2 decimales supera `2 × (100 / 32)` y dejar la nota.
3. Mismo resultado con fuente `89` y capacidad 200 L, y un trayecto en 6,23 km/L que sí se muestra.
4. Sin cambio de API, de UI ni de migración: la nota ya viaja en `nota_combustible` y la celda ya la pinta cuando no hay km/L.
