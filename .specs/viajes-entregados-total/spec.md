# Spec — métrica norte `viajes_entregados_total`

**Estado**: aceptada para este frente de observabilidad
**Fecha**: 2026-09-21

## Problema

El criterio de término del Slot 3 (un viaje cerrado por el flujo de producto, sin un parche manual) no tiene contador. Hoy se puede contar recogidas (`recogidas_confirmadas_total`) y no entregas. No hay dashboard en este frente: solo la definición y la emisión.

## Métrica

Un solo counter OTel, meter `booster-ai-api/business` (helper `getBusinessCounter`):

| Nombre | Tipo | Cuándo suma 1 |
|---|---|---|
| `viajes_entregados_total` | Counter | `confirmarEntregaViaje` commitea la **primera** transición a `entregado` |

Ese servicio es el único write-path de producto: lo usan `PATCH /trip-requests-v2/:id/confirmar-recepcion` (shipper) y `PATCH /assignments/:id/confirmar-entrega` (carrier). Primer click gana.

**No suma** cuando:

- el viaje ya estaba `entregado` (idempotente, `alreadyDelivered=true`);
- el cierre se rechaza (`invalid_status`, `documento_requerido`, ownership, sin assignment, CAS perdido);
- alguien cambia `viajes.estado` por SQL, job de backfill o consola.

Eso es la definición operativa de «sin intervención»: el contador solo ve el cierre que hace el producto.

## Labels

Cardinalidad baja. Sin `trip_id`, empresa ni usuario.

| Label | Valores | Para qué |
|---|---|---|
| `confirmed_via` | `shipper` \| `carrier` | Quién cerró. Mismo valor que `payload.confirmed_via` del evento `entrega_confirmada`. |
| `estado_previo` | `asignado` \| `en_proceso` | `en_proceso` = pasó por recogida confirmada. `asignado` = la entrega sigue siendo legal sin recogida previa (spec confirmar-recogida §3.2). |

Consultas:

- total cerrado por el producto: `sum(viajes_entregados_total)`
- cerrados que pasaron por recogida: `sum(viajes_entregados_total{estado_previo="en_proceso"})`
- POD del transportista: `sum(viajes_entregados_total{confirmed_via="carrier"})`

El certificado, la cobertura GPS y la liquidación **no** condicionan el +1. Esos side-effects son fire-and-forget posteriores; un fallo suyo no borra la entrega.

## Criterios de éxito

1. Una entrega nueva del shipper desde `asignado` emite exactamente `+1` con `{confirmed_via: shipper, estado_previo: asignado}`.
2. Una entrega nueva del carrier desde `en_proceso` emite exactamente `+1` con `{confirmed_via: carrier, estado_previo: en_proceso}`.
3. La repetición idempotente y un rechazo no llaman a `add`.
4. La respuesta HTTP no cambia.

## Fuera de alcance

Dashboards, alertas, deploy, validación de huella en UI, GPS nativo, matching y notificaciones.
