# Verificación: huella-consolidada

## Parte 1 — funciones puras (2026-11-11)

En `packages/carbon-calculator/src/ruta/`, sin base ni API. El cálculo que
corre en producción todavía no las usa (eso es la parte 3).

| Función | Qué hace |
|---|---|
| `calcularEmisionesRuta` | Emisión de una ruta a partir de sus tramos, cargados y vacíos (spec §3.1) |
| `repartirPorActividad` | Reparte cada total entre los servicios por toneladas-kilómetro con distancia directa (§3.3) y redondeo por resto mayor (§3.4) |
| `derivarNivelRuta` | Nivel de certificación de la ruta, que heredan sus servicios (§3.8) |

### Criterios de la spec que cubre

| Criterio | Cómo se prueba |
|---|---|
| 1: las partes publicadas suman el total, ninguna es negativa, no depende del orden | tests de propiedad sobre 500 rutas generadas por cada propiedad, con un generador con semilla |
| 2: reordenar las entregas no cambia la parte | por construcción: el reparto usa la distancia directa de cada servicio y no recibe el orden de las paradas |
| 4: una ruta de dos paradas da lo mismo que `calcularEmisionesViaje`, en los tres métodos | tests de propiedad, 300 casos por método |

Los criterios 3 (regresión contra los 8 certificados emitidos), 5, 6 y 7
dependen de la base y de la emisión de certificados: son de las partes 3 a 5.

### Decisiones de implementación

Completan lo que la spec deja abierto. Ninguna rige en producción todavía.

1. **Aritmética entera en el reparto.** Las emisiones se publican en kg con 3
   decimales, así que la unidad entera es el gramo. La actividad se lleva en
   gramos-metro. Así el invariante de suma es exacto y no depende del orden de
   los servicios ni de errores de punto flotante.
2. **Cada componente se reparte por separado.** `wtw`, `ttw` y `wtt` cumplen
   cada uno el invariante de suma (§3.4). Como consecuencia, la parte `wtw` de
   un servicio puede diferir en un gramo de la suma de sus partes `ttw` y
   `wtt`. Hoy ya pasa lo mismo en un viaje: los tres totales se redondean por
   separado.
3. **La participación también suma exacto.** Se publica en porcentaje con 2
   decimales y se reparte con el mismo redondeo: las participaciones de una
   ruta suman 100,00.
4. **Varios tramos: se suman las cifras publicadas de cada tramo.** La ruta es
   exactamente la suma de su desglose. Con combustible medido no hay desglose:
   el CAN entrega el total de la ruta (riesgo ya anotado en la spec §9).
5. **El retorno vacío por factor no entra en `calcularEmisionesRuta`.** Un
   regreso medido va como un tramo con carga 0. El factor de ADR-021 lo sigue
   aplicando quien orquesta, sobre el total de la ruta (§3.2), con
   `calcularEmptyBackhaul`, que no cambia.
6. **Un servicio sin peso en una ruta con otros recibe cero.** La spec no lo
   deja entrar (§3.6); si llegara, no se le inventa actividad. Si ningún
   servicio de una ruta con varios tiene actividad, el reparto falla.

### La regla del nivel de una ruta medida por tramos

La spec §3.8 no decía cómo se resumen los tramos. `derivarNivelRuta` usa la
cobertura ponderada por distancia y la fuente más débil entre los tramos. El
PO la confirmó el 2026-11-11 (spec §3.8 y §11-5), frente a la alternativa de
ponderar también la fuente por distancia.

## Parte 2 — migración `expand` 0080 (2026-11-11)

`apps/api/drizzle/0080_metricas_ruta.sql`:

- tabla nueva `metricas_ruta`, una fila por ruta: distancia, actividad de
  transporte, emisiones estimadas y reales con su desglose, intensidad,
  combustible, método, factores, fuente, cobertura, nivel de certificación,
  incertidumbre y versión del método de reparto;
- en `metricas_viaje`: `ruta_id`, `actividad_tkm`, `participacion` y
  `version_metodo_reparto`, todas opcionales, más un índice por `ruta_id`.

No toca filas existentes. Ningún código las escribe todavía: el cálculo sigue
siendo por viaje hasta la parte 3.

### Decisiones

- **Mismos tipos numéricos que `metricas_viaje`.** Una ruta de un solo servicio
  guarda las mismas cifras en los dos lados (spec §3.5).
- **`participacion` es porcentaje con 2 decimales**, entre 0 y 100, igual que
  la publica `repartirPorActividad`. La spec nombra la columna sin decir la
  unidad.
- **`metricas_ruta` guarda estimado y real**, como `metricas_viaje`: la
  estimación de una carga antes del cierre de la ruta sale del mismo reparto
  sobre la emisión estimada (spec §3.9).
- **Restricciones:** actividad no negativa, participación y cobertura entre 0 y
  100. La ruta no se puede borrar mientras tenga métricas.
- **Sin `empresa_id`.** Se lee por `ruta_id` de una ruta ya validada contra la
  empresa; queda documentada en `docs/rls-exemptions.md` junto a las otras
  tablas de ruta.

### Seguridad del despliegue

- **Rollback de código:** seguro; una revisión anterior no conoce la tabla ni
  las columnas.
- **Reverso del esquema:** manual, en `down/`, con las dos consultas previas.
- **Bloqueo:** agregar la llave foránea y las dos restricciones a
  `metricas_viaje` valida las filas existentes. En producción son 10.

### Numeración

El PR #904, abierto, también usa el número 0080. El que entre segundo
renumera a 0081.


## Parte 3 — el cálculo pasa por la ruta (2026-11-11)

`apps/api/src/services/huella-por-ruta.ts`:

- `calcularHuellaDeServicioSolo`: emisión de la ruta (`calcularEmisionesRuta`,
  un tramo) y reparto entre un único servicio (`repartirPorActividad`). Lo usan
  las dos escrituras de `calcular-metricas-viaje.ts`, la estimada y la del
  cierre, en lugar de `calcularEmisionesViaje`.
- `guardarMetricasDeRuta`: en la misma transacción que `metricas_viaje`,
  guarda `metricas_ruta` y deja en el viaje su ruta, su actividad, su
  participación (100,00) y la versión del reparto.

El nivel se deriva con `derivarNivelRuta`. El relleno de distancia
(`backfill-distancia-adapters.ts`) también deja la ruta igual al viaje.

### Qué no cambia

Con una carga por ruta, las cifras del viaje son las mismas de antes: lo
prueban los tests de propiedad de la parte 1 y, aquí, 5 casos más los insumos
de los 8 certificados emitidos. Los 80 tests unitarios del cálculo y los de
integración del cierre pasan sin cambiar sus expectativas.

### El criterio 3 de la spec, como estaba escrito, no se podía cumplir

El criterio pide que, para los 8 certificados emitidos en producción, el
cálculo por ruta dé «las mismas cifras publicadas». Con los insumos leídos de
producción el 2026-11-11:

| Certificado | Publicado (kg CO₂e) | Calculador de hoy, por viaje y por ruta | Diferencia |
|---|---|---|---|
| 1 | 2,691 | 2,576 | −4,27 % |
| 2 | 385,938 | 384,750 | −0,31 % |
| 3 | 23,004 | 22,933 | −0,31 % |
| 4 y 5 | 22,562 | 22,493 | −0,31 % |
| 6 | 517,437 | 515,844 | −0,31 % |
| 7 | 224,092 | 223,398 | −0,31 % |
| 8 | 590,746 | 590,750 | 0,00 % (4 gramos) |

Por ruta y por viaje dan exactamente lo mismo en los 8. Lo que no se reproduce
es la cifra publicada, y tampoco la reproduce el cálculo por viaje que estaba
antes de este cambio.

### Por qué no se reproducen (investigado el 2026-11-11)

| Certificado | Calculado | Causa | Cómo se comprobó |
|---|---|---|---|
| 2 a 7 | entre el 2026-09-21 y el 2026-10-20 | El factor del diésel pasó de 3,25 a 3,24 kg CO₂e/L el 2026-11-02 (#872, HC-003: fila «Diesel» de la Tabla 32 de GLEC v2.0). 3,24 / 3,25 = −0,31 %. | Con 3,25 los seis se reproducen con a lo más 5 gramos de diferencia. |
| 8 | 2026-11-03 | Ninguna: se calculó con el factor de hoy. | Se reproduce con 4 gramos de diferencia. |
| 1 | 2026-09-14 | El factor anterior, y además el vehículo se editó el 2026-09-28, después de emitir. | Con 3,25 y una capacidad de 10.000 kg (hoy 20.000) calzan la cifra (3 gramos) y los litros guardados (0,83). |

Las diferencias de gramos calzan con que la distancia se guarda con 2
decimales.

Lo del certificado 1 es la explicación que calza con los datos, no un hecho
registrado: la base no guarda el perfil que tenía el vehículo cuando se emitió
el certificado.

Ningún certificado está mal calculado. Cada uno es correcto para el factor y
el vehículo de su momento.

### Lo que el desvío deja a la vista

1. **Un certificado emitido no se puede reproducir solo con la base de hoy.**
   Depende del factor vigente y del perfil del vehículo en su fecha, y ninguno
   de los dos queda guardado junto al certificado. `factores_fuente` existe
   desde #872 y está vacío en los 7 certificados anteriores.
2. **`factor_emision_usado` puede quedar desactualizado.** En el certificado 8
   dice 3,25 y sus emisiones reales se calcularon con 3,24: el factor se
   escribe al estimar y el cierre no lo reescribe. Es anterior a este cambio.
   En `metricas_ruta`, el cierre sí guarda el factor con que se calculó.

Ninguno de los dos se corrige aquí. El segundo es un cambio chico en el cierre;
el primero es una decisión de diseño (guardar con cada certificado los insumos
con que se calculó). Quedan para que el PO decida.

### El criterio 3, reescrito

El PO lo aprobó el 2026-11-11 (spec §10-3 y §11-6): «con los insumos de los 8
certificados emitidos, el cálculo por ruta da exactamente lo mismo que el
cálculo por viaje, y cada certificado se reproduce con el factor vigente en su
fecha». Las dos cosas quedan probadas en `test/unit/huella-por-ruta.test.ts`,
con la salvedad del certificado 1.

### Otras notas

- **Asignación sin ruta.** Un viaje cuya asignación todavía no tiene ruta
  (anterior a la 0078, antes del relleno) se calcula igual y no escribe
  `metricas_ruta`. Después del relleno, la próxima vez que se calcule queda
  anotada.
- **Las filas que ya existen no se rellenan.** Las 10 de `metricas_viaje` en
  producción quedan sin `ruta_id` hasta que se recalculen. Un relleno aparte
  tocaría datos y necesitaría el visto del PO.
- **Combustible inválido.** Un test usaba `diesel_b5`, que no existe en el enum
  `tipo_combustible`. El cálculo anterior devolvía NaN y lo guardaba; el
  reparto exige totales finitos y ahora falla. Corregí el fixture a `diesel`.
- **Lo que sigue calculando por viaje:** la vista previa de la eco-ruta en una
  oferta (`eco-route-preview.ts`), que estima antes de que exista una
  asignación y no guarda métricas.
- **El cierre real del viaje** ahora escribe en una transacción (antes era un
  solo UPDATE): el viaje y su ruta quedan iguales o no se escribe ninguno.

## Arreglo: el cierre guarda el factor con que calculó (2026-11-11)

Hallazgo 2 de la investigación del desvío. `metricas_viaje.factor_emision_usado`
y `version_glec` se escribían solo al estimar. Si los factores cambiaban entre
la asignación y el cierre, las emisiones reales quedaban calculadas con el
factor nuevo y la columna seguía diciendo el anterior. El certificado imprime
esa columna junto a las emisiones.

Ahora, cuando el cierre calcula emisiones reales, guarda también el factor y
la versión de ese cálculo. Sin emisiones reales (cobertura bajo el umbral o
peso ausente) el certificado usa la estimación, y el factor guardado sigue
siendo el de esa estimación.

### Alcance en producción

De los 8 certificados emitidos, tres tienen emisiones reales:

| Certificado | Estimado con | Cerrado con | Factor guardado |
|---|---|---|---|
| 1 | 3,25 | 3,25 | 3,25, coincide |
| 7 | 3,25 | 3,25 | 3,25, coincide |
| 8 | 3,25 (2026-10-30) | 3,24 (2026-11-03) | 3,25, **no coincide** |

El certificado 8 es el único afectado: su cifra (590,746 kg CO₂e) sale de
182,33 L × 3,24, y la columna dice 3,25. Por el código, el PDF emitido el
2026-11-03 imprimió 3,25; no abrí el PDF para confirmarlo.

Este arreglo no toca filas existentes ni certificados emitidos. Corregir el
certificado 8 sería una reemisión, que decide el PO.


## Parte 4 — reparto en rutas con varios servicios y emisión al cerrar (2026-11-11)

Hasta ahora toda ruta tenía un servicio. Esta parte cubre la ruta con varios:
se mide entera cuando se cierra, su emisión se reparte entre los servicios y
recién ahí salen los certificados.

Nada cambia en producción al desplegar: las rutas con varios servicios solo
las crea la API de rutas, que sigue apagada (`RUTAS_API_ACTIVADA`).

| Archivo | Qué hace |
|---|---|
| `services/tramos-recorridos.ts` | Arma los tramos que el camión recorrió, con la carga a bordo de cada uno, y les asigna la distancia medida de la ruta |
| `services/huella-por-ruta.ts` | `calcularHuellaDeRuta`: emisión de la ruta y la parte de cada servicio. El servicio solo es el caso de un servicio |
| `services/cerrar-huella-de-ruta.ts` | Mide la ventana de la ruta, calcula, escribe `metricas_ruta` y las `metricas_viaje` en una transacción, y emite los certificados |
| `services/ruta-compartida.ts` | Dice si un viaje comparte su ruta y si esa ruta ya cerró |
| `services/calcular-metricas-viaje.ts` | La medición de una ventana (distancia, CAN y decisión de fuente) pasa a `medirVentanaDelVehiculo`, que usan el viaje solo y la ruta |

### Qué cambia para una carga que viaja con otras

| Momento | Antes | Ahora |
|---|---|---|
| Se entrega y la ruta sigue abierta | medía su huella y emitía su certificado | no mide ni emite; la liquidación no cambia |
| Se entrega y era la última parada | lo mismo, solo para esa carga | se mide la ruta, se reparte y se certifican todas las cargas entregadas |
| Se cancela la última carga pendiente de una ruta con otras entregadas | nada | la ruta queda cerrada y se certifican las entregadas |
| Cualquier otro camino que pida su certificado (job de relleno) | lo emitía | `ruta_no_cerrada` mientras la ruta esté abierta |

Para la carga que viaja sola en su ruta no cambia nada.

### Criterios de la spec que cubre

| Criterio | Cómo se prueba |
|---|---|
| 5: al cerrar una ruta de tres servicios quedan una fila en `metricas_ruta` y tres en `metricas_viaje` que suman el total, y se emiten tres certificados | `test/integration/huella-ruta-compartida`, contra PostgreSQL. WTW, TTW, WTT y combustible suman el total de la ruta; las participaciones suman 100 |
| 6: una ruta `en_curso` no emite certificados aunque un servicio esté entregado | el mismo archivo, llamando a la emisión real; y `emitir-certificado-viaje.test` y `confirmar-entrega-viaje.test` |
| 1 y 2 (suma y orden), ahora en el cálculo completo | `test/unit/huella-por-ruta.test`: los tres métodos, y el mismo resultado con los servicios en otro orden |
| §3.5: con un servicio da lo mismo que el servicio solo | `test/unit/huella-por-ruta.test`, los cinco casos de la parte 3 |
| §3.7: cancelado antes de su recogida no participa; cancelado después participa y su parte no se carga a los demás | `test/integration/huella-ruta-compartida` |

### Decisiones de implementación

Las cuatro primeras cambian cifras que el certificado publica. Necesitan el
visto del PO junto con el momento de emisión.

1. **La distancia y el combustible se miden una vez, sobre toda la ruta.** La
   ventana va de la primera recogida a la última entrega, y se mide con el
   mismo código que mide hoy un viaje. No se mide tramo por tramo: un tramo
   corto con pocos puntos de GPS abortaría la ruta completa.
2. **Los tramos salen de lo que pasó, no de lo planificado.** Cada recogida y
   cada entrega confirmada es un instante; un tramo es lo que hay entre dos
   instantes seguidos, con la carga que el camión llevaba. Si el conductor
   confirma en otro orden que el de la ruta (decisión D5 de
   ruta-parada-servicio), los tramos siguen ese orden.
3. **La distancia medida se asigna a cada tramo según el avance observado**
   (la distancia entre puntos de GPS que caen en el tramo). Sin avance
   observado, por duración. El total no cambia. Esta asignación solo influye en
   el método modelado, donde el consumo depende de la carga de cada tramo; con
   combustible medido el total no depende de ella.
4. **En una ruta con varios servicios, cada servicio publica su distancia
   directa**, que es la que entró al reparto (§3.3) y la que ya tiene como
   distancia estimada. `distancia_km_real` del viaje queda vacía y la distancia
   real queda en `metricas_ruta`. La intensidad del servicio es su parte
   dividida por su actividad. El combustible también se reparte, con el mismo
   redondeo, para que el certificado siga cuadrando litros por factor.
5. **Una carga recogida que nunca se entregó sigue a bordo hasta el final de
   la ruta** para el cálculo por tramos. Hoy ningún camino cancela una carga
   ya recogida; queda cubierto para cuando exista.
6. **Opt-in mixto.** La ruta se mide si al menos un servicio tiene la medición
   de huella activa. Un servicio sin opt-in participa en el reparto y no
   recibe cifras reales; su parte no se carga a los demás.
7. **Mismos cortes que el viaje solo.** Con cobertura bajo el umbral, sin un
   peso declarado o sin la distancia directa de algún servicio, las cifras
   reales de todos quedan vacías y el certificado usa la estimación. Nunca un
   cero.
8. **El nivel se deriva con un solo tramo: la ruta completa.** Un vehículo
   tiene una sola fuente de posición, así que «la fuente más débil» (§3.8) es
   esa, y la cobertura es la de la ventana completa.
9. **El cierre espera al cálculo y a los certificados.** La respuesta de la
   última entrega de una ruta compartida tarda unos segundos más. Si el cálculo
   falla, los certificados salen con la estimación, igual que en el viaje solo.

### Lo que queda fuera de esta parte

- **La estimación con reparto (§3.9, segundo párrafo).** Va en el PR
  siguiente; ver «Parte 4, segunda entrega» más abajo.
- **Posicionamiento y regreso medidos (§3.2 y §11-1).** La ventana sigue
  siendo de la primera recogida a la última entrega, igual que hoy en el viaje
  solo.
- **Los datos de consolidación en el certificado** (parte 5) y la web
  (parte 6).

### El rojo

Las dos piezas puras se escribieron con el test primero
(`tramos-recorridos.test`, `huella-por-ruta.test`): 11 tests en rojo antes de
la implementación, en la evidencia del PR. El test de integración se escribió
después del servicio de cierre; encontró un error en el tramo sin duración
(recogida y entrega en el mismo instante quedaban con carga 0), ya corregido.

## Parte 4, segunda entrega — la estimación sigue a la ruta (2026-11-11)

Spec §3.9, segundo párrafo: mientras la ruta está planificada o en curso, la
estimación de cada carga es su parte de la emisión estimada de la ruta, y
cambia cuando la ruta cambia. Sigue sin efecto en producción hasta encender
`RUTAS_API_ACTIVADA`.

| Archivo | Qué hace |
|---|---|
| `services/estimar-huella-de-ruta.ts` | Estima la ruta por sus tramos planificados, reparte y escribe `metricas_ruta` y la estimación de cada `metricas_viaje` en una transacción |
| `services/tramos-recorridos.ts` | `tramosPlanificados`: la carga a bordo entre parada y parada, en el orden de la ruta |
| `routes/rutas.ts` | Después de agrupar, quitar, reordenar o declarar, vuelve a estimar las rutas que la operación tocó |
| `routes/trip-requests-v2.ts`, `routes/assignments.ts` | Lo mismo cuando se cancela una carga de la ruta o se acepta un cambio de peso |

### Cómo se estima

1. **Los tramos son los del plan**: las paradas en su orden, con la carga que
   el camión lleva entre una y otra.
2. **La distancia de cada tramo** se pide igual que la de un viaje: Routes y,
   si falla, la tabla por región. Dos paradas seguidas en la misma dirección
   miden 0 sin consultar.
3. **El reparto es el del cierre**: toneladas-kilómetro de distancia directa.
   La distancia directa de cada carga es su distancia estimada, que no se
   toca.
4. **Con una carga**, la ruta es su viaje: usa su distancia directa, no
   consulta mapas y da la estimación de siempre. Así vuelve a su cifra una
   carga que se quita de una ruta.
5. **El retorno vacío estimado de cada carga no se recalcula.** Queda el que
   se calculó al asignarla. Aplicarlo sobre el total de la ruta es §3.2, que
   sigue fuera.
6. **La estimación corre después del commit** de la operación. Si falla, la
   operación ya quedó hecha y la siguiente vuelve a estimar.

### Cómo se prueba

| Qué | Dónde |
|---|---|
| Dos cargas: la estimación de la ruta se reparte y las partes suman el total; la distancia directa no cambia | `test/integration/huella-ruta-compartida` |
| Reordenar las entregas cambia la emisión de la ruta y no la participación (criterio 2) | el mismo archivo |
| Una carga sola da la estimación del viaje; una cancelada no entra; una ruta cerrada no se vuelve a estimar | el mismo archivo |
| Cada operación de la API estima las rutas que tocó, y un fallo de la estimación no cambia la respuesta | `routes/rutas.test` |
| Qué decide con cada ruta | `test/unit/estimar-huella-de-ruta.test`, `test/unit/tramos-planificados.test` (rojo primero: 5 tests) |

## Parte 5 — el certificado de una carga consolidada (2026-11-11)

Spec §3.10 y criterio 7. Cambia la plantilla del certificado: necesita el
visto del PO. Solo afecta a las cargas que compartieron su ruta; el
certificado de una carga que viajó sola sale igual, byte a byte en su texto.

| Archivo | Qué hace |
|---|---|
| `packages/certificate-generator/src/consolidacion.ts` | Los datos de consolidación, sus textos y su validación |
| `packages/certificate-generator/src/generar-pdf-base.ts` | La sección «Carga consolidada» y la distancia directa en Resultados |
| `apps/api/src/services/emitir-certificado-viaje.ts` | `armarDatosEmision` agrega la participación, el total de la ruta y la versión del método. Lo usan la emisión y la reemisión |

### Qué dice el certificado de una carga consolidada

Una sección nueva, «Carga consolidada», entre Metodología y Trayecto:

> Esta carga viajó con otras cargas en la misma ruta. Su huella es la parte
> que le corresponde de la huella total de la ruta.

| Dato | Ejemplo |
|---|---|
| Método de reparto | Toneladas-kilómetro, distancia directa |
| Versión del método | tkm-distancia-directa-v1 |
| Participación de esta carga | 62,50 % |
| Huella total de la ruta | 80,00 kg CO₂e |

En Resultados, la línea de distancia pasa de «Distancia: X km (medido N %,
estimado M %)» a «Distancia directa: X km». La distancia directa es la que
entró al reparto y no es una medición, así que no lleva cobertura. La
cobertura de la ruta sigue en Metodología.

No dice cuántas cargas más había ni de quién eran.

### Decisiones de implementación

1. **Cuándo una carga es consolidada para el certificado**: su participación
   es mayor que 0 y menor que 100. Una carga que quedó sola en una ruta
   compartida (las demás se cancelaron antes de recogerse) se llevó el 100 % y
   recibe el certificado de siempre.
2. **El total de la ruta es del mismo tipo que la cifra de la carga**: medido
   si la carga publica su cifra medida, estimado si publica la estimada.
3. **Si falta el total de la ruta o la versión del método, no se emite**
   (`ruta_sin_huella`). Un certificado que publica una parte sin decir de qué
   total sería peor que no tenerlo; queda para el relleno.
4. **El generador valida antes de firmar**: participación en (0, 100), total
   de la ruta no menor que la cifra de la carga, versión presente.
5. **La sección no se parte entre dos páginas.**
6. **Ningún texto nombra una norma** para el reparto (riesgo de la spec §9):
   las citas de GLEC e ISO 14083 para el reparto siguen sin verificar contra
   la fuente.

### Cómo se prueba

| Criterio | Dónde |
|---|---|
| 7: muestra método, participación, versión y total; no contiene datos de otro generador | `packages/certificate-generator/test/consolidacion-plantilla.test` (rojo primero: 3 tests) |
| Una carga sola no lleva nada de esto | el mismo archivo |
| Datos incoherentes no generan el PDF | el mismo archivo |
| La emisión arma los datos desde la base, con el total medido o estimado según la cifra de la carga | `apps/api/test/unit/emitir-certificado-viaje.test` y `test/integration/huella-ruta-compartida` |

### Parte 5 sobre el ADR-091 (2026-11-12)

La parte 5 se rehízo sobre main con el ADR-091 ya implementado (#952). Una carga consolidada hereda la presentación de su ruta:

- ruta medida por Teltonika (cobertura ≥ 80 %): sin sello, y la nota de método dice «La distancia de la ruta fue medida…», porque la distancia de la carga es la directa del reparto;
- ruta estimada por Google Maps: conserva sello, disclaimer y «Estimado» en el pie.

Pruebas: `packages/certificate-generator/test/consolidacion-plantilla.test.ts` (dos casos nuevos) y `test/render-helpers.test.ts`.

## Parte 6 — web del generador y del transportista (2026-11-13)

Spec §4. El generador ve que su cifra es una parte y su participación. El
transportista ve el total de la ruta y la parte de cada carga, con el código
que ya conoce. Ninguna pantalla nombra a los otros generadores ni dice cuántos
son. Una carga que viaja sola no cambia.

| Superficie | Qué muestra |
|---|---|
| Detalle de la carga (`/app/cargas/:id`) | «Esta cifra es la parte de tu carga en la ruta» y la participación. Si ya está entregada y el certificado no salió, dice que se emite al cerrar la ruta. |
| Ruta del transportista (`/app/rutas`) | Total de la ruta, la presentación de ADR-091 y la participación y los kg de cada carga. Antes del cierre la etiqueta es «Estimación». Al cerrar, sale de `presentacionNivel`: una cifra real con Google Maps dice «Estimado», no «Medida». |

`GET /trip-requests-v2/:id` agrega `metrics.consolidacion` solo cuando la ruta
es compartida: `{ participacion_pct }`. No incluye el total. `GET /rutas/:id`
agrega `ruta.huella` (`null` con una sola carga o sin cifra todavía).

### Cómo se prueba

| Qué | Dónde |
|---|---|
| La carga sola no trae consolidación; la compartida trae su participación y no el total | `apps/api/test/unit/serialize-trip-metrics.test.ts` (rojo primero) |
| La vista de una ruta con varias cargas trae el total y las partes | `apps/api/test/unit/operar-ruta.test.ts` |
| El detalle de la carga y la pantalla de rutas muestran esos textos | `apps/web/src/routes/cargas.test.tsx`, `apps/web/src/routes/rutas.test.tsx` |
