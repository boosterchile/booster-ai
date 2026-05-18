# Cliente piloto — kickoff outreach (Sprint S0 T10)

**Fecha**: 2026-05-18
**Sprint**: S0 production-readiness · Task T10
**Spec**: [`.specs/s0-housekeeping/spec.md`](../../.specs/s0-housekeeping/spec.md) SC-S0.10
**Cubre objetivo**: SC-27a (≥1 cliente piloto firmado y operando) de la spec maestra [`.specs/production-readiness/spec.md`](../../.specs/production-readiness/spec.md). Outreach kickoff = lane externa cliente piloto activada.

---

## Resumen

Outreach inicial a prospects de cliente piloto identificados para Booster AI. Sigue convención **privada por defecto** (decisión OQ-S0.1 resuelta): detalle de prospects, contactos, comunicaciones y status en `.private/piloto-prospects.md` (gitignored). Este stub público solo expone conteos agregados sin información comercial sensible.

## Conteos al momento del PR (2026-05-18)

| Métrica | Conteo |
|---|---|
| Prospects identificados | **≥ 5** (shortlist primaria) |
| Prospects backup adicionales | **≥ 5** (si shortlist primaria no responde en 2 sem) |
| Prospects contactados | **0** (pendiente PO dry-run + envíos) |
| Respuestas recibidas | **0** (pre-envío) |
| Reuniones agendadas | **0** |
| Contratos firmados | **0** |

## Distribución sectorial de la shortlist primaria

- Retail con flota propia
- Forestal / celulosa / madera (2 candidatos por densidad de transporte forestal Chile)
- Minería (litio / cobre con presión ESG por trazabilidad)
- Distribución bebidas / alimentos

## Criterios de fit aplicados

- **Flota** ≥ 20 vehículos o operación recurrente con backhaul significativo.
- **Compromiso ESG público** verificable (sustainability report, science-based targets, B-Corp, etc.).
- **Caso de uso GLEC justificable** — huella de carbono es métrica relevante para el cliente.
- **Canal de intro** preferentemente warm (LinkedIn + intros mutuas) sobre cold email.

## Estado del workflow

1. ✅ Shortlist redactada por el agente (5 primarios + 5 backup, categorías + criterios fit + scores 1-5).
2. ⏸ **Pendiente PO dry-run**: validar candidatos, completar contactos reales, marcar `PO approved: <fecha>` en el doc privado.
3. ⏸ Pendiente envío emails (post-aprobación).
4. ⏸ Pendiente tracking respuestas.
5. ⏸ Pendiente firma piloto (criterio bloqueante SC-27a cierre spec maestra).

## Reconocimiento de irreversibilidad

Spec S0 §11 reconoce explícitamente que el **outreach es acción irreversible**: emails enviados a prospects no se rollbackean. Por eso:

- Dry-run PO obligatorio **antes** de enviar (parte de SC-S0.10).
- Criterios de fit explícitos por prospect — no se contacta candidatos sin caso de uso justificable.
- Si un prospect inicia diálogo y luego no se procede, cierre formal con email de "no fit en este momento".

## Próximos pasos

| Quien | Acción | Plazo objetivo |
|---|---|---|
| **PO (Felipe)** | Revisar shortlist en `.private/piloto-prospects.md`, validar/ajustar, completar contactos reales | Semana 2026-05-19 |
| **PO** | Marcar `PO approved` en el doc privado | Semana 2026-05-19 |
| **PO** | Enviar emails usando template, personalizando "razón específica" por prospect | Semana 2026-05-19 |
| **PO** | Actualizar tabla "Tracking respuestas" en el doc privado conforme lleguen respuestas | Continuo |
| **PO** | Actualizar este stub público con conteos progresivos (sin info sensible) | Mensual |
| **PO + agente** | Sub-PR cuando se firme contrato piloto (cierre SC-27a) | Sprint S13 del roadmap |

## Referencias

- **Spec sprint S0**: [`.specs/s0-housekeeping/spec.md`](../../.specs/s0-housekeeping/spec.md) SC-S0.10
- **Spec maestra**: [`.specs/production-readiness/spec.md`](../../.specs/production-readiness/spec.md) SC-27a + lane externa cliente piloto
- **Doc privado**: `.private/piloto-prospects.md` (gitignored — solo accesible localmente)
