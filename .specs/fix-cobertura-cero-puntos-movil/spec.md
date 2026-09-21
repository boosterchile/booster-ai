# Cobertura 0 % con puntos del teléfono ya enviados

**Estado**: aceptada como bugfix · **Fecha**: 2026-09-21 · **Pedido por**: QA prod (BOO-83ND2C)
**Slot**: no abre frente. Endurece el resultado del conductor (Slot 3, paso 4) y la lectura de la cobertura de Slot 1. No cambia la fórmula de ADR-028 ni el enrutamiento de ADR-077.

## Qué se vio

En la tarjeta del conductor: «Reportando posición en vivo · 17 puntos enviados».
Al cerrar el viaje: «Cobertura de posición: 0 %», «Huella estimada (cobertura insuficiente para medir)» y nivel secundario modelado.

La misma carga está descrita en `.specs/fix-tracking-snapshot-congelado/`: fuente en vivo «teléfono del conductor», velocidad con decimales (fila de `posiciones_movil_conductor`, no el entero de Teltonika), y los 17 puntos solo mientras esta pantalla estaba al frente. Con Google Maps delante el browser no postea. No hay consulta a prod en este cambio: la causa de abajo sale del código que produce exactamente esa pantalla.

## Causa (leída del código, no supuesta sobre las 17 filas)

`pointsSent` cuenta POST `driver-position` que el API aceptó. Cada uno inserta una fila en `posiciones_movil_conductor`.

`cobertura_pct` no es ese conteo. Al entregar, `recalcularNivelPostEntrega` pide pings a `resolverPosicionesSegmento` y persiste la fracción de `computarEscrituraDistanciaReal`:

- km observados = Σ haversine entre pings consecutivos con hueco **< 60 s** (`CONTINUITY_GAP_S`, ADR-028 §5).
- Si esa suma es 0, `resolverEscrituraDistanciaReal` guarda cobertura **0** y distancia real **null**. Con huella activa la fuente persistida pasa a `maps_directions` y las emisiones reales quedan null.
- La UI imprime ese 0 como «Cobertura de posición: 0 %» y, porque las emisiones reales son null, «cobertura insuficiente para medir». El nivel sigue `secundario_modeled` (ADR-077: el móvil nunca es primario).

La fuente de esa lectura **no es** la del tracking en vivo (`posicion-en-vivo.ts` lo dice: live ≠ certificación).

| Vehículo | Qué lee la cobertura | Qué hace el vivo si no hay Teltonika fresco |
|---|---|---|
| `teltonika_imei` o solo espejo | solo `telemetria_puntos` | cae al teléfono de esta asignación |
| sin dispositivo | `posiciones_movil_conductor` por `vehiculo_id`, ventana `[recogido_en, entregado_en]` | teléfono |

Hipótesis revisadas:

- «La cobertura ignora el móvil en un viaje sin IMEI.» **No.** Sin dispositivo la ventana móvil ya alimenta el cálculo (test de integración T11). 17 puntos continuos y con desplazamiento dan cobertura > 0.
- «El umbral trata puntos ralos o tardíos como 0 %.» **Sí, y es la regla.** Hueco ≥ 60 s no suma km. Si ningún par entra, o los que entran no se desplazan, o los POST quedaron fuera de la ventana, el número guardado es 0 aunque las filas existan. Un abort de Routes o el tope de huecos también pisa a 0 una observación que sí había.
- «El vivo y el cierre no miran la misma tabla.» **Sí, cuando hay dispositivo.** El vivo puede decir «teléfono» y el cierre, con la tabla del dispositivo vacía en el tramo, guarda 0 e ignora los 17 (ADR-077: sin mezclar streams). Eso no se “cablea” al revés: mezclar reabriría el ADR.

No se sube el porcentaje para que 17 puntos ralos parezcan cobertura. Un número más alto en el certificado sería declarar distancia medida que el gap de 60 s no midió.

## Qué cambia

`GET /assignments/:id/resultado` agrega `cobertura` cuando la cobertura persistida es 0 y hay vehículo:

- `motivo`: `sin_puntos` | `fuera_de_tramo` | `sin_tramo_continuo` | `sin_desplazamiento` | `sin_telemetria_dispositivo` | `medicion_no_cerrada`
- `fuente`: la que decide ADR-077, no la del vivo
- `puntos_telefono`: filas de esta asignación
- `puntos_en_tramo`: pings de esa fuente dentro de la ventana

La tarjeta no muestra «0 %» ni «cobertura insuficiente para medir» cuando hay motivo: dice por qué el cero es honesto, y separa «sin telemetría del dispositivo» de los puntos del teléfono. `metricas_viaje.cobertura_pct` no se toca.

Un valor guardado entre 0 y 1 ya no se redondea a «0 %» en la tarjeta (un decimal).

## Fuera de alcance

GPS con Maps o el teléfono bloqueado. Mezclar Teltonika y móvil en la huella. Opt-in de huella. Deploy.
