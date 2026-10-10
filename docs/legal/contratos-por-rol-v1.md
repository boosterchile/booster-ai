---
documento: contratos-por-rol
version: 1.0.0
estado: borrador
lawyer_review: pendiente
supersede: null
refs:
  - ADR-079
  - ADR-080
  - ADR-069
  - ADR-070
  - ADR-021
  - ADR-077
---

> **BORRADOR LEGAL.** No se firma ni se publica mientras `lawyer_review` no tenga la fecha de
> revisión del abogado. Ver `docs/legal/README.md`.

# Contratos por rol — versión 1

Este documento contiene dos contratos marco que complementan los *Términos y Condiciones v3* (`terminos-de-servicio-v3.md`):

- **Parte A**: contrato de servicios con el **generador de carga**.
- **Parte B**: contrato de adhesión del **transportista**.

Los Términos v3 rigen el uso de la Plataforma para cualquier usuario. Estos contratos agregan lo que se negocia o se firma por empresa: condiciones comerciales particulares, contrato programado, suscripciones y comodato. Ante contradicción, prevalece el contrato firmado sobre los Términos, solo en lo que el contrato regula expresamente.

El conductor no firma un contrato con Booster: acepta los Términos v3 (o el texto que defina el abogado) y los consentimientos C-1 a C-4 de `consentimientos-v2.md`. Su relación laboral es con el transportista.

> [PENDIENTE ABOGADO: confirmar la estructura (Términos de adhesión + contrato por empresa) y la
> regla de prelación.]

---

## Parte A — Contrato de servicios con el generador de carga

**Partes**: Booster Chile SpA, RUT [RUT], representada por [NOMBRE], (Booster) y [RAZÓN SOCIAL], RUT [RUT], representada por [NOMBRE], (el Generador).

### A.1. Objeto

Booster presta al Generador los servicios de la Plataforma: publicación de solicitudes de carga, asignación a transportistas, seguimiento de viajes, repositorio documental y, si se contrata, estimación y certificación de huella de carbono.

### A.2. Naturaleza

Booster no es transportista ni responde por la ejecución del transporte. El contrato de transporte de cada viaje se celebra entre el Generador y el transportista que acepta la oferta, por el precio del transportista que el Generador publicó.

### A.3. Comisión

A.3.1. El Generador paga a Booster, por cada viaje, una comisión calculada sobre el precio del transportista, más IVA, según los Términos v3 §6.

A.3.2. **Modalidad de la carga.** Las solicitudes se publican como **spot**, salvo que Booster habilite al Generador un **contrato programado** según A.4.

A.3.3. **Tasas.** Rigen las tasas vigentes en la Plataforma al momento de publicar cada solicitud, que la Plataforma muestra al Generador en ese momento, salvo que este contrato fije tasas particulares en el Anexo A-1.

> [PENDIENTE ABOGADO: si el Anexo A-1 fija tasas particulares, la Plataforma hoy no tiene cómo
> aplicarlas por empresa (ADR-079 configura tasas globales). Decidir si el contrato puede fijar
> tasas particulares o solo remite a las vigentes.]

### A.4. Contrato programado

A.4.1. Booster habilita la modalidad **programada** cuando el Generador se compromete a una operación recurrente con las características del Anexo A-2 (volumen, corredores, frecuencia y plazo).

A.4.2. La habilitación queda registrada en la Plataforma con su fecha y con el usuario de Booster que la activó.

A.4.3. Si el Generador no cumple el compromiso del Anexo A-2 durante [PERÍODO], Booster puede revocar la habilitación con aviso de [PLAZO]. Las solicitudes publicadas antes de la revocación conservan su tasa.

> [PENDIENTE ABOGADO: el criterio de habilitación no está escrito (ADR-079 Consecuencias (d)).
> Definir volumen mínimo, plazo y consecuencias del incumplimiento.]

### A.5. Suscripción del Generador

El Generador paga la suscripción mensual por empresa que Booster publique en UF (Términos v3 §7), desde [FECHA DE INICIO o «el primer viaje entregado»].

### A.6. Huella de carbono

A.6.1. La medición de huella se activa para el Generador cuando la solicita. Los certificados se emiten por viaje entregado con la metodología GLEC v3.0 y su nivel de certificación.

A.6.2. Los servicios de huella por proyecto o temporada (reportes consolidados, línea base, metas de reducción) se cotizan en el Anexo A-3.

### A.7. Pago

A.7.1. **Modo de pago directo** (vigente): el Generador paga el flete directamente al transportista contra su factura, y paga a Booster la factura de comisión en [PLAZO] días desde su emisión.

A.7.2. **Mandato de cobro**: si las partes firman el *Adendum de mandato de cobro*, el Generador paga a Booster el precio al generador más el IVA de la comisión, y el adendum prevalece en lo que regula.

### A.8. Recepción conforme

El Generador confirma la entrega en la Plataforma, u objeta con fundamento, dentro de [PLAZO] desde la entrega registrada por el conductor.

> [PENDIENTE ABOGADO: plazo de recepción conforme y efecto del silencio (¿se entiende conforme?).
> Es crítico para el mandato de cobro.]

### A.9. Confidencialidad

A.9.1. Cada parte mantiene reservada la información comercial de la otra.

A.9.2. El Generador no comunica al transportista la comisión de Booster ni el precio al generador.

> [PENDIENTE ABOGADO: alcance y sanción de A.9.2.]

### A.10. Datos personales

Cada parte trata los datos personales que reciba de la otra solo para ejecutar este contrato, conforme a la ley. Respecto de los datos de conductores que la Plataforma le muestra (nombre, patente, ubicación en viaje), el Generador los usa solo para el viaje respectivo.

### A.11. Vigencia y término

Plazo indefinido desde la firma. Cualquiera de las partes puede terminarlo con aviso de [PLAZO] días, sin perjuicio de los viajes en curso y de las obligaciones de pago pendientes.

### A.12. Ley y jurisdicción

Ley chilena. [Tribunales de Santiago / arbitraje, según Términos v3 §19.]

**Anexos**: A-1 Condiciones comerciales particulares · A-2 Compromiso de contrato programado · A-3 Servicios de huella de carbono.

---

## Parte B — Contrato de adhesión del transportista

**Partes**: Booster Chile SpA, RUT [RUT], (Booster) y [RAZÓN SOCIAL], RUT [RUT], representada por [NOMBRE], (el Transportista).

### B.1. Objeto

El Transportista se incorpora a la Plataforma para recibir ofertas de transporte de generadores de carga y, si las acepta, ejecutarlas. Puede además contratar los servicios de gestión de flota y telemetría.

### B.2. Precio del transportista

B.2.1. Por cada viaje que acepte, el Transportista recibe el **precio del transportista** que muestra la oferta, **íntegro**. Booster no le descuenta comisión.

B.2.2. El Transportista factura el flete al generador según la normativa tributaria que le aplique y sube el documento a la Plataforma. Booster no emite documentos tributarios por cuenta del Transportista.

### B.3. Confidencialidad del precio al generador

El Transportista reconoce que la comisión de Booster la paga el generador y que la Plataforma no le informa el porcentaje ni el monto de esa comisión, ni el precio al generador. Esta información es reservada de Booster y del generador.

> [PENDIENTE ABOGADO: redactar el reconocimiento de modo que no se entienda como ocultamiento
> indebido; evaluar si conviene informar al transportista que existe una comisión pagada por el
> generador (este borrador lo hace) sin revelar su monto.]

### B.4. Suscripción y gestión de flota

B.4.1. El Transportista paga la suscripción mensual por camión activo que Booster publique en UF, con o sin gestión de flota.

B.4.2. No paga suscripción mientras tenga activos [N] camiones o menos, según el valor publicado como exento.

### B.5. Dispositivo de telemetría en comodato

B.5.1. Cuando Booster instala un dispositivo de telemetría en un vehículo del Transportista sin costo de compra, lo entrega en **comodato**. El dispositivo sigue siendo de Booster.

B.5.2. El Transportista: no lo retira, no lo manipula ni lo desconecta; avisa de inmediato su falla, pérdida o robo; y lo devuelve en [PLAZO] al terminar el contrato o cuando Booster lo pida.

B.5.3. Booster puede desactivar el dispositivo a distancia al terminar el comodato.

B.5.4. Los datos que genera el dispositivo se tratan según el Aviso de Privacidad v2.

> [PENDIENTE ABOGADO: responsabilidad por pérdida o daño del dispositivo, valor de reposición y
> plazo de devolución.]

### B.6. Conductores

B.6.1. El Transportista crea a sus conductores en la Plataforma, les entrega el código de activación y responde por ellos.

B.6.2. El Transportista declara que sus conductores tienen licencia vigente de la clase que corresponde, que cumple con ellos la legislación laboral y previsional, y que les informó el Aviso de Privacidad v2. Booster no es empleador de los conductores.

### B.7. Obligaciones operativas

Las de los Términos v3 §12, en especial: vehículos en regla, seguros vigentes, documentos del flete subidos a la Plataforma e incidentes informados.

### B.8. Pago del flete

B.8.1. **Modo de pago directo** (vigente): el generador paga el flete directamente al Transportista. Booster no garantiza ese pago.

B.8.2. **Mandato de cobro**: si el Transportista firma el *Adendum de mandato de cobro*, Booster cobra el flete al generador y lo libera al Transportista tras la recepción conforme, según el adendum.

### B.9. No elusión

El Transportista no contacta a un generador conocido a través de la Plataforma para ejecutar fuera de ella, durante [PLAZO], operaciones originadas en la Plataforma.

> [PENDIENTE ABOGADO: validar B.9 frente a la libre competencia, su plazo y su sanción.]

### B.10. Datos personales

Booster trata los datos del Transportista, de sus usuarios y de sus conductores según el Aviso de Privacidad v2. El Transportista usa los datos del generador solo para ejecutar el viaje.

### B.11. Vigencia y término

Plazo indefinido desde la aceptación. El Transportista puede terminarlo en cualquier momento, sin perjuicio de los viajes aceptados y de la devolución del dispositivo en comodato. Booster puede terminarlo o suspenderlo por las causales de los Términos v3 §17.

### B.12. Ley y jurisdicción

Ley chilena. [Tribunales de Santiago / arbitraje, según Términos v3 §19.]
