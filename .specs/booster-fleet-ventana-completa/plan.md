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

Criterios 7, 8 y 9.

- [x] Guardar la lectura por empresa y tramo de 10 minutos en Redis.
- [x] Con Redis caído, leer de la base y registrarlo.
- [x] Marcar en la métrica de duración si la lectura salió de caché.
- [x] Medir §4.4 con 200.000 puntos sintéticos y adjuntar la medición.

Medición del 2026-11-17, en el equipo de desarrollo, con Postgres y Redis
locales: 199.998 puntos en 7 días repartidos en 3 vehículos, con un
`io_data` de 1.130 bytes por punto (casi el doble del real).

| Lectura | Tiempo |
|---|---|
| De la base, tres corridas | 3.058, 3.042 y 2.964 ms |
| Desde la caché, cinco corridas | 4, 1, 1, 1 y 1 ms |

Las dos cumplen los objetivos de la spec §4.4 (menos de 4 s y menos de
300 ms). La lectura de la base queda a un segundo del límite y la medición
no es de producción: hay que mirarla en el histograma
`booster_fleet_lectura_combustible_ms` después del primer despliegue. El
valor guardado pesó 132 KB.

Decisiones tomadas en este PR:

- La clave lleva la empresa, el tramo de 10 minutos, el reparto y el
  presupuesto. No lleva datos de la flota.
- Lo guardado se valida antes de usarlo. Si no tiene forma de lectura o es
  de otra empresa, se descarta y se lee de la base.
- El guardado no se espera: la respuesta no depende de Redis.
- Se reutiliza la conexión Redis que el API ya tiene; no se abre otra.
- La caché envuelve solo al panel. El listado de trayectos y el detalle del
  vehículo leen siempre de la base.

## PR 3 — La pantalla dice desde cuándo

Criterio 6.

- [x] El aviso de telemetría cortada dice desde cuándo son las cifras, en
      hora de Santiago. Sin la fecha, mantiene el aviso general.

## Fuera de esta serie

- La tabla de trayectos ya segmentados (spec §7).
- El listado de trayectos de 30 días de toda la flota.
