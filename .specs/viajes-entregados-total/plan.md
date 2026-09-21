# Plan — `viajes_entregados_total`

1. Emitir el counter en `confirmarEntregaViaje`, después del commit y solo si `ok && !alreadyDelivered`, antes de los side-effects post-entrega.
2. Labels: `confirmed_via` = `source` del servicio; `estado_previo` = `viajes.estado` leído bajo el `FOR UPDATE`, antes del UPDATE.
3. Test unitario del servicio (mock de `getBusinessCounter`) con los tres criterios de la spec.
4. Sin rutas nuevas, sin cambio de JSON, sin Terraform, sin dashboard.
