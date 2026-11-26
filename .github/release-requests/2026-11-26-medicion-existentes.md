# Release request — medición encendida en transportistas activas y «Pedido a Booster» al recargar

**Fecha**: 2026-11-26 · America/Santiago  
**Motivo**: llevar a producción lo fusionado en `main` desde el release del cierre del frente 2 (`ef8ec6af`, run 45807853157), hasta la punta de `main` al fusionar esta solicitud.  
**Pedido**: del PO — «resolver urgente lo pendiente» y su visto a la migración 0092 en #1126.

## Qué entra

- Migración **0092**: enciende `carbon_measurement_enabled` en las empresas transportistas activas que la tenían apagada (4 en prod al 2026-11-26, una de prueba) y registra cuáles cambió en `empresas_medicion_encendida_0092`. Toca datos; visto del PO en #1126. Reversa en `drizzle/down/0092_…down.sql` (#1126).
- Booster Fleet muestra «Pedido a Booster» al recargar si el camión ya tiene una solicitud abierta (#1125).

## Qué no cambia

- Sin cambios de esquema en `empresas`. `PRICING_V3_ACTIVATED` sigue apagado.

## Qué mirar tras el deploy

- En los registros del api, `Drizzle migrate() complete` con la 0092, sin `runMigrations failed`.
- En solo lectura: `SELECT count(*) FROM empresas_medicion_encendida_0092` y que las transportistas activas tengan la medición encendida.

## Gate

Este archivo dispara `Release on request`. El Environment **production** sigue exigiendo aprobación humana (ADR-076). No usa la lane `release-deploy-main`.
