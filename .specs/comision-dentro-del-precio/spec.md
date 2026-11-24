# Spec — Comisión dentro del precio del generador (ADR-094)

**Estado**: en curso. Frente 1 hecho; frentes 2 a 6 sin empezar.
**ADR**: [ADR-094](../../docs/adr/094-comision-dentro-del-precio-del-generador.md)

## Entradas

- Precio del viaje neto, en CLP entero (lo fija el generador al publicar).
- Modalidad de la carga: `spot` o `programada`.
- Configuración comercial publicada: `comisiones.spot_pct`, `comisiones.programada_pct`, `impuestos.iva_pct`.

## Salidas

- Para el generador: total a pagar con IVA.
- Para el transportista: lo que recibe, neto y con IVA. Nunca el precio del viaje ni la comisión.
- Para Booster: comisión e IVA de la comisión, por viaje.

## Criterios de éxito

1. Con precio 100.000 y tasa 5 %: generador 119.000, comisión 5.000, IVA de la comisión 950, transportista 113.050 (95.000 netos).
2. Para todo precio y tasa: `total generador = total transportista + descuento Booster`, en pesos enteros.
3. El platform-admin publica cualquier par de tasas entre 0 y 100, incluidas tasas iguales y programada mayor que spot.
4. Un cambio de tasa no altera cargas ya publicadas.
5. Ninguna respuesta de API, notificación ni pantalla del transportista o del conductor incluye el precio del viaje o la comisión.
6. Con el interruptor apagado, el comportamiento en producción no cambia.

## Frentes

### 1. Regla y cálculo — hecho

- `packages/shared-schemas/src/configuracion-comercial.ts`: sin invariante entre tasas.
- `packages/pricing-engine/src/liquidacion-v4.ts`: `calcularLiquidacionV4`.
- Evidencia: tests de `pricing-engine`, `shared-schemas`, ruta admin de la API y pantalla admin de la web.

### 2. Ancla en publicación y cotización

- `GET /cotizacion` recibe `precio_viaje_clp` en vez de `precio_transportista_clp` y responde el desglose v4.
- `trips.proposedPriceClp` pasa a significar precio del viaje. Decidir qué se hace con las cargas ya publicadas (hoy guardan el precio del transportista).
- Archivos: `apps/api/src/routes/trip-requests-v2.ts`, `apps/api/src/services/cotizacion-comercial.ts`, `apps/web/src/components/comercial/SeccionComercial.tsx`, `apps/web/src/routes/cargas.tsx`.

### 3. Ofertas y asignación

- La oferta al transportista lleva lo que él recibe: `precio viaje − comisión`, con la tasa congelada de la carga.
- `assignments.agreedPriceClp` queda como lo que recibe el transportista.
- Archivos: `apps/api/src/services/matching.ts`, `reclamar-viaje.ts`, `offer-actions.ts`, `notify-offer.ts`.

### 4. Liquidación y cambios de carga

- `liquidarTripV3` pasa a calcular desde el precio del viaje con `calcularLiquidacionV4` y persiste la metodología `pricing-v4.0-cl-2026.11`.
- Revisar el significado de las columnas `precio_generador_clp`, `total_factura_generador_clp`, `monto_neto_carrier_clp` y `total_factura_booster_clp`.
- Archivos: `apps/api/src/services/liquidar-trip.ts`, `cambio-carga-comercial.ts`, `apps/api/src/db/schema.ts` y la migración que corresponda.

### 5. Cobro bajo mandato

- `montosEsperados` hoy cobra al generador `precio transportista + comisión + IVA de la comisión` y libera el precio del transportista. Con ADR-094 cobra el precio del viaje con IVA y libera ese total menos el descuento de Booster.
- Archivos: `packages/factoring-engine/src/mandato-cobro.ts`, `apps/api/src/services/mandato-cobro/eventos-pago.ts`.

### 6. Panel de administración y activación

- La vista previa de la pantalla de configuración comercial usa `calcularLiquidacionV4` y deja de mostrar el retorno programado.
- Definir el interruptor: reutilizar `PRICING_V3_ACTIVATED` con el cálculo nuevo o crear uno propio. La activación en producción la decide el PO.
- Retirar `retorno_programada_pct` del esquema, de `resolverComisionPct` y de la versión publicada.

## Preguntas abiertas para el PO

1. **IVA del flete.** Booster no emite DTE (ADR-069). ¿El documento por el flete lo emite el transportista por el precio del viaje completo, y Booster le factura aparte su comisión más IVA? Es la lectura que deja cuadrado el ejemplo de 119.000 / 5.950 / 113.050.
2. **Cargas ya publicadas.** ¿Se liquidan con la regla con que se publicaron, o se convierten?
3. **Tasas iniciales.** La versión publicada hoy tiene 20 % y 10 %. ¿Con qué valores parte la regla nueva?
4. **Plan de caja.** Las proyecciones del plan sep-2026 → jun-2027 usan las tasas y la base de ADR-079.
