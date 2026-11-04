# Plantilla — feedback del cliente 1

**Uso**: copiar este archivo a `docs/handoff/<AAAA-MM-DD>-cliente-1.md` (fecha del cierre del primer ciclo de facturación) y completarlo. Es la evidencia de T10-30 de `.specs/trl10/spec.md`: al menos un cliente que no opera el PO, con contrato firmado, viajes reales, un ciclo de facturación procesado, certificados emitidos y su feedback.

Escribir solo lo verificado. Lo que no se pudo verificar se dice explícitamente. Los datos personales del cliente (nombres de conductores, teléfonos, RUT de personas) no van en este archivo.

---

# Cliente 1 — feedback del primer ciclo

**Fecha**: AAAA-MM-DD
**Redactado por**:
**Período cubierto**: AAAA-MM-DD a AAAA-MM-DD
**Revisión desplegada en producción durante el período**: (API, web y gateway)

## 1. Contexto

| Campo | Valor |
|---|---|
| Empresa (razón social) | |
| Rol | Generador de carga / Transportista / Ambos |
| ¿La opera el PO? | No (requisito de T10-30) |
| Contrato | Tipo, fecha de firma y versión (`contratos-por-rol-v1` u otro) |
| Términos aceptados | Versión y fecha |
| Modo de pago | Pago directo / Mandato de cobro |
| Usuarios activos por rol | |
| Vehículos y dispositivos | N vehículos, N con Teltonika, N con CAN |

Por qué este cliente y qué esperaba obtener de Booster (en sus palabras, si es posible):

## 2. Viajes

| Código del viaje | Fecha | Origen → destino | Fuente de la traza | Cobertura | Nivel del certificado | Emisiones (kg CO₂e) | Documento subido | Estado final |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |

Consulta con que se obtuvieron los datos (query de solo lectura y fecha de ejecución):

```sql
-- pegar la query usada
```

## 3. Ciclo de facturación

| Concepto | Monto | Fecha de emisión | Fecha de pago | ¿Dentro del sistema? |
|---|---|---|---|---|
| Flete (transportista → generador) | | | | |
| Comisión de Booster + IVA | | | | |
| Suscripciones (UF y valor UF del día) | | | | |

Metodología de cálculo registrada (`pricing_methodology_version`) y versión de la configuración comercial, si aplica:

Diferencias entre lo que calculó el sistema y lo que se facturó, y por qué:

## 4. Incidencias

| # | Fecha | Paso del guion | Descripción | Severidad (P0–P3) | Detectada por | Issue | Estado |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

Intervenciones manuales del equipo Booster durante el ciclo (cada una con motivo):

## 5. Satisfacción

**NPS** — «¿Qué tan probable es que recomiende Booster a un colega? (0–10)»

| Persona (rol, sin nombre) | Puntaje | Comentario |
|---|---|---|
| | | |

**Preguntas cualitativas** (respuestas textuales o resumidas fielmente):

1. ¿Qué le resultó más útil?
2. ¿Qué le costó más o le pareció confuso?
3. ¿Qué tuvo que hacer fuera de la plataforma (llamadas, planillas, correos)?
4. ¿El certificado de huella le sirve para su reporte? ¿Qué le falta?
5. ¿Qué necesitaría para mover más viajes a Booster?

## 6. Decisiones

| # | Decisión | Quién decide | Fecha | Seguimiento |
|---|---|---|---|---|
| | | | | |

Qué se cambia en el producto o en la operación por este feedback, y qué se deja explícitamente fuera:

## 7. Estado de T10-30

- [ ] Cliente que no opera el PO
- [ ] Contrato firmado
- [ ] Viajes reales (≥ 1)
- [ ] Un ciclo de facturación procesado
- [ ] Certificados emitidos
- [ ] Feedback registrado (este documento)

Evidencia de cada casilla (enlace a la sección o al archivo):
