# Plan — exponer el token público sin destinatario

## Cambio mínimo

1. Proyectar `asignaciones.tracking_token_publico` en `GET /trip-requests-v2/:id` como `public_tracking_token` (`string | null`). Siempre presente en la asignación; el destinatario no entra en la decisión.
2. Helper puro `publicTrackingShareUrl(token, tripStatus, origin)`: URL solo si hay token y el estado es `asignado` o `en_proceso`.
3. Bloque «Enlace de seguimiento» (vos) en el detalle de la carga y en `/app/cargas/:id/track`, con el URL visible y botón copiar.

## Fuera

WhatsApp, backfill SQL, `GET /public/tracking` (ya funciona por token), Fleet, matching, `es_demo`.

## Rollback

Revertir el PR. La columna y el acuñado en el accept no se tocan; quitar el campo del JSON y el bloque de UI vuelve al comportamiento anterior.
