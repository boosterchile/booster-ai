# Spec — Guardrail de km/L y KPI de la ventana

**Slug:** `guardrail-km-l-trayecto`

**Brief:** JLKT54 mostró 12,29 km/L (294,93 km / 24,0 L del AVL 84). El #719 ya está en `main` y dejó explícito que el guardrail no entraba en ese frente.

## Supuesto que no se persigue

`cursor/km-l-jlkt54-diagnostico-2cd6` parte de un `main` anterior al #719: no había columna y `listar` pasaba capacidad `null`. En el `main` actual la fuente configurada es la única que entra. Con `fuente = 89` y capacidad N, los litros ya son porcentaje × N. Con N = 200 L eso coincide con el 84 deprimido y el 12,29 se repite. No se reescribe la fórmula de litros ni se inventa un estanque.

## Entrada

Trayecto ya segmentado que pasa las compuertas vigentes (cobertura ≥ 90 %, litros ≥ 5, km ≥ 10). El km/L es `cubiertaKm / litros`, redondeado a 2 decimales.

Baseline diésel del diagnóstico: **32 L/100 km** → `100 / 32 = 3,125 km/L`.

## Salida

Si el km/L redondeado es **mayor que** `2 × (100 / 32)` = **6,25**:

- `kmPorLitro` queda `null`.
- `litrosConsumidos` se conserva.
- `notaCombustible` = `dato no confiable`.

En 6,25 el número se muestra. Por debajo también. El caso JLKT54 (294,93 km / 24,0 L = 12,29) cae en el guardrail en el camino legado (AVL 84 × 0,1) y con fuente `89` y estanque de 200 L.

## Cobertura y sensor

La cobertura es la que ya calcula `calcularCoberturaPura` y persiste `metricas_viaje.cobertura_pct` (ADR-028). El umbral es `THRESHOLD_SECUNDARIO_MODELED_PCT` = **80**. No hay columna nueva.

Si un segmento trae litros medidos y su cobertura es **menor que 80**:

- `kmPorLitro` queda `null`.
- `litrosConsumidos` se conserva.
- `notaCombustible` = `dato no confiable · cobertura baja`.

En 80 el km/L se muestra (si además pasa el tope de 6,25). En 79 no.

Si `fuente_combustible_can` es `sin_sensor` (o la columna es null, que se lee igual):

- no se inventan litros ni km/L.
- `notaCombustible` = `dato no confiable · sin sensor de combustible`.

Esas dos exclusiones no entran al Σkm/ΣL del hub. El tope de 6,25 sigue aplicando sobre los segmentos que sí entran: si el cociente de esa suma supera 6,25, el KPI queda `null` y la tarjeta dice `dato no confiable`, sin la razón de cobertura. Los litros medidos siguen visibles en la fila y en la suma de litros de la ventana.

El km/L del hub es **Σkm / ΣL** de los trayectos de la ventana que entran y tienen litros consumidos > 0. No es el km/L del trayecto más reciente ni el promedio de esos cocientes. Si no queda ninguno porque todos fueron excluidos, el KPI queda `null` y la tarjeta muestra `dato no confiable` con la razón (`cobertura baja` y/o `sin sensor de combustible`).

## Fuera de alcance

- Cambiar la prioridad 84 > 83 > 89 del camino legado, ni la fuente provisionada.
- Escribir en producción `capacidad_estanque_l` o `fuente_combustible_can` de JLKT54.
- Recalibrar el AVL 84 en el equipo.
