# Follow-up: km/L imposible en JLKT54 (estanque virtual de 200 L)

**Origen**: reporte de prod del 2026-09-23. En `/app/trayectos` y en la tarjeta Consumo del hub, JLKT54 muestra ~12,29 km/L. Un camión de esta flota no hace eso (el default de huella para camión pesado cargado es 28 L/100 km, o sea ~3,6 km/L).

No se consultó prod desde el agente. Los números de abajo salen de la función pura con la firma AVL que ya documenta la spec.

## Dónde se calcula

No hay un promedio. La UI pinta el campo que ya trae el API.

1. `segmentar-trayectos-teltonika.ts` → `consumoCubierto`: `km/L = distancia del tramo leído / litros`, redondeado a 2 decimales. Los litros del 84 son `raw × 0.1` (`CAN_FUEL_LEVEL_L_SCALE`). Si el trayecto trae 84, esa fuente gana aunque también venga el contador 83.
2. `resumir-hub-vehiculo.ts` copia el `kmPorLitro` del trayecto más reciente que ya lo trae. No divide `km_recientes / litros_recientes`.
3. `GET /trayectos-teltonika` serializa ese número. `listar-trayectos-teltonika.ts` pasa `capacidadEstanqueL: null` siempre: no hay columna de estanque.
4. La tabla (`ConsumoCelda`) y la tarjeta Consumo del hub muestran ese km/L. El L/100 km de la tabla es `100 / km/L` (12,29 km/L se ve como 8,1 L/100 km). El subtítulo de la tarjeta («en los últimos trayectos») es la suma de km y de litros de hasta 10 trayectos, no el denominador del km/L de arriba.

## Qué se descartó

- Metros tratados como km. La distancia del trayecto es haversine en km. El odómetro CAN (87, metros) no entra en este cálculo.
- El 89 usado como litros. Sin 84 y sin 83 usable, la fuente queda `nivel_porcentaje` y `km_por_litro` queda null.
- División por litros casi cero. El piso es 5 L (`LITROS_MINIMOS_KM_POR_LITRO`); `EPSILON_L` solo protege el divisor después de ese piso.
- Doble conteo GPS + CAN. Solo se suma haversine.
- Micro-trayectos en ralentí. El trayecto exige ignición on y movimiento. Excluir el ralentí sube el km/L un poco; no lo multiplica por cuatro.
- #713. El filtro de falsos positivos solo apaga el badge y el pin (viaje < 1 km o nivel bajo). No toca `consumoCubierto`.

## Causa

El gate de muestra (≥ 5 L y ≥ 10 km, criterio 11) no acota el cociente. Con 5,0 L y ~61,45 km el resultado es 12,29 km/L y se publica, sin nota.

En JLKT54 el 84 no es un volumen medido aparte del porcentaje. La spec ya lo registró: el raw del 84 vale 20 × el raw del 89, así que `litros = 2 × Δ%` (estanque de 200 L puesto en el equipo). Un tramo de ~122,85 km que baja de 80 % a 75 % (raw 1600 → 1500) consume «10 L» y da **12,29 km/L**. El mismo tramo con un Δ del 83 de 49,1 L daría ~2,5 km/L, pero el 84 está primero (criterio 10) y el 83 no se usa.

Ese 12,29 es la misma familia que el censo (0,8 a 10 km/L, los cuatro que sobrevivían al piso, todos de JLKT54), un poco por encima del techo que esa nota dejó afuera del slice. Dos cosas lo inflan, y las dos caben en la fórmula actual:

- el estanque real es más grande que los 200 L del firmware, y no hay `capacidad_estanque_l` para reescalar;
- el km/L usa el Δ neto de nivel (primera lectura menos última). Una carga a mitad de viaje achica el Δ y sube el km/L. Solo se anula si el neto es ≤ 0.

## Por qué este PR no cambia la fórmula

Elegir la fuente (seguir con el 84, pasar al 83 cuando exista, o reescalar con la capacidad real) cambia el contrato de la spec aceptada (criterio 10 y el «fuera del slice» del km/L de JLKT54). Un tope duro en 8 km/L también lo cambia: el censo dejó visibles valores hasta 10. No hay flag nuevo: apagarlo por defecto no corrige prod, y prenderlo sería esa decisión.

El test `it.fails` fija el síntoma: con la firma 84 = 20 × 89 y un Δ del 83 de camión, el km/L publicado no puede ser 12,29 (null o ≤ 8). Hoy falla, como tiene que fallar, hasta que el PO elija la fuente.
