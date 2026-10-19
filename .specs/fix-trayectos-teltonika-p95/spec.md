# fix(trayectos): p95 de /trayectos-teltonika y carga del mapa en el hub

**Estado**: aceptada · **Fecha**: 2026-10-19 · **Package**: `apps/api`, `apps/web`

## Problema

`GET /trayectos-teltonika` responde 200 en 33–42 s (TTFB ~37 s) con `page_size=10` en `/app/vehiculos/$id` y `page_size=20` en `/app/trayectos`. Se vio con KZXB64 (`6cbf07f8-464e-40a1-8710-d25b6ddcb06c`, Van Oosterwyk), 7 trayectos con combustible. `GET /vehiculos/{id}/ubicacion` a veces tarda lo mismo.

El hub y el detalle piden 30 días. La API lee hasta 20 000 pings de `telemetria_puntos` (índice `idx_telemetria_vehiculo_ts` ya existe) y segmenta todo antes de paginar. Golpe y hormiga recorren el historial completo por cada par de lecturas dentro de 5 min. Con AVL 89 y capacidad, ese bucle es cuadrático y corre síncrono en el hilo de la API (1 vCPU): la ubicación encolada en la misma instancia espera el mismo tiempo.

Mientras `/ubicacion` está pendiente, la tarjeta del mapa dice «Sin posición GPS todavía».

## Entradas

- El mismo `GET /trayectos-teltonika` (ventana, `page`, `page_size`, `combustible`, `vehiculo_id`, `detalle`).
- El mismo `GET /vehiculos/:id/ubicacion`.
- Pings ya ingeridos. No se reescribe telemetría.

## Salidas

- Mismos trayectos: litros, km/L, notas, alertas de golpe y hormiga, y pin (`event_lat` / `event_lon`).
- Misma paginación y los mismos totales. `page_size` sigue aplicándose después de segmentar la ventana: el tope de 20 000 pings no cambia.
- p95 de esas páginas bajo 2 s en el cómputo de segmentación (el presupuesto del request).
- Con IMEI, mientras `/ubicacion` no ha resuelto, el mapa dice «Cargando posición…». «Sin posición GPS todavía» queda para la respuesta vacía (404 / sin coordenada).

## Criterio de éxito

1. Test de 20 000 pings (cadencia 30 s, AVL 89, 7 viajes) falla en rojo por tardar más de 2 s contra el código previo, y pasa después sin cambiar litros, alertas ni pin.
2. La suite de `segmentar-trayectos-teltonika` sigue verde (regresión de litros, km/L, golpe, hormiga y pin).
3. Test del hub: ubicación pendiente → «Cargando posición…» y no «Sin posición GPS todavía»; 404 → el texto de sin GPS.

## Fuera de alcance

- Migración de índices (el índice por vehículo y timestamp ya cubre la lectura; el tiempo está en CPU).
- Cambiar la ventana de 30 días, el tope de 20 000 pings o el contrato JSON.
- Prod, Terraform, workflows de CI.
