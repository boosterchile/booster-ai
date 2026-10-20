# Solo el conductor asignado confirma la entrega y reporta incidentes

**Estado**: aceptada · **Fecha**: 2026-10-20 · **Pedido por**: PO (Felipe Vicencio)

## 1. El problema

`PATCH /assignments/:id/confirmar-entrega` y `POST /assignments/:id/incidents`
aceptan a cualquier miembro de la empresa transportista. Confirmar la entrega
y reportar un incidente son actos del conductor que está en el viaje.

## 2. Entradas y salidas

- Sigue vigente la autorización de empresa: membership transportista activa y
  `assignment.empresa_id === activeMembership.empresa.id`. Otra empresa sigue
  en `403 forbidden_owner_mismatch` (entrega) o el mismo código que ya devuelve
  el servicio (incidente).
- Además, `assignment.driver_user_id` debe ser igual a `users.id` del usuario
  autenticado.
- Si `driver_user_id` es `null`, o es otro usuario, la respuesta es
  `403 { error: 'not_assigned_driver', code: 'not_assigned_driver' }`.
- Un dueño o admin que se asignó el viaje a sí mismo sí puede: es el conductor
  asignado. El rol no abre ni cierra el permiso.
- `PATCH /trip-requests-v2/:id/confirmar-recepcion` (generador) no cambia.
- `PATCH /assignments/:id/confirmar-recogida` no cambia: la oficina sigue
  pudiendo confirmar la recogida.

## 3. Criterios de salida

- El conductor asignado confirma la entrega (200) y reporta un incidente (201).
- Un admin o dueño que no es el conductor recibe 403 `not_assigned_driver` en
  ambos endpoints, y el servicio no se ejecuta.
- `driver_user_id` null recibe el mismo 403.
- Tests con datos sintéticos: RUT `11.111.111-1`, correos `@example.com`,
  patente `TEST01`.
