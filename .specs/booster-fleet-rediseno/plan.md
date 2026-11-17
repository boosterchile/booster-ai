# Booster Fleet — rediseño: plan

Spec: [`spec.md`](./spec.md). Tres PRs, de a uno. La serie termina cuando los
17 criterios de la spec §5 están cubiertos por tests y la pantalla nueva está
en `main`.

## Lo que se revisó antes de empezar

La spec mandaba detenerse si el segmentador no conservaba el instante y los
litros de la desviación. Se revisó `segmentar-trayectos-teltonika.ts`: los
conoce al detectar el aviso y los descartaba al armar el trayecto.

- Baja de golpe: `detectarRobos` tiene el inicio y el fin de la ventana y la
  diferencia de litros entre las dos lecturas.
- Baja gradual: cada episodio guarda su ventana y sus litros; la ventana que
  califica es la lista de episodios que suman el umbral.

Sacar esos valores no agrega una regla de detección ni toca un umbral. No
hubo que estimar nada.

## PR 1 — Contrato: la desviación con su hora, sus litros y su lugar

Criterios 14 a 17.

- [x] Segmentador: `eventoDesde`, `eventoHasta` y `eventoLitros` por trayecto.
      Si el trayecto tiene golpe y gradual, manda el golpe, igual que el pin.
- [x] Ruta de trayectos: `evento_desde`, `evento_hasta`, `evento_litros`.
- [x] Panel: `desviacion` en el vehículo con señal `posible_robo`, con el
      trayecto, la ventana, los litros, las coordenadas, el tipo y el total.
      Ausente en los demás vehículos.
- [x] Tests primero, con el rojo en la Evidencia del PR.

Decisiones tomadas en este PR:

- Con varias desviaciones manda la de fin de baja más reciente. Si un aviso
  no trae ventana, se ordena por el fin de su trayecto.
- `tipo` reutiliza los valores `golpe` y `hormiga` que el panel ya entrega en
  `alertas`. La pantalla los muestra como «desviación» y «desviación gradual».
- Los litros de la ventana se redondean a un decimal.

## PR 2 — Overview

Criterios 1 a 9, 12, 13 y la parte de pantalla del 14.

- [x] Reglas puras de la pantalla, con sus tests: frase de estado, tonos,
      agrupación y orden, mediana de lectura, acción y destino de cada señal.
- [x] Componentes en `apps/web/src/components/booster-fleet/`: cifra, etiqueta
      de severidad, fila de flota, alerta documental, card de mantención.
- [x] Variante de borde punteado para el tono «sin lectura».
- [x] Riel de documentos y mantenciones; estado vacío con el formulario.
- [x] «Programar mantención» en un `Modal`; «Cancelar» confirma en un `Modal`.
- [x] La fila de una desviación muestra fecha, hora, litros y coordenadas.
- [x] axe sin violaciones y recorrido por teclado.

Decisiones tomadas en este PR:

- La fila de una desviación todavía no abre el detalle del vehículo: esa
  ruta llega en el PR 3. «Analizar trayecto» ya abre el trayecto.
- El botón del formulario se llama «Guardar mantención», para que no haya
  dos botones con el mismo nombre que «Programar mantención» de la cabecera.
- La lista de documentos une vehículos y conductores en un solo orden.
- Fechas y horas se muestran en hora de Santiago; el panel no entrega la
  zona de la empresa.

## PR 3 — Detalle del vehículo

Criterios 10 y 11, y la parte del 12 que toca al detalle.

- [ ] Ruta `/app/booster-fleet/vehiculos/$id`, con el mismo control de rol.
- [ ] Bloque de la desviación con fecha, hora, litros y mapa; «lugar sin
      dato» cuando no hay coordenadas.
- [ ] La semana sobre un eje de tiempo: días, nivel de estanque en los puntos
      conocidos, trayectos y eventos.
- [ ] Tabla de trayectos, combustible de la semana, documentos y mantenciones
      del vehículo.
- [ ] El tipo `Trayecto` de la pantalla suma los campos del evento.

## Fuera de esta serie

- El nombre del lugar en palabras (C3).
- Los textos de notificaciones, correos y plantillas de WhatsApp.
