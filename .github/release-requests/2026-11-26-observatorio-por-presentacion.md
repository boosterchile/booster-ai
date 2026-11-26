# Release request — el observatorio separa las emisiones por presentación

**Fecha**: 2026-11-26 · America/Santiago  
**Motivo**: llevar a producción lo fusionado en `main` desde el release del mes en curso del Inicio (`969a7e4d`, run 45764951190), hasta la punta de `main` al fusionar esta solicitud.  
**Pedido**: del PO — solicitar el release de #1115.

## Qué entra

- El export horario del observatorio puede mandar la presentación de ADR-091 de cada viaje, y la web sella cada fila de Emisiones con la suya; sin ella, «Estimado» (#1115).
- La bandera `OBSERVATORIO_PRESENTACION_ACTIVADA` (por defecto apagada): el export solo manda la columna cuando Terraform la enciende, en el mismo `apply` que crea la columna (#1115).
- Documentación del handoff (#1114 y esta solicitud).

## Qué no cambia

- Sin migraciones de Cloud SQL.
- Este release no toca BigQuery: la columna y la vista llegan con el `terraform apply` del PO. Hasta entonces el export sale igual que hoy y el observatorio muestra «Estimado».
- `PRICING_V3_ACTIVATED` sigue apagado.

## Qué mirar tras el deploy

En los logs del api, el siguiente `observatorio exportado` (minuto 7 de cada hora) sin error. En el panel, `/app/platform-admin/observatorio` sigue cargando.

## Gate

Este archivo dispara `Release on request`. El Environment **production** sigue exigiendo aprobación humana (ADR-076). No usa la lane `release-deploy-main`.
