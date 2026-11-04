# Reactivar un conductor retirado de la misma empresa

**Estado**: aceptada · **Fecha**: 2026-10-20 · **Pedido por**: PO (urgente)

## 1. El problema

`DELETE /conductores/:id` hace soft delete (`eliminado_en` / `deletedAt`).
`conductores.usuario_id` es UNIQUE en toda la tabla (`0021_conductores.sql`),
también con la fila retirada. Un alta posterior con el mismo RUT en la misma
empresa pasa el chequeo de «conductor activo» (solo mira `deletedAt` nulo) e
intenta un INSERT. Postgres responde `23505` y la API devuelve 409 `duplicate`.
No hay camino para reactivar esa fila.

## 2. Entradas y salidas

`POST /conductores`, dentro de la transacción de alta, al encontrar el user por RUT:

- Conductor activo (`deletedAt` nulo) → 409 `user_already_driver`.
- Conductor retirado de **otra** empresa → 409 `conductor_retirado_otra_empresa`,
  con un mensaje en tú. No escribe.
- Conductor retirado de **esta** empresa:
  - Antes de tocar al usuario, `emailIdentidadCompartida`. Si da true → 409
    `identidad_vinculada`. No escribe.
  - Si no: UPDATE de la fila (licencia, `is_extranjero`, `driverStatus`
    `activo`, `deletedAt` null, `updatedAt`). No hay INSERT.
  - Email de relleno: la misma rama que ya lo reemplaza.
  - Teléfono: `users.phone` queda en `body.phone` aunque ya hubiera uno.
  - Cuenta no activa (`cuentaYaActivada` false): PIN nuevo siempre. El envío
    que ya existe manda WhatsApp y correo.
  - 200 con `reactivado: true` y el PIN, igual que el alta cuando hay PIN.

La web traduce `duplicate`, `conductor_retirado_otra_empresa` e
`identidad_vinculada` a español y muestra el PIN si la respuesta trae
`activation_pin` (alta o reactivación).

Sin migración. Sin cambio de schema.

## 3. Criterios de salida

- Misma empresa, cuenta pendiente con PIN previo: 200, `reactivado: true`, PIN
  nuevo (el hash anterior no se conserva) y WhatsApp al teléfono del body.
- Identidad compartida: 409 `identidad_vinculada` y cero escrituras.
- Retirado de otra empresa: 409 `conductor_retirado_otra_empresa` y cero escrituras.
- Conductor activo: 409 `user_already_driver`.
- La pantalla de alta no muestra el código `duplicate` crudo y, tras reactivar,
  muestra el PIN como en un alta normal.
