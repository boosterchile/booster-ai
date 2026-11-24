# ADR-094 — La comisión se descuenta dentro del precio que paga el generador, con dos tasas libres

**Estado**: Vigente. Decisión del PO en el chat del 2026-11-24. Implementación parcial (ver «Estado de la implementación»).
**Fecha**: 2026-11-24
**Decider**: Felipe Vicencio (Product Owner).
**Acota a**:
- [ADR-079 Modelo comercial v3](./079-modelo-comercial-v3-comision-al-generador-configurable.md). Dejan de regir la sección 1 (la comisión se suma encima del precio del transportista y la paga el generador) y, de la sección 2, la invariante `comision_spot_pct > comision_programada_pct` y la tasa de retorno programado. Siguen vigentes la modalidad `spot` | `programada`, el contrato programado, la tasa congelada al publicar, la configuración en runtime (sección 3), los servicios en UF (sección 4) y la regla de visibilidad (sección 5).
- [ADR-080 Flujo de dinero](./080-flujo-de-dinero-mandato-de-cobro-y-capital-de-trabajo.md), sección 1, en los montos que se cobran al generador y se liberan al transportista.

No supersede a ninguno.

**Spec**: [`.specs/comision-dentro-del-precio/spec.md`](../../.specs/comision-dentro-del-precio/spec.md).

---

## Contexto

ADR-079 fijó el 2026-09-09 que la comisión la paga el generador encima del precio del transportista, con tres tasas (spot 20 %, programada 10 %, retorno programado 12 %) y la invariante de que spot sea mayor que programada. Ese modelo está en código detrás de `PRICING_V3_ACTIVATED`, que nunca se encendió.

El 2026-11-24 el PO cambió la regla: «el generador paga con IVA, Booster descuenta como comisión dentro del precio al generador, el residual es para el transportista», «más parecido a Uber», con «un porcentaje que yo configuro para dos tipos de carga: programada y spot» y «lo importante es que el porcentaje de comisión lo pueda modificar». Rige solo para el servicio de carga (Match de Carga), no para Booster Fleet.

Esto revierte dos condiciones que el propio PO había fijado en ADR-079: quién soporta la comisión y la relación entre las tasas. Se registra aquí para que no quede como contradicción entre el código y ese ADR.

## Decisión

### 1. Un solo precio, y la comisión va dentro

- El ancla es el **precio del viaje** (`precio_viaje_clp`): el monto neto que paga el generador.
- El generador paga `precio_viaje_clp + IVA`.
- Booster descuenta, dentro de ese monto, `comision_clp + IVA de la comisión`, con `comision_clp = precio_viaje_clp × comision_pct`.
- El resto es del transportista. En neto recibe `precio_viaje_clp − comision_clp`.

| Viaje de 100.000 netos con 5 % | CLP |
|---|---|
| El generador paga, con IVA | 119.000 |
| Booster descuenta: comisión | 5.000 |
| Booster descuenta: IVA de la comisión | 950 |
| El transportista recibe, con IVA | 113.050 |
| Que en neto son | 95.000 |

### 2. Dos tasas, sin invariante entre ellas

- Hay una tasa para carga `spot` y otra para carga `programada`. El PO fija cada una con libertad desde el panel de administración, en cualquier momento: pueden ser iguales, o la programada mayor que la spot.
- La tasa de retorno programado deja de usarse. La clave `retorno_programada_pct` queda opcional en el esquema hasta que una migración la retire.
- La tasa se sigue congelando al publicar (ADR-079 sección 2).

### 3. Qué ve cada uno

- El generador ve el total que paga.
- El transportista ve solo lo que recibe. No ve el precio del viaje ni la comisión (ADR-079 sección 5 se mantiene).

## Estado de la implementación

Hecho en el PR que introduce este ADR:

- `comisionesSchema` ya no valida ninguna relación entre tasas.
- `calcularLiquidacionV4` en `packages/pricing-engine` implementa la sección 1, con sus tests. Todavía no tiene callers.

Pendiente, descrito en la spec: cambiar el ancla en publicación, ofertas, asignación, liquidación, cambios de carga, cobro bajo mandato y las pantallas; decidir el interruptor de activación; retirar la tasa de retorno.

`PRICING_V3_ACTIVATED` no debe encenderse mientras eso esté pendiente: activaría el cálculo de ADR-079, que este ADR deja sin efecto.

## Consecuencias

- El precio que publica el generador pasa a ser lo que él paga, no lo que recibe el transportista. Las cargas publicadas antes del cambio guardan su precio con el significado anterior; la spec fija cómo se tratan.
- El Plan de Flujo de Caja sep-2026 → jun-2027 se construyó con las tasas de ADR-079 (20 % y 10 %) cobradas encima. Con la comisión dentro del precio y tasas a criterio del PO, sus proyecciones de ingreso dejan de corresponder al código.
- El IVA del flete entra al cálculo. ADR-079 solo modelaba el IVA de la factura de comisión, y Booster no emite DTE (ADR-069): quién emite el documento por el flete y cómo se respalda el descuento de Booster queda como pregunta abierta en la spec.
