# Booster Fleet — ventana completa: plan

Spec: [`spec.md`](./spec.md). Tres PRs, de a uno. La serie termina cuando
los 10 criterios de la spec §5 están cubiertos por tests, los tiempos de
§4.4 están medidos y el cambio está en `main`.

## Lo que se revisó antes de empezar

El segmentador lee diez AVL de `io_data`: 1 y 239 (ignición), 24 y 81
(velocidad), 240 (movimiento), 250 (viaje), 83 (consumo acumulado), 84
(nivel en litros), 89 (nivel en %) y 85 (rpm). La lista suma el 87
(odómetro CAN), que el módulo declara aunque hoy no lo usa. El resto del
`io_data`, unos 600 bytes por punto, no se necesita.

## PR 1 — Lectura por vehículo, con proyección y presupuesto

Criterios 1 a 5 y 10.

- [x] `AVL_LEIDOS_POR_SEGMENTADOR`, exportada junto al segmentador. Un test
      espía cada lectura del `io` y falla si aparece un AVL fuera de la
      lista; otro compara el resultado con el `io` completo y proyectado.
- [x] La consulta proyecta esas claves con `jsonb_build_object` y quita las
      ausentes, para que no viajen como null.
- [x] Reparto `por_vehiculo`: cuenta los puntos de cada vehículo, reparte el
      presupuesto y lee cada uno con su cuota.
- [x] `repartirPresupuesto`: partes iguales; lo que un vehículo no usa pasa
      a los demás.
- [x] `combustible.cobertura_desde` en el esquema y en el panel.
- [x] `BOOSTER_FLEET_PRESUPUESTO_PUNTOS` en la configuración, 400.000 por
      defecto.
- [x] Histogramas de puntos leídos y de duración de la lectura.
- [x] Tests primero, con el rojo en la Evidencia del PR.

Decisiones tomadas en este PR:

- El listado de la flota sigue con su tope de 20.000 y su corte por fecha,
  como manda la spec §4.5. Lo único que le cambia es la proyección, que no
  altera el resultado.
- Una consulta de un solo vehículo lee hasta el presupuesto. Así el detalle
  del vehículo trae sus 7 días completos; de paso, la vista de trayectos
  filtrada por vehículo deja de recortarse a 20.000 puntos.
- Los vehículos se leen en el orden de la flota, uno tras otro.
- `cobertura_desde` es el punto más antiguo leído de toda la flota, como
  dice la spec §3.2. Con recorte parejo, un camión que reporta poco puede
  tener historia más antigua que uno que reporta mucho: la fecha dice desde
  cuándo hay algún dato, no desde cuándo están todos completos. Queda
  planteado al PO.

## PR 2 — Caché de la lectura de combustible

Criterios 7 y 8, y los tiempos del 9.

- [ ] Guardar la lectura por empresa y tramo de 10 minutos en Redis.
- [ ] Con Redis caído, leer de la base y registrarlo.
- [ ] Marcar en la métrica de duración si la lectura salió de caché.
- [ ] Medir §4.4 con 200.000 puntos sintéticos y adjuntar la medición.

## PR 3 — La pantalla dice desde cuándo

Criterio 6.

- [ ] El aviso de telemetría cortada dice desde cuándo son las cifras.

## Fuera de esta serie

- La tabla de trayectos ya segmentados (spec §7).
- El listado de trayectos de 30 días de toda la flota.
