# Spec — Módulo único de rendimiento

**Slug:** `modulo-rendimiento-unico`

**Brief:** el km/L y el L/100 km se calculaban en cuatro lugares con reglas de redondeo distintas. Ese desorden ya produjo el 12,29 km/L de JLKT54 (`.specs/guardrail-km-l-trayecto/`). Este frente deja una sola fuente: `apps/api/src/domain/combustible/rendimiento.ts`.

## Dónde se calculaba antes

| Lugar | Cuenta |
|---|---|
| `segmentar-trayectos-teltonika.ts` · `consumoCubierto` | `kmCubiertos / litros` con los litros **sin redondear** |
| `segmentar-trayectos-teltonika.ts` · `kmPorLitroSuperaTope` | `kmCubiertos / litrosConsumidos` con los litros **redondeados a 0,1** |
| `resumir-hub-vehiculo.ts` · `kmPorLitroDeVentana` | `Σ kmCubiertos / Σ litrosConsumidos` |
| `decidir-fuente-huella.ts` · `guardrail83` (plausibilidad de la huella CAN; antes `consumo-can-segmento.ts`, borrado en HC-005) | `litros / km × 100` |
| web `trayectos-teltonika.tsx` · `litrosPorCienKm` | `100 / km_por_litro` ya redondeado |

## Defecto que corrige

La fila y el hub podían discrepar. Con 62,4 km y 9,96 L la fila daba 6,27 km/L (lo oculta por estar sobre 6,25), pero el hub hacía la cuenta con 10,0 L, daba 6,24 y sumaba el trayecto al Σ. Era la misma clase de error que el 12,29: dos cuentas para el mismo número.

## Entradas

- `km`: distancia cubierta por la lectura de combustible (`kmCubiertos`, 3 decimales).
- `litros`: litros consumidos que se publican (`litrosConsumidos`, 1 decimal).

## Salidas

- `rendimiento(km, litros)` → `{ kmPorLitro, litrosPor100Km }` o `null` si `litros ≤ 0`, `km ≤ 0` o algún valor no es finito. `kmPorLitro` va a 2 decimales y `litrosPor100Km` a 1. Las dos salen de los mismos `km` y `litros`; el L/100 km no sale del km/L redondeado.
- `rendimientoAgregado(tramos)` → el mismo resultado con `Σkm` y `ΣL`. No es el promedio de los cocientes.
- `litrosPor100KmSinRedondear(km, litros)` → para comparar contra umbrales (plausibilidad CAN) sin perder precisión.
- `superaTopeConfiable(kmPorLitro)` → `true` si es mayor que `2 × 100 / 32 = 6,25`. En 6,25 se muestra.
- Constantes: muestra mínima (5 L, 10 km), baseline diésel 32 L/100 km, factor 2.

## Criterios de éxito

1. La fila del trayecto, el chequeo de tope del hub y el Σ del hub usan `rendimiento` sobre los valores publicados. El caso 62,4 km / 9,96 L da 6,24 km/L en la fila y entra al Σ (rojo exhibido antes del cambio).
2. La API manda `litros_por_100_km` en cada trayecto (campo nuevo, solo se agrega). Es `null` cuando `km_por_litro` es `null`.
3. La web muestra el L/100 km que manda la API y no calcula nada. Sin el campo (API anterior) no muestra L/100 km.
4. Se borran `litrosPorCienKm` (web), `kmPorLitroDeVentana` (hub) y `kmPorLitroSuperaTope` (segmentar). Un `git grep` de `/ litros\b`, `100 /` y `* 100` en esos archivos no encuentra otra cuenta de rendimiento.
5. `guardrail83` (que reemplazó a `consumo-can-segmento` en HC-005) usa la misma cuenta L/100 km; el mínimo de muestra es `can_muestra_insuficiente`.
6. Tope: 300 líneas netas.

## Fuera de alcance

- Cambiar el tope de 6,25, la cobertura de 80 % o las compuertas de 5 L / 10 km.
- Agregar L/100 km al hub de la web.
- Cambiar cómo se calculan los litros.
