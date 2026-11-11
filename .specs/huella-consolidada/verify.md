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
