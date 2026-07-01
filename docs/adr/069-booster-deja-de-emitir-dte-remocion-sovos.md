# ADR-069 — Booster deja de emitir DTE: remoción de la integración Sovos

**Estado**: Accepted
**Fecha**: 2026-06-18
**Decider**: Felipe Vicencio (Product Owner)
**Supersede**: [ADR-024](./024-sii-provider-sovos-with-multi-vendor-strategy.md) (Sovos primario + multi-vendor LATAM)
**Modifica**: [ADR-007](./007-chile-document-management.md) §emisión (Booster pasa de emisor a receptor/archivador)
**Related**:
- Frente F3 de `.specs/pivote-documental-y-cierre-legal-2026-06/spec.md`
- Inventario + plan: `.specs/remover-emision-dte-sovos/{report.md,spec.md}` (28 puntos verificados, 2026-06-18)
- Cierra **P0-A** (retention-lock) por "no aplica"; obsoleta `.specs/sec-h3-dte-retention-lock/spec.md`
- Inventario ADR-vs-prod: `.specs/adr-vs-prod-inventory/inventory.md` §ADR-007

---

## Contexto

[ADR-024](./024-sii-provider-sovos-with-multi-vendor-strategy.md) adoptó **Sovos/Paperless** como proveedor SII primario para que Booster emitiera DTE (Tipo 33 factura comisión, Tipo 52 guía de despacho) en nombre de N transportistas, con un adapter-pattern en `packages/dte-provider` y estrategia multi-vendor LATAM.

Dos hechos del estado real (verificados sobre `main`, 2026-06-18 — ver `report.md`) cambian la decisión:

1. **La emisión de DTE NUNCA estuvo activa en producción.** `DTE_PROVIDER` tenía default `'disabled'`, no había wiring en Terraform que lo activara, y `SovosDteAdapter` era un skeleton sin sandbox UAT. Todo el subsistema de emisión era **scaffolding**.
2. **Pivote de negocio (PO)**: Booster no será emisor de DTE en esta fase. El rol documental pasa a **recibir y archivar** DTE de terceros (frente F4). Mantener Sovos es deuda activa (código, cron horario, secretos, env) sin uso de producto.

Como el camino de emisión nunca corrió en prod, removerlo tiene **riesgo operacional nulo**. Los datos de negocio (`facturas_booster_clp`, `liquidaciones`) **sobreviven**; solo las columnas `dte_*` que existían por la emisión quedan deprecadas.

## Decisión

### 1. Booster deja de emitir DTE; se remueve la integración Sovos

Se elimina todo el scaffolding de emisión (nunca activo en prod):

- Package `@booster-ai/dte-provider` completo (interface, adapters Sovos/mock, errores, tipos).
- Services `dte-emitter-factory.ts`, `emitir-dte-liquidacion.ts`, `reconciliar-dtes.ts` en `apps/api`.
- Wire de emisión en `liquidar-trip.ts` (el service de liquidación **sobrevive** y cierra la liquidación sin emitir DTE).
- Endpoint admin `POST /admin/liquidaciones/:id/emitir-dte` (router completo) y su registro en `server.ts`.
- Handler cron `POST /admin/jobs/reconciliar-dtes` (el router `admin-jobs` sobrevive).
- Config: `DTE_PROVIDER`, `SOVOS_API_KEY`/`SOVOS_BASE_URL`, `BOOSTER_RUT`/`RAZON_SOCIAL`/`GIRO`/`DIRECCION`/`COMUNA`.
- Infra: cron `google_cloud_scheduler_job.reconciliar_dtes` (`scheduling.tf`) y topic `document-events` (`messaging.tf`).
- Tests de emisión; poda de los casos DTE en los tests de `admin-jobs` y `liquidar-trip`.

El adapter-pattern de ADR-024 queda preservado en git history: si Booster vuelve a emitir, se restaura (decisión reversible a nivel de código).

### 2. ADR-024 queda superseded

Booster ya **no selecciona ni integra proveedor SII para emisión**. La estrategia multi-vendor LATAM (CL/CO/MX/PE) de ADR-024 queda fuera de alcance hasta nueva decisión.

### 3. ADR-007 §emisión: Booster = receptor/archivador

Se modifica el rol documental de ADR-007: Booster pasa de **emisor** (DTE 33/52 en nombre de carriers) a **receptor/archivador** de DTE de terceros. La generación/firma/presentación SII deja de ser responsabilidad del sistema. La recepción y archivo documental de terceros (tabla `documentos_transporte`, worker TED, repositorio documental) se diseña en **F4** bajo política de retención O-3.

> El campo `dte_provider_account_id` del schema `transportista` (en `packages/shared-schemas`) se conserva: corresponde al rol receptor de F4, no a la emisión removida.

### 4. P0-A "no aplica"; obsoleta sec-h3-dte-retention-lock

El gate de `is_locked=true` del bucket `documents` (P0-A / `.specs/sec-h3-dte-retention-lock`) se condicionaba a **"emisión real de DTE en prod"**. Sin emisión, ese gate es **insatisfacible por diseño** → **P0-A pasa a "no aplica"** y el spec `sec-h3-dte-retention-lock` (cuyo SC-4 depende de un write path de emisión vivo) queda **obsoleto**.

La retención de documentos de **terceros** (F4) se rige por **O-3**: retención según exigencia legal aplicable al archivador, **sin WORM/Retention-Lock obligatorio** salvo que una norma específica lo exija. Esto **no deja un hueco de compliance**: la obligación de retención de 6 años del *emisor* SII deja de aplicar a Booster precisamente porque Booster ya no emite. El bucket `documents` y los secretos `dte-provider-*` quedan marcados para revisión en F4 (posible reuso para recepción de terceros); **F3 no los toca**.

### 5. Columnas `dte_*`: deprecación sin DROP (O-2)

Las columnas `dte_*` de `facturas_booster_clp` (`dteTipo`, `dteFolio`, `dteEmitidaEn`, `dtePdfGcsUri`, `dteProvider`, `dteProviderTrackId`, `dteStatus`) y de `liquidaciones` (`dteFacturaBoosterFolio`, `dteFacturaBoosterEmitidoEn`) se marcan **`@deprecated`** en `apps/api/src/db/schema.ts`: conservan datos históricos, dejan de escribirse, **sin DROP ni migración destructiva** (no se viola el guard expand/contract de [ADR-066](./066-db-migration-rollback-strategy.md)). La migración `0019_facturas_dte_provider_meta` es inmutable y queda inerte (índice `idx_facturas_dte_status` incluido). El valor `'dte_emitido'` del CHECK `chk_liquidaciones_status` se **conserva** como legacy (filas históricas) aunque el flujo ya no transicione a él.

### 6. Contrato `/me/liquidaciones`: deprecación escalonada (O-7)

`GET /me/liquidaciones` proyectaba 5 campos `dte_*`, consumidos por la PWA del carrier (`apps/web`). Único consumidor confirmado = `apps/web`; **sin clientes externos** (no hay app móvil ni API pública/SDK que exponga el endpoint — verificado 2026-06-18). Estrategia conservadora de contrato (decisión PO 2026-06-18):

1. **`apps/web`** deja de consumir `dte_*`: se quita el componente `DteCell`/`DteStatusBadge` y los campos `dte_*` del tipo `LiquidacionRow` y del hook.
2. **El backend** deja de **poblar** `dte_*` (se quita el `leftJoin` a `facturas_booster_clp`) pero **mantiene los 5 campos en el JSON devolviendo `null`** (deprecated) — backward-compat para PWAs en vuelo/caché. **No se remueven del response schema.**
3. La **eliminación del contrato** (quitar los campos del JSON) es una **fase posterior**, tras confirmar cero consumidores.

## Consecuencias

**Positivas:**
- Cero deuda activa de un subsistema nunca usado en prod (código, cron horario, secretos, env, topic huérfano).
- `grep -riE 'sovos|DTE_PROVIDER'` sobre `apps/`+`packages/` = 0 en código vivo (solo historia/ADR y nombres de columnas legacy deprecadas).
- P0-A cerrado sin trabajo de retention-lock irreversible; narrativa de ADR-007 alineada con la realidad (Booster no emite → no aplica la promesa de retención del emisor).
- Contrato público preservado backward-compat (O-7): la PWA no se rompe.

**Negativas / deuda explícita aceptada:**
- Las columnas `dte_*` quedan en el schema como peso muerto deprecado hasta una fase contract futura (O-2: el costo de mantenerlas << el riesgo de un DROP con datos históricos).
- El contrato `/me/liquidaciones` mantiene 5 campos `null` hasta la fase de eliminación (O-7 fase 3).
- Secretos `dte-provider-*` y bucket `documents` quedan para decisión en F4 (O-9): si F4 no los reusa para recepción, se remueven ahí.
- Si Booster decide volver a emitir DTE, hay que restaurar el adapter-pattern desde git history y re-decidir proveedor (la estrategia multi-vendor LATAM de ADR-024 ya no rige).

## Alternativas consideradas

- **Dejar Sovos en `disabled` indefinidamente**: rechazado. Es deuda silenciosa (CLAUDE.md §Cero deuda); cron horario + secretos + env vivos sin uso de producto, y bloquea el cierre de P0-A.
- **DROP de columnas `dte_*`**: rechazado (O-2). Destruiría datos históricos y violaría el guard expand/contract; el beneficio (limpieza de schema) no justifica el riesgo irreversible.
- **Romper el contrato `/me/liquidaciones` de una vez**: rechazado (O-7). Aunque el único consumidor es `apps/web`, una PWA cacheada en vuelo podría romper; la deprecación escalonada elimina el riesgo a costo casi nulo.
