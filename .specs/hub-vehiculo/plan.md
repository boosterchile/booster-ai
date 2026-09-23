# Plan — Hub del vehículo

## Decisiones

- Sin endpoint nuevo. `GET /trayectos-teltonika` acepta `vehiculo_id` (uuid) y `detalle`. El resumen sale de los trayectos ya segmentados de ese vehículo, no de la página filtrada por combustible.
- `km/L` se copia del trayecto más reciente que ya lo trae. No se divide.
- La URL de flota sin `vehiculo` no cambia. Con `vehiculo` la ventana pasa a 30 días.
- El detalle de un trayecto sigue en `/app/trayectos?detalle=`. Si hace falta, `detalle` se une a la página para que el `find` del cliente lo encuentre.
- Estado Teltonika: sin IMEI; conectado si la última ubicación tiene menos de 30 min; si no, sin señal.
- Configuración en `<details>` al final. Guardar la ficha invalida y se queda en el hub.
- Conductor no dispara el listado (el API ya responde 403). Ver en vivo se mantiene si hay IMEI.

## Fuera

Umbrales de robo, filtro #713, listado de flota, gráficos, sensores nuevos.
