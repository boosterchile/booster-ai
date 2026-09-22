# Spec — Historial de trayectos Teltonika (combustible + badge anti-robo)

**Slug:** `historial-trayectos-teltonika`
**Brief:** bloqueado 2026-09-21. Dueño|admin de una empresa transportista audita consumo y posible robo de combustible sobre la flota Teltonika. No se ata a cargas de Booster ni a la app nativa.

**Frentes vivos:** el documento `docs/frentes-vivos.md` (2026-09-13) no lista este frente. El brief de producto del 2026-09-21 lo encarga de forma explícita, con criterios de aceptación cerrados. Esta spec no reabre un cimiento ni edita ADRs.

## Entradas

- Membresía activa `dueno`|`admin` de una empresa con `es_transportista = true`. El `empresa_id` sale de la membresía, nunca del cliente.
- `GET /trayectos-teltonika?desde&hasta&page&page_size&combustible`
  - `desde` / `hasta`: ISO-8601 opcionales. Default: últimos 7 días. `hasta > desde`. Ventana máxima 31 días.
  - `page` ≥ 1 (default 1). `page_size` 1..50 (default 20).
  - `combustible`: `con_dato` (default) | `sin_dato`. Elige qué trayectos se paginan (criterio 12).
- Fuente: `telemetria_puntos` de los vehículos de esa empresa con `teltonika_imei` propio (no el IMEI espejo de demo). Columnas `timestamp_device`, `latitud`, `longitud`, `velocidad_kmh` e `io_data`.

## Auditoría AVL (no se hardcodea a ciegas)

Censo `.specs/telemetria-fmc150/delta.md` (260k filas, 2026-05-03→2026-07-13) y catálogo vigente:

| Señal | ID | ¿En `io_data` del censo? | Uso en este frente |
|---|---|---|---|
| Ignición | **239** | Sí | Primaria para abrir/cerrar el trayecto. |
| RPM CAN | **85** | Sí desde jul-2026 (flota con CAN) | Motor encendido si > 0. Suple al 239 cuando el cable de ignición no está conectado (criterio 13). |
| Movimiento | **240** | Sí | Primaria, junto con `velocidad_kmh` (> 5 km/h). |
| Trip (escenario) | **250** | Sí | Solo de apoyo: acerca el borde ≤ 2 min si ya hay un trayecto por ignición+movimiento. No crea un trayecto solo. |
| DIN1 | **1** | **No** (ausente del set de claves) | Reserva: solo si el punto no trae 239 y el valor es 0 o 1. No es la fuente por defecto. |
| Fuel level L | **84** | No en ese censo; sí en PLFL57 (`.specs/can-live-view/`) | Única fuente del **nivel** en litros (raw ×0.1, catálogo `can-lvcan`). Es la única que habilita el aviso de robo. |
| Fuel level % | **89** | Igual que 84 | No se convierte a litros (no hay capacidad de estanque en el esquema). Sin 84 ni 83 se muestra como nivel en % (criterio 10). |
| Fuel consumed | **83** | Igual | Contador acumulado (raw ×0.1 L). No se usa como nivel. Sin 84 en el trayecto, su Δ da los litros consumidos y el km/L (criterio 10). |
| Velocidad CAN / GPS IO | **81** / **24** | 81 no en el censo; 24 sí | Respaldo de velocidad solo si `velocidad_kmh` es null. |

**Censo 2026-09-22** (Van Oosterwyk, 7 días, `scripts/db/agent-query.sh`): solo JLKT54 manda 84. RCPC20, KFKW23 y KZXB64 mandan 83 + 89. JWTH77 manda solo 89. PLFL57 manda 83 + 89 de forma intermitente. VFZH-68 y KZBB26 no mandan ninguna clave de combustible. KZXB64 trae el 239 siempre en 0, también en marcha, con RPM 85 > 0.

No hay columna de capacidad de estanque. El golpe usa `U = max(U_empresa, 2 %)` si hay capacidad, si no `U_empresa`. Sin config, `U_empresa = 8 L`. La empresa puede persistir `umbral_robo_golpe_l` (5–20) y `umbral_robo_hormiga_l` (8–30); NULL es el default.

## Salidas

`200`:

```
{
  empresa_id, desde, hasta,
  vehiculos_teltonika, truncado,
  cta: null | "vincular_teltonika",
  cta_sensor: boolean,
  combustible: "con_dato" | "sin_dato",
  page, page_size, total,
  total_con_combustible, total_sin_combustible,
  vehiculos: [{
    vehiculo_id, patente,
    combustible: "nivel_litros" | "consumo_can" | "nivel_porcentaje" | "sin_sensor"
  }],
  trayectos: [{
    id, vehiculo_id, empresa_id, patente,
    inicio, fin, distancia_km,
    litros_iniciales, litros_finales, km_por_litro,
    fuente_combustible: null | "nivel_litros" | "consumo_can" | "nivel_porcentaje",
    litros_consumidos, nivel_pct_inicial, nivel_pct_final,
    nota_combustible, posible_robo_combustible, posible_robo_hormiga,
    event_lat, event_lon,
    sensor_combustible: "ausente" | "presente" | "degradado",
    cta_sensor
  }]
}
```

`total` cuenta los trayectos del filtro pedido. `vehiculos` resume la mejor fuente de cada vehículo con puntos en la ventana (84 > 83 > 89 > ninguna).

Orden: fin descendente (más reciente primero), luego inicio descendente.

Segmentación, por vehículo, puntos en orden temporal:

1. Ignición = on si el 239 vale 1 o el RPM CAN (85) es > 0. Si no, off si el 239 vale 0. Sin 239 ni RPM > 0, DIN1 (1) si es 0|1. Se arrastra el último valor conocido. Sin ignición conocida el punto no abre trayecto.
2. En movimiento = 240 = 1, o velocidad conocida > 5 km/h.
3. Trayecto = racha con ignición on y en movimiento. Un hueco > 15 min entre puntos activos corta el trayecto. Hacen falta ≥ 2 puntos.
4. 250 = 1/0 solo estira el borde si cae a ≤ 2 min del inicio/fin ya detectado.
5. Distancia = Σ haversine entre coordenadas válidas (se salta 0,0 y null; no se inventa tramo).
6. L ini / L fin = primera y última lectura válida de 84 dentro del trayecto. `km/L = distancia / max(L_ini − L_fin, ε)` solo si `L_ini − L_fin > 0`. Si no, `km_por_litro = null` y nota en vos. Sin 84 en el trayecto, los litros salen del 83 (criterio 10). La distancia del km/L es la del tramo entre la primera y la última lectura usada (criterio 11).
7. Badges según los criterios 3 y 9. El reloj es `timestamp_device`. `timestamp_recibido_en` no entra en la ventana ni en el orden.
8. Pin del aviso: `event_lat` / `event_lon` se calculan al leer, sobre los mismos puntos. Si hay golpe, el pin es **el inicio de la ventana de esa caída** (se conserva el comportamiento de #706). Si solo hay hormiga, el pin es el inicio de la ventana del primer episodio que entra en la suma. Dentro de `[desde, hasta]` de esa ventana, el primer punto con lat/lon usable ordenado por timestamp de dispositivo. Si el punto de inicio no tiene fix (null o 0,0), el siguiente dentro de la misma ventana. Si ninguna ventana del aviso tiene fix usable, ambos campos van en `null`. Sin aviso también van en `null`. No se usa la traza del trayecto ni un punto fuera de la ventana.
9. Sensor del vehículo en la ventana: algún 84 válido → `presente`. Algún 83/84/89 sin 84 válido → `degradado` (sin nivel en litros, así que sin badge; los litros consumidos y el nivel en % sí se muestran según el criterio 10). Ninguno → `ausente` (trayectos y km sí; sin km/L ni badge; CTA de conectar sensor).

## Criterios de éxito

1. Dueño|admin transportista ve la lista en `/app/trayectos`: inicio, fin, distancia, vehículo; scope `empresa_id`; reciente primero; paginada.
2. Con 84 válido al inicio y al final y ΔL > 0: L ini, L fin y km/L según la fórmula. Si ΔL ≤ 0: km/L «—» y nota.
3. Given Teltonika points ordered by **device timestamp** (not receive/GPRS time), When within window Y=5 min (device ts) fuel drops ΔL ≤ −U with v≤5 km/h — **ignition on OR off both valid** — Then badge «posible robo combustible» on that trip in historial.

   U = max(U_empresa, 2% tank capacity) if capacity known, else U_empresa. Default U_empresa = 8 L. Dueño|admin configura U_empresa en [5, 20] L para toda la flota. Por debajo de 5 L no se ofrece (ruido del sensor). El 2 % sigue de piso: `max(U_empresa, 2 %)` cuando hay capacidad.

   Mandatory: offline-tolerant — if device buffered without cellular and later uploads via GPRS, ΔL is detected on ingest using device ts (must not miss due to server delay).

   Still out of MVP: live/push alerts. Still in: v≈0 so we don't badge consumption while moving.

   Cumplimiento en código: `listar-trayectos-teltonika.ts` lee y ordena `telemetria_puntos.timestamp_device` (no `timestamp_recibido_en`) y pasa ese instante como `tMs`. Lee `empresas.umbral_robo_golpe_l` (NULL → 8). `segmentar-trayectos-teltonika.ts` reordena por `tMs`, exige ΔL ≤ −U en ≤ 5 min y velocidad conocida ≤ 5 km/h en todo el intervalo, y no mira la ignición. El badge se calcula al leer el historial sobre los puntos ya ingeridos; un upload GPRS tardío no se pierde por la demora del servidor. No hay push.
4. Teltonika sin sensor (sin 83/84/89): trayectos y km; sin km/L ni badge; CTA «conectar sensor combustible».
5. Empresa sin vehículos Teltonika: lista vacía + CTA de vincular. HTTP 200, no error.
6. Conductor, despachador, visualizador, generador puro: 403 y el ítem no está en el nav.
7. IO de combustible ausente o inválido: no se inventan litros ni badge; la UI lo dice.
8. Given a theft badge on a trip, When ≥1 Teltonika point has lat/lon in the ΔL detection window (ordered by device timestamp, not receive time), Then expose `event_lat`/`event_lon` (prefer the start of the drop window) and show a pin on the trip detail map.
   Given badge but no usable geo in that window, When opening detail, Then badge still visible + honest copy «sin ubicación» — never invent a pin.
   Given list `/app/trayectos`, When an event has geo, Then user can open map centered on that pin.

   Cumplimiento: mismo cálculo on-read. El pin del golpe es el primer fix válido de la ventana, por `tMs`, empezando por el inicio de la caída. La UI en `/app/trayectos?detalle=` muestra el mapa centrado en ese punto, o «sin ubicación» si `event_lat`/`event_lon` son null. La lista enlaza «Ver en el mapa» cuando hay geo y «Ver detalle» cuando el aviso no tiene fix. El mismo pin sirve para la hormiga cuando no hay golpe.
9. Hormiga, distinto del golpe. Dentro del trayecto al que se atribuye cada episodio (el mismo criterio que el golpe: solapa el trayecto o es la parada posterior, sin cruzar al trayecto siguiente): ≥2 episodios, cada uno con ΔL ≤ −2 L en ≤5 min y v≤5, fines separados ≥10 min. Se suma |ΔL|. Si la suma ≥ U_hormiga → badge «posible robo hormiga». U_hormiga default 10 L; la empresa lo configura en 8–30 L (`empresas.umbral_robo_hormiga_l`, NULL = 10). En un trayecto largo la suma mira una ventana móvil de 6 h por timestamp de dispositivo. Un solo episodio, aunque esté bajo el U del golpe, no marca hormiga. Una baja de menos de 2 L o con v>5 no es episodio.

   Configuración: `GET /me/empresa` devuelve los dos umbrales (null = default). `PATCH /me/empresa/umbrales-combustible` los persiste. Solo dueño|admin. Zod rechaza fuera de rango. La UI en `/app/empresa` ofrece el rango con un `<select>` (5–20 y 8–30); menos de 5 L no está en la lista. Y sigue en 5 min y no se configura.

## Slice — fuentes CAN y vista limpia (2026-09-22)

Brief del PO del 2026-09-22: en prod, RCPC20 y JWTH77 muestran «No hay una lectura válida de litros» aunque el CAN funciona, y los camiones sin sensor se ven como fallas. Causa raíz (censo de arriba): no es el parseo del 84. Esos camiones no mandan el 84, y el código solo aceptaba el 84 como fuente de litros. Todo lo que no fuera 84 quedaba `degradado` con esa nota.

10. Fuente por trayecto, en este orden, con los puntos del trayecto:
    - `nivel_litros`: hay 84 válido. L ini, L fin, km/L y avisos de robo como en los criterios 2, 3 y 9. `litros_consumidos = L_ini − L_fin` si es > 0.
    - `consumo_can`: no hay 84 y hay ≥ 2 lecturas válidas de 83. `litros_consumidos = 83_último − 83_primero` (×0.1). `km/L = distancia / litros_consumidos`. L ini y L fin quedan null, porque el 83 no es un nivel. Sin aviso de robo: un robo no pasa por el contador del motor.
    - `nivel_porcentaje`: no hay 84 ni 83 usable y hay 89. `nivel_pct_inicial` / `nivel_pct_final` = primera y última lectura. Sin litros, sin km/L y sin aviso: sin la capacidad del estanque no se convierte a litros.
    - `null`: ninguna. El trayecto va al filtro `sin_dato`.

    `nivel_pct_inicial` / `nivel_pct_final` se llenan siempre que el trayecto traiga 89, sea cual sea la fuente.
11. Lectura válida para litros y km/L. Se calculan sobre el tramo entre la primera y la última lectura de la fuente, con la distancia de ese mismo tramo, y solo si:
    - ese tramo cubre ≥ 90 % de la distancia del trayecto. Si no, `litros_consumidos` y `km_por_litro` quedan null y la nota por fila lo dice. Así un CAN que se corta a mitad de viaje no infla el km/L;
    - suma ≥ 5 L y ≥ 10 km. Si no, los dos quedan null sin nota por fila, y la UI lo explica una vez bajo la tabla. El 83 viene en pasos de 0,5 L y el 84 oscila con el oleaje: en la semana del censo, sin este mínimo salían 47 km/L fuera de 1–8 (0,00; 0,93; 32,87…). Con el mínimo quedan 4, todos de JLKT54 (ver «Fuera del slice»).

    El caso ΔL ≤ 0 del 84 (criterio 2) no cambia: km/L «—» y nota por fila.
12. Vista limpia en `/app/trayectos`:
    - Dos pestañas: «Con combustible» (default, `combustible=con_dato`: fuente no null) y «Sin dato de combustible» (`sin_dato`). Cada una muestra su total. La paginación es por pestaña.
    - La tabla principal no lleva notas de sensor por fila. Un solo mensaje por causa, con las patentes: qué mide cada camión (nivel en L, litros consumidos, nivel en %).
    - En «Sin dato de combustible», un mensaje para los vehículos `sin_sensor` y otro para los trayectos sin lectura de un vehículo que sí informa combustible en otros trayectos.
    - Nada de esto se decide por patente en el código: la clasificación sale de `io_data`.
13. Given un punto con el 239 en 0 y RPM CAN (85) > 0, When se segmenta, Then cuenta como ignición on. El motor gira, así que el cable de ignición no está leyendo. Sin RPM > 0, el 239 en 0 sigue siendo off.

## Fuera de alcance

Alertas push o en vivo, alertas in-app, score de confianza, app nativa, GPS del teléfono, cruce con cargas Booster, descongelar Fleet, override de Y por empresa, columna nueva de capacidad de estanque. Tampoco precio de combustible ni costo en CLP: el precio fluctúa y el transportista lo calcula con los litros y el km/L. El MVP muestra L, km/L y L/100 km, sin input de precio ni estimación de costo. La authz de `GET /trayectos-teltonika` (dueño|admin transportista) no cambia.

Fuera del slice del 2026-09-22 (declarado, no resuelto en silencio):

- El tope de 20 000 puntos por consulta. Con 8 camiones, una semana trae ~147 000 y la vista queda en el último día. La UI pide «acotá las fechas» y no hay selector.
- Los micro-trayectos. Cualquier punto detenido corta el trayecto, y en la semana del censo 176 de 368 trayectos miden < 0,5 km (colas y maniobras). Unir paradas cortas cambia la segmentación de la que cuelgan el golpe y la hormiga (#706/#707).
- El 84 de JLKT54. Vale exactamente 20 × el 89 (el %), o sea litros derivados de una capacidad de 200 L configurada en el equipo. Oscila con el estanque bajo: 4 de sus 5 avisos de la semana caen con el 89 bajo 14 % y en trayectos de < 1 km, y su km/L va de 0,8 a 10. Ver «Propuesta — anti-ruido del golpe y la hormiga», que corrige estas cifras con la semana completa.
- La capacidad de estanque para convertir el 89 a litros (JWTH77).

## Propuesta — anti-ruido del golpe y la hormiga (2026-09-22)

**Estado: propuesta, pendiente de decisión del PO.** No hay código. El frente no está en `docs/frentes-vivos.md`. Los umbrales configurables de #707 (U golpe 5–20 L, U hormiga 8–30 L) no cambian.

### Evidencia

JLKT54, 15→22-sep (hora de Santiago), consulta read-only con `scripts/db/agent-query.sh`. Se tomaron los 20 984 puntos de la semana, sin el tope de 20 000 de la vista, y se pasaron por `segmentarTrayectosTeltonika` con los defaults (U = 8 L). La tabla `empresas` de prod todavía no tiene las columnas `umbral_robo_*`: la migración 0056 de #707 no corrió en prod.

Resultado: 83 trayectos, 10 con «posible robo combustible» y 0 con hormiga. Los 10 salen de **8 caídas distintas**, porque una misma caída se atribuye al trayecto que solapa y a la parada anterior. Las 8 se revisaron punto a punto con 84, 89, velocidad, 239, RPM (85) y odómetro CAN (87):

| Caída (Stgo) | 84 (L) | 89 (%) | Qué pasa alrededor | Lectura |
|---|---|---|---|---|
| 15-sep 01:43 | 38,4 → 29,6 en 5 min | 19 → 14 | Se detiene tras manejar y queda en ralentí. Baja suave y cada vez más lento, 0,8 L cada 30 s, hasta 14 %. Queda en 14 % hasta el arranque de las 08:05. | No concluyente. Tiene la forma del amortiguado del tablero, pero un sifón lento se vería parecido. |
| 15-sep 08:46 | 29,6 → 10,4 en 11 s | 14 → 5 | Es el arranque: el 89 pasa de 14 a 5 dos segundos después de dar contacto. En 5 min vuelve a 17,6 L (9 %) sin recarga. | Ruido de arranque. |
| 15-sep 10:26 | 54,4 → 41,6 en 8 s | 27 → 21 | Arranque 24 min después de una recarga. En 3 min, andando, sube a 60,8 L. | Ruido de arranque. |
| 15-sep 18:54 | 10,4 → 0,8 en 60 s | 5 → 0 | En ralentí, v = 0, odómetro fijo. Cae a 0 en un ping y en 5 min vuelve a 12,0 L sin recarga. | Ruido: vuelve. |
| 16-sep 07:59 | 11,2 → 1,7 en 60 s | 5 → 0 | Al empezar a moverse. En 3 min vuelve a 8,0 L sin recarga (la recarga es entre las 08:08 y las 08:19). | Ruido: vuelve. |
| 17-sep 10:16 | 26,4 → 10,4 en 69 s | 14 → 5 | Arranque. El 14 % venía de otro arranque (09:41) que subió de 5 % a 14 % sin recarga. | Ruido de arranque. |
| 17-sep 12:01 | 27,2 → 11,2 en 5 min | 13 → 5 | Arranque a las 11:55:52: el 84 salta de 12,0 a 28,0 L en 2 s sin recarga y en 11 min vuelve a 11,2. | Ruido de arranque. |
| 22-sep 15:50 | 199,2 → 184,8 en 5 min | 99 → 92 | Arranque 1 h 20 min después de llenar. Tras apagar vuelve a 192,0 L (96 %) en 5 min, v = 0, odómetro fijo. | Ruido: vuelve. |

Lo que sostiene que es ruido del sensor y no combustible que sale:

- **Es simétrico.** En la misma semana hay 7 subidas de ≥ 8 L en ≤ 5 min con el camión detenido que no son recargas: el nivel sube y vuelve. Recargas reales hubo 3. Un sensor que sube 9 puntos sin que entre combustible también baja 9 sin que salga.
- **Al arrancar, el primer dato no es el nivel.** 5 de las 8 caídas empiezan en los primeros 10 min después de dar contacto. El tablero entrega primero un valor guardado (14 % en tres de ellas) y tarda entre segundos y 11 min en llegar al nivel. La caída es esa convergencia. Dos veces (17-sep 09:41 y 11:55) ese valor guardado fue una subida de 5–6 % a 14 % sin recarga.
- **El rango bajo está recortado.** El 89 marca 0 % durante 251 min con el motor en marcha (el 22-sep maneja de 09:25 a 14:32 en 0 %, y ahí carga de 0 a 96 %). El 0 % no es estanque vacío. Además el 89 se queda pegado en 5 % (173 min) y en 14 % (42 min), mientras que en 8–11 % pasa pocos minutos.
- **84 ≈ 20 × 89, no exacto.** En 20 707 de 20 736 lecturas la diferencia va de −0,8 a +2,0 L, y coincide exacto en 3 811 (18 %). Las otras 29 son instantes en que el 89 ya cambió y el 84 todavía no; 21 de ellas caen justo al dar contacto. El 84 sale del % con una escala de 200 L, así que hereda todo lo anterior.
- **Sin ignición no hay 84.** Con la ignición apagada por más de 2 min, 0 de 134 puntos traen el 84. El golpe solo ve caídas con el contacto dado. Un robo con el motor apagado aparece entre la última lectura antes de apagar y la primera tras arrancar, horas después, fuera de la ventana de 5 min, y esa primera lectura es la del transitorio de arranque.

### Reglas evaluadas

Réplica del golpe (U = 8 L, 5 min, v ≤ 5) con cada filtro. Se probó sobre las 8 caídas y sobre 4 robos sintéticos con lecturas cada 30 s, en ralentí: **T1** sifón de 30 L en 3 min con el estanque a medias, 40 min después de arrancar; **T2** sifón de 15 L con el estanque bajo (15 % → 7 %); **T3** sifón de 30 L que empieza 1 min después de arrancar; **T4** sifón de 30 L tras el que se apaga el motor.

| Filtro | Caídas reales que siguen marcando | T1 | T2 | T3 | T4 |
|---|---|---|---|---|---|
| Actual | 8 | sí | sí | sí | sí |
| Ignorar 89 < 15 % | 3 (incluye el lleno del 22-sep) | sí | **no** | sí | sí |
| Persistencia 10 min | 4 | sí | sí | sí | sí |
| No recuperación 15 min | 5 | sí | sí | sí | sí |
| Asentamiento tras arranque 10 min | 2 | sí | sí | **no** | sí |
| Asentamiento 3 o 5 min + persistencia 10 min | 2 | sí | sí | **no** | sí |
| **Asentamiento 10 min + persistencia 10 min** | **1** (15-sep 01:43) | sí | sí | **no** | sí |

Con asentamiento de 7 min ya queda 1. Se propone 10 por margen. Un sifón que sigue después de esos 10 min se ve igual: se probó uno que empieza a los 11 min y otro de 60 L en 15 min desde el minuto 1, y los dos marcan. Sobre la hormiga, el mismo filtro baja los episodios de ≥ 2 L de la semana de 23 (167 L en total) a 5 (28 L).

Descartadas:

- **Ignorar el 89 bajo X %.** No limpia el lleno del 22-sep, deja sin aviso el robo con estanque bajo (T2) y depende de una capacidad que no conocemos.
- **Solo persistencia o solo no recuperación.** No ve el transitorio de arranque. La lectura que precede a la caída ya es espuria, así que el nivel bajo «persiste».
- **Subir U.** La amplitud del ruido es de 14–19 L con la escala de 200 L, y con la capacidad real crecería al doble. Con U = 20 se apaga el aviso para toda la empresa, porque hoy solo JLKT54 manda 84.

### Criterio propuesto (borrador, entra como criterio 14 si el PO lo aprueba)

14. Given una caída del 84 que cumple el criterio 3 (golpe) o un episodio del criterio 9 (hormiga), When se evalúa, Then solo cuenta si además cumple las dos condiciones:
    - **Asentamiento:** la ventana empieza ≥ 10 min después del último arranque del vehículo. Arranque = la ignición resuelta del criterio 1 (239 = 1 o RPM > 0) pasa de off a on, por timestamp de dispositivo. Las lecturas de los primeros 10 min tras un arranque no abren una ventana.
    - **Persistencia:** la mediana de las lecturas del 84 en los 10 min que siguen al fin de la ventana queda ≤ L_ini − umbral: U para el golpe, 2 L para el episodio. Si en esos 10 min no hay lecturas (el equipo dejó de mandar CAN, por ejemplo porque se apagó el motor), la caída cuenta: no se descarta por falta de dato.

    Las dos son constantes de dominio y no se configuran, igual que Y = 5 min. U golpe y U hormiga (#707) no cambian. El badge, el pin y la atribución a trayectos siguen como en los criterios 3, 8 y 9.

    Costo declarado: un robo que empieza y termina en los primeros 10 min después de arrancar no marca (T3).

Implementación, si se aprueba: función pura en `segmentar-trayectos-teltonika.ts`, TDD con el rojo exhibido. Los fixtures salen de las series reales de la tabla, anonimizadas: el arranque del 17-sep 11:55, el 0 → rampa del 15-sep 18:54 y el lleno del 22-sep 15:50 dejan de marcar, y T1, T2 y T4 siguen marcando.

### Fuera de esta propuesta (declarado)

- **Robo con el motor apagado.** Por lo dicho arriba, el golpe no lo ve. La única huella es la diferencia entre el nivel asentado antes de apagar y el nivel asentado ≥ 10 min después de arrancar, con el odómetro casi fijo. Sería un criterio nuevo y lo decide el PO. En esta semana el caso a revisar con ese criterio es 16→17-sep: 21 % al terminar el trayecto de 262 km y 1 % a los 10 min del arranque siguiente (ese trayecto suma 24 km). Con este sensor no se distingue un retiro de un escalón del rango bajo.
- **La capacidad del estanque de JLKT54.** Entre la recarga al 98 % del 16-sep y el 23 % del 17-sep a las 05:00, el odómetro CAN (87) suma 950 km. A 2,5–3,5 km/L son 270–380 L por 75 puntos del 89, o sea 360–510 L si el % fuera lineal. Es 1,8–2,5 veces los 200 L configurados. Por eso el km/L por trayecto va de 0,8 a 10. Corregir la capacidad arregla los litros y el km/L, no el ruido: con la escala real la amplitud del ruido en litros crece.
