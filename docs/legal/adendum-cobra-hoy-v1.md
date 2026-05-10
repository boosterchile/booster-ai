# Adendum — Booster Cobra Hoy (Pronto Pago al Transportista) — v1

**Versión**: 1.0
**Vigente desde**: 2026-05-10
**Última actualización**: 2026-05-10
**Documento marco**: [Términos de Servicio v2](./terminos-de-servicio-v2.md) §4.3

> Este Adendum integra y desarrolla la cláusula 4.3 ("módulo pronto pago
> opcional") de los Términos de Servicio v2. La aceptación del Adendum es
> requisito previo para usar la funcionalidad **"Cobra hoy"** desde la
> plataforma Booster.

---

## 1. Naturaleza del servicio

Booster ofrece a los Transportistas, en forma opcional, la posibilidad
de **anticipar el cobro del monto neto de un viaje entregado** sin
esperar el plazo natural de pago del Generador de carga (en adelante,
el **"Shipper"**).

A esta funcionalidad se le denomina **"Booster Cobra Hoy"** o
**"pronto pago"** indistintamente.

El servicio se opera bajo un esquema **partner-mode**: Booster facilita
la solicitud, realiza el underwriting del Shipper y registra el adelanto
en la plataforma. **El dinero adelantado proviene de un partner
financiero externo regulado** (en adelante, el **"Partner"**) que, en
su carácter de cesionario, asume el riesgo de crédito frente al Shipper.

Booster **no es** una institución financiera, no opera con dineros del
público y no requiere registro CMF mientras se mantenga en partner-mode
(Resolución CMF N°449 y normativa concordante).

## 2. Quién puede solicitar pronto pago

Cualquier Transportista activo en la plataforma Booster que cumpla
simultáneamente:

1. Haber aceptado los Términos de Servicio v2 y el presente Adendum.
2. Tener al menos un viaje **entregado** con liquidación calculada.
3. Operar con un Shipper cuyo crédito haya sido **aprobado** por
   Booster + Partner según los criterios descritos en §4.

La solicitud se realiza desde la pantalla del viaje
(`/app/asignaciones/:id`) o desde el historial dedicado
(`/app/cobra-hoy/historial`).

## 3. Cómo se calcula la tarifa

La tarifa de pronto pago se aplica sobre el **monto neto del viaje**
(monto bruto descontada la comisión Booster + IVA correspondiente),
en función del **plazo declarado del Shipper** según la siguiente
tabla oficial:

| Plazo Shipper | Tarifa |
|---|---|
| 30 días | 1,50% |
| 45 días | 2,20% |
| 60 días | 3,00% |
| 90 días | 4,50% |

Para plazos intermedios se aplica **interpolación lineal** entre los
puntos contiguos de la tabla.

Para plazos superiores a 90 días se aplica un **techo dinámico**:

```
techo(plazo) = 4,5% + 0,5% × ceil((plazo − 90) / 15)
```

con un **máximo absoluto de 8,0%** independientemente del plazo.

El redondeo es a **enteros CLP** mediante regla HALF_UP. La metodología
de cálculo se versiona como `factoring-v1.0-cl-2026.06` y queda
**congelada** en cada solicitud aceptada — futuras revisiones de la
tarifa no se aplican retroactivamente.

### Ejemplo

Viaje entregado, monto neto del Transportista = $176.000, plazo
Shipper = 30 días:

- Tarifa: 1,50% × $176.000 = **$2.640**
- **Monto adelantado: $173.360**
- Plazo del Shipper: 30 días corridos desde la liquidación.

## 4. Criterios de elegibilidad del Shipper (underwriting)

Para que un viaje sea elegible, el Shipper que lo originó debe contar
con una **decisión de crédito vigente y aprobada**. La decisión se
evalúa con base en:

1. **Score Equifax CL** del RUT del Shipper (escala 0–1000):
   - ≥ 700 → aprobado con **límite estándar**.
   - 550–699 → aprobado con **límite reducido**.
   - < 550 → **rechazado**.
2. **Antigüedad operativa** mínima de 24 meses en plataforma o
   acreditable documentalmente.
3. **Cuentas impagas** o protestos: cualquier registro vigente
   resulta en rechazo.
4. **Concentración de exposición**: la suma de adelantos vivos del
   mismo Shipper no puede superar su límite asignado.
5. **Vigencia de la decisión**: 90 días corridos. Pasado ese plazo
   se re-evalúa.

Si el Shipper no tiene decisión vigente y no es posible obtener score
automáticamente, la solicitud queda en estado **manual_requerido**.
Booster decidirá manualmente en máximo 2 días hábiles.

## 5. Flujo operativo

1. El Transportista hace click en **"Cobra hoy"** desde la pantalla
   del viaje entregado.
2. La plataforma muestra el **desglose en tiempo real** (monto neto,
   tarifa, monto a recibir, plazo del Shipper).
3. El Transportista confirma. La solicitud queda en estado
   `solicitado`.
4. El Partner valida y, si procede, transfiere el monto adelantado
   a la cuenta bancaria registrada del Transportista (estado
   `desembolsado`).
5. Booster cobra al Shipper en su fecha natural de pago (estado
   `cobrado_a_shipper`). El Transportista **no participa** del cobro
   al Shipper en este flujo.

Cada estado queda registrado con marca temporal en el historial
del Transportista (`/app/cobra-hoy/historial`).

## 6. Cesión de derechos

Al confirmar la solicitud de pronto pago, el Transportista **cede al
Partner** los derechos de cobro sobre el monto neto del viaje
correspondiente, en los términos del Art. 1901 y siguientes del Código
Civil chileno. Booster actúa como intermediario tecnológico y
documental de la cesión.

La cesión es:

- **Limitada al viaje específico** identificado por su `asignacion_id`.
- **A título oneroso** (el Transportista recibe el monto adelantado).
- **Sin recurso** contra el Transportista en condiciones normales:
  si el Shipper no paga al Partner en el plazo, el riesgo es del
  Partner — salvo en los supuestos del §7.

## 7. Excepciones (con recurso contra el Transportista)

El adelanto pasa a tener **recurso contra el Transportista** y
Booster/Partner pueden exigir devolución del monto si:

1. El viaje resulta **cancelado o no entregado** después del desembolso
   por causa imputable al Transportista.
2. Se acreditan **fraude, falsedad u omisiones materiales** del
   Transportista al solicitar el adelanto.
3. Existe **disputa válida del Shipper** sobre la entrega (ej. carga
   no recibida, mercadería dañada, evidencia POD inválida) que el
   Transportista no resuelve dentro de los 30 días corridos.

En estos casos, Booster bloqueará nuevas solicitudes hasta regularizar
la situación.

## 8. Tratamiento tributario

- El **monto adelantado** no constituye un ingreso adicional para el
  Transportista — sustituye temporalmente al pago del Shipper.
- La **tarifa de pronto pago** es una operación financiera
  **exenta de IVA** conforme al Art. 12-E DL 825 (operaciones de
  financiamiento de créditos).
- El Partner emite el certificado tributario correspondiente
  (factura exenta o documento equivalente). Booster lo pone a
  disposición del Transportista en su historial.
- La comisión Booster sobre el viaje (DTE Tipo 33, comisión + IVA)
  se mantiene **inalterada** y se factura por el flujo regular.

## 9. Privacidad y datos

Para evaluar la elegibilidad del Shipper, Booster consulta el score
Equifax CL de su RUT bajo el marco regulatorio chileno (Ley 19.628
y Ley 19.812). El Transportista solicitante no accede a estos datos —
sólo conoce el resultado agregado (aprobado / rechazado).

Para el desembolso, Booster comparte con el Partner los datos
estrictamente necesarios: RUT del Transportista, datos bancarios
registrados, monto neto del viaje, plazo del Shipper. El Partner
asume obligaciones de confidencialidad equivalentes a las de Booster.

## 10. Comunicación y soporte

Cualquier consulta o disputa sobre una solicitud específica puede
canalizarse a **soporte@boosterchile.com**. Booster responde en
máximo 1 día hábil para solicitudes activas (`solicitado`,
`aprobado`) y 3 días hábiles para histórico ya `desembolsado`.

## 11. Modificaciones

Booster puede modificar la tabla de tarifas, los umbrales de
underwriting o la mecánica operativa de este Adendum. Cambios
**adversos** al Transportista se comunican con **30 días de
anticipación** vía email + banner persistente. Cambios neutros o
favorables entran en vigor al publicarse.

La metodología versionada (`factoring-v1.0-cl-2026.06`) capturada al
momento de cada solicitud **no varía retroactivamente**.

## 12. Suspensión y término

Booster puede suspender el acceso al pronto pago para un Transportista
específico cuando:

- Acumule >2 incidentes de los supuestos del §7 en 90 días.
- Su Shipper habitual pase a estado **rechazado** en underwriting.
- Exista investigación judicial o regulatoria que comprometa el
  flujo.

La suspensión del módulo no afecta el resto de la plataforma Booster.

---

**Aceptación**

Al hacer click en **"Confirmar y recibir hoy"** desde la pantalla del
viaje, el Transportista manifiesta voluntad expresa de quedar
vinculado por este Adendum para esa solicitud específica. La primera
aceptación queda registrada en la cuenta del Transportista con marca
temporal, IP y agente de usuario.
