---
documento: consentimientos
version: 2.0.0
slug_consentimiento: consent-v2
estado: borrador
lawyer_review: pendiente
supersede: modelo-consentimiento-esg-v1.md
refs:
  - ADR-068
  - ADR-028
  - ADR-034
  - ADR-079
  - ADR-080
---

> **BORRADOR LEGAL.** No se publica en la app mientras `lawyer_review` no tenga la fecha de
> revisión del abogado. Ver `docs/legal/README.md`.

# Consentimientos de Booster AI — versión 2

Este documento fija **qué consentimientos pide Booster, a quién, con qué texto y cómo se registran**. Complementa el *Aviso de Privacidad v2* (`aviso-privacidad-v2.md`), que explica el tratamiento completo y las bases de licitud distintas del consentimiento.

La versión 1 (`modelo-consentimiento-esg-v1.md`) era una plantilla genérica centrada en ESG. Esta versión:

1. Separa los consentimientos **de personas** (usuarios y conductores) de las **autorizaciones de empresa** para compartir datos ESG con organizaciones stakeholder.
2. Agrega el consentimiento del conductor para el uso de su RUT, licencia y ubicación, que ADR-080 §6.4 exige antes de activar el mandato de cobro.
3. Deja de pedir consentimiento para lo que se basa en la ejecución del contrato (crear la cuenta, operar el viaje): pedirlo ahí lo vuelve condición del servicio y deja de ser libre.

> [PENDIENTE ABOGADO: validar el criterio del punto 3 (qué tratamientos se basan en contrato y
> cuáles en consentimiento) contra la Ley 21.719.]

## 1. Reglas comunes

- **Acción afirmativa**: cada casilla aparece **sin marcar**. No hay consentimiento tácito ni casillas premarcadas.
- **Granularidad**: una casilla por finalidad. Las finalidades opcionales no condicionan el acceso al servicio.
- **Información previa**: cada pantalla de consentimiento enlaza el Aviso de Privacidad v2 en su versión vigente.
- **Revocación**: tan simple como el otorgamiento, desde la Plataforma o por el canal de privacidad. Opera hacia el futuro.
- **Evidencia**: cada otorgamiento y cada revocación se registran con identidad del titular, finalidad, fecha y hora, versión del documento, dirección IP y agente de usuario (ADR-068).
- **Versión**: el identificador que se guarda en `consentimientos.version_aviso` es el de la columna «Slug» de la sección 5. La columna admite hasta 20 caracteres.

## 2. Consentimientos de personas

### C-1. Aviso de privacidad (todos los usuarios, al registrarse)

> ☐ Leí el Aviso de Privacidad de Booster y entiendo cómo se tratan mis datos para usar la plataforma.

Es una constancia de información, no un consentimiento para finalidades opcionales. Es obligatoria para crear la cuenta.

> [PENDIENTE ABOGADO: confirmar si basta una constancia de lectura o si debe redactarse como
> aceptación.]

### C-2. Ubicación del teléfono durante los viajes (conductores)

> ☐ Autorizo a Booster a usar la ubicación de mi teléfono **solo mientras tengo un viaje activo** y el camión no tiene dispositivo GPS, para que las partes sigan el viaje y para estimar su huella de carbono. Sé que se borra a los 30 días y que puedo retirar esta autorización; si lo hago, el viaje se seguirá sin mi teléfono cuando sea posible.

Además del consentimiento, el teléfono pide su propio permiso de ubicación. Ambos son necesarios.

> [PENDIENTE ABOGADO: si la ubicación es indispensable para ejecutar el viaje sin dispositivo GPS,
> evaluar si la base correcta es el contrato entre transportista y conductor y no el
> consentimiento (un consentimiento que no se puede negar sin perder el trabajo no es libre).]

### C-3. Uso de RUT y licencia del conductor (conductores)

> ☐ Autorizo a Booster a tratar mi RUT, mi nombre y los datos de mi licencia de conducir que registró mi empresa, para identificarme en los viajes, verificar que mi licencia esté vigente y mostrar mi nombre al generador de carga de cada viaje que conduzca.

> [PENDIENTE ABOGADO: igual que C-2, revisar si corresponde a ejecución de contrato. ADR-080 §6.4
> pide autorización explícita del conductor; este texto la cubre.]

### C-4. Recomendaciones de conducción con inteligencia artificial (conductores, opcional)

> ☐ Autorizo a Booster a usar los eventos de conducción de mis viajes para generar recomendaciones personalizadas con inteligencia artificial. El proveedor del modelo procesa estos datos en Brasil.

### C-5. Transferencia internacional (todos, si el abogado la mantiene como consentimiento)

> ☐ Autorizo la transferencia de mis datos a proveedores de Booster fuera de Chile (Estados Unidos y Brasil), con las garantías que describe el Aviso de Privacidad.

> [PENDIENTE ABOGADO: decidir si la transferencia internacional se basa en consentimiento (C-5) o
> en garantías contractuales sin consentimiento. Si es lo segundo, C-5 se elimina.]

### C-6. Uso de mis datos en reportes ESG para terceros (usuarios, opcional)

> ☐ Autorizo que mi nombre y cargo aparezcan como contacto responsable en reportes ESG que mi empresa comparta con clientes, inversionistas o certificadores.

## 3. Autorizaciones de empresa para organizaciones stakeholder

Estas autorizaciones las otorga **la empresa** (por su dueño o administrador) y permiten que una organización stakeholder vea datos de sus viajes. Se registran en la tabla `consentimientos` con el modelo de ADR-028 y ADR-068: una fila por organización, con las categorías autorizadas, el alcance y la evidencia.

Cada categoría es una casilla separada y corresponde a un valor del enum `categoria_dato_consentimiento`:

| Casilla | Valor del enum | Qué ve la organización |
|---|---|---|
| ☐ Emisiones de carbono | `emisiones_carbono` | Emisiones estimadas de los viajes en el alcance |
| ☐ Rutas | `rutas` | Trazados de los viajes, agregados según el alcance |
| ☐ Distancias | `distancias` | Distancias recorridas |
| ☐ Combustibles | `combustibles` | Consumo y tipo de combustible |
| ☐ Certificados | `certificados` | Certificados de huella emitidos |
| ☐ Perfiles de vehículos | `perfiles_vehiculos` | Tipo, combustible y capacidad de los vehículos |

Texto de la autorización:

> En nombre de [RAZÓN SOCIAL], autorizo a [ORGANIZACIÓN] a acceder, por el período [DESDE] – [HASTA o «hasta revocación»], a los datos marcados de los viajes de mi empresa dentro del alcance [ALCANCE]. Sé que cada acceso queda registrado y que puedo revocar esta autorización en cualquier momento desde la plataforma.

Las consultas por zona (municipios, observatorios) se entregan además agregadas y con anonimización por umbral mínimo de grupo (ADR-041 y ADR-042). Hoy la Plataforma exige igualmente un consentimiento vigente para servirlas y registra cada acceso en `log_acceso_stakeholder`.

> [PENDIENTE ABOGADO: confirmar que la autorización de la empresa basta cuando los datos de rutas
> permiten inferir la ubicación de conductores identificables, o si se requiere además C-6 o un
> aviso al conductor.]

## 4. Términos y adendum

La aceptación de los *Términos y Condiciones v3* y del *Adendum de mandato de cobro v1* es contractual, no un consentimiento de datos, pero se registra con la misma evidencia (identidad, fecha y hora, versión, IP y agente de usuario).

## 5. Registro de versiones

| Documento | Slug (`version_aviso`) | Estado |
|---|---|---|
| Aviso de Privacidad v2 | `privacidad-v2` | Borrador |
| Consentimientos v2 (este documento) | `consent-v2` | Borrador |
| Términos y Condiciones v3 | `tyc-v3` | Borrador |
| Adendum de mandato de cobro v1 | `mandato-cobro-v1` | Borrador |
| Modelo de consentimiento ESG v1 | `esg-v1` | Reemplazado (se conserva para la evidencia de otorgamientos previos) |

## 6. Lo que falta en el sistema

Esto no es texto legal; es la brecha entre este documento y la Plataforma a octubre de 2026, para planificar el trabajo de código una vez revisado el texto:

- La tabla `consentimientos` modela hoy las autorizaciones de empresa a stakeholders (sección 3). No hay registro de los consentimientos personales C-1 a C-6.
- La aceptación de términos se registra hoy solo para transportistas (`carrier_memberships`, v2).
- No hay pantalla para revocar C-2 a C-6 ni para ejercer acceso, portabilidad o supresión.
