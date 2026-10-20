# Asignación: camión de la flota y conductor pendiente

**Estado**: aceptada · **Fecha**: 2026-10-20 · **Pedido por**: PO (Felipe Vicencio)

Pantalla del transportista `/app/asignaciones/:id` (carga de ejemplo BOO-HC7DJX).

## Entradas

- Lista `GET /conductores` de la empresa, incluido quien todavía no activó (`user.is_pending`).
- Lista `GET /vehiculos` de la flota de la empresa.
- `POST /assignments/:id/asignar-conductor` con el conductor elegido y el camión elegido.

## Salidas

- En el paso de asignación (viaje `asignado` y sin `driver_user_id`) la pantalla muestra solo el selector de camiones, el selector de conductores y el botón Confirmar.
- Un conductor sin activar aparece en el selector con la marca «pendiente de activación» y se puede asignar.
- El camión elegido queda en `asignaciones.vehiculo_id`.
- Ruta eco, recorrido, entrega, incidentes, documentos y chat siguen en esa pantalla después de asignar, y en la pantalla del conductor donde ya estaban. No se borran del producto.

## Criterios de éxito

1. El selector de conductores incluye a los pendientes de activación y el POST los acepta.
2. El POST acepta `vehiculo_id` de un vehículo motriz activo de la misma empresa y lo persiste. Rechaza uno ajeno, retirado o de arrastre.
3. Sin conductor asignado, esas secciones de ejecución no se montan. Con conductor asignado, sí.
4. Tests de API y de web cubren los tres puntos. Datos sintéticos: RUT `11.111.111-1`, correo `@example.com`.
