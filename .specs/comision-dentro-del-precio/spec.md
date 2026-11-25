# Spec — Comisión dentro del precio del generador (ADR-094)

**Estado**: en curso. Frente 1 hecho; frentes 2 a 6 sin empezar.
**ADR**: [ADR-094](../../docs/adr/094-comision-dentro-del-precio-del-generador.md)

## Entradas

- Precio del viaje neto, en CLP entero (lo fija el generador al publicar).
- Modalidad de la carga: `spot` o `programada`.
- Configuración comercial publicada: `comisiones.spot_pct`, `comisiones.programada_pct`, `impuestos.iva_pct`.

## Salidas

- Para el generador: total a pagar con IVA y su desglose en dos facturas, la del transportista y la de Booster.
- Para el transportista: lo que recibe, neto y con IVA. Nunca el precio del viaje ni la comisión.
- Para el conductor: ningún monto.
- Para Booster: comisión e IVA de la comisión, por viaje.

## Criterios de éxito

1. Con precio 100.000 y tasa 5 %: generador 119.000, comisión 5.000, IVA de la comisión 950, transportista 113.050 (95.000 netos).
2. Para todo precio y tasa: `total generador = factura del transportista + factura de Booster`, en pesos enteros.
3. El platform-admin publica cualquier par de tasas entre 0 y 100, incluidas tasas iguales y programada mayor que spot.
4. Un cambio de tasa no altera cargas ya publicadas.
5. El generador ve dos facturas que suman exactamente lo que paga. Ninguna respuesta de API, notificación ni pantalla del transportista o del conductor incluye el precio del viaje o la comisión.
6. Con el interruptor apagado, el comportamiento en producción no cambia.

## Frentes

### 1. Regla y cálculo — hecho

- `packages/shared-schemas/src/configuracion-comercial.ts`: sin invariante entre tasas.
- `packages/pricing-engine/src/liquidacion-v4.ts`: `calcularLiquidacionV4`.
- Evidencia: tests de `pricing-engine`, `shared-schemas`, ruta admin de la API y pantalla admin de la web.

### 2. Ancla en publicación y cotización

- `GET /cotizacion` recibe `precio_viaje_clp` en vez de `precio_transportista_clp` y responde el desglose v4.
- `trips.proposedPriceClp` pasa a significar precio del viaje solo en las cargas publicadas desde la activación. Las anteriores conservan su significado (precio del transportista); la metodología persistida en cada liquidación distingue una regla de la otra.
- Archivos: `apps/api/src/routes/trip-requests-v2.ts`, `apps/api/src/services/cotizacion-comercial.ts`, `apps/web/src/components/comercial/SeccionComercial.tsx`, `apps/web/src/routes/cargas.tsx`.

### 3. Ofertas y asignación

- La oferta al transportista lleva lo que él recibe: `precio viaje − comisión`, con la tasa congelada de la carga.
- `assignments.agreedPriceClp` queda como lo que recibe el transportista.
- Archivos: `apps/api/src/services/matching.ts`, `reclamar-viaje.ts`, `offer-actions.ts`, `notify-offer.ts`.

### 4. Liquidación y cambios de carga

- `liquidarTripV3` pasa a calcular desde el precio del viaje con `calcularLiquidacionV4` y persiste la metodología `pricing-v4.0-cl-2026.11`.
- Revisar el significado de las columnas `precio_generador_clp`, `total_factura_generador_clp`, `monto_neto_carrier_clp` y `total_factura_booster_clp`.
- Archivos: `apps/api/src/services/liquidar-trip.ts`, `cambio-carga-comercial.ts`, `apps/api/src/db/schema.ts` y la migración que corresponda.

### 4b. Desglose para el generador

- El detalle de la carga muestra las dos facturas: la del transportista (su neto más IVA) y la de Booster (comisión más IVA), y el total.
- `GET /me/liquidaciones` del transportista no cambia de forma: sigue entregando solo lo que él recibe.
- Archivos: `apps/api/src/services/cotizacion-comercial.ts` (`desgloseParaGenerador`), `apps/web/src/components/comercial/SeccionComercial.tsx`.

### 5. Cobro bajo mandato

- `montosEsperados` hoy cobra al generador `precio transportista + comisión + IVA de la comisión` y libera el precio del transportista. Con ADR-094 cobra el precio del viaje con IVA y libera la factura del transportista; la diferencia es la factura de Booster.
- Archivos: `packages/factoring-engine/src/mandato-cobro.ts`, `apps/api/src/services/mandato-cobro/eventos-pago.ts`.

### 6. Panel de administración y activación

- La vista previa de la pantalla de configuración comercial usa `calcularLiquidacionV4` y deja de mostrar el retorno programado.
- Definir el interruptor: reutilizar `PRICING_V3_ACTIVATED` con el cálculo nuevo o crear uno propio. La activación en producción la decide el PO.
- Retirar `retorno_programada_pct` del esquema, de `resolverComisionPct` y de la versión publicada.

### 7. Modalidad por plazo

- `configuracion_comercial` gana `umbral_inmediata_horas` (entero, inicial 24), opcional con valor por defecto para no invalidar la versión publicada.
- `tipo_carga` deja de elegirlo el generador: se calcula al publicar con el inicio de la ventana de retiro y el umbral. Se retira la bandera de contrato programado por empresa y su pantalla de administración.
- Las claves `spot_pct` y `programada_pct` conservan su nombre; en pantalla se llaman «carga inmediata» y «carga programada».
- Archivos: `packages/shared-schemas/src/configuracion-comercial.ts`, `apps/api/src/services/cotizacion-comercial.ts`, `apps/api/src/services/contrato-programado.ts`, `apps/api/src/routes/trip-requests-v2.ts`, `apps/web/src/routes/platform-admin-configuracion-comercial.tsx`.

### 8. Carta de porte por viaje

- Al aceptar la oferta se genera la carta de porte con los datos del viaje, se congela, se le calcula su huella digital y se entrega una copia a cada parte. La copia del transportista no lleva el anexo del servicio de Booster.
- Se guarda quién aceptó por cada parte, cuándo, desde dónde, y la versión del contrato y de los Términos.
- Las condiciones generales de transporte se aceptan una vez por empresa, con su versión; la carta de porte las incorpora por referencia.
- Un cambio de vehículo o de conductor después de la asignación emite una carta de porte actualizada y avisa al generador, que debe actualizar su guía de despacho (Resolución Exenta SII N.º 144 de 2026).
- Al emitirse la carta de porte, el generador recibe los datos de transporte que exige su guía de despacho: RUT del transportista, nombre y cédula del conductor, patentes, direcciones con comuna.
- Campos que faltan en el esquema: valor declarado de la carga, número de bultos, ventana de entrega, condiciones especiales. Sin comprobar: patente del carro junto al camión en la asignación.
- Análisis de la resolución: https://claude.ai/artifact/9r5C3o1gSG8jf1RSXT5N9h
- Comparación de la guía subida con el viaje (transportista, conductor, patente, origen y destino) usando la lectura del timbre que ya existe (ADR-070).
- La misma entrega de datos para la guía en el viaje propio de Booster Fleet.
- Textos de pantalla con la referencia «Resolución Exenta SII N.º 144 de 2026».
- Maqueta: «Generador · Datos para la guía de despacho» en https://claude.ai/artifact/44QutQ6zQ25Tenyj1qoRNq
- El borrador del texto está en https://claude.ai/artifact/KVdfTiKkn1dsfijzXti14W. Pasa a `docs/legal/` cuando el abogado lo revise.

### 9. Nombre del servicio

- «Booster Spot» reemplaza a «Match de Carga» en la aplicación, los correos, los Términos y los documentos del repositorio.

## Respondidas por el PO el 2026-11-24

- **Facturación.** Booster solo factura al generador; el transportista le factura su parte.
- **Dónde se emite.** La factura de comisión se emite fuera de la plataforma. ADR-069 no se reabre.
- **IVA.** Validado por contabilidad.
- **Tasas iniciales.** No hay siembra nueva: rigen las que el PO publique a mano desde el panel.
- **Nombre y modalidades.** Booster Spot reemplaza a Match de Carga. Carga inmediata (retiro dentro de 24 horas, umbral configurable) y programada. La inmediata paga más, a criterio del PO; el sistema no lo exige. El contrato programado por empresa desaparece.
- **Retorno.** Misma comisión; lo que puede ser menor es la tarifa del viaje.
- **Contrato.** Uno por viaje, perfeccionado por la aceptación de ambas partes en la plataforma.
- **Cargas ya publicadas (2026-11-25).** Quedan fuera: la regla nueva rige solo para las cargas que se publiquen desde su activación. Las anteriores se liquidan con la regla y la tasa con que se publicaron; no hay conversión ni migración de montos.
- **Condiciones generales (2026-11-25).** Valores fijados según lo habitual en Chile y confirmados por el PO: pago a 30 días corridos desde la recepción de la factura (Ley 21.131), reclamo de daños no visibles y objeción de la entrega en 24 horas, 2 horas de espera incluidas, sobreestadía de 5 % del porte por hora con tope de 50 %, falso flete de 50 %, cancelación sin cargo hasta 2 horas antes de la ventana. Valor declarado obligatorio al publicar. Aceptan una carga o una carta de porte solo los roles de decisión u operativos (`dueno`, `admin`, `despachador`); `conductor` no puede, y tampoco los roles de solo lectura (`visualizador`, `stakeholder_sostenibilidad`).

## Preguntas abiertas para el PO

1. (Sin preguntas abiertas sobre cargas ya publicadas: ver respondidas.)
2. **Contrato por viaje.** Las decisiones de producto que el borrador deja abiertas: cargos por cancelación, retiro fallido, carga y descarga, evidencia de entrega, plazo para objetar, valor declarado obligatorio, seguro y quién puede aceptar.
3. **Plan de caja.** Las proyecciones del plan sep-2026 → jun-2027 usan las tasas y la base de ADR-079.
