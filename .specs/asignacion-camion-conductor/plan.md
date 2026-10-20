# Plan

1. Documentar el comportamiento actual (filtro UI, body sin `vehiculo_id`, armado de la pantalla, efectos posteriores) en el PR.
2. Tests rojos de API (`asignar-conductor`) y de web (card + detalle).
3. Servicio: aceptar `vehiculo_id` opcional y no excluir al conductor por `firebase_uid` pendiente. Sin migración: `asignaciones.vehiculo_id` ya existe.
4. UI: dos selectores + Confirmar. Ejecución del viaje solo cuando ya hay conductor, o si el viaje ya salió del estado `asignado`.
5. Verde de los tests del cambio. Evidencia en el PR.
