# Booster Fleet — rediseño de la pantalla del dueño

**Estado**: borrador, espera la aceptación del PO · **Fecha**: 2026-11-17 · **Pedido**: PO

Depende de [`.specs/booster-fleet/spec.md`](../booster-fleet/spec.md), que
sigue fijando las reglas de combustible, documentos y mantenciones. Esta spec
cambia cómo se muestran, no cómo se calculan.

## 1. Qué es

Booster Fleet está en producción como tres bloques de texto y tablas. El PO
la encuentra básica y poco intuitiva. El rediseño la convierte en un panel de
control: en tres segundos el dueño sabe cuántas cosas están mal y cuál es la
más urgente, y cada hallazgo trae su acción.

El PO exploró tres direcciones y eligió la **A (triage por severidad)**, con
el **detalle de vehículo sobre un eje de tiempo**. Esta spec lleva esa
dirección a `apps/web`.

Dos decisiones del PO del 2026-11-17 gobiernan los textos:

- La interfaz no dice «robo». La señal `posible_robo` se muestra como
  «desviación de combustible por analizar».
- Una desviación se muestra siempre con su fecha, su hora y su lugar. Junto a
  un consumo alto se recuerda que puede venir de la vía.

## 2. Entradas

- `GET /booster-fleet` — el panel actual (`panelBoosterFleetSchema`).
- `GET` del listado de trayectos Teltonika, filtrado por vehículo: da, por
  trayecto, inicio, fin, distancia, litros, L/100 km, nivel inicial y final,
  los avisos de desviación y las coordenadas del evento.
- Las tres escrituras de mantenciones que ya existen (programar, realizar,
  cancelar).
- Primitivas de `packages/ui-components` (Badge, Button, Card, Input, Modal)
  y `apps/web/src/components/EmptyState.tsx`.

## 3. Salidas

### 3.1 Con el contrato actual

**Overview, en `/app/booster-fleet`**, de arriba hacia abajo:

1. **Frase de estado.** Una oración generada por regla (§4.1) que dice
   cuántos camiones piden revisión y por cuál partir.
2. **Barra de severidad.** Un segmento por camión, en el orden de gravedad,
   con su leyenda en palabras y cifras.
3. **Franja de cuatro cifras**: consumo de la flota en L/100 km, camiones con
   alerta de combustible, documentos pendientes y mantenciones vencidas.
4. **Aviso de telemetría cortada**, cuando `combustible.truncado` es verdadero.
5. **Combustible**, en dos tercios del ancho: una fila por camión, agrupada
   por tono (§4.2). Los camiones en orden se colapsan en una sola línea.
6. **Riel derecho**: documentos pendientes y mantenciones abiertas.

Cada fila de combustible muestra patente, etiqueta de la señal, una línea de
descripción, litros, L/100 km con una barra que marca la mediana de la flota,
y la acción (§4.3).

**Documentos** lista primero lo vencido y lo faltante, después lo que no
tiene fecha o archivo, y al final lo que está por vencer. Muestra seis y
despliega el resto en el mismo lugar. Cada ítem enlaza a la ficha del
vehículo o del conductor. No muestra el RUT.

**Mantenciones** muestra los camiones en taller y las abiertas, con la fecha
como ancla y sus dos acciones. «Cancelar» confirma con el `Modal` del sistema
y deja de usar `window.confirm`. Sin mantenciones abiertas aparece el estado
vacío con el formulario a la vista.

**Programar mantención** está en la cabecera de la pantalla y abre el
formulario actual en un `Modal`. Los campos y las validaciones no cambian.

**Detalle de un vehículo**, en una ruta nueva bajo Booster Fleet:

1. Cabecera con patente, etiqueta de la señal y «Programar inspección».
2. Si hay desviación, un bloque con fecha, tramo horario, lugar y la acción
   «Analizar trayecto».
3. **La semana sobre un eje de tiempo.** Días, nivel de estanque, trayectos y
   eventos comparten la escala horizontal.
4. Tabla de trayectos de la ventana, con el trayecto de la desviación marcado.
5. Combustible de la semana, documentos del vehículo y sus mantenciones.

Con el contrato actual el detalle tiene tres límites, que la pantalla dice:

- El nivel de estanque se dibuja solo con el nivel inicial y final de cada
  trayecto. Entre esos puntos no hay lectura y no se inventa una curva.
- La hora de la desviación es el tramo del trayecto que la contiene, no el
  minuto exacto.
- El lugar es el pin en el mapa (`EventoCombustibleMap`) y sus coordenadas.
  No hay nombre de comuna ni de ruta.

### 3.2 Requiere ampliar el contrato (decide el PO)

Tres ampliaciones, todas de solo agregar campos. Cada una levanta uno de los
límites de §3.1 y se puede aceptar por separado.

| # | Qué se agrega | Qué permite |
|---|---|---|
| C1 | En cada vehículo del panel con desviación: el trayecto que la contiene, su inicio y fin, y las coordenadas del evento | Que la fila del overview muestre fecha, hora y lugar sin otra consulta, y que «Analizar trayecto» abra ese trayecto |
| C2 | Por trayecto, el instante de la desviación y los litros que bajaron | La hora exacta y la variación en litros en el bloque del detalle |
| C3 | El nombre del lugar del evento (comuna y vía) | Decir el lugar en palabras en la fila y en el detalle |

C3 necesita geocodificación inversa: tiene costo por consulta y hay que
decidir dónde se guarda el resultado. Sin C1, la fila del overview dice
«desviación por analizar» y la fecha, la hora y el lugar aparecen recién en
el detalle.

## 4. Reglas

### 4.1 Frase de estado

Sea N = `combustible.con_alerta`.

- Con una desviación: «N camiones piden revisión. Parte por {patente}: una
  desviación de combustible por analizar.»
- Con varias desviaciones: «N camiones piden revisión. Parte por las K
  desviaciones de combustible.»
- Sin desviación y N > 0: «N camiones piden revisión. Parte por {patente}:
  {señal en palabras}.» La patente es la primera en el orden de gravedad.
- N = 0: una sola oración que lo dice en positivo. Es el único lugar de la
  frase donde cabe la buena onda.
- Con N = 1 el sujeto va en singular.

La frase no menciona documentos ni mantenciones: combustible manda.

### 4.2 Tonos

| Señal | Tono | Etiqueta |
|---|---|---|
| `posible_robo` | Analizar primero | Desviación |
| `sin_telemetria` | Sin lectura | Sin telemetría |
| `sin_movimiento` | Sin lectura | Sin movimiento |
| `sin_sensor` | Sin lectura | Sin sensor |
| `falta_capacidad` | Sin lectura | Falta capacidad |
| `dato_no_confiable` | Sin lectura | Dato no confiable |
| `consumo_alto` | Atención | Consumo alto |
| `en_orden` | En orden | En orden |

- Dentro de cada tono el orden es el de gravedad de la spec base.
- Un tono se distingue por forma y palabra además del color.
- «Sin lectura» es un estado propio: el camión no se puede medir. No es
  alerta ni es «en orden».
- Documentos: `vencido` y `faltante` van con la marca del primer tono;
  `sin_fecha` y `sin_archivo` con la de sin lectura; `por_vencer` con la de
  atención. Mantenciones: `vencida`, `proxima` y `programada`, en ese orden.

### 4.3 Acción de cada hallazgo

| Hallazgo | Acción | Destino |
|---|---|---|
| Desviación | Analizar trayecto | Trayectos del vehículo (con C1, el trayecto) |
| Sin telemetría, sin movimiento | Ir al vehículo | Ficha del vehículo |
| Sin sensor | Revisar sensor | Ficha del vehículo |
| Falta capacidad | Cargar capacidad | Ficha del vehículo |
| Dato no confiable | Ver trayectos | Trayectos del vehículo |
| Consumo alto | Comparar trayectos | Trayectos del vehículo |
| Documento pendiente | Abrir ficha | Ficha del vehículo o del conductor |
| Mantención abierta | Marcar realizada · Cancelar | Las escrituras actuales |

La fila de una desviación abre el detalle del vehículo. Ninguna fila termina
en un estado sin acción, salvo «en orden».

### 4.4 Lenguaje

- «Robo», «hurto» y «sustracción» no aparecen en ningún texto visible.
- Una desviación es un hecho medido que alguien tiene que analizar. El bloque
  del detalle dice que puede ser una falla del sensor.
- La descripción de un consumo alto dice que puede venir de la vía. El
  detalle nombra las causas: congestión, desvíos, pendiente o espera con el
  motor encendido.
- Ningún texto de combustible nombra ni insinúa a un conductor. La fila de
  flota no tiene columna de conductor.
- La buena onda vive en el estado vacío de mantenciones y en la frase de
  flota en orden. En filas, tablas y formularios, sobriedad.

### 4.5 Mediana y barra de consumo

La marca de la mediana es solo de lectura. Se calcula en la pantalla con los
camiones que tienen L/100 km y al menos los kilómetros mínimos de
`CONFIGURACION_BOOSTER_FLEET`. No reemplaza ni recalcula la señal
`consumo_alto`, que sigue viniendo del API. Con menos de dos camiones
elegibles la barra no muestra mediana.

### 4.6 Construcción

- Los componentes de pantalla (cifra, fila de flota, alerta documental, card
  de mantención, etiqueta de severidad) viven en `apps/web`, no en
  `packages/ui-components`: llevan dominio.
- La etiqueta de severidad compone el `Badge` del sistema y le agrega la
  forma. El tono «sin lectura» necesita una variante con borde punteado.
- El estado vacío usa `EmptyState`. Su texto no vive en una primitiva.
- Colores, radios y tipografía salen de `packages/ui-tokens`. No entra el
  registro comercial.
- La pantalla responde 403 a los mismos roles que hoy, con el mismo texto.

## 5. Criterios de éxito

1. Con un panel que trae una desviación, la primera oración de la pantalla
   nombra la patente y dice «desviación de combustible por analizar».
2. Con N = 0 la frase lo dice en positivo y no aparece ninguna fila de alerta.
3. Las filas de combustible salen agrupadas por tono y, dentro de cada uno,
   en el orden de gravedad. Un camión con desviación va primero aunque
   también le falte sensor.
4. Los camiones en orden ocupan una sola línea.
5. Cada señal muestra la etiqueta de §4.2 y la acción de §4.3, y el enlace
   lleva al destino indicado.
6. Ningún texto visible de la pantalla ni del detalle contiene «robo».
7. La fila de consumo alto dice que puede venir de la vía.
8. Sin mantenciones abiertas se ve el estado vacío con el formulario, y
   programar desde ahí hace la misma llamada que hoy.
9. «Cancelar» una mantención pide confirmación en un `Modal` y no llama a
   `window.confirm`.
10. El detalle de un vehículo con desviación muestra fecha, tramo horario y
    el mapa con el pin. Si el evento no trae coordenadas, dice «lugar sin
    dato» y no muestra un mapa vacío.
11. El eje de tiempo del detalle ubica cada trayecto en su día y no dibuja
    nivel de estanque donde no hay lectura.
12. Overview y detalle pasan axe sin violaciones, y toda acción se alcanza
    con teclado.
13. Los criterios 1 al 7 de la spec base siguen pasando.

Con C1 aceptada se agrega: la fila de una desviación en el overview muestra
fecha, hora y lugar. Con C2: el bloque del detalle muestra el instante y los
litros. Con C3: el lugar aparece en palabras.

## 6. Lo que no entra

- Cambiar las reglas, los umbrales o el segmentador de combustible.
- Predicción de mantenciones, sugerencia de fechas o de kilometrajes.
- Subir o editar archivos de documentos en esta pantalla.
- Rediseñar el menú lateral, el login o el sitio comercial.
- Las direcciones B (bandeja) y C (matriz), que quedan como exploración.
- Versión para el conductor y modo oscuro.
- Notificaciones, correos y plantillas de WhatsApp: sus textos no se
  revisaron para la regla de lenguaje.
- La tarifa y la bandera de cobro.

## 7. Para decidir (PO)

1. Aceptar esta spec, con o sin cambios.
2. La ruta del detalle. Propuesta: `/app/booster-fleet/vehiculos/$id`.
3. C1, C2 y C3 de §3.2: cuáles entran y en qué orden. Recomendación: C1 y C2
   juntas, porque son las que ponen la fecha, la hora y el lugar donde el PO
   las pidió; C3 después, cuando esté decidido el costo de la geocodificación.
4. El color del tono «analizar primero». La propuesta usa el rojo del
   sistema para que siga siendo lo primero que se ve. La alternativa es el
   ámbar de atención, ahora que el texto dejó de acusar.
