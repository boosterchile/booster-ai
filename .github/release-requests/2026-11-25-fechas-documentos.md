# Release request — fechas de los documentos de vehículo y conductor

**Fecha**: 2026-11-25 · America/Santiago  
**Motivo**: llevar a producción #1099, fusionado en `main` después del release del frente 1 (`505fbf0`).  
**Pedido**: del PO — «sigue cuando se fusione y pide el release».

## Qué entra

- #1099: `fecha_emision` y `fecha_vencimiento` de `documentos_vehiculo` y `documentos_conductor` se declaran `date` en el esquema de drizzle, como en la base. Hoy en producción crear, editar o listar un documento de vehículo o conductor responde 500 (`RangeError: Invalid time value`); en la creación la fila igual queda guardada.

## Qué no cambia

- Sin migraciones: el esquema de la base no cambia.
- `PRICING_V3_ACTIVATED` sigue apagado.

## Gate

Este archivo dispara `Release on request`. El Environment **production** sigue exigiendo aprobación humana (ADR-076). No usa la lane `release-deploy-main`.

## Segunda solicitud (2026-11-25)

La primera ([run 45720364303](https://github.com/boosterchile/booster-ai/actions/runs/45720364303)) se aprobó mientras corría el release del frente 1 y se detuvo antes de Cloud Build en «Verificar que no hay otro deploy a prod en curso»; no desplegó nada. El release del frente 1 terminó en verde (`505fbf06`, run 45717367685) y no hay otro deploy en curso.
