---
documento: terminos-de-servicio
version: 3.0.0
slug_consentimiento: tyc-v3
estado: borrador
lawyer_review: pendiente
supersede: terminos-de-servicio-v2.md
refs:
  - ADR-069
  - ADR-070
  - ADR-079
  - ADR-080
  - ADR-068
  - ADR-035
  - ADR-077
  - ADR-021
  - ADR-022
---

> **BORRADOR LEGAL.** Este texto no se publica en la app ni se ofrece para aceptación mientras
> `lawyer_review` no tenga la fecha de revisión del abogado. Los campos entre corchetes `[ ]`
> y cada bloque `[PENDIENTE ABOGADO]` deben resolverse antes. Ver `docs/legal/README.md`.

# Términos y Condiciones de Servicio de Booster AI — versión 3

**Versión**: 3.0.0 (borrador)
**Reemplaza a**: Términos de Servicio v2 (2026-05-10)
**Vigente desde**: [FECHA DE PUBLICACIÓN, posterior a la revisión legal]

## Qué cambia respecto de la versión 2

La versión 2 describía un modelo que ya no rige. En resumen, esta versión:

1. **Elimina la emisión de documentos tributarios por Booster.** Booster no emite DTE (facturas, guías de despacho ni otros) por cuenta propia ni en nombre de nadie. Recibe y archiva los documentos que emiten las partes (ADR-069 y ADR-070).
2. **Cambia quién paga la comisión.** La comisión de Booster la paga el generador de carga, encima del precio del transportista. El transportista recibe su precio íntegro, sin descuento de Booster (ADR-079).
3. **Elimina las membresías con comisión escalonada** (Free, Standard, Pro, Premium) y los cargos mensuales en pesos. Los servicios recurrentes se cobran en UF (ADR-079 §4).
4. **Incorpora una cláusula de confidencialidad del precio**: el transportista no accede al precio que paga el generador ni a la comisión de Booster (ADR-079 §5).
5. **Rige para todos los roles** (generador de carga, transportista y conductor), no solo para el transportista.

---

## 1. Partes

La plataforma Booster AI (en adelante, la **Plataforma**) es operada por **Booster Chile SpA**, RUT [RUT], con domicilio en [DIRECCIÓN, COMUNA, CIUDAD] (en adelante, **Booster**). Las comunicaciones sobre estos Términos se dirigen a [soporte@boosterchile.com](mailto:soporte@boosterchile.com).

> [PENDIENTE ABOGADO: confirmar razón social, RUT, domicilio y representante legal de Booster
> Chile SpA. Confirmar si el canal de comunicaciones legales debe ser distinto del de soporte.]

## 2. Definiciones

- **Generador de carga**: empresa que publica solicitudes de transporte de carga en la Plataforma y paga el servicio de transporte y la comisión de Booster.
- **Transportista**: empresa que ejecuta el transporte con vehículos y conductores propios o bajo su responsabilidad.
- **Conductor**: persona natural que conduce el vehículo del transportista y usa la Plataforma para ejecutar el viaje. El conductor actúa por cuenta del transportista.
- **Usuario**: persona natural que accede a la Plataforma con credenciales propias, en representación de una empresa y con uno de los roles de la sección 4.3.
- **Solicitud de carga**: requerimiento de transporte que publica el generador, con origen, destino, fechas, características de la carga y precio.
- **Tipo de carga**: clasificación comercial de la solicitud, que determina la tasa de comisión: **spot** (operación puntual) o **programada** (operación recurrente bajo contrato programado habilitado por Booster).
- **Precio del transportista**: monto que el transportista recibe por el viaje. Es el ancla de todo cálculo de comisión.
- **Comisión de Booster**: monto que Booster cobra al generador por el servicio de intermediación, calculado como un porcentaje del precio del transportista.
- **Precio al generador**: precio del transportista más la comisión de Booster. El IVA de la comisión se agrega en la factura de Booster.
- **Recepción conforme**: confirmación del generador, registrada en la Plataforma, de que la carga fue entregada, con el documento del viaje archivado.
- **Documento tributario de terceros**: guía de despacho, factura u otro documento electrónico emitido por una de las partes ante el Servicio de Impuestos Internos (SII) y subido a la Plataforma.
- **Certificado de huella**: documento digital firmado que emite la Plataforma con la estimación de emisiones de gases de efecto invernadero de un viaje.

## 3. Objeto y naturaleza del servicio

3.1. Booster opera un mercado digital entre empresas (B2B) que conecta generadores de carga con transportistas en Chile, y ofrece servicios asociados: seguimiento del viaje, repositorio documental, gestión de flota, telemetría y estimación de huella de carbono.

3.2. **Booster es un intermediario tecnológico.** No es transportista, no presta el servicio de transporte, no es dueño ni tenedor de la carga, y no es empleador de los conductores. El contrato de transporte se celebra entre el generador y el transportista.

3.3. **Booster no emite documentos tributarios electrónicos** por cuenta de ninguna de las partes. Cada parte emite los suyos ante el SII según la normativa que le aplique. Booster solo emite las facturas por sus propios servicios (comisión y suscripciones), por los medios que use como contribuyente.

> [PENDIENTE ABOGADO: confirmar la calificación jurídica de Booster como intermediario y su
> encaje frente a la normativa de transporte de carga por carretera y de protección al consumidor
> (relaciones B2B). Confirmar si corresponde excluir expresamente la Ley 19.496.]

## 4. Registro, cuentas y roles

4.1. **Alta de empresa.** Las empresas se incorporan a la Plataforma por solicitud de acceso revisada por Booster, o por alta directa de Booster. La empresa declara su RUT, razón social, domicilio y datos de contacto, y si actúa como generador de carga, como transportista o como ambos.

4.2. **Credenciales.** Cada usuario accede con su RUT y una clave numérica personal, o con los métodos de acceso que la Plataforma habilite. La clave es personal e intransferible. El usuario debe custodiarla y avisar a Booster de inmediato si sospecha un uso no autorizado. La recuperación de clave se hace por un código de un solo uso enviado al número registrado.

4.3. **Roles dentro de la empresa.** La empresa asigna a cada usuario uno de estos roles: dueño, administrador, despachador, conductor, visualizador o responsable de sostenibilidad. Cada rol ve y hace solo lo que la Plataforma le permite. La empresa responde por los actos de sus usuarios en la Plataforma.

4.4. **Facultad para obligar a la empresa.** Quien acepta estos Términos en nombre de una empresa declara tener facultades suficientes para obligarla. Booster puede pedir antecedentes que lo acrediten.

4.5. **Conductores.** El transportista crea a sus conductores en la Plataforma y les entrega el código de activación por los canales que la Plataforma ofrezca. El transportista declara que sus conductores tienen licencia de conducir vigente de la clase que corresponde y que ha obtenido de ellos las autorizaciones que exige la ley para el tratamiento de sus datos (sección 15).

> [PENDIENTE ABOGADO: definir si el conductor acepta estos Términos en nombre propio, si basta la
> aceptación del transportista, o si el conductor acepta solo un texto reducido (uso de la app y
> privacidad). ADR-080 §6.4 exige la autorización explícita del conductor para el uso de RUT,
> licencia y ubicación.]

## 5. Operación del mercado

5.1. **Publicación.** El generador publica una solicitud de carga e indica el tipo de carga. El tipo **programada** solo está disponible para generadores a los que Booster les habilitó un contrato programado. Si no se indica, la solicitud es **spot**.

5.2. **Precio.** Al publicar, el generador fija el precio que recibirá el transportista. En ese momento la Plataforma le muestra el desglose completo: precio del transportista, comisión de Booster (porcentaje y monto), IVA de la comisión y total a pagar.

5.3. **Asignación.** El algoritmo de asignación de Booster propone la solicitud a transportistas candidatos según capacidad, cercanía, disponibilidad y otros criterios técnicos. La solicitud se ofrece al transportista con el precio del transportista, sin alterarlo.

5.4. **Aceptación.** La aceptación de la oferta por el transportista perfecciona el compromiso de transporte entre generador y transportista por el precio del transportista ofrecido. El primer transportista que acepta queda asignado.

5.5. **Ejecución.** El transportista asigna un conductor y un vehículo. El conductor registra en la Plataforma la recogida y la entrega. Durante el viaje, la Plataforma registra la ubicación del vehículo (por el dispositivo de telemetría instalado o por el teléfono del conductor) para seguimiento, seguridad y cálculo de huella.

5.6. **Cierre documental.** Para cerrar una orden de transporte, al menos una de las partes debe subir el documento tributario que ampara la carga (guía de despacho o factura). La Plataforma intenta leer el timbre electrónico del documento para completar sus datos; si no lo logra, basta el archivo o el ingreso manual.

5.7. **Recepción conforme.** El generador confirma la entrega en la Plataforma. Esa confirmación es la recepción conforme para efectos de estos Términos y del adendum de mandato de cobro, si aplica.

5.8. **Cancelaciones.** Las reglas de cancelación, plazos y eventuales cargos se publican en la Plataforma y forman parte de estos Términos.

> [PENDIENTE ABOGADO: las reglas de cancelación no están redactadas. Hoy la Plataforma no aplica
> penalidades por cancelación (ADR-079 §7 las deja fuera de alcance). Definir si se dejan fuera de
> estos Términos o se incorporan como anexo.]

## 6. Precio, comisión y confidencialidad

6.1. **Precio del transportista.** El transportista recibe el precio del transportista **íntegro**. Booster no le descuenta comisión alguna.

6.2. **Comisión de Booster.** La comisión de Booster la paga **el generador de carga**, encima del precio del transportista:

```
comisión               = precio del transportista × tasa de comisión aplicable
IVA de la comisión     = comisión × tasa de IVA vigente
precio al generador    = precio del transportista + comisión
total factura Booster  = comisión + IVA de la comisión
```

Todas las cifras se expresan netas de IVA, salvo el IVA de la comisión. Los montos se redondean a pesos enteros.

6.3. **Tasa según tipo de carga.** La tasa de comisión depende del tipo de carga:

- **Carga spot**: tasa spot.
- **Carga programada**: tasa programada, que siempre es menor que la tasa spot.
- **Retorno de carga programada**: cuando la Plataforma identifica el viaje como retorno y la carga es programada, se aplica la tasa de retorno programada, que queda entre las dos anteriores, si Booster la tiene publicada.

Las tasas vigentes se publican en la Plataforma y el generador las ve antes de publicar.

6.4. **Congelamiento de la tasa.** La tasa aplicable **se congela al publicar** la solicitud de carga. Un cambio posterior de tasas solo afecta a solicitudes publicadas después del cambio. El total que el generador vio al publicar no cambia por un cambio de tasas.

6.5. **Ejemplo ilustrativo.** Con una tasa hipotética de 20 % y un IVA de 19 %, en un viaje con precio del transportista de $700.000: la comisión es $140.000, el IVA de la comisión es $26.600, el precio al generador es $840.000 y la factura de Booster al generador es $166.600. El transportista recibe $700.000. Las tasas reales son las publicadas en la Plataforma.

6.6. **Confidencialidad del precio al generador.** Booster no informa al transportista ni a sus conductores el porcentaje de comisión, el monto de la comisión, el precio al generador ni el total facturado al generador. Las pantallas, mensajes y notificaciones dirigidas al transportista y al conductor muestran solo el precio del transportista. El generador ve el desglose completo de sus propias solicitudes.

> [PENDIENTE ABOGADO: definir si el generador asume una obligación recíproca de no revelar al
> transportista la comisión de Booster, su alcance y su sanción. Revisar si la confidencialidad
> del precio requiere alguna declaración expresa frente al transportista para evitar reclamos de
> falta de transparencia.]

6.7. **Cambios de tasas.** Booster puede modificar las tasas publicadas. Los cambios rigen para solicitudes publicadas desde su entrada en vigor y nunca de forma retroactiva.

> [PENDIENTE ABOGADO: fijar el plazo de aviso previo al generador para un alza de tasas (la v2
> daba 30 días para cambios adversos al transportista) y si un alza da derecho a terminar sin
> costo. Revisar compatibilidad con contratos programados que fijen tasas por escrito.]

6.8. **Trazabilidad del cálculo.** Cada liquidación registra la versión de la metodología de cálculo y la versión de la configuración comercial con que se calculó. Booster puede recalcular y auditar cualquier liquidación con esos datos.

## 7. Servicios recurrentes en UF

7.1. Los servicios recurrentes de Booster se expresan **en Unidades de Fomento (UF)**:

- Suscripción del transportista, por camión activo al mes, con o sin gestión de flota.
- Suscripción del generador, por empresa al mes.

Los valores vigentes se publican en la Plataforma.

7.2. El transportista con hasta el número de camiones activos que Booster publique como exento no paga suscripción.

7.3. Al facturar, la UF se convierte a pesos con el valor de la UF del día de emisión de la factura, que queda registrado en la factura.

7.4. **Dispositivo de telemetría en comodato.** Cuando Booster instala un dispositivo de telemetría en un vehículo del transportista sin costo de compra, el dispositivo se entrega en comodato. Sigue siendo de Booster, el transportista lo cuida y lo devuelve al terminar la relación o cuando Booster lo pida, y Booster puede desactivarlo a distancia.

> [PENDIENTE ABOGADO: redactar las condiciones del comodato (plazo, devolución, responsabilidad
> por pérdida o daño, desactivación remota) o remitir a un contrato de comodato separado. ADR-079
> §4 conserva las reglas de ADR-026 §4, que no tienen texto contractual en el repo.]

7.5. **Huella de carbono como servicio.** La medición de huella para reportes del generador o de terceros se cotiza por proyecto o por temporada, en un acuerdo aparte.

## 8. Facturación y flujo del dinero

8.1. **Lo que factura Booster.** Booster factura al generador la comisión más su IVA, y a cada empresa las suscripciones que correspondan.

8.2. **Lo que factura el transportista.** El transportista factura el flete al generador según la normativa tributaria que le aplique. Booster no emite ese documento.

8.3. **Modo vigente: pago directo.** Mientras Booster no active el mandato de cobro, el generador paga el flete directamente al transportista, y paga a Booster la factura de comisión por separado.

8.4. **Mandato de cobro.** Cuando Booster active el mandato de cobro y las partes acepten el adendum respectivo, el generador pagará a Booster el precio al generador más el IVA de la comisión, y Booster liberará al transportista el precio del transportista tras la recepción conforme. Ese flujo se rige por el *Adendum de mandato de cobro*.

8.5. **Plazos y mora.** Las facturas de Booster vencen en el plazo que indique cada factura. La mora puede suspender la publicación de nuevas solicitudes o la aceptación de nuevas ofertas.

> [PENDIENTE ABOGADO: fijar plazo de pago de las facturas de Booster, interés por mora y
> procedimiento de cobranza. Confirmar el tratamiento tributario de la comisión facturada al
> generador.]

## 9. Repositorio documental

9.1. Booster **recibe y archiva** los documentos tributarios de terceros que las partes suben para amparar cada viaje. No los emite, no los firma, no los presenta al SII y no responde por su contenido.

9.2. La lectura automática del timbre electrónico es de mejor esfuerzo. El resultado no constituye validación del documento ante el SII.

9.3. Booster conserva cada documento por **seis años contados desde su fecha de emisión** (o desde su carga, si la fecha no se puede determinar), como política de custodia. Durante ese plazo no lo elimina, aunque la orden se cierre o la cuenta se dé de baja.

9.4. Cada parte responde por la veracidad, integridad y legalidad de los documentos que sube, y por su propia obligación de conservarlos ante el SII.

> [PENDIENTE ABOGADO: ADR-070 adopta el plazo de 6 años como postura conservadora con sign-off
> del PO; validar el fundamento y si corresponde un plazo distinto para documentos que contengan
> datos personales.]

## 10. Huella de carbono

10.1. La Plataforma estima las emisiones de gases de efecto invernadero de cada viaje con la metodología **GLEC Framework v3.0** (Smart Freight Centre), con factores *well-to-wheel* para Chile y potenciales de calentamiento global IPCC AR6 a 100 años.

10.2. **Es una estimación metodológica**, no una medición directa de gases. Su precisión depende de los datos disponibles: consumo real del vehículo leído del bus CAN, distancia medida por GPS, perfil declarado del vehículo o valores por defecto. El certificado indica el nivel de certificación y la fuente de los datos. El nivel lo calcula la Plataforma; ningún usuario lo puede declarar.

10.3. Los certificados se firman digitalmente y se pueden verificar con su código de seguimiento.

10.4. La medición de huella se activa por empresa. La empresa que la active autoriza el tratamiento de los datos operacionales necesarios (sección 15).

10.5. Mientras la Plataforma no informe una certificación externa vigente de la metodología, el certificado de huella refleja la aplicación de la metodología por Booster y no una verificación de tercero. Booster no garantiza que el certificado sea aceptado para un fin regulatorio, de reporte o de compensación específico del usuario.

> [PENDIENTE ABOGADO: revisar la limitación de responsabilidad sobre el uso de certificados en
> reportes ESG de terceros y el texto de la sección 10.5 cuando exista el certificado GLEC externo
> (T10-27).]

## 11. Obligaciones del generador de carga

1. Describir la carga con veracidad: peso, volumen, naturaleza, condiciones especiales y si es peligrosa.
2. Tener derecho a disponer de la carga y entregar la documentación que la ampara.
3. Pagar el flete y la comisión de Booster en los plazos acordados.
4. Confirmar la recepción conforme, u objetarla con fundamento, dentro del plazo que fije la Plataforma.
5. Usar los datos del transportista y de sus conductores solo para ejecutar el viaje.

## 12. Obligaciones del transportista

1. Ejecutar los viajes aceptados con vehículos en regla (revisión técnica, permiso de circulación, seguro obligatorio y los permisos especiales que la carga exija).
2. Asignar conductores con licencia vigente de la clase que corresponde y cumplir con ellos la legislación laboral y previsional. Booster no es empleador de los conductores.
3. Mantener su información tributaria, bancaria y de contacto al día.
4. Emitir los documentos tributarios del flete y subirlos a la Plataforma.
5. Informar por la Plataforma o a soporte los atrasos, accidentes, daños, robos y demás incidentes del viaje.
6. No contactar al generador para desviar fuera de la Plataforma operaciones originadas en ella.

> [PENDIENTE ABOGADO: validar la cláusula 12.6 (no elusión) y su sanción, considerando la libre
> competencia.]

## 13. Obligaciones del conductor

1. Usar la Plataforma solo para los viajes que su transportista le asigne.
2. Registrar la recogida y la entrega cuando ocurran.
3. Mantener activa la ubicación del teléfono durante el viaje cuando el vehículo no tenga dispositivo de telemetría.
4. No usar el teléfono mientras conduce de forma contraria a la ley de tránsito. La Plataforma ofrece funciones de voz para reducir la interacción manual.

## 14. Obligaciones y responsabilidad de Booster

14.1. Booster procura mantener la Plataforma disponible, salvo mantenciones avisadas y fallas de terceros fuera de su control.

14.2. Booster calcula las liquidaciones con la metodología publicada, sin alterarlas retroactivamente.

14.3. Booster no responde por la pérdida, daño o retraso de la carga, que son responsabilidad del transportista conforme al contrato de transporte y a la ley, ni por el incumplimiento de pago de una parte a otra en el modo de pago directo.

> [PENDIENTE ABOGADO: fijar el compromiso de disponibilidad (la v2 prometía 99 % mensual; hoy la
> Plataforma opera sin SLA contractual) y el tope de responsabilidad de Booster. Revisar la
> exclusión de 14.3 bajo mandato de cobro, donde Booster sí recibe el flete.]

## 15. Datos personales

El tratamiento de datos personales se rige por el **Aviso de Privacidad v2** (`aviso-privacidad-v2.md`) y por los consentimientos que cada titular otorgue (`consentimientos-v2.md`), conforme a la Ley 19.628 y, desde su entrada en vigencia, a la Ley 21.719. Booster no vende datos personales. Cada parte que entregue a Booster datos de personas naturales (por ejemplo, el transportista respecto de sus conductores) declara contar con la base de licitud para hacerlo.

## 16. Propiedad intelectual

La Plataforma, sus marcas, su código y sus metodologías son de Booster. Los usuarios reciben una licencia limitada, revocable, no exclusiva e intransferible para usarla según estos Términos. Los datos que suben las empresas siguen siendo suyos; Booster los usa para operar la Plataforma, emitir certificados y elaborar estadísticas agregadas y anonimizadas.

## 17. Suspensión y término

17.1. Cualquier empresa puede terminar su relación con Booster en cualquier momento, sin perjuicio de los viajes en curso y de las obligaciones de pago pendientes.

17.2. Booster puede suspender una cuenta por mora, por incumplimiento grave de estos Términos, por fraude o por riesgo material para otros usuarios. La suspensión por mora se avisa con anticipación; la suspensión por fraude o riesgo puede ser inmediata.

> [PENDIENTE ABOGADO: plazos de aviso de suspensión y causales.]

## 18. Modificaciones

Booster puede modificar estos Términos. Los cambios materiales que perjudiquen a una parte se avisan por correo y en la Plataforma con anticipación, y la parte puede terminar sin costo antes de su entrada en vigor. Los cambios que no perjudican rigen al publicarse. Cada versión aceptada queda registrada con su número de versión.

> [PENDIENTE ABOGADO: plazo de aviso previo de modificaciones.]

## 19. Ley aplicable y solución de controversias

Estos Términos se rigen por las leyes de la República de Chile. Las controversias se someten a los tribunales ordinarios de justicia de Santiago.

> [PENDIENTE ABOGADO: evaluar arbitraje (por ejemplo, CAM Santiago) para controversias entre
> empresas y la cuantía bajo la cual conviene mantener tribunales ordinarios.]

## 20. Disposiciones finales

- **Divisibilidad**: si una cláusula es inválida, las demás siguen vigentes.
- **No renuncia**: no ejercer un derecho no implica renunciar a él.
- **Comunicaciones**: al correo registrado en la cuenta, salvo que estos Términos indiquen otro medio.
- **Documentos que integran estos Términos**: el Aviso de Privacidad v2, el contrato por rol que corresponda y, si se acepta, el Adendum de mandato de cobro.

---

## Aceptación

La aceptación se hace con una acción afirmativa en la Plataforma (casilla no marcada por defecto y botón de aceptación). Queda registrada con la identidad del usuario, la empresa, la fecha y hora, la versión de estos Términos (`tyc-v3`), la dirección IP y el agente de usuario. El usuario puede descargar una copia.

> Nota de implementación (no forma parte del texto legal): la aceptación de la v2 se registra hoy
> en `carrier_memberships` desde `/legal/terminos`. La v3 necesita un registro de aceptación que
> sirva a generadores, transportistas y conductores; es trabajo de código posterior a la revisión
> legal (ADR-079, acción derivada 7).
