# Revisión

- El filtro que escondía al pendiente estaba solo en la UI (`!user.is_pending`). El POST ya aceptaba ese `users.id`. Este cambio lo deja explícito (`driver_pending`) y no agrega un filtro por `firebase_uid`.
- `vehiculo_id` es opcional en el body para no romper clientes que solo mandan `driver_user_id`. La pantalla siempre lo manda.
- Camión aceptado: misma empresa, `estado_vehiculo = activo`, `categoria_unidad = motriz`, y distinto de `unidad_arrastre_id` (el CHECK de la tabla).
- La ejecución del viaje no se borra: se monta cuando ya hay `driver_user_id`, o si el viaje ya no está en `asignado`. La pantalla del conductor no se tocó.
