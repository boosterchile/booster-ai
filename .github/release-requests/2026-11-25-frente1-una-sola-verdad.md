# Release request — rediseño, frente 1: una sola verdad por dato

**Fecha**: 2026-11-25 · America/Santiago  
**Motivo**: llevar a producción lo fusionado en `main` desde el release del 2026-11-25 (`c37fa6c`), hasta la punta de `main` al fusionar esta solicitud.  
**Pedido**: del PO — cerrar el frente 1 de `docs/design/rediseno-2026-11-25/FRENTES.md` con una solicitud de release a producción fusionada.

## Qué entra

- Formateador único de cifras de emisiones en `apps/web` (#1095).
- Umbral de anonimato único de 1 camión, ADR-096 (#1096).
- Un solo cálculo de documentos pendientes en Booster Fleet, Cumplimiento, el Inicio y Conductores; vocabulario único del estado de la flota; indicadores del negocio en el Inicio del panel; totales de Certificados sobre todos los certificados; y la prueba E2E que carga la misma empresa en esas pantallas (#1097).
- Corrige un error en producción: Booster Fleet mostraba todo documento con fecha como «Sin fecha de vencimiento» (la fecha se leía inválida).
- Lo demás fusionado desde `c37fa6c` es documentación: el traspaso del rediseño y ADR-095 (#1087 a #1094).

## Qué no cambia

- Sin migraciones.
- `PRICING_V3_ACTIVATED` sigue apagado.
- Las vistas de BigQuery del observatorio siguen filtrando con 10 vehículos hasta que el PO corra `terraform apply` (`infrastructure/observatorio.tf`, #1096). Hasta entonces el observatorio muestra lo mismo que hoy.

## Gate

Este archivo dispara `Release on request`. El Environment **production** sigue exigiendo aprobación humana (ADR-076). No usa la lane `release-deploy-main`.
