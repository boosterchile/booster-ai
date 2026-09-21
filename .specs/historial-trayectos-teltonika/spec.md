# Spec — Historial de trayectos Teltonika (combustible + badge anti-robo)

**Slug:** `historial-trayectos-teltonika`
**Brief:** bloqueado 2026-09-21. Dueño|admin de una empresa transportista audita consumo y posible robo de combustible sobre la flota Teltonika. No se ata a cargas de Booster ni a la app nativa.

**Frentes vivos:** el documento `docs/frentes-vivos.md` (2026-09-13) no lista este frente. El brief de producto del 2026-09-21 lo encarga de forma explícita, con criterios de aceptación cerrados. Esta spec no reabre un cimiento ni edita ADRs.

## Entradas

- Membresía activa `dueno`|`admin` de una empresa con `es_transportista = true`. El `empresa_id` sale de la membresía, nunca del cliente.
- `GET /trayectos-teltonika?desde&hasta&page&page_size`
  - `desde` / `hasta`: ISO-8601 opcionales. Default: últimos 7 días. `hasta > desde`. Ventana máxima 31 días.
  - `page` ≥ 1 (default 1). `page_size` 1..50 (default 20).
- Fuente: `telemetria_puntos` de los vehículos de esa empresa con `teltonika_imei` propio (no el IMEI espejo de demo). Columnas `timestamp_device`, `latitud`, `longitud`, `velocidad_kmh` e `io_data`.

## Auditoría AVL (no se hardcodea a ciegas)

Censo `.specs/telemetria-fmc150/delta.md` (260k filas, 2026-05-03→2026-07-13) y catálogo vigente:

| Señal | ID | ¿En `io_data` del censo? | Uso en este frente |
|---|---|---|---|
| Ignición | **239** | Sí | Primaria para abrir/cerrar el trayecto. |
| Movimiento | **240** | Sí | Primaria, junto con `velocidad_kmh` (> 5 km/h). |
| Trip (escenario) | **250** | Sí | Solo de apoyo: acerca el borde ≤ 2 min si ya hay un trayecto por ignición+movimiento. No crea un trayecto solo. |
| DIN1 | **1** | **No** (ausente del set de claves) | Reserva: solo si el punto no trae 239 y el valor es 0 o 1. No es la fuente por defecto. |
| Fuel level L | **84** | No en ese censo; sí en PLFL57 (`.specs/can-live-view/`) | Única fuente de litros (raw ×0.1, catálogo `can-lvcan`). |
| Fuel level % | **89** | Igual que 84 | No se convierte a litros (no hay capacidad de estanque en el esquema). Si llega sin un 84 válido → degradación, no CTA de “sin sensor”. |
| Fuel consumed | **83** | Igual | Contador acumulado. No se usa como nivel. Si llega sin 84 válido → degradación. |
| Velocidad CAN / GPS IO | **81** / **24** | 81 no en el censo; 24 sí | Respaldo de velocidad solo si `velocidad_kmh` es null. |

No hay columna de capacidad de estanque. `U = 15 L` salvo que el llamador pase litros de estanque (la fórmula `max(15, 3 %)` queda testeada; el servicio de hoy pasa `null`).

## Salidas

`200`:

```
{
  empresa_id, desde, hasta,
  vehiculos_teltonika, truncado,
  cta: null | "vincular_teltonika",
  cta_sensor: boolean,
  page, page_size, total,
  trayectos: [{
    id, vehiculo_id, empresa_id, patente,
    inicio, fin, distancia_km,
    litros_iniciales, litros_finales, km_por_litro,
    nota_combustible, posible_robo_combustible,
    sensor_combustible: "ausente" | "presente" | "degradado",
    cta_sensor
  }]
}
```

Orden: fin descendente (más reciente primero), luego inicio descendente.

Segmentación, por vehículo, puntos en orden temporal:

1. Ignición = 239 si el punto lo trae (0|1); si no, DIN1 (1) si es 0|1. Se arrastra el último valor conocido. Sin ignición conocida el punto no abre trayecto.
2. En movimiento = 240 = 1, o velocidad conocida > 5 km/h.
3. Trayecto = racha con ignición on y en movimiento. Un hueco > 15 min entre puntos activos corta el trayecto. Hacen falta ≥ 2 puntos.
4. 250 = 1/0 solo estira el borde si cae a ≤ 2 min del inicio/fin ya detectado.
5. Distancia = Σ haversine entre coordenadas válidas (se salta 0,0 y null; no se inventa tramo).
6. L ini / L fin = primera y última lectura válida de 84 dentro del trayecto. `km/L = distancia_km / max(L_ini − L_fin, ε)` solo si `L_ini − L_fin > 0`. Si no, `km_por_litro = null` y nota en vos.
7. Badge según el criterio 3 (texto cerrado abajo). El reloj es `timestamp_device`. `timestamp_recibido_en` no entra en la ventana ni en el orden.
8. Sensor del vehículo en la ventana: algún 84 válido → `presente`. Algún 83/84/89 sin 84 válido → `degradado` (sin litros, sin badge, nota explícita). Ninguno → `ausente` (trayectos y km sí; sin km/L ni badge; CTA de conectar sensor).

## Criterios de éxito

1. Dueño|admin transportista ve la lista en `/app/trayectos`: inicio, fin, distancia, vehículo; scope `empresa_id`; reciente primero; paginada.
2. Con 84 válido al inicio y al final y ΔL > 0: L ini, L fin y km/L según la fórmula. Si ΔL ≤ 0: km/L «—» y nota.
3. Given Teltonika points ordered by **device timestamp** (not receive/GPRS time), When within window Y=5 min (device ts) fuel drops ΔL ≤ −U with v≤5 km/h — **ignition on OR off both valid** — Then badge «posible robo combustible» on that trip in historial.

   U = max(15 L, 3% tank capacity) if capacity known, else 15 L.

   Mandatory: offline-tolerant — if device buffered without cellular and later uploads via GPRS, ΔL is detected on ingest using device ts (must not miss due to server delay).

   Still out of MVP: live/push alerts. Still in: v≈0 so we don't badge consumption while moving.

   Cumplimiento en código: `listar-trayectos-teltonika.ts` lee y ordena `telemetria_puntos.timestamp_device` (no `timestamp_recibido_en`) y pasa ese instante como `tMs`. `segmentar-trayectos-teltonika.ts` reordena por `tMs`, exige ΔL ≤ −U en ≤ 5 min y velocidad conocida ≤ 5 km/h en todo el intervalo, y no mira la ignición. El badge se calcula al leer el historial sobre los puntos ya ingeridos; un upload GPRS tardío no se pierde por la demora del servidor. No hay push.
4. Teltonika sin sensor (sin 83/84/89): trayectos y km; sin km/L ni badge; CTA «conectar sensor combustible».
5. Empresa sin vehículos Teltonika: lista vacía + CTA de vincular. HTTP 200, no error.
6. Conductor, despachador, visualizador, generador puro: 403 y el ítem no está en el nav.
7. IO de combustible ausente o inválido: no se inventan litros ni badge; la UI lo dice.

## Fuera de alcance

Alertas push o en vivo, app nativa, GPS del teléfono, cruce con cargas Booster, descongelar Fleet, overrides de U/Y por empresa, columna nueva de capacidad de estanque.
