# Spec — Hub del vehículo (`/app/vehiculos/:id`)

## Problema

El detalle del vehículo es un CRUD: patente decorativa, formulario vacío como protagonista y botones sueltos de Recorrido / Ver en vivo. El dueño o admin de un transportista necesita ver, por patente, el último trayecto, el consumo y las alertas.

## Audiencia

Dueño o admin de una empresa transportista. Conductor, despachador y el resto conservan el acceso de hoy: el historial Teltonika sigue en 403; la ficha del vehículo no se cierra.

## Entradas

- `GET /vehiculos/:id` (ficha actual).
- `GET /vehiculos/:id/ubicacion` (frescura y última posición; 404 = sin reporte).
- `GET /trayectos-teltonika` con `vehiculo_id`, ventana de 30 días y, si hace falta, `detalle` para incluir ese trayecto en la página.
- `GET /vehiculos/:id/traza` solo para la preview del último trayecto (desde/hasta de ese trayecto).

No hay endpoint nuevo. El resumen (`ultimo_trayecto`, `km_por_litro`, `alertas_total`, `recientes`) se calcula en el listado existente cuando llega `vehiculo_id`, sobre los trayectos ya segmentados. No se recalcula km/L ni se tocan umbrales de robo ni el filtro de falsos positivos.

## Salidas

Arriba: patente en texto (no la placa decorativa), marca y modelo si existen, tipo, estado Teltonika (`conectado` si el último punto tiene menos de 30 min, `sin señal` si hay IMEI sin punto fresco, `sin IMEI` si no hay IMEI). Acciones compactas: Ver en vivo (mismo destino `/app/vehiculos/:id/live`) y Ver trayectos (`/app/trayectos?vehiculo=<id>`). Tres tarjetas (último trayecto, consumo, alertas), preview de mapa, lista de hasta 10 trayectos. Configuración (IMEI, capacidades, tipo, formulario actual y documentos) queda colapsada al final. Guardar la ficha no navega al listado.

## Criterios de éxito

Los AC 1–10 del brief del hub. Vacío con CTA, nunca una tarjeta en blanco. km/L solo si el segmentador ya lo calculó.

## Fuera de alcance

Edición masiva de flota, comparación, costo CLP/L, push, IA, rediseño del listado, sensores nuevos, wizard Teltonika, gráficos de 30 días.
