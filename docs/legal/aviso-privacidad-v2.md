---
documento: aviso-privacidad
version: 2.0.0
slug_consentimiento: privacidad-v2
estado: borrador
lawyer_review: pendiente
supersede: aviso-privacidad-corto-v1.md
refs:
  - ADR-068
  - ADR-070
  - ADR-074
  - ADR-071
  - ADR-077
  - ADR-079
  - ADR-080
---

> **BORRADOR LEGAL.** No se publica en la app mientras `lawyer_review` no tenga la fecha de
> revisión del abogado. Ver `docs/legal/README.md`.

# Aviso de Privacidad de Booster AI — versión 2

Este aviso explica qué datos personales trata Booster, para qué, con qué base legal, por cuánto tiempo, con quién los comparte y cómo puede ejercer sus derechos. Está redactado conforme a la Ley 19.628 sobre protección de la vida privada y a la Ley 21.719, que regula la protección y el tratamiento de los datos personales y entra en vigencia el 1 de diciembre de 2026.

La versión 1 (`aviso-privacidad-corto-v1.md`) era solo el texto corto del registro. Esta versión es el aviso completo, con un inventario de datos levantado del sistema real (sección 4). El texto corto para pantallas de registro está al final (sección 13).

> [PENDIENTE ABOGADO: revisar el aviso completo contra el texto final de la Ley 21.719 y la
> normativa que dicte la Agencia de Protección de Datos Personales. Este borrador cita la ley de
> forma genérica; no se citan artículos.]

## 1. Responsable del tratamiento

| Campo | Información |
|---|---|
| Responsable | Booster Chile SpA, RUT [RUT] |
| Domicilio | [DIRECCIÓN, COMUNA, CIUDAD] |
| Plataforma | Booster AI (`app.boosterchile.com`) y su canal de WhatsApp |
| Contacto para privacidad | [CORREO DE PRIVACIDAD]; mientras no exista, [soporte@boosterchile.com](mailto:soporte@boosterchile.com) |
| Delegado de protección de datos | [NOMBRE, si se designa] |

> [PENDIENTE ABOGADO: definir si Booster designa delegado de protección de datos y crear un
> correo dedicado de privacidad. Hoy el único canal de soporte en el repo es
> soporte@boosterchile.com.]

## 2. A quién se aplica

- **Usuarios de empresas generadoras de carga**: dueños, administradores, despachadores y visualizadores.
- **Usuarios de empresas transportistas**: dueños, administradores y despachadores.
- **Conductores** de los transportistas.
- **Responsables de sostenibilidad** y usuarios de organizaciones interesadas (stakeholders) con acceso a reportes agregados.
- **Personas que solicitan acceso** a la Plataforma antes de tener cuenta.
- **Destinatarios de un enlace de seguimiento** compartido por un generador.

Cuando la empresa es una persona jurídica, sus datos no son datos personales; sí lo son los de sus representantes, contactos, usuarios y conductores.

## 3. Principios

Booster trata los datos solo para las finalidades declaradas (finalidad), solo los necesarios (minimización), por el tiempo necesario (limitación del plazo), con medidas de seguridad apropiadas (seguridad) y de forma transparente. No vende datos personales.

## 4. Datos que tratamos

El inventario se levantó del esquema de base de datos de la Plataforma (`apps/api/src/db/schema.ts`), de la infraestructura (`infrastructure/`) y de los servicios que la componen, a octubre de 2026.

| Categoría | Datos | De quién | Origen |
|---|---|---|---|
| Identificación y contacto | Nombre completo, correo, teléfono, número de WhatsApp, RUT | Todos los usuarios | El usuario o su empresa |
| Credenciales | Clave numérica y códigos de activación y recuperación, guardados solo como *hash* (nunca en texto legible); identificador de la cuenta de autenticación | Todos los usuarios | El usuario |
| Empresa | Razón social, RUT, domicilio, correo y teléfono de contacto | Representantes y contactos | La empresa |
| Datos profesionales del conductor | Clase, número y vencimiento de la licencia; condición de extranjero (para restricciones de acceso a puertos y plantas); documentos del conductor (licencia, antecedentes, psicotécnico y otros que el transportista suba) | Conductores | El transportista |
| Ubicación del teléfono del conductor | Latitud, longitud, precisión, velocidad y rumbo, cada pocos segundos mientras hay un viaje activo y el vehículo no tiene dispositivo de telemetría | Conductores | Teléfono del conductor, con su permiso |
| Telemetría del vehículo | Posición GPS, velocidad, altitud, rumbo, satélites, IMEI del dispositivo, datos del bus CAN (consumo, odómetro y otros) y eventos del equipo | Vehículos (dato personal en cuanto se vincula al conductor del viaje) | Dispositivo Teltonika instalado en el vehículo |
| Eventos de conducción | Frenadas y aceleraciones bruscas, giros, excesos de velocidad, con su ubicación; puntaje de conducción del viaje; recomendaciones de conducción generadas automáticamente | Conductores | Telemetría del vehículo |
| Registro de accidentes | Traza forense del dispositivo ante un evento de choque | Conductores y vehículos | Dispositivo Teltonika |
| Viaje | Origen, destino, fechas, carga, vehículo, conductor asignado, eventos del viaje, evidencia de entrega | Usuarios y conductores | Las partes del viaje |
| Mensajería | Mensajes de chat del viaje (texto, fotos, ubicación compartida) y conversaciones con el bot de WhatsApp | Usuarios y conductores | El usuario |
| Documentos tributarios de terceros | Guías de despacho y facturas subidas a la Plataforma, que pueden contener nombres y RUT de personas naturales | Partes del viaje y terceros mencionados | Las partes |
| Datos comerciales y de pago | Liquidaciones, facturas de Booster, datos bancarios del transportista para coordinar pagos | Representantes y transportistas | La empresa |
| Evaluación crediticia | Puntaje de riesgo del generador y su decisión de crédito, solo si se activa el pronto pago | Generador (y sus representantes, si es persona natural) | Proveedor de información comercial |
| Consentimientos | Finalidades autorizadas, versión del aviso, fecha y hora, dirección IP y agente de usuario del otorgamiento, revocación | Todos los titulares | Registro de la Plataforma |
| Datos técnicos | Dirección IP, agente de usuario, suscripciones de notificaciones *push*, registros de errores y de acceso | Todos los usuarios | Navegador y servidores |
| Auditoría | Registro de accesos de organizaciones stakeholder y de sesiones de soporte de Booster (impersonación auditada) | Usuarios afectados y personal de Booster | Plataforma |

**Datos sensibles.** Booster no busca tratar datos sensibles. Algunos documentos que el transportista sube del conductor (por ejemplo, certificado de antecedentes o examen psicotécnico) pueden contenerlos.

> [PENDIENTE ABOGADO: determinar si los documentos del conductor (antecedentes, psicotécnico) y
> los datos de geolocalización permanente durante la jornada califican como datos sensibles o de
> especial protección bajo la Ley 21.719, y si exigen consentimiento expreso separado.]

## 5. Finalidades y bases de licitud

| Finalidad | Datos | Base de licitud |
|---|---|---|
| Crear y administrar cuentas, autenticar y recuperar acceso | Identificación, credenciales, contacto | Ejecución del contrato |
| Operar el mercado: publicar, asignar, ejecutar y cerrar viajes | Viaje, identificación, datos profesionales del conductor | Ejecución del contrato |
| Seguimiento del viaje en tiempo real por las partes | Ubicación del conductor, telemetría | Ejecución del contrato; consentimiento del conductor para la ubicación del teléfono |
| Seguridad del viaje y respuesta a accidentes | Telemetría, eventos de conducción, traza de accidentes | Interés legítimo; ejecución del contrato |
| Puntaje y recomendaciones de conducción | Eventos de conducción | Interés legítimo del transportista y de Booster |
| Estimar y certificar huella de carbono | Telemetría, viaje, vehículo | Ejecución del contrato (cuando la empresa activó la medición); consentimiento para reportes a terceros |
| Reportes ESG agregados a organizaciones stakeholder | Datos de viajes agregados y anonimizados | Consentimiento de la empresa; anonimización |
| Repositorio documental y cierre de órdenes | Documentos tributarios de terceros | Ejecución del contrato; cumplimiento de obligación legal de las partes |
| Facturación, cobro y, si se activa, mandato de cobro y pronto pago | Datos comerciales y de pago, evaluación crediticia | Ejecución del contrato; interés legítimo en la evaluación de riesgo |
| Comunicaciones operativas (WhatsApp, SMS, correo, notificaciones *push*) | Contacto | Ejecución del contrato |
| Seguridad de la Plataforma, prevención de fraude y diagnóstico de errores | Datos técnicos, auditoría | Interés legítimo |
| Cumplimiento de obligaciones legales y requerimientos de autoridad | Los que la autoridad requiera | Obligación legal |

> [PENDIENTE ABOGADO: validar cada base de licitud, en especial el interés legítimo para el
> puntaje de conducción y la telemetría, y si la ubicación del teléfono del conductor debe
> basarse en consentimiento o en la ejecución del contrato entre transportista y conductor.]

## 6. Decisiones automatizadas e inteligencia artificial

La Plataforma usa procesos automatizados en tres casos:

1. **Asignación de cargas**: un algoritmo ordena a los transportistas candidatos para cada solicitud según capacidad, cercanía y otros factores técnicos. La aceptación final es siempre del transportista.
2. **Puntaje de conducción**: se calcula a partir de los eventos de conducción del viaje.
3. **Recomendaciones de conducción**: un modelo de lenguaje (Gemini, en Google Vertex AI) redacta recomendaciones a partir de los eventos de conducción del viaje.

Ninguno de estos procesos, por sí solo, produce efectos jurídicos sobre el titular. El titular puede pedir información sobre la lógica aplicada, pedir revisión humana y oponerse, por el canal de la sección 10.

> [PENDIENTE ABOGADO: confirmar que el puntaje de conducción no se usa para decisiones con efectos
> significativos sobre el conductor (por ejemplo, por el transportista para sanciones) o, si se
> usa, qué garantías ofrecer.]

## 7. Con quién compartimos datos

### 7.1. Otras partes del viaje

- **El generador** ve, para sus viajes, el nombre del conductor, la patente del vehículo, la ubicación en tiempo real durante el viaje y la evidencia de entrega.
- **El transportista** ve los datos de contacto del generador necesarios para ejecutar el viaje.
- **El enlace de seguimiento** que el generador comparte muestra la ubicación del viaje a quien lo tenga. El enlace caduca 7 días después de terminado el viaje y, en cualquier caso, 30 días después de aceptada la carga.

### 7.2. Encargados de tratamiento (proveedores que tratan datos por cuenta de Booster)

| Proveedor | Servicio | Datos | Ubicación |
|---|---|---|---|
| Google Cloud | Infraestructura: servidores (Cloud Run, GKE), base de datos (Cloud SQL), archivos (Cloud Storage), analítica (BigQuery), mensajería interna (Pub/Sub), claves (KMS, Secret Manager), registros | Todos | Región principal `southamerica-west1` (Santiago, Chile) |
| Google Firebase / Identity Platform | Autenticación de usuarios | Identificación, credenciales | [PENDIENTE: verificar ubicación del servicio] |
| Google Vertex AI (Gemini) | Redacción de recomendaciones de conducción | Eventos de conducción del viaje | `southamerica-east1` (São Paulo, Brasil) |
| Google Maps Platform | Rutas, distancias y mapas | Origen, destino, posiciones | Servicio global de Google |
| Twilio | Mensajes de WhatsApp y SMS | Teléfono, contenido de mensajes | Estados Unidos |
| Sentry | Registro de errores de la aplicación web, con filtrado de datos personales por lista permitida (ADR-074) | Datos técnicos mínimos | Estados Unidos |
| Datadog | Registros de infraestructura del receptor de telemetría (ADR-071) | Datos técnicos, IMEI | [PENDIENTE: verificar región de la cuenta] |
| Resend | Envío de correos transaccionales, cuando esté activo | Correo, nombre | [PENDIENTE: verificar] |
| Proveedor de información comercial | Evaluación crediticia del generador, solo si se activa el pronto pago | RUT del generador | [PENDIENTE] |
| Operador financiero | Anticipo al transportista, solo bajo mandato de cobro y con adendum aceptado | RUT, datos bancarios, montos | [PENDIENTE] |

> [PENDIENTE ABOGADO: confirmar que existe contrato de encargo de tratamiento (DPA) con cada
> proveedor, la ubicación real de Firebase, Datadog y Resend, y la lista definitiva. Los datos de
> ubicación anteriores salen de la configuración del repo (`infrastructure/variables.tf`,
> `apps/api/src/services/gemini-client.ts`, ADR-074) y no de los contratos.]

### 7.3. Autoridades

Booster entrega datos a tribunales y autoridades cuando la ley lo exige.

### 7.4. Organizaciones stakeholder

Las organizaciones con acceso a reportes ESG (por ejemplo, municipios u observatorios) reciben solo datos agregados, con un mínimo de vehículos por grupo para impedir la identificación, y cada acceso queda registrado.

## 8. Transferencias internacionales

Parte del tratamiento ocurre fuera de Chile: recomendaciones de conducción (Brasil), mensajería (Estados Unidos), registro de errores (Estados Unidos) y los servicios globales de Google. Booster exige a esos proveedores garantías contractuales de protección equivalentes.

> [PENDIENTE ABOGADO: definir el mecanismo de transferencia internacional bajo la Ley 21.719
> (país adecuado, cláusulas contractuales u otro) para cada destino, y si se mantiene la casilla
> de consentimiento separada para transferencias que tenía el aviso v1.]

## 9. Plazos de conservación

Los plazos de esta tabla son los que el sistema aplica hoy (código e infraestructura del repo) o los que fijan los ADR vigentes. Donde no hay plazo definido, se indica.

| Dato | Plazo | Fuente |
|---|---|---|
| Ubicación del teléfono del conductor | 30 días; un proceso diario borra lo anterior y conserva solo la última posición de cada vehículo | `apps/api/src/services/purgar-posiciones-movil.ts` |
| Documentos tributarios de terceros | 6 años desde la fecha de emisión (o desde la carga, si no hay fecha); no se borran antes | ADR-070 §3 |
| Traza forense de accidentes | 7 años | `infrastructure/crash-traces.tf` |
| Fotos del chat | 90 días | `infrastructure/compute.tf` (ciclo de vida del bucket) |
| Archivos subidos sin procesar | 90 días | `infrastructure/storage.tf` |
| Código de recuperación de clave | 10 minutos, de un solo uso | ADR-035 |
| Código de activación del conductor | Se borra al activar la cuenta | `apps/api/src/db/schema.ts` |
| Enlace de seguimiento público | 7 días tras terminar el viaje, máximo 30 días | `apps/api/src/services/get-public-tracking.ts` |
| Respaldos de la base de datos | 30 días, más 7 días de registro de transacciones para recuperación a un punto en el tiempo | `infrastructure/variables.tf`, `infrastructure/data.tf` |
| Registro de accesos de stakeholders | Se conserva; los identificadores pueden anonimizarse a los 5 años | `apps/api/src/db/schema.ts` (definición pendiente) |
| Evidencia de consentimientos | Mientras dure el tratamiento y luego el plazo de prescripción de las acciones | ADR-068 |
| Telemetría de vehículos y eventos de conducción | **Sin plazo definido** | [PENDIENTE] |
| Mensajes de texto del chat y conversaciones del bot | **Sin plazo definido** | [PENDIENTE] |
| Certificados de huella | **Sin plazo definido** (no se borran) | [PENDIENTE] |
| Datos de cuenta tras la baja | **Sin plazo definido** | [PENDIENTE] |
| Registros de servidores | Plazo por defecto del proveedor; no fijado en el repo | [PENDIENTE] |

> [PENDIENTE ABOGADO: fijar plazos para todo lo marcado «sin plazo definido». Cada plazo nuevo es
> además trabajo de código (un proceso de borrado o anonimización), que no existe hoy.]

## 10. Derechos del titular

El titular puede ejercer, sin costo, los derechos de **acceso, rectificación, supresión, oposición, portabilidad y bloqueo**, y **revocar** su consentimiento cuando el tratamiento se base en él. También puede pedir información sobre las decisiones automatizadas de la sección 6.

**Cómo ejercerlos**: escribiendo a [CORREO DE PRIVACIDAD] (mientras no exista, a soporte@boosterchile.com) desde el correo registrado en la cuenta, o por el formulario que Booster habilite. Booster puede pedir antecedentes para verificar la identidad. Los consentimientos otorgados en la Plataforma se pueden revocar también desde la propia Plataforma.

**Plazo de respuesta**: el que fije la ley.

**Reclamo**: si el titular estima que sus derechos no fueron respetados, puede reclamar ante la Agencia de Protección de Datos Personales, una vez que esté en funciones.

**Límites**: la supresión no procede respecto de datos que Booster deba conservar por obligación legal o para la defensa de derechos, como los documentos tributarios durante su plazo de custodia (sección 9).

> [PENDIENTE ABOGADO: plazo legal de respuesta, procedimiento de verificación de identidad y
> formulario. Hoy no existe un flujo en la Plataforma para acceso, portabilidad ni supresión:
> se atiende manualmente.]

## 11. Seguridad

Booster aplica, entre otras, estas medidas: cifrado en tránsito; cifrado en reposo, con claves administradas para documentos y trazas de accidentes; credenciales guardadas solo como *hash*; acceso a la base de datos solo por red privada; separación de datos por empresa; registros sin datos personales (filtrado en el registro de servidores y en el de errores web); y firma digital de certificados con claves custodiadas en un servicio de gestión de claves.

Ante una vulneración de seguridad que afecte datos personales, Booster notificará a la autoridad y a los titulares en los casos y plazos que exija la ley.

> [PENDIENTE ABOGADO: procedimiento y plazos de notificación de vulneraciones bajo la Ley 21.719.]

## 12. Cambios a este aviso

Cada cambio relevante genera una versión nueva con su número. Si cambian las finalidades que se basan en el consentimiento, Booster lo informará y pedirá un consentimiento nuevo cuando corresponda. La versión que aceptó cada titular queda registrada.

## 13. Texto corto para el registro

Este texto reemplaza al de `aviso-privacidad-corto-v1.md`.

> **Tu privacidad en Booster**
>
> Booster Chile SpA (RUT [RUT]) trata tus datos para darte acceso a la plataforma, operar los viajes de carga en que participas, seguirlos en tiempo real, estimar su huella de carbono y cumplir la ley. Si eres conductor, usamos la ubicación de tu teléfono durante los viajes cuando el camión no tiene dispositivo GPS, y la borramos a los 30 días. Usamos inteligencia artificial para sugerir recomendaciones de conducción. Algunos proveedores están fuera de Chile. No vendemos tus datos.
>
> Puedes pedir acceso, rectificación, supresión, oposición, portabilidad o bloqueo, y revocar tu consentimiento, escribiendo a [CORREO DE PRIVACIDAD].
>
> [Lee el aviso completo]([URL])

Las casillas de aceptación y las finalidades opcionales están en `consentimientos-v2.md`.
