# Release request — Booster Fleet

**Fecha**: 2026-11-17 · America/Santiago  
**Motivo**: dejar Booster Fleet disponible en producción (PR #1002, `269d820e` y tip de `main` al mergear este request).  
**Pedido**: goal del PO — «Booster Fleet esté en producción».

## Qué entra

- Panel `/app/booster-fleet` + API `/booster-fleet`
- Migración **0086** `mantenciones_vehiculo` (expand-only, al startup del api)
- Oneshot: `docs/handoff/2026-11-17-booster-fleet-release-oneshot.md`

## Gate

Este archivo dispara `Release on request`. El Environment **production** sigue exigiendo aprobación humana (ADR-076). No usa la lane `release-deploy-main`.
