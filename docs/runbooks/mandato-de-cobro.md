# Runbook — Mandato de cobro

Operación del flujo de dinero de [ADR-080](../adr/080-flujo-de-dinero-mandato-de-cobro-y-capital-de-trabajo.md). Ventana de respuesta: [`on-call.md`](on-call.md). Un incidente que mueve o retiene dinero de terceros es **P0**.

## Estado hoy (2026-10-08)

- La plataforma opera en **modo conector** (ADR-080 §5). El generador de carga paga directo al transportista y Booster factura solo su comisión. No hay fondos de terceros, ni anticipo integrado, ni liberaciones.
- El flag `MANDATO_COBRO_ACTIVATED` y el modelo de estados de §2 **todavía no existen en el código**: la spec `.specs/mandato-de-cobro/` está pendiente (T10-25).
- Las secciones "Con mandato activo" de abajo describen el procedimiento que regirá desde la activación. Se actualizan junto con la implementación. Hasta entonces, el único procedimiento vigente es el de modo conector.

## Activación (una sola vez, la ejecuta el PO)

Requisitos previos:

- Las seis precondiciones de ADR-080 §6 tienen evidencia en `.specs/mandato-de-cobro/activacion.md`:
  1. sign-off legal;
  2. cuenta de fondos de terceros con conciliación;
  3. capital de trabajo o tope `float_maximo_terceros_clp`;
  4. consentimiento del conductor;
  5. recepción conforme de punta a punta;
  6. T&C v3 y adendum v2.
- El gate de calendario es el 2026-11-30. Si la precondición 3 no se cumple a esa fecha, el peak de enero a marzo de 2027 se opera en modo conector. Esa decisión se registra en `docs/handoff/CURRENT.md` en noviembre.

Pasos:

1. Escribir la lista de verificación de la activación y hacer la corrida en seco del `terraform plan` que cambia el flag (ADR-076). Registrar la salida.
2. Hacer el `terraform apply` del flag a `true` y registrar en `docs/handoff/CURRENT.md` la fecha y la revisión desplegada.
3. Comunicar el cambio a generadores y transportistas activos. El cambio de régimen es configuración más comunicación (§5).

## Volver a modo conector (salida de emergencia)

Es la ruta 3 de ADR-080. Se usa si falla la línea de confirming, si la conciliación no cuadra o ante cualquier riesgo legal o de caja no acotado.

1. Poner `MANDATO_COBRO_ACTIVATED=false` por Terraform, con la misma lista de verificación y corrida en seco.
2. Las liquidaciones en curso conservan su `modo_flujo`. Las que quedaron en `pendiente` bajo mandato se cierran a mano: liberar lo cobrado y dejar lo no cobrado como cobro directo, informado a las partes.
3. Comunicar a las partes y registrar la decisión en `docs/handoff/CURRENT.md`.

## Con mandato activo: incidentes

| Síntoma | Severidad | Acción |
|---|---|---|
| La conciliación diaria no cuadra (cuenta de terceros vs tabla de pagos) | P0 | Congelar nuevas liberaciones. Identificar la diferencia por viaje: abono no registrado, liberación duplicada o comisión mal retenida. No compensar entre viajes. |
| `caja.float_terceros_clp` cerca de `float_maximo_terceros_clp` | P1 | La plataforma bloquea nuevas liberaciones anticipadas al alcanzar el tope (§6.3). Avisar al PO para decidir si se amplía la línea; nunca subir el tope sin decisión escrita. |
| Liberación rechazada por el tope | P1 | Esperado. Informar al transportista del plazo estándar (`plazo_liberacion_transportista_dias`). |
| Generador en `mora` | P1 | El cupo queda bloqueado automáticamente (ADR-029 §3). Gestionar el cobro y no liberar sin recepción conforme. |
| Recepción conforme objetada (`disputa`) | P1 | La liberación queda congelada y el cobro sigue (§2). Reunir la evidencia: documento archivado, traza GPS/CAN y contrato del match. Plazo de resolución: 30 días (adendum, §7). |
| Falla de la API del operador financiero (anticipo) | P1 | Los anticipos quedan pendientes y no se liberan desde caja propia salvo decisión del PO. Si existe un segundo `partner_slug`, evaluar la ruta 2. |
| Dinero liberado a la cuenta equivocada | P0 | Contactar al banco de inmediato para retener. Post-mortem obligatorio. |

## Qué no hacer

- Liberar sin recepción conforme registrada.
- Mover fondos entre la cuenta de terceros y la operacional fuera de la retención de comisión.
- Activar o desactivar el flag desde código o consola: solo por Terraform.
