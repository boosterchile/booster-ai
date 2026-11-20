# @booster-ai/matching-algorithm

Placeholder package. Ver ADR relacionado en `docs/adr/` para diseño detallado.

## Status

`SKELETON` — implementación pendiente.

## Scripts

- `pnpm typecheck` — validación de tipos
- `pnpm test` — suite de tests (vacía por ahora)

## Elegibilidad desde la carga (ADR-090)

`src/elegibilidad/` responde qué empresas tienen con qué llevar una carga:

- `COMPATIBILIDAD_CARGA_CARROCERIA` y `carroceriaCompatible(carga, carroceria)`:
  la tabla de 110 pares aprobada por el PO
  (`.specs/matching-desde-la-carga/plan.md` §1.1). Un vehículo sin carrocería
  declarada sirve solo para `carga_seca` y `otra`.
- `configuracionesElegibles(carga, flota)`: las configuraciones (motriz sola o
  motriz con arrastre) con capacidad y carrocería para la carga. El volumen
  declarado no descarta: si no alcanza, la configuración lleva
  `volumenInsuficiente` y queda después de las que sí alcanzan.
- `empresaEsCandidata(carga, flota)`.

Todavía no la usa el matching que corre en producción: eso es la parte 2 de la
spec, detrás de un flag y con comparación en sombra. Cambiar un par de la
tabla exige el visto del PO y cambiarlo también en la copia del test.
