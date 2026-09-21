# Token público de seguimiento ausente con destinatario vacío

**Estado**: aceptada · **Fecha**: 2026-09-21 · **Pedido por**: QA prod (BOO-PMGQWN, BOO-83ND2C — Prueba Generador → Van Oosterwyk)

## 1. El problema (medido)

En viajes `en_proceso` el generador abre `/app/cargas/:id/track`, pero el payload de `GET /trip-requests-v2/:id` no trae `tracking_token_publico` y la UI no muestra un enlace para compartir. Sin destinatario (`destinatario_nombre` / `destinatario_whatsapp_e164` nulos) el WhatsApp de `notifyTrackingLinkAtAssignment` no tiene a quién escribir (o cae al generador, que en estas cuentas tampoco tiene WhatsApp). El token, si existe, queda solo en `asignaciones` y `GET /public/tracking/:token` no se puede ejercer.

Causa verificada en código (no es una compuerta por destinatario al acuñar):

- `acceptOffer` inserta `publicTrackingToken` (UUID v4) en toda asignación nueva. No lee campos de destinatario.
- El único canal que lo entregaba era el WhatsApp post-accept, que sí prefiere el teléfono del destinatario y, si falta, el del generador.
- `GET /trip-requests-v2/:id` no proyecta la columna. La pantalla de seguimiento tampoco arma `/tracking/:token`.

Regla de producto: un destinatario vacío no omite el token si el viaje admite seguimiento en vivo (`asignado` | `en_proceso`). No se acuña token antes de la asignación (no hay viaje que seguir). Asignaciones anteriores a la columna siguen en `null` (sin backfill).

## 2. Entradas y salidas

- `GET /trip-requests-v2/:id` (generador dueño): `assignment.public_tracking_token` es el UUID o `null`. No depende del destinatario. El listado no lo incluye.
- UI (`/app/cargas/:id` y `/app/cargas/:id/track`): con token y estado `asignado` o `en_proceso`, enlace absoluto `/tracking/<token>` copiable. Fuera de esos estados, o sin token, no se muestra.
- `GET /public/tracking/:token` no cambia: ya resuelve por token y devuelve posición en `en_proceso`.

## 3. Criterios de salida

- [x] Aceptar una oferta sigue insertando UUID v4 aunque el viaje no tenga destinatario.
- [x] El detalle devuelve ese token en la proyección de la asignación.
- [x] La UI muestra el enlace en `en_proceso` sin destinatario y lo oculta si no hay token o el viaje no está en seguimiento vivo.
- [x] Tests de api y web en verde; typecheck y lint de los paquetes tocados limpios.
