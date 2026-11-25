# Release request — lema y comisión dentro del precio (ADR-094, frentes 1 y 2)

**Fecha**: 2026-11-25 · America/Santiago  
**Motivo**: llevar a producción lo fusionado en `main` desde el release del 2026-11-24 (`fdd0528`), hasta `187ed9a` y la punta de `main` al fusionar esta solicitud.  
**Pedido**: del PO — «necesito que todos los cambios entren en producción».

## Qué entra

- Lema «Transporta más, impacta menos» en la aplicación y los documentos (#1080, #1081).
- DESIGN.md: el verde es marca y acción principal; sello Medido/Estimado (#1082). Solo documento.
- ADR-094, frente 1: tasas de comisión sin invariante entre sí y `calcularLiquidacionV4` (#1084).
- ADR-094, frente 2: el precio publicado es el del viaje (#1085).
- Lo demás fusionado desde `fdd0528` que no es de este pedido: #1072 a #1078 (App Check con Fraud Defense elegible por entorno, arreglos de infraestructura de staging, jobs del api, tests y handoff).

## Qué no cambia

- `PRICING_V3_ACTIVATED` sigue apagado: la regla de comisión nueva no rige en producción. No debe encenderse hasta cerrar los frentes 3, 4 y 5 de `.specs/comision-dentro-del-precio/spec.md`: hoy la oferta copia el precio publicado y la liquidación suma la comisión encima.
- Sin migraciones nuevas.

## Estado de staging

El deploy a staging de `187ed9a` no terminó en verde: Cloud Build falla en su paso 32 desde antes de estos cambios (`c89cc91`). El E2E de staging sobre `187ed9a` pasó.

## Gate

Este archivo dispara `Release on request`. El Environment **production** sigue exigiendo aprobación humana (ADR-076). No usa la lane `release-deploy-main`.
