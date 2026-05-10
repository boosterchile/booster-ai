# Términos de Servicio Booster AI — v2

**Versión**: 2.0
**Vigente desde**: 2026-05-10
**Última actualización**: 2026-05-10

> Estos Términos reemplazan cualquier versión anterior. El uso continuado
> de Booster AI tras la aceptación de esta versión implica la aceptación
> íntegra del documento.

---

## 1. Quiénes somos

Booster AI (en adelante, **"Booster"**) es operado por Booster Chile SpA,
RUT XX.XXX.XXX-X, con domicilio en [dirección Chile]. Cualquier
comunicación legal o consulta sobre estos Términos puede dirigirse a
[soporte@boosterchile.com](mailto:soporte@boosterchile.com).

Booster opera un marketplace digital B2B que conecta:

- **Generadores de carga** (en adelante, **"Generadores"**): empresas con
  necesidad de transportar mercaderías en territorio chileno.
- **Transportistas** (en adelante, **"Transportistas"**): empresas con
  flota propia y conductores que ejecutan los viajes.

Estos Términos aplican principalmente a los **Transportistas** que
acepten ofertas y reciban remuneración a través de la plataforma. Los
términos para Generadores se rigen por un acuerdo separado.

## 2. Aceptación

Al hacer click en "Acepto los Términos de Servicio v2" desde
[app.boosterchile.com](https://app.boosterchile.com), el Transportista
declara haber leído, comprendido y aceptado este documento en su
integridad. La aceptación se registra técnicamente con marca temporal,
dirección IP y agente de usuario para fines de auditoría.

El Transportista declara estar facultado legalmente para vincular a su
empresa (cargo de representante legal, dueño, administrador o
mandatario expreso). Booster puede solicitar validación adicional de
dicha facultad cuando el monto operado lo justifique.

## 3. Operación del marketplace

### 3.1 Cómo funciona

1. El Generador publica una solicitud de transporte con precio sugerido
   en pesos chilenos (CLP).
2. El algoritmo de matching de Booster (descrito en términos técnicos en
   nuestra documentación pública) selecciona Transportistas candidatos.
3. El Transportista recibe ofertas y puede aceptarlas o rechazarlas.
4. La aceptación genera un compromiso vinculante de transporte por el
   monto acordado (`agreedPriceClp`).
5. El Transportista ejecuta el viaje, registra recogida y entrega.
6. Booster persiste evidencia, telemetría (si el vehículo tiene
   Teltonika) y certifica la huella de carbono del viaje.

### 3.2 Tier de membresía

Cada Transportista pertenece a un **tier** que determina:

- **Comisión** que Booster cobra sobre el monto bruto del viaje.
- **Fee mensual** de membresía (si aplica).
- **Beneficios** adicionales (prioridad de matching, dispositivo
  Teltonika subsidiado, etc.).

| Tier | Fee mensual | Comisión | Beneficios principales |
|---|---|---|---|
| Free | $0 | 12% | Acceso al marketplace, certificación ESG |
| Standard | $15.000 | 9% | Badge verificado, soporte humano |
| Pro | $45.000 | 7% | Prioridad alta, dashboards, integración contable |
| Premium | $120.000 | 5% | Teltonika incluido, prioridad máxima |

Al registrarte como Transportista entras automáticamente al tier
**Free**. El upgrade o downgrade se gestiona desde tu perfil. Los
fees mensuales se facturan el primer día hábil de cada mes con
vencimiento a 14 días.

## 4. Modelo de cobro

### 4.1 Comisión sobre viajes ("liquidación")

Cuando un viaje queda **entregado** (estado `entregado` en la
plataforma), Booster calcula automáticamente:

```
comisión        = monto_bruto × comisión_pct_tier
IVA comisión    = comisión × 19%
factura Booster = comisión + IVA
neto carrier    = monto_bruto − comisión
```

**Ejemplo**: viaje de $200.000 con tier Free (12%):

- Monto bruto: $200.000
- Comisión Booster: $24.000
- IVA: $4.560
- **Factura Booster al carrier**: $28.560 (DTE Tipo 33)
- **Neto al carrier**: $176.000 (lo que paga el Generador)

### 4.2 Emisión de documentos tributarios (DTE)

- **Booster emite DTE Tipo 33 (Factura Electrónica)** al Transportista
  por el monto `factura Booster` (comisión + IVA). Esta es la
  contraprestación por el servicio de marketplace y telemetría.
- **El Transportista emite DTE Tipo 52 (Guía de Despacho electrónica)**
  al Generador por el monto bruto, en tanto persona obligada a la
  facturación del servicio de transporte. Booster puede emitir el
  Tipo 52 "en nombre de" el Transportista, previo mandato expreso y
  certificado digital cargado, conforme a las normas del Servicio de
  Impuestos Internos (SII).

### 4.3 Flujo de dinero

El pago del monto bruto del viaje fluye **directamente del Generador al
Transportista** (mecanismo: transferencia bancaria coordinada
externamente, o pago intermediado por Booster cuando se active el
módulo "pronto pago" — opcional).

Booster cobra su comisión **al Transportista** vía la factura Tipo 33
emitida, con vencimiento a 30 días corridos desde la emisión.

### 4.4 Versión de la metodología de cálculo

Cada liquidación captura el `pricing_methodology_version` vigente al
momento del cierre del viaje (por ejemplo, `pricing-v2.0-cl-2026.06`).
Los cambios futuros a tasas de comisión, IVA o reglas de redondeo
**no se aplican retroactivamente** a liquidaciones ya emitidas.

## 5. Obligaciones del Transportista

El Transportista se compromete a:

1. **Ejecutar los viajes aceptados** con sus propios vehículos,
   conductores con licencia vigente, seguros al día y permisos
   correspondientes (carga peligrosa, internacional, etc. cuando aplique).
2. **Mantener al día su información tributaria** (RUT vigente, dirección
   actualizada, datos bancarios para coordinación de pagos).
3. **Reportar incidentes** (atrasos, accidentes, daños, robos) a la
   brevedad por los canales oficiales (in-app o
   soporte@boosterchile.com).
4. **No utilizar la plataforma para evadir** obligaciones laborales con
   sus conductores. Booster no actúa como empleador del personal del
   Transportista bajo ninguna circunstancia.
5. **Permitir telemetría** (cuando aplique al tier Premium con dispositivo
   subsidiado) durante la vigencia del beneficio.
6. **Aceptar el cargo de la comisión** dentro de los plazos de la DTE
   emitida. Mora en el pago puede resultar en suspensión del acceso al
   marketplace.

## 6. Obligaciones de Booster

Booster se compromete a:

1. **Mantener disponible** la plataforma con un SLA objetivo del 99% de
   uptime mensual (excluyendo mantenimientos comunicados con 24h de
   anticipación).
2. **Procesar liquidaciones** con la metodología publicada,
   auditablemente y sin alteración retroactiva.
3. **Emitir DTE Tipo 33** con la oportunidad y formato que exige el SII
   chileno, vía proveedor certificado (Sovos u otro de capacidad
   equivalente). Los plazos de emisión pueden tener desfase justificado
   por integración con el SII; en ningún caso supera 60 días desde la
   entrega del viaje.
4. **Proteger datos personales** del Transportista, sus conductores y
   contactos conforme a la Ley 19.628 y normas posteriores. Detalles en
   la Política de Privacidad publicada.
5. **Comunicar cambios materiales** a estos Términos con al menos 30
   días de anticipación cuando el cambio afecte adversamente al
   Transportista (subida de comisión, eliminación de beneficios, etc.).

## 7. Disputas, contracargos y cancelaciones

### 7.1 Disputa de liquidación

Si el Transportista considera que una liquidación tiene errores
(monto, comisión aplicada, tier incorrecto), puede abrirla en disputa
desde la plataforma o vía soporte@boosterchile.com dentro de los **30
días corridos** desde la emisión. Booster revisa en máximo 10 días
hábiles. Resolución posible:

- **Procedente**: Booster anula el DTE original y emite uno nuevo
  corregido (sin costo para el Transportista).
- **Improcedente**: Booster mantiene el monto. El Transportista mantiene
  el derecho de escalar a SERNAC o tribunales civiles según corresponda.

### 7.2 Cancelación de viajes

El comportamiento de cancelaciones (penalty, reembolso, indemnización)
se rige por las reglas operativas vigentes al momento del incidente.
Estas reglas se mantienen públicas y separadas de este documento por
ser de mayor frecuencia de actualización.

### 7.3 Suspensión

Booster puede **suspender** la cuenta del Transportista cuando:

- Acumule 30+ días de mora en facturas de comisión.
- Reciba múltiples reportes verificados de mala praxis (cargas no
  entregadas, daños sistemáticos, comportamiento abusivo).
- Incumpla obligaciones tributarias verificables (RUT inhabilitado).
- Esté involucrado en investigación judicial que comprometa la
  reputación del marketplace.

La suspensión es notificada con 48h de anticipación cuando es por mora
o inactividad. Es inmediata cuando es por fraude o riesgo material a
otros usuarios.

## 8. Datos personales y privacidad

El procesamiento de datos personales se rige por la **Política de
Privacidad** vigente. Resumen de los puntos críticos para este contrato:

- Booster recolecta datos del Transportista (RUT, datos de contacto),
  sus conductores (nombre, licencia) y de los viajes (ubicación GPS si
  hay telemetría, evidencia fotográfica).
- Los datos se procesan en Chile y en regiones GCP autorizadas.
- Booster **no vende** datos a terceros. Comparte datos con:
  - Proveedores tecnológicos esenciales (Google Cloud, Twilio, Sovos)
    bajo acuerdos de confidencialidad.
  - Autoridades cuando es legalmente requerido.
  - Generadores **estrictamente** los datos necesarios para la
    ejecución del viaje aceptado (placa, contacto del conductor durante
    el viaje, ubicación en tiempo real).

## 9. Propiedad intelectual

- La plataforma, marcas, logos y código de Booster son propiedad de
  Booster Chile SpA. El Transportista recibe una licencia limitada,
  revocable y no exclusiva para usar la plataforma según estos
  Términos.
- Los datos generados por el Transportista (descripciones de carga,
  fotos de evidencia, etc.) **permanecen propiedad del Transportista**.
  Booster recibe licencia para usarlos exclusivamente para operar la
  plataforma, generar certificados ESG y reportes anonimizados.

## 10. Modificaciones

Booster puede modificar estos Términos. Las modificaciones se notifican:

- **Materiales y adversas** al Transportista: con 30 días de
  anticipación, vía email y banner persistente en la app. El
  Transportista puede dar de baja su cuenta sin penalidad antes de que
  entren en vigor.
- **No materiales** (correcciones, aclaraciones, modificaciones que
  benefician al Transportista): se publican y entran en vigor
  inmediatamente.

El uso continuado tras la entrada en vigor implica aceptación.

## 11. Ley aplicable y jurisdicción

Estos Términos se rigen por las leyes de la República de Chile.
Cualquier disputa que no pueda resolverse amistosamente se somete a la
jurisdicción de los tribunales ordinarios de Santiago, salvo que las
normas de protección al consumidor exijan otra cosa.

## 12. Disposiciones finales

- **Independencia de cláusulas**: si una cláusula resulta inválida, las
  demás permanecen vigentes.
- **No renuncia**: el no ejercicio de un derecho por parte de Booster
  no implica renuncia futura.
- **Comunicaciones**: por defecto a la dirección de email registrada en
  la cuenta. El Transportista debe mantenerla actualizada.

---

**Aceptación**

Al hacer click en **"Acepto"** desde tu cuenta Booster, manifiestas
voluntad expresa de quedar vinculado a este contrato. Tu aceptación
queda registrada con marca temporal, dirección IP y agente de usuario.

Puedes descargar una copia firmada digitalmente (PDF) desde tu perfil
después de aceptar.
