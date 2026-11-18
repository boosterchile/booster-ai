# Booster Fleet — que el dueño no espere la lectura

**Estado**: aceptada por el PO el 2026-11-18 · **Fecha**: 2026-11-18 · **Pedido**: PO

Depende de [`.specs/booster-fleet-ventana-completa/spec.md`](../booster-fleet-ventana-completa/spec.md).
No cambia ninguna regla de combustible ni cuánta telemetría se lee: cambia
cuándo se lee y qué ve el dueño mientras tanto.

## 1. El problema

La spec de la ventana completa fijó que la primera lectura de la flota más
grande respondiera en menos de 4 segundos (§4.4), y que si no cumplía se
escalara con la medición. No cumple. Medido en producción el 2026-11-18:

| Apertura del panel | Tiempo de la petición |
|---|---|
| 13:18 | 10,5 s |
| 14:35 | 9,6 s |
| 14:44 | 9,2 s |
| 15:19, con el registro por fases | 8,8 s |

La última lectura, de 201.903 puntos en 8 vehículos, se repartió así:

| Fase | Tiempo |
|---|---|
| Conteo por vehículo | 0,2 s |
| Leer de la base, 45 tandas | 4,0 s |
| Convertir filas a puntos | 2,4 s |
| Segmentar | 1,5 s |

No hay una fase culpable. La base resuelve cada tanda en 27 ms; el resto
es trabajo del API, que corre con un vCPU. La misma lectura toma 1 s en un
equipo de desarrollo. Quitar la validación por punto bajó cerca de 1 s
(PR 5 de la ventana completa); para llegar a 4 s habría que recortar la
mitad en tres frentes a la vez.

Dos cosas agravan la espera:

- La caché va por tramos fijos de 10 minutos de reloj. Una apertura a las
  14:44 y otra a las 14:35 caen en tramos distintos y las dos pagan la
  lectura completa.
- En la primera apertura medida, el navegador abandonó la petición a los
  4,6 s y el dueño recargó la página.

## 2. Entradas

- La lectura de combustible de la flota, como hoy.
- Redis, donde ya se guarda esa lectura.

## 3. Salidas

### 3.1 El panel responde con la última lectura guardada

Cada lectura de combustible se guarda con el instante en que se hizo. La
pantalla pide el panel aceptando una lectura guardada (§3.3), y entonces:

1. **Hay una lectura de menos de 10 minutos.** Se responde con ella. Es lo
   que hoy hace la caché, pero contado desde la lectura, no por tramos de
   reloj.
2. **Hay una lectura más antigua, de hasta 24 horas.** Se responde con ella
   de inmediato y la respuesta dice que no está al día.
3. **No hay lectura, o tiene más de 24 horas.** Se lee y se espera, como
   hoy.

Quien pide el panel sin aceptar una lectura guardada recibe siempre una al
día: el caso 2 se trata como el 3.

Documentos y mantenciones se leen siempre en vivo; esto es solo combustible.

### 3.2 La pantalla pide la lectura nueva sin tapar lo que ya muestra

Cuando la respuesta dice que el combustible no está al día, la pantalla
muestra esos datos con su hora y pide de inmediato la lectura nueva. Al
llegar, reemplaza las cifras. Si la lectura nueva falla, se queda con la
guardada y lo dice.

La lectura nueva la pide la pantalla, no un trabajo en segundo plano del
API: el API corre con CPU asignada solo mientras atiende una petición, así
que un trabajo que siga después de responder no tiene con qué correr.

### 3.3 Cambios en el contrato

Dos campos nuevos y opcionales en `combustible`, y un parámetro. Ningún
campo existente cambia.

- `combustible.leido_en`: instante en que se hizo la lectura que se está
  mostrando.
- `combustible.al_dia`: falso cuando la lectura tiene más de 10 minutos.
- `GET /booster-fleet?combustible=guardada`: acepta la última lectura
  guardada aunque tenga más de 10 minutos. Lo manda la pantalla en su
  primera petición. Sin el parámetro el panel responde con una lectura al
  día, como antes de esta spec, y eso es lo que usa la pantalla para
  refrescar.

El parámetro es para aceptar la guardada, y no al revés, por las pantallas
que no lo conocen: una pestaña con la versión anterior cargada, o cualquier
otro cliente, sigue recibiendo cifras al día sin cambiar nada.

### 3.4 Lo que ve el dueño

- Siempre: «Combustible leído a las HH:MM», en hora de Santiago.
- Con una lectura que no está al día: la misma línea más «actualizando…»,
  y las cifras guardadas a la vista.
- Si la actualización falla: «No se pudo actualizar. Estas cifras son de
  las HH:MM.»

Una desviación ocurrida después de la lectura guardada aparece cuando llega
la lectura nueva, unos segundos después. La pantalla no afirma que una
flota está en orden con datos viejos sin decir de cuándo son.

## 4. Reglas

- **Al día:** 10 minutos desde la lectura. **Tope para mostrar una lectura
  guardada:** 24 horas.
- Una sola lectura a la vez por flota: si ya hay una en curso, la segunda
  petición espera a esa (ya es así desde la corrección de memoria).
- Lo guardado se valida antes de usarlo y es de la misma empresa, como hoy.
- Si Redis no responde, el panel lee de la base y lo registra, como hoy.
- Un cambio de capacidad de estanque, de fuente de combustible o de
  umbrales se refleja en la lectura siguiente: al refrescar, no después de
  24 horas.
- La métrica de duración de la lectura sigue distinguiendo caché y base, y
  agrega cuántas respuestas salieron con una lectura que no estaba al día.
- El detalle del vehículo no cambia: lee siempre de la base.

## 5. Criterios de éxito

1. Con una lectura guardada de menos de 10 minutos, el panel responde con
   ella y `al_dia` es verdadero, aunque haya cambiado el tramo de reloj.
2. Con una lectura guardada de entre 10 minutos y 24 horas y
   `?combustible=guardada`, el panel responde sin leer la telemetría, con
   `al_dia` falso y `leido_en` con su instante.
3. Sin lectura guardada, o con una de más de 24 horas, el panel lee, espera
   y responde con `al_dia` verdadero.
4. Sin el parámetro, el panel no devuelve nunca una lectura de más de 10
   minutos.
5. Dos peticiones simultáneas de la misma flota hacen una sola lectura.
6. La pantalla, con `al_dia` falso, muestra las cifras guardadas con su
   hora, pide la lectura nueva y las reemplaza al llegar.
7. Si la lectura nueva falla, la pantalla conserva las cifras guardadas y
   dice de qué hora son.
8. Con Redis caído, el panel responde leyendo de la base y deja un registro.
9. Con una lectura guardada, la petición del panel responde en menos de 1
   segundo en producción con la flota más grande. Se mide y se adjunta.
10. Los criterios de las specs de las que depende siguen pasando.

## 6. Lo que no entra

- Bajar el tiempo de la lectura misma. La primera apertura del día sigue
  tardando lo que tarda la lectura (hoy, 8 a 10 s).
- Una tarea programada que lea antes de que el dueño abra el panel (§7.3).
- Más CPU para el API.
- La tabla de trayectos ya segmentados.

## 7. Decisiones del PO

Tomadas el 2026-11-18, al aceptar la spec con sus propuestas:

1. La spec queda aceptada, con el cambio de contrato de §3.3: los campos
   `combustible.leido_en` y `combustible.al_dia` y un parámetro. El mismo
   día, al implementar, el PO aceptó invertir el parámetro propuesto
   (`?combustible=al_dia` pasó a `?combustible=guardada`): sin él, el panel
   sigue respondiendo con una lectura al día.
2. **Los números:** 10 minutos para «al día» y 24 horas como tope para
   mostrar una lectura guardada.
3. **La primera apertura del día** sigue esperando la lectura completa. No
   se agrega una tarea programada por ahora; se decide con los datos de uso
   después de desplegar esto.
4. **El objetivo de 4 s** de la spec de la ventana completa (§4.4) queda
   reemplazado por el criterio 9 de esta spec. El tiempo de la lectura
   completa se sigue midiendo, sin objetivo.
