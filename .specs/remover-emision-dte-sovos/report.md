# Reporte de remoción Sovos / emisión DTE — Frente F3

**Frente**: F3 de `.specs/pivote-documental-y-cierre-legal-2026-06/spec.md`
**Fecha**: 2026-06-18
**Tipo**: READ-ONLY (inventario + propuesta). La remoción se ejecuta tras aprobación del PO.
**Decisiones aplicadas**: O-2 (`facturas_booster_clp` sobrevive; deprecar solo `dte_*`), O-3 (retención del emisor deja de aplicar → P0-A "no aplica").

> Inventario verificado contra el código vivo de `main` (2026-06-18). Todas las rutas:línea fueron confirmadas con `grep`/`Read`.

---

## Resumen ejecutivo

**Hallazgo clave: la emisión de DTE NUNCA estuvo activa en producción.** `DTE_PROVIDER` tiene default `'disabled'`, no hay wiring en Terraform que lo active, y `SovosDteAdapter` es un skeleton sin sandbox UAT. Por lo tanto **casi todo el subsistema de emisión es SCAFFOLDING** → se **REMUEVE** sin riesgo operacional. Los datos de negocio (`facturas_booster_clp`, `liquidaciones`) **SOBREVIVEN**; solo se **DEPRECAN** (sin DROP) las columnas `dte_*` que existían por la emisión vía Sovos.

**Dos hallazgos que corrigen el plan maestro:**
1. **`document-events` NO fue removido en `main`** (la creencia de que #493 lo cerró era incorrecta: ese commit vive en una rama sin mergear). Sigue en `infrastructure/messaging.tf:13,83-91` como topic huérfano (0 publishers, 0 subscriptions, consumer skeleton). F3 **absorbe su remoción** (o se coordina con P1-F).
2. **`GET /me/liquidaciones` proyecta campos `dte_*`** (`apps/api/src/routes/me-liquidaciones.ts:57-64,89-93`) → es un **contrato público** consumido por la PWA del carrier. Dejar de proyectarlos requiere revisar `apps/web` antes de mergear (ver spec §4).

---

## Inventario por categoría (28 puntos)

### A REMOVER (scaffolding de emisión, nunca activo en prod)

| # | Punto | Ruta:línea | Estado |
|---|---|---|---|
| 1 | Package `@booster-ai/dte-provider` completo | `packages/dte-provider/` (interface.ts, types.ts, errors.ts, adapters/sovos.ts, adapters/mock.ts, index.ts, package.json, README, tsconfig, vitest.config) | Scaffolding |
| 2 | Tests del package | `packages/dte-provider/test/sovos-adapter.test.ts`, `test/mock-adapter.test.ts` | Scaffolding |
| 3 | Factory de emitter | `apps/api/src/services/dte-emitter-factory.ts` | Activo (selecciona adapter; default→null) |
| 4 | Service emisión | `apps/api/src/services/emitir-dte-liquidacion.ts` | Activo (gated por flag) |
| 5 | Service reconciliación | `apps/api/src/services/reconciliar-dtes.ts` | Activo (cron) |
| 6 | Wire DTE en liquidación | `apps/api/src/services/liquidar-trip.ts:10,188-206` (import + bloque; **el service sobrevive**) | Activo (gated) |
| 7 | Endpoint admin emitir-dte | `apps/api/src/routes/admin-liquidaciones.ts:49` (POST `/:id/emitir-dte`; router queda vacío → remover) | Activo |
| 8 | Registro del router | `apps/api/src/server.ts:24,615-625` (import + `app.route`) | Activo |
| 9 | Handler cron reconciliar | `apps/api/src/routes/admin-jobs.ts:41,83-107` (import + POST `/reconciliar-dtes`; **router sobrevive**) | Activo |
| 10 | Env emisión | `apps/api/src/config.ts:371-383` (`DTE_PROVIDER`), `:390-391` (`SOVOS_API_KEY`/`SOVOS_BASE_URL`), `:393-406` (`BOOSTER_RUT`/`RAZON_SOCIAL`/`GIRO`/`DIRECCION`/`COMUNA`) | Activo (default disabled) |
| 11 | Cron Scheduler | `infrastructure/scheduling.tf:154-189` (`google_cloud_scheduler_job.reconciliar_dtes`) | Activo |
| 12 | Topic huérfano | `infrastructure/messaging.tf:13,83-91` (`document-events`) | Huérfano (hallazgo #1) |
| 13 | Tests de emisión (api) | `apps/api/test/unit/dte-emitter-factory.test.ts`, `dte-end-to-end.test.ts`, `emitir-dte-liquidacion.test.ts`, `reconciliar-dtes.test.ts`, `admin-liquidaciones.test.ts` | Scaffolding |
| 14 | Tests parciales | `admin-jobs-route.test.ts` (solo casos reconciliar-dtes), `liquidar-trip.test.ts` (solo aserciones del wire DTE) — el resto se conserva | Mixto |

### A DEPRECAR — sin DROP (O-2: datos de negocio sobreviven)

| # | Punto | Ruta:línea | Acción |
|---|---|---|---|
| 15 | Columnas `dte_*` en `facturas_booster_clp` | `apps/api/src/db/schema.ts:1992-2003` (`dteTipo`, `dteFolio`, `dteEmitidaEn`, `dtePdfGcsUri`, `dteProvider`, `dteProviderTrackId`, `dteStatus`) | Marcar `@deprecated`, dejar de escribir. **NO DROP.** |
| 16 | Columnas DTE en `liquidaciones` | `apps/api/src/db/schema.ts:1945-1948` (`dteFacturaBoosterFolio`, `dteFacturaBoosterEmitidoEn`) | `@deprecated`, dejar de escribir |
| 17 | Valor `'dte_emitido'` del CHECK | `apps/api/src/db/schema.ts:1957-1960` (`chk_liquidaciones_status`) | **Conservar** el valor (datos históricos), documentar legacy; el flujo deja de transicionar a él |
| 18 | Migración 0019 | `apps/api/drizzle/0019_facturas_dte_provider_meta.sql` | **NO revertir** (inmutable); columnas + índice `idx_facturas_dte_status` quedan inertes |
| 19 | Proyección en API web | `apps/api/src/routes/me-liquidaciones.ts:57-64,89-93` | Deja de proyectar `dte_*`; simplificar el `leftJoin` a `facturas_booster_clp`. **Contrato público — ver spec §4** (hallazgo #2) |
| 20 | Secretos Sovos | `infrastructure/security.tf:198-200` (`dte-provider-api-key`/`-client-secret`) + `compute.tf:659-662` (inyección en document-service) | **Marcar para revisión en F4** (posible reuso en recepción de DTE de terceros); si F4 no los usa, remover. Huérfanos hoy (el código nunca los lee) |
| 21 | Bucket `documents` | `infrastructure/storage.tf:119-194` (retention 6a, `is_locked=false`) | **NO tocar en F3**: pasa a docs de terceros bajo política O-3 (F4). Actualizar narrativa en ADR-069 |

---

## Clasificación resumen

- **REMOVER**: 14 grupos (package dte-provider, 4 services de emisión/factory, endpoint admin, registros, env emisión, cron, topic huérfano, ~6 tests). Riesgo operacional **nulo** (nunca activo en prod).
- **DEPRECAR sin DROP**: 7 grupos (columnas `dte_*`, CHECK legacy, migración inerte, proyección API, secretos a revisar en F4, bucket a F4).
- **P0-A**: pasa a "no aplica" (sin emisión, el gate del retention-lock nunca se cumple).

Detalle del plan de ejecución, ADR-069 y riesgos: ver `spec.md` en este directorio.
