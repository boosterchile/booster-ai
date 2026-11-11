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

