# Booster Fleet — gestión de flota para el dueño

**Estado**: aceptada en este frente · **Fecha**: 2026-11-17 · **Pedido**: PO

## 1. Qué es

Booster Fleet es la configuración del servicio de gestión de flota. Está
dirigida al dueño de la empresa de transportes (y al admin, que opera con
él). No es otra pantalla de seguimiento: es el control de la flota.

Tres controles, y en ese orden de importancia:

1. **Combustible.** La misma lectura que ya segmenta los trayectos Teltonika
   (litros, L/100 km confiables, robo de golpe y hormiga, sensor y capacidad
   de estanque). El dueño ve la flota de los últimos 7 días, con el problema
   arriba.
2. **Documentos.** Cada vehículo activo y cada conductor no eliminado, con
   los documentos obligatorios y el archivo. Lo que falta o está vencido no
   se esconde detrás de un conteo.
3. **Mantenciones.** El dueño programa, marca realizada o cancela. Un camión
   en estado `mantenimiento` aparece como en taller.

La tarifa no cambia: sigue siendo
`suscripcion_transportista_gestion_flota_uf_camion_mes`. El platform-admin
habilita el cobro con la misma bandera de siempre; en la pantalla se llama
Booster Fleet.

## 2. Entradas

- Membresía activa de una empresa transportista, rol `dueno` o `admin`.
- Vehículos no retirados, con o sin Teltonika.
- Trayectos de los últimos 7 días, leídos por `leerTrayectosDeLaFlota`.
- `documentos_vehiculo`, `documentos_conductor` y la fecha de licencia de la
  ficha del conductor.
- Filas de `mantenciones_vehiculo` (migración 0086, expand-only).

## 3. Salidas

- `GET /booster-fleet` — panel con `configuracion`, `combustible`,
  `documental` y `mantenciones`.
- `POST /booster-fleet/mantenciones` — programa una mantención.
- `POST /booster-fleet/mantenciones/:id/realizar` — la cierra como hecha.
- `POST /booster-fleet/mantenciones/:id/cancelar` — la cancela.
- `/app/booster-fleet` — la pantalla del dueño, en el menú Transporte.

Un despachador, un conductor, un visualizador o un generador puro reciben
403. La pantalla les dice que Booster Fleet es del dueño.

## 4. Reglas

### Combustible

Por vehículo, la señal más grave gana:

1. `posible_robo` — algún trayecto con golpe u hormiga.
2. `sin_telemetria` — no tiene Teltonika.
3. `sin_movimiento` — tiene equipo y ningún trayecto en la ventana.
4. `sin_sensor` — hubo trayectos y ninguno trae fuente de combustible.
5. `falta_capacidad` — hay porcentaje de estanque y no hay litros confiables
   porque falta la capacidad.
6. `dato_no_confiable` — la nota del trayecto lo dice y no quedó un L/100 km
   confiable.
7. `consumo_alto` — L/100 km confiable, al menos 50 km, y supera en más de
   25 % la mediana de los otros camiones que también tienen al menos 50 km
   confiables. Hacen falta al menos dos pares. Si no, no se compara.
8. `en_orden`.

En pantalla, `posible_robo` no se nombra como robo: se muestra como
«Desviación de combustible por analizar» (decisión del PO, 2026-11-17). Es una
variación medida que alguien tiene que revisar, no una conclusión. El nombre
de la señal en el contrato no cambia. La misma regla vale para las demás
pantallas que muestran el aviso (trayectos, mapa del evento, ficha del
vehículo y umbrales de la empresa): «desviación de combustible» para la baja
de golpe y «desviación gradual» para las bajas chicas repetidas.

Los litros que se muestran pueden incluir tramos no confiables. El L/100 km
solo sale de los tramos que el segmentador ya aceptó en el Σkm/ΣL. Un km/L
igual al 25 % sobre la mediana no es alto: tiene que superarla.

### Documentos

Obligatorios del vehículo: revisión técnica, permiso de circulación, SOAP.
Obligatorios del conductor: licencia de conducir y examen psicotécnico.

Sin fila, el obligatorio está `faltante`. Con fila, la vigencia sale de la
fecha: vencido si la fecha es anterior a hoy, por vencer si faltan 30 días o
menos (incluido el día de vencimiento), vigente si faltan más. Sin fecha, la
fila es `sin_fecha`. Si hay varias filas del mismo tipo, manda la vigencia
mejor; a igualdad, la fecha más lejana.

La licencia además mira `licencia_vencimiento` de la ficha. Si la ficha está
vigente y no hay archivo, el estado es `sin_archivo`. Si la ficha está peor
que el archivo, manda la ficha.

Un documento no obligatorio solo aparece cuando no está vigente. El vehículo
o el conductor está al día solo si cada documento listado está vigente.

### Mantenciones

`realizada` y `cancelada` cierran la fila; no pueden estar las dos. Sin
cierre: `vencida` si la fecha ya pasó, `proxima` si faltan 15 días o menos
(hoy incluido), `programada` si faltan más. Las canceladas no vuelven al
panel.

## 5. Criterios de éxito

1. El panel se llama Booster Fleet y declara el servicio `gestion_de_flota`.
2. Un camión con robo queda en `posible_robo` aunque también le falte sensor.
3. El consumo alto no se declara con menos de dos pares ni en el borde exacto
   del 25 %.
4. Cada vehículo y cada conductor muestra sus obligatorios, incluido el que
   no tiene ninguna fila.
5. Una mantención de ayer está vencida; marcarla realizada la saca de esa
   lista. Cancelarla la quita del panel.
6. Dueño y admin de un transportista entran. El resto, no.
7. La pantalla deja programar una mantención y muestra combustible,
   documentos y mantenciones del panel.

## 6. Lo que no entra

- Predicción de mantenciones, repuestos o talleres externos.
- Editar el archivo del documento en esta pantalla: se enlaza al vehículo o
  al conductor.
- Cambiar la tarifa, el umbral de robo o el segmentador de trayectos.
- Cobrar solo por tener la pantalla abierta. El cobro sigue en la bandera
  que prende el platform-admin.
