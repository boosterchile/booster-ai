# Release request — el Inicio del generador rotula el mes en curso

**Fecha**: 2026-11-26 · America/Santiago  
**Motivo**: llevar a producción lo fusionado en `main` desde el release del frente 2 (`5bcf36d2`, run 45757996298), hasta la punta de `main` al fusionar esta solicitud.  
**Pedido**: del PO — solicitar el release de #1111.

## Qué entra

- El Inicio del generador dice «Gasto {mes}» y «Huella {mes}» con el mes en curso en la zona de Santiago; antes decía «octubre» fijo en el código (#1111).
- Documentación del handoff (#1112 y esta solicitud).

## Qué no cambia

- Solo la web. Sin cambios de API ni migraciones.
- `PRICING_V3_ACTIVATED` sigue apagado.

## Qué mirar tras el deploy

Con una sesión de generador: el bloque de huella del Inicio dice «Huella noviembre».

## Gate

Este archivo dispara `Release on request`. El Environment **production** sigue exigiendo aprobación humana (ADR-076). No usa la lane `release-deploy-main`.
