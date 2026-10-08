---
documento: adendum-mandato-cobro
version: 1.0.0
slug_consentimiento: mandato-cobro-v1
estado: borrador
lawyer_review: pendiente
supersede: adendum-cobra-hoy-v1.md
refs:
  - ADR-080
  - ADR-079
  - ADR-069
  - ADR-070
  - ADR-029
  - ADR-032
---

> **BORRADOR LEGAL.** No se publica ni se ofrece para aceptación mientras `lawyer_review` no tenga
> la fecha de revisión del abogado. Además, ADR-080 §6 exige **sign-off legal escrito sobre la
> figura del mandato de cobro** antes de activarlo en producción: este borrador es el insumo de
> esa revisión, no la reemplaza. Ver `docs/legal/README.md`.

# Adendum de mandato de cobro — versión 1

**Documento marco**: Términos y Condiciones v3 §8.4 y contratos por rol v1 (A.7.2 y B.8.2).
**Reemplaza a**: Adendum Booster Cobra Hoy v1, que describía la cesión de la factura del transportista con tarifa fija de Booster sobre el monto neto post-comisión. Ese esquema queda superado por ADR-080.

## Estado de activación

Este adendum **solo produce efectos cuando Booster active el mandato de cobro** y lo comunique a las partes. Mientras tanto rige el **modo de pago directo**: el generador paga el flete directamente al transportista y Booster no recibe ni administra fondos de terceros (Términos v3 §8.3). A octubre de 2026, la Plataforma opera en modo de pago directo.

Booster solo activará el mandato de cobro cuando se cumplan, con evidencia escrita, las precondiciones de ADR-080 §6: sign-off legal de la figura, cuenta bancaria separada de fondos de terceros con conciliación diaria, financiamiento del capital de trabajo, autorización de los conductores para el uso de sus datos, recepción conforme operativa de punta a punta, y aceptación de los Términos v3 y de este adendum.

---

## 1. Partes y alcance

Este adendum lo aceptan, cada uno por separado, el **generador de carga** y el **transportista** que quieran operar bajo mandato de cobro. Se aplica a los viajes cuyas solicitudes se publiquen después de que ambas partes del viaje lo hayan aceptado y Booster lo haya activado.

> [PENDIENTE ABOGADO: definir qué pasa con un viaje en que solo una de las partes aceptó el
> adendum (propuesta: rige el pago directo para ese viaje).]

## 2. Mandato

2.1. **Del transportista a Booster.** El transportista encarga a Booster, en mandato sin representación [o con representación, según defina el abogado], cobrar al generador el precio del transportista de cada viaje amparado por este adendum y recibir el pago en su nombre.

2.2. **Del generador.** El generador acepta pagar a Booster, por cada viaje amparado, el **precio al generador** (precio del transportista más la comisión de Booster) más el IVA de la comisión, y reconoce que el pago a Booster del precio del transportista libera su obligación de pago del flete frente al transportista.

2.3. **Documentos tributarios.** El transportista sigue emitiendo la factura del flete al generador, y la sube a la Plataforma. Booster no emite documentos tributarios por cuenta del transportista; cobra ese documento por mandato y lo archiva. Booster factura al generador solo su comisión.

> [PENDIENTE ABOGADO: forma jurídica del mandato (Código Civil y Código de Comercio), si es con o
> sin representación, efecto liberatorio del pago a Booster y tratamiento tributario de los
> montos que transitan por Booster. Confirmar que la recepción y liberación de fondos de terceros
> no constituye captación ni actividad regulada por la CMF (ADR-080 §6.1).]

## 3. Flujo del dinero

3.1. **Recepción conforme.** El plazo de pago y la liberación se cuentan desde la **recepción conforme**: la confirmación de entrega del generador en la Plataforma, con el documento del viaje archivado.

3.2. **Pago del generador.** El generador paga a Booster dentro de **[30] días** desde la recepción conforme.

3.3. **Liberación al transportista.** Booster transfiere al transportista el **precio del transportista íntegro** dentro de **[5] días** desde la recepción conforme, a la cuenta bancaria que el transportista registró en la Plataforma, aunque el generador todavía no haya pagado.

> [PENDIENTE ABOGADO: confirmar si la liberación al día 5 es una obligación de Booster
> independiente del pago del generador (así la plantea ADR-080 y el plan de caja), con el riesgo
> de crédito que eso implica para Booster, o si queda condicionada a la disponibilidad del
> financiamiento del §5. Los plazos entre corchetes son los valores iniciales de la configuración
> comercial y Booster puede ajustarlos: definir si un cambio de plazo exige aviso previo.]

3.4. **Comisión.** Booster retiene su comisión más IVA del monto que paga el generador. El transportista no paga comisión.

3.5. **Fondos de terceros.** Los montos del flete se mantienen en una **cuenta bancaria de fondos de terceros**, separada de la cuenta operacional de Booster, y se concilian a diario. Booster no usa esos fondos para fines propios.

3.6. **Registro.** Cada evento (recepción conforme, pago del generador, liberación al transportista) queda registrado en la Plataforma con su fecha y hora, y ambas partes pueden consultarlo para sus viajes.

## 4. Disputas y mora

4.1. **Objeción del generador.** Si el generador objeta la entrega con fundamento (carga no recibida, dañada o evidencia inválida) dentro del plazo de recepción conforme, la liberación al transportista se suspende hasta resolver la disputa. La objeción no suspende la obligación de pago del generador por los montos no disputados.

4.2. **Plazo de resolución.** Las partes procuran resolver la disputa en 30 días. Booster aporta la evidencia del viaje (traza GPS, eventos, documentos y fotos).

4.3. **Mora del generador.** Si el generador no paga en plazo, Booster puede bloquear la publicación de nuevas solicitudes y reducir o suspender su cupo de crédito, sin perjuicio de las acciones de cobro.

> [PENDIENTE ABOGADO: interés por mora, gastos de cobranza, y quién asume el riesgo de no pago
> del generador después de liberado el pago al transportista. Mecanismo de solución de disputas
> entre generador y transportista (¿Booster decide, media o solo aporta evidencia?).]

## 5. Anticipo por operador financiero

5.1. Booster puede financiar la liberación anticipada con un **operador financiero** (por ejemplo, una línea de *confirming* en que Booster es mandante y los transportistas adheridos son proveedores).

5.2. Cuando el operador anticipa el pago al transportista:

- La base del anticipo es el **precio del transportista completo**, hasta el porcentaje del documento que fije el operador.
- **La tasa del anticipo la fija el operador**, no Booster, y se informa al transportista antes de que acepte cada anticipo.
- Booster puede recibir del operador una comisión de originación sobre el monto anticipado.
- El transportista acepta las condiciones del operador en el documento que este exija.

5.3. El anticipo procede solo sobre viajes con recepción conforme y con una decisión de crédito vigente del generador.

5.4. **Recurso contra el transportista.** El operador o Booster pueden exigir al transportista la devolución del anticipo si el viaje resulta no entregado por causa imputable al transportista, si hubo fraude o falsedad, o si una disputa válida del generador no se resuelve en 30 días.

> [PENDIENTE ABOGADO: texto del anticipo según el contrato que se firme con el operador. Revisar
> si la cesión de la factura (Ley 19.983) se mantiene como respaldo opcional (ADR-080 §3) y el
> tratamiento tributario del costo del anticipo. Revisar si Booster debe informar al transportista
> la comisión de originación que recibe.]

## 6. Datos

Para operar este adendum, Booster trata los datos bancarios del transportista y comparte con el operador financiero, solo cuando hay anticipo, el RUT del transportista, sus datos bancarios, el monto y la evidencia del viaje. Para evaluar el crédito del generador, Booster puede consultar a proveedores de información comercial. Todo según el Aviso de Privacidad v2.

## 7. Término y reversión

7.1. Cualquier parte puede dejar de operar bajo este adendum con aviso de [PLAZO]. Los viajes ya publicados terminan su ciclo bajo el adendum.

7.2. Booster puede volver al modo de pago directo para todos los viajes nuevos, con aviso a las partes, si deja de cumplirse alguna precondición de activación. Los viajes en curso terminan su ciclo bajo el adendum.

## 8. Aceptación

Cada parte acepta este adendum con una acción afirmativa en la Plataforma. La aceptación queda registrada con identidad, empresa, fecha y hora, versión (`mandato-cobro-v1`), dirección IP y agente de usuario.
