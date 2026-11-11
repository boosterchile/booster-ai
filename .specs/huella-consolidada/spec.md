# Spec: huella-consolidada

- **Author**: agente (Claude), por encargo del PO
- **Date**: 2026-11-10
- **Status**: Aceptada por el PO en el chat del 2026-11-11 («Acepto las ocho»), con las decisiones de §11.
- **Linked**: [ADR-089](../../docs/adr/089-reparto-huella-cargas-consolidadas.md) (vigente desde el 2026-11-10), [ADR-088](../../docs/adr/088-ruta-parada-servicio.md), [ADR-021](../../docs/adr/021-glec-v3-compliance.md), [ADR-077](../../docs/adr/077-nivel-certificacion-por-fuente-de-posicion.md), `.specs/ruta-parada-servicio/`
- **Frente**: «Ruta, parada y servicio (etapa 2)», fuera de slot en `docs/frentes-vivos.md`.

## 1. Objetivo

Cuando un camión lleva cargas de varios generadores, la huella del recorrido
se calcula una vez y se reparte entre las cargas. Los certificados de las
cargas suman exactamente la huella del recorrido, y una carga que viaja sola
recibe lo mismo que hoy.

## 2. Estado verificado

En main (`b9f40f3a`):

- `services/calcular-metricas-viaje.ts` calcula por viaje. Usa
  `calcularEmisionesViaje` de `packages/carbon-calculator` con tres métodos
  (`exacto_canbus`, `modelado`, `por_defecto`), suma el retorno vacío con
  `calcularEmptyBackhaul` y deriva el nivel con `derivarNivelCertificacion`.
- `metricas_viaje.viaje_id` es llave primaria. Guarda las emisiones estimadas
  y reales, su desglose, el método, el nivel de certificación y el hash y la
  fecha del certificado.
- `services/emitir-certificado-viaje.ts` emite cuando el viaje está
  `entregado` y tiene métricas. Lo disparan la confirmación de entrega y un
  job de relleno.

En producción, consultado el 2026-11-10 en solo lectura: 10 filas en
`metricas_viaje`, 8 con certificado emitido.

## 3. Reglas

### 3.1 Se calcula la ruta

La emisión de la ruta, `E`, es la suma de sus tramos, cargados y vacíos. Un
tramo es el trayecto entre dos paradas consecutivas
(`.specs/ruta-parada-servicio/` §3).

- Con combustible medido, `E` sale del combustible consumido entre la primera
  y la última parada de la ruta.
- Sin él, cada tramo se modela con su distancia y la masa total a bordo en
  ese tramo, con los mismos métodos y factores que hoy usa el viaje.

### 3.2 Posicionamiento y regreso (decisión 4 de ADR-089)

El trayecto antes de la primera recogida y el posterior a la última entrega
entran en `E` cuando hay telemetría que los mide. Sin ella se aplica el factor
de retorno vacío de ADR-021 sobre el total de la ruta. Los límites de esos dos
trayectos son los de §11-1.

### 3.3 Reparto

La actividad del servicio `i` es `a_i = masa_i × d_i`. `masa_i` es su peso
declarado y `d_i` la distancia directa entre su origen y su destino: la ruta
más corta factible, no los kilómetros que el camión recorrió con esa carga.

`E_i = E × a_i / Σ a_j`

Es toneladas-kilómetro para todas las cargas (decisión 3 de ADR-089). No hay
reparto por volumen ni por pallets.

### 3.4 Invariante

`Σ E_i = E` sobre los valores publicados. El redondeo es por resto mayor: se
redondea cada parte hacia abajo a la precisión publicada y las unidades que
faltan se entregan a las partes con mayor resto, con desempate por
identificador de servicio. La suma nunca supera `E`.

Lo mismo vale para cada componente del desglose que el certificado publica.

### 3.5 Servicio solo

Una ruta con un servicio le reparte el 100 %. Su resultado es igual al que da
hoy el cálculo por viaje para ese mismo servicio.

### 3.6 Servicio sin peso (decisión 2 de ADR-089)

Un servicio sin peso declarado no entra en una ruta con otros servicios
(`.specs/ruta-parada-servicio/` §4.4). El reparto nunca ve un servicio sin
peso en una ruta consolidada. Solo, sigue la regla vigente.

### 3.7 Servicio cancelado dentro de la ruta

- Cancelado antes de su recogida: sale de la ruta y no participa.
- Cancelado después de su recogida: participa con su actividad completa. No
  recibe certificado y su parte no se carga a los demás (§11-2).

### 3.8 Nivel de certificación

Se deriva una vez por ruta, con la fuente y la cobertura de la ruta completa
(ADR-077). Todos sus servicios lo heredan.

Una ruta se mide por tramos. Para derivar su nivel (§11-5):

- la **cobertura** de la ruta es la de sus tramos, ponderada por su distancia;
- la **fuente** de la ruta es la más débil entre sus tramos: declarada a mano,
  ruta de mapas, GPS del celular, GPS del vehículo, de menor a mayor.

Un tramo medido con el celular impide el nivel primario de toda la ruta, y uno
declarado a mano la baja al último nivel, por corto que sea.

### 3.9 Cuándo se emite (decisión 1 de ADR-089)

El certificado de un servicio se emite cuando su ruta pasa a `cerrada`. No hay
certificado provisional. Hasta entonces el generador ve la estimación, marcada
como tal.

La estimación de un servicio en una ruta `planificada` o `en_curso` se calcula
con el mismo reparto sobre la emisión estimada de la ruta, y cambia cuando la
ruta cambia.

### 3.10 Qué dice el certificado

En una ruta con más de un servicio agrega: que la carga viajó consolidada, el
método de reparto («toneladas-kilómetro, distancia directa»), la participación
del servicio en porcentaje, la huella total de la ruta (§11-4) y la versión
del método. No identifica a los otros
generadores ni dice cuántos son.

En una ruta con un solo servicio el certificado no cambia.

### 3.11 A quién corresponde cada cifra

La transportista informa el 100 % de `E` como emisión propia. Cada generador
informa su `E_i` como emisión indirecta de transporte contratado. La
clasificación por alcance y categoría de GHG Protocol y la referencia de GLEC
para el reparto se citan en `plan.md` contra los documentos fuente; las citas
de ADR-089 están escritas de memoria y no se usan sin verificar.

## 4. Contratos públicos que cambian

Son decisión del PO.

| Contrato | Cambio |
|---|---|
| Esquema de base | tabla nueva `metricas_ruta` (`ruta_id`, `E` y su desglose, distancia, método, fuente, nivel, versión del método); `metricas_viaje` agrega `ruta_id`, `actividad_tkm`, `participacion` y `version_metodo_reparto` |
| Certificado | cinco datos nuevos en las rutas con más de un servicio (§3.10). Cambia la plantilla. |
| API y web del generador | la huella de una carga consolidada indica que es una parte de una ruta y su participación |
| API y web del transportista | huella total de la ruta y su reparto por servicio, sin datos de otros generadores más allá de lo que la transportista ya conoce |
| Momento de emisión | el certificado de una carga consolidada llega al cerrar la ruta, no al entregar esa carga |

## 5. Arquitectura

- `packages/carbon-calculator` agrega tres funciones puras:
  `calcularEmisionesRuta` (tramos → `E` y desglose), `repartirPorActividad`
  (`E` y actividades → partes, con el redondeo de §3.4) y
  `derivarNivelRuta`.
- Un servicio nuevo en `apps/api` calcula las métricas de la ruta y escribe
  `metricas_ruta` y las filas de `metricas_viaje` en una transacción.
- `calcular-metricas-viaje.ts` deja de calcular por viaje: delega en el
  cálculo por ruta. No quedan dos caminos.
- La emisión del certificado se dispara al cerrar la ruta, por cada servicio
  entregado de ella.

## 6. Entrega por partes

Empieza cuando las partes 1 a 4 de `.specs/ruta-parada-servicio/` están en
main. Sus partes 4 a 6 salen en el mismo release que las partes 5 a 7 de
aquella spec: no hay consolidación sin certificado.

| # | Qué entra | Visto del PO |
|---|---|---|
| 1 | Las tres funciones puras, con tests de propiedad. Sin base ni API. | no |
| 2 | Migración `expand`: `metricas_ruta` y las columnas nuevas de `metricas_viaje`. | sí: esquema de base |
| 3 | El cálculo pasa a ser por ruta para toda asignación. Como toda ruta tiene un servicio, nada cambia para los usuarios. Con test de regresión contra los certificados emitidos. | no |
| 4 | Reparto en rutas con más de un servicio; emisión al cerrar la ruta. | sí: momento de emisión |
| 5 | Plantilla del certificado con los datos de consolidación. | sí: certificado |
| 6 | Web del generador y del transportista. | sí: interfaz |

## 7. Fuera de alcance

- Reparto por volumen, pallets o valor de la carga.
- Recalcular certificados ya emitidos.
- Certificado de la ruta para la transportista como documento propio.
- Repartir entre empresas transportistas: una ruta es de una sola.
- Reparto del precio o de costos. Esta spec reparte emisiones.

## 8. Criterios de éxito

1. Test de propiedad de `repartirPorActividad` sobre rutas generadas: la suma
   de las partes publicadas es igual a `E` publicado, ninguna parte es
   negativa, y el resultado no depende del orden en que se entregan los
   servicios.
2. Test de propiedad: permutar el orden de las paradas de entrega no cambia la
   parte de ningún servicio mientras `E` no cambie.
3. Test de regresión: para cada uno de los 8 certificados emitidos en
   producción al 2026-11-10, el cálculo por ruta de un solo servicio da las
   mismas cifras publicadas.
4. Test de `calcularEmisionesRuta`: una ruta de dos paradas da lo mismo que
   `calcularEmisionesViaje` para ese viaje, en los tres métodos.
5. Test de integración contra PostgreSQL: al cerrar una ruta de tres servicios
   quedan una fila en `metricas_ruta` y tres en `metricas_viaje` que suman el
   total, y se emiten tres certificados.
6. Test: una ruta `en_curso` no emite certificados aunque uno de sus servicios
   esté entregado.
7. Test del certificado: en consolidada muestra método, participación y
   versión, y no contiene datos de otro generador.
8. Tests, lint, typecheck y build en verde; cobertura ≥ 80 % en el código
   nuevo.

Es dominio crítico (GLEC): primero el test, con el rojo en la evidencia del
PR.

## 9. Riesgos

- **El generador espera más por su certificado.** En una ruta larga, la carga
  entregada primero no tiene certificado hasta que el camión termina. Es la
  consecuencia de la decisión 1 de ADR-089.
- **Combustible medido y tramos.** El combustible por CAN da el total de la
  ruta, no el de cada tramo. El reparto no lo necesita por tramo, pero el
  desglose por tramo solo existe en el método modelado.
- **Citas normativas sin verificar.** Ningún texto del certificado nombra una
  norma hasta que su cita esté verificada contra la fuente.

## 10. Dependencias

- `.specs/ruta-parada-servicio/` partes 1 a 4, y sus partes 5 a 7 para el
  release conjunto.
- Verificación de las citas de GLEC, ISO 14083 y GHG Protocol.

## 11. Decisiones del PO (2026-11-11)

El PO aceptó las cuatro recomendaciones. La quinta la tomó el mismo día, con
la parte 1 a la vista.

| # | Pregunta | Decisión |
|---|---|---|
| 1 | ¿Desde y hasta dónde se cuentan el posicionamiento y el regreso cuando hay telemetría? | Desde el último punto donde el vehículo quedó libre de la ruta anterior, o donde empezó a moverse ese día si no hay ruta anterior, hasta la primera recogida. El regreso, desde la última entrega hasta la primera recogida de la ruta siguiente o hasta 4 horas detenido, lo que ocurra primero. |
| 2 | Un servicio cancelado después de recogido, ¿participa en el reparto? | Sí, con su actividad completa: el camión ya movió esa carga. No se le emite certificado; su parte queda registrada en la ruta y no se carga a los demás. |
| 3 | ¿El transportista ve cuánto le tocó a cada generador? | Sí. Ya conoce a sus clientes y sus cargas; el reparto no le revela nada nuevo. |
| 4 | ¿El certificado muestra la huella total de la ruta además de la parte del servicio? | Sí. Con la parte y la participación, que ADR-089 ya pone en el certificado, el total se deduce igual; mostrarlo permite verificar la cuenta. No dice cuántos ni quiénes son los otros generadores. |
| 5 | Una ruta medida por tramos con fuentes distintas, ¿con cuál se deriva su nivel? (2026-11-11, tras la parte 1) | Con la más débil («Sí, la más débil»). La cobertura se pondera por distancia. Es la lectura conservadora: el nivel respalda el certificado ante un auditor. Se descartó ponderar también la fuente por distancia, que dejaría pasar un tramo corto mal medido. |
