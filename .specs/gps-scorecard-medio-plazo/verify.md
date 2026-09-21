# Verify — scorecard GPS de medio plazo

Corrido en este workspace el 2026-09-21. El VM trae Node 22.14.0; `engines` pide
≥ 24. `tsc` y vitest pasaron igual (el código es ES2023, sin API exclusiva de 24).
CI corre en Node 24.

## Tests

```text
pnpm --filter @booster-ai/api exec vitest run \
  src/services/gps-scorecard-medio-plazo.test.ts \
  src/services/cargar-gps-scorecard.test.ts \
  src/observability/business-metrics.test.ts \
  test/unit/purgar-posiciones-movil.test.ts

 Test Files  4 passed (4)
      Tests  36 passed (36)
```

Los 34 del scorecard cubren ventanas, edad, gaps en el borde de 5 y 15 min,
mediana/p10, compuertas, flota sin inventar latido, dual `sin_par`, decisión
con `cambiaStack: false`, y el batch contra un stub de Drizzle (demo, null
island, troceo, conteo inválido).

## Coverage (solo estos módulos, umbral 80)

```text
File                         | % Stmts | % Branch | % Funcs | % Lines
cargar-gps-scorecard.ts      |   99.09 |    96.72 |     100 |   99.04
gps-scorecard-medio-plazo.ts |   99.23 |    97.92 |     100 |   99.21
```

Sin cubrir, a propósito: el `or()` de Drizzle devolviendo vacío (no ocurre) y
dos estrechados de índice que el tipo marca como `undefined` y el array denso
no produce.

## Typecheck + lint

```text
pnpm --filter @booster-ai/api exec tsc --noEmit
exit 0

pnpm exec biome check apps/api/src/services/gps-scorecard-medio-plazo.ts \
  apps/api/src/services/gps-scorecard-medio-plazo.test.ts \
  apps/api/src/services/cargar-gps-scorecard.ts \
  apps/api/src/services/cargar-gps-scorecard.test.ts \
  apps/api/src/observability/business-metrics.ts \
  apps/api/src/observability/business-metrics.test.ts \
  apps/api/src/services/purgar-posiciones-movil.ts
exit 0
```

No hay build de app: no cambia el bundle de web ni un entrypoint de runtime.
El batch no está cableado a un request.
