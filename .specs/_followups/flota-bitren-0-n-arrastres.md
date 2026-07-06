# Flota — configuraciones 0..N arrastres (bitrén) tras el modelo 0..1 de W4a

**Dimensión**: dominio / db · **Estado**: deuda declarada por el PO (decisión D1.1, 2026-07-06).
**Fuente**: `.specs/hito-2-corfo-mes-8/decisiones.md` (condición 1 de la Opción A) + ADR de tipologías de flota (W4a).

## Problema

El modelo de W4a (Opción A: `vehiculos.categoria_unidad` + `viajes.unidad_arrastre_id` FK única nullable) soporta exactamente **0..1 unidad de arrastre por viaje**. Chile permite bitrenes (1 tracto + 2 semirremolques) con permiso especial en corredores autorizados (D.S. 158 MTT y resoluciones asociadas): esas configuraciones no caben en una FK escalar.

## Impacto

- Un transportista con bitrén no puede declarar su configuración real → capacidad agregada y clase GLEC quedarían mal derivadas para ese caso.
- Aceptado HOY como deuda explícita porque el parque objetivo del piloto (mes 8) no opera bitrenes; declarado en el ADR de W4a.

## Plan de pago

1. Tabla puente `viaje_unidades_arrastre` (viaje_id, vehiculo_id arrastre, posicion 1..2) con UNIQUE(viaje_id, posicion) y guard N≤2 tras flag `BITREN_ENABLED`.
2. Migrar `viajes.unidad_arrastre_id` → posicion=1 de la tabla puente (expand/contract, guards ADR-043/044).
3. Derivación GLEC y capacidad agregada iteran sobre el set (el contrato de `packages/carbon-calculator` ya recibirá "configuración" desde W4a — solo cambia la cardinalidad del input).
4. Validación de permiso especial (documento del MTT) como parte del registro de la configuración bitrén.
