# Plan — scorecard GPS de medio plazo

Spec: `.specs/gps-scorecard-medio-plazo/spec.md`

1. [x] Fórmulas puras de (1) y (2): ventanas de 2 min, usable ≤ 50 m y ≤ 90 s, gaps > 5 y > 15.
2. [x] Agregados: mediana, p10 nearest-rank, compuertas con n ≥ 30 y gaps < 15.
3. [x] (3) con `telemetria_puntos` como latido. Sin fila consultada → medición incompleta, no un 0 inventado.
4. [x] (4) solo con los dos streams. Sin umbral de ventaja clara.
5. [x] `decidirScorecardGps` con `cambiaStack: false` y precondición de nav + Wake Lock explícita.
6. [x] Batch `cargarScorecardMedioPlazo` + histogramas/contadores. Sin tocar `cobertura_pct`.
7. [x] Tests de las fórmulas y del armado de filas. Evidencia en `verify.md`.
