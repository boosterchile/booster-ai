# ADR-087 — Una empresa con los dos roles no paga la UF de generador

**Estado**: Vigente desde el merge del PR #795 (visto del PO en ese PR).
**Fecha**: 2026-11-04 (la decisión es del 2026-10-19)
**Decider**: Felipe Vicencio (Product Owner), 2026-10-19.
**Acota a**:
- [ADR-079](./079-modelo-comercial-v3-comision-al-generador-configurable.md), sección «Planes de suscripción». Agrega una regla para la empresa que es transportista y generador a la vez. El resto de ADR-079 sigue vigente.

No supersede a ADR-079.

**Spec**: `.specs/transportista-generador/spec.md`

---

## Contexto

ADR-079 define tres planes en UF: transportista base por camión, transportista con gestión de flota por camión y generador por empresa. No dice qué paga una empresa que tiene `es_transportista` y `es_generador_carga` a la vez.

El PR #795 permite que un transportista active también el rol generador desde el panel de administración. El borrador del PR registraba la regla editando ADR-079. El contrato del repo no permite editar un ADR vigente, así que la decisión queda registrada en este ADR.

## Decisión

1. Una empresa con los dos roles **no paga** `suscripcion_generador_uf_empresa_mes`. Generar carga queda dentro de la suscripción de transportista.
2. A esa empresa se le cobra solo la línea de transportista, o la de gestión de flota si corresponde.
3. Si el transportista está bajo el umbral de `camiones_sin_cobro_por_transportista`, sigue exento aunque también sea generador.
4. El generador puro sigue pagando `suscripcion_generador_uf_empresa_mes`, como dice ADR-079.

## Consecuencias

- `packages/pricing-engine/src/suscripcion-uf.ts` no emite la línea `suscripcion_generador` cuando la empresa también es transportista. Lo cubre `packages/pricing-engine/test/suscripcion-uf.test.ts`.
- Activar el rol generador en un transportista no cambia lo que factura.
- Si en el futuro se cobra el rol generador a un transportista, hace falta un ADR nuevo que supersede este.
