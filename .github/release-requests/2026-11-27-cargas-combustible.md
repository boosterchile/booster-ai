# Release request — registro de cargas de combustible

**Fecha**: 2026-11-27 · America/Santiago  
**Motivo**: llevar a producción lo fusionado en `main` desde el último release (`33b0a786`, run 45815282425), hasta la punta de `main` al fusionar esta solicitud.  
**Pedido**: del PO — «Primero el release», tras la entrega 2 de `.specs/desviacion-combustible-confiable` (D4).

## Qué entra

- Migración **0093** `cargas_combustible`: tabla nueva, expand-only, no toca datos ni tablas existentes. Reversa en `drizzle/down/0093_cargas_combustible.down.sql` (#1130).
- `GET/POST /vehiculos/:id/cargas-combustible` y `DELETE …/:cargaId` (anula, no borra), y la sección «Cargas de combustible» en la ficha del vehículo para quien gestiona la flota (#1130).
- Paquete `packages/fuel-deviation` (#1129): ninguna app lo importa todavía; no cambia nada en ejecución.
- Handoff (#1128): solo documentación.

## Qué no cambia

- Booster Fleet y los avisos de desviación siguen con la regla vigente. JLKT54 y JWTH77 siguen en `sin_sensor`.

## Qué mirar tras el deploy

- En los registros del api, `Drizzle migrate() complete` con la 0093, sin `runMigrations failed`.
- En solo lectura: `SELECT to_regclass('public.cargas_combustible')` no nulo y `SELECT count(*) FROM cargas_combustible` = 0.
- `GET /vehiculos/:id/cargas-combustible` responde 200 a un gestor de flota.

## Gate

Este archivo dispara `Release on request`. El Environment **production** sigue exigiendo aprobación humana (ADR-076). No usa la lane `release-deploy-main`.
