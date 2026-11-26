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
- Dentro de ese monto, a Booster le corresponde `comision_clp + IVA de la comisión`, con `comision_clp = precio_viaje_clp × comision_pct`.
- El resto es del transportista. En neto recibe `precio_viaje_clp − comision_clp`.

| Viaje de 100.000 netos con 5 % | CLP |
|---|---|
| El generador paga, con IVA | 119.000 |
| De eso, comisión de Booster | 5.000 |
| De eso, IVA de la comisión | 950 |
| El transportista recibe, con IVA | 113.050 |
| Que en neto son | 95.000 |

### 2. Dos tasas, sin invariante entre ellas

- Hay una tasa para carga `spot` y otra para carga `programada`. El PO fija cada una con libertad desde el panel de administración, en cualquier momento: pueden ser iguales, o la programada mayor que la spot.
- La tasa de retorno programado deja de usarse. La clave `retorno_programada_pct` queda opcional en el esquema hasta que una migración la retire.
- La tasa se sigue congelando al publicar (ADR-079 sección 2).

### 3. Dos facturas al generador

Decisión del PO del 2026-11-24: «Booster solo factura al generador».

- El transportista factura al generador su parte: `precio_viaje_clp − comision_clp`, más IVA.
- Booster factura al generador su comisión, más IVA. Booster no factura al transportista.
- Las dos facturas suman exactamente lo que paga el generador. Ese es el desglose que él recibe.

| Viaje de 100.000 netos con 5 % | Neto | Con IVA |
|---|---|---|
| Factura del transportista al generador | 95.000 | 113.050 |
| Factura de Booster al generador | 5.000 | 5.950 |
| Total que paga el generador | 100.000 | 119.000 |

### 4. Qué ve cada uno

- El generador ve el total que paga y su desglose en las dos facturas.
- El transportista ve solo lo que recibe. No ve el precio del viaje ni la comisión: **ADR-079 sección 5 se mantiene íntegra**.
- El conductor no ve montos.

### 5. Booster Spot: carga inmediata y carga programada

Decisiones del PO del 2026-11-24.

- El servicio de carga se llama **Booster Spot** y reemplaza al nombre «Match de Carga». Recoge el origen del proyecto: conseguir carga para el retorno, para que no haya trayectos vacíos.
- La modalidad la decide el plazo, no un contrato previo: la carga es **inmediata** si el retiro empieza dentro del umbral contado desde la publicación, y **programada** si empieza después. El umbral parte en 24 horas y el PO lo cambia desde el panel de administración.
- **Deja de regir** la habilitación de «contrato programado» por generador de ADR-079 sección 2. Cualquier generador obtiene la tasa programada publicando con la anticipación del umbral.
- La tasa de la carga inmediata es la que hoy se llama `spot_pct`; la de la programada, `programada_pct`. Que la inmediata sea mayor queda a criterio del PO al configurarlas: el sistema no lo valida (sección 2).
- Un viaje de retorno paga la misma comisión que cualquier otro. Lo que puede ser menor es la tarifa del viaje.

### 6. Una carta de porte por viaje

- Cada viaje de Booster Spot tiene una carta de porte: el documento de una página, generado con los datos del viaje, que acredita el contrato de transporte entre generador y transportista. Las reglas que no cambian de un viaje a otro van en unas condiciones generales de transporte que cada empresa acepta una vez (decisión del PO, 2026-11-25). El generador lo ofrece al publicar y se perfecciona cuando el transportista acepta la oferta en la plataforma.
- La carta de porte fija como precio del transporte lo que recibe el transportista. El servicio de Booster va en un anexo que se entrega solo al generador, para mantener la sección 4.
- El PO informó el 2026-11-25 que el abogado y el contador aprobaron la carta de porte, las condiciones generales y el análisis de la Resolución Exenta SII N.º 144 de 2026. El texto no se ofrece para aceptación mientras tenga valores por definir (plazos, cargos, seguro, ciudad).
- **Cumplimiento del SII como función del producto.** La Resolución Exenta SII N.º 144 de 2026 (que deja sin efecto la N.º 154 de 2025) exige en la guía de despacho o factura los datos del transporte. Booster entrega esos datos al generador al asignarse el camión, compara la guía subida con el viaje y avisa cuando un cambio de vehículo o conductor la deja desactualizada. Las pantallas citan la resolución.

## Estado de la implementación

Hecho en el PR que introduce este ADR:

- `comisionesSchema` ya no valida ninguna relación entre tasas.
- `calcularLiquidacionV4` en `packages/pricing-engine` implementa la sección 1, con sus tests. Todavía no tiene callers.

Pendiente, descrito en la spec: la modalidad por plazo con su umbral, el contrato por viaje, el cambio de nombre en la aplicación, cambiar el ancla en publicación, ofertas, asignación, liquidación, cambios de carga, cobro bajo mandato y las pantallas; decidir el interruptor de activación; retirar la tasa de retorno.

`PRICING_V3_ACTIVATED` no debe encenderse mientras eso esté pendiente: activaría el cálculo de ADR-079, que este ADR deja sin efecto.

## Consecuencias

- El precio que publica el generador pasa a ser lo que él paga, no lo que recibe el transportista. Las cargas publicadas antes del cambio quedan fuera (decisión del PO, 2026-11-25): se liquidan con la regla y la tasa con que se publicaron.
- El Plan de Flujo de Caja sep-2026 → jun-2027 se construyó con las tasas de ADR-079 (20 % y 10 %) cobradas encima. Con la comisión dentro del precio y tasas a criterio del PO, sus proyecciones de ingreso dejan de corresponder al código.
- El IVA del flete entra al desglose que ve el generador; ADR-079 solo modelaba el IVA de la factura de comisión.
- Booster no emite DTE (ADR-069) y eso no cambia: la factura de comisión se emite fuera de la plataforma (decisión del PO, 2026-11-24). La plataforma muestra al generador el desglose de las dos facturas, y la factura emitida debe coincidir con él.
- El tratamiento del IVA de las dos facturas está validado por contabilidad, según informó el PO el 2026-11-24.
- Las tasas no se siembran de nuevo: rigen las que el PO publique a mano desde el panel de administración. La versión publicada hoy (20 % y 10 %) sigue vigente hasta que él la cambie.
- La guardia `visibilidad-transportista` y `CLAVES_PRIVADAS_GENERADOR` siguen como están.
