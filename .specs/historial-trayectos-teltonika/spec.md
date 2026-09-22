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
- El 84 de JLKT54. Vale exactamente 20 × el 89 (el %), o sea litros derivados de una capacidad de 200 L configurada en el equipo. Oscila con el estanque bajo: 4 de sus 5 avisos de la semana caen con el 89 bajo 14 % y en trayectos de < 1 km, y su km/L va de 0,8 a 10.
- La capacidad de estanque para convertir el 89 a litros (JWTH77).
