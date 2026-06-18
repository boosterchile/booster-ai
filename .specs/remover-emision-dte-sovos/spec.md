# remover-emision-dte-sovos — Spec (Frente F3)

**Frente del programa**: F3 de `.specs/pivote-documental-y-cierre-legal-2026-06/spec.md`
**Fecha**: 2026-06-18
**Status**: **Draft — pendiente aprobación PO** (la remoción NO se ejecuta sin firma en §Approval)
**Cierra**: P0-A (por "no aplica"). Supersede ADR-024; modifica ADR-007.
**Reporte de inventario**: `report.md` en este directorio (28 puntos verificados).

> La remoción invierte una decisión arquitectónica firmada (ADR-024) y toca un contrato público (`/me/liquidaciones`). Por eso: **reporte primero** (este spec + report.md), aprobación del PO, recién entonces ejecución en rama propia.

---

## 1. Objective

Remover la integración Sovos / emisión de DTE real de Booster, dejando el sistema en estado "Booster NO emite documentos tributarios". El comportamiento observable al cierre:

- No existe código de emisión/reconciliación DTE ni el package `@booster-ai/dte-provider`; `grep -riE 'sovos|DTE_PROVIDER'` sobre `apps/`+`packages/` da 0 en código vivo.
- El cron `reconciliar-dtes` y el topic `document-events` ya no existen en Terraform.
- `facturas_booster_clp` y `liquidaciones` **conservan sus datos**; las columnas `dte_*` quedan deprecadas (legacy, sin escritura, sin DROP).
- ADR-069 mergeado: supersede ADR-024, modifica ADR-007 (Booster = receptor/archivador), declara P0-A "no aplica", obsoleta el spec `sec-h3-dte-retention-lock`.

## 2. Why now

- **Pivote de negocio (PO)**: Booster no será emisor de DTE en esta fase; recibirá y archivará DTE de terceros (F4). Mantener Sovos es deuda activa (código, cron horario, secretos, env) sin uso de producto.
- **Cierra P0-A**: al no emitir, el gate del retention-lock ("emisión real de DTE en prod") nunca se cumple → P0-A pasa a "no aplica" y el spec `sec-h3-dte-retention-lock` queda obsoleto.
- **Riesgo de remoción nulo**: la emisión nunca estuvo activa en prod (`DTE_PROVIDER=disabled`, sin wiring Terraform, adapter skeleton) — ver `report.md` §Resumen.

## 3. Success criteria (measurable)

- [ ] `grep -riE 'sovos|DTE_PROVIDER|emitirDteLiquidacion|reconciliarDtes' apps packages` → 0 en código vivo (solo historia/ADR).
- [ ] `packages/dte-provider/` eliminado; ninguna referencia en `package.json`/`pnpm-workspace.yaml`/imports.
- [ ] `apps/api` typecheck 0 (sin imports colgantes) tras remover services/factory/endpoint.
- [ ] Suite api verde **sin** los tests de emisión; los tests no-DTE de `admin-jobs`/`liquidar-trip` siguen verdes.
- [ ] `infrastructure/scheduling.tf` sin `reconciliar_dtes`; `infrastructure/messaging.tf` sin `document-events`. `terraform validate`/`fmt` OK; `terraform plan` muestra solo destrucción del cron + topic (sin cambios colaterales inesperados).
- [ ] `facturas_booster_clp` y `liquidaciones` **intactas en datos**; columnas `dte_*` marcadas `@deprecated` en `schema.ts`, sin escritura desde services, **sin migración destructiva** (guard expand/contract no se viola — no hay DROP).
- [ ] `GET /me/liquidaciones` deja de proyectar `dte_*` **y** el consumidor en `apps/web` fue ajustado (o se confirma que tolera su ausencia) — ver §4.
- [ ] ADR-069 mergeado (supersede ADR-024, modifica ADR-007, P0-A "no aplica").

## 4. User-visible behaviour

| Actor | Antes | Después |
|---|---|---|
| Admin plataforma | `POST /admin/liquidaciones/:id/emitir-dte` (re-emisión manual) | Endpoint **eliminado** (404) |
| Operador GCP | Cron horario `reconciliar-dtes` corriendo | Cron eliminado |
| **Carrier (PWA)** | `GET /me/liquidaciones` devuelve `dte_folio`/`dte_status`/`dte_pdf_url`/`dte_provider`/`dte_emitido_en` | **Esos campos desaparecen del payload** |

⚠️ **Contrato público (hallazgo #2 — CONFIRMADO por verificación adversarial)**: el consumidor existe y usa los campos activamente — `apps/web/src/hooks/use-liquidaciones.ts:33-37` (tipo `LiquidacionRow`) y `apps/web/src/routes/liquidaciones.tsx:180-202` (componente `DteCell`: `if(!row.dte_folio)`, render de `dte_status`/`dte_pdf_url`). Quitar los campos del backend SIN tocar el front **rompe la PWA**. → **O-7 es bloqueante de merge** (§11): la remoción de F3 DEBE incluir el cambio coordinado de `apps/web` (o mantener los 5 campos como `null` por backward-compat).

## 5. Out of scope

- **Recepción/archivo de DTE de terceros** (F4): este frente solo REMUEVE la emisión. La tabla `documentos_transporte` y el worker TED son F4.
- **DROP de columnas/tablas con datos**: prohibido (O-2). Solo deprecación.
- **Revertir la migración 0019**: las migraciones son inmutables; las columnas quedan inertes.
- **Bucket `documents` y secretos `dte-provider-*`**: se evalúan en F4 (posible reuso para recepción de terceros). F3 no los toca (solo los marca para revisión).
- **Reescritura de historial** para borrar menciones Sovos: no aplica (registro histórico).
- **Mención de "Sovos" en `apps/web/src/routes/legal-terminos.tsx:231`** (texto legal de proveedores: "Cloud, Twilio, Sovos"): NO se toca en F3 — es disclosure de términos de servicio, no código operacional. Actualizar el texto legal si Booster deja de usar Sovos del todo es un follow-up de producto/legal, no de esta remoción.

## 6. Constraints

- **Reversibilidad**: rama propia (`chore/remover-emision-dte-sovos` o similar); la remoción debe ser un PR atómico revisable. Git history conserva el código por si Booster vuelve a emitir.
- **O-2**: `facturas_booster_clp` sobrevive; deprecar solo `dte_*` (sin DROP). Igual para `liquidaciones`.
- **Stack Booster**: typecheck 0, lint 0, suite verde, Conventional Commit con scope, sección Evidencia en el PR.
- **Terraform**: `plan` revisado antes de `apply`; el `apply` del cron+topic es manual post-merge (no va por release.yml). Coordinar con `sre-oncall` (toca infra).
- **ADR antes de ejecutar**: ADR-069 se redacta y mergea con la remoción (no en retrospectiva). Numeración: 067 reservado por #426; 068 usado por F1/#495 → **F3 = ADR-069**.

## 7. Approach

Rama propia. Orden sugerido (PR único o 2 PRs: código + infra):

1. **Código de aplicación** (`apps/api`):
   - Eliminar `dte-emitter-factory.ts`, `emitir-dte-liquidacion.ts`, `reconciliar-dtes.ts`.
   - `liquidar-trip.ts`: quitar import (`:10`) + bloque wire DTE (`:188-206`); el service sobrevive.
   - `admin-liquidaciones.ts`: eliminar (router queda vacío); quitar registro en `server.ts:24,615-625`.
   - `admin-jobs.ts`: quitar import + handler `POST /reconciliar-dtes` (`:41,83-107`); el router sobrevive.
   - `config.ts`: eliminar `DTE_PROVIDER` (`:371-383`), `SOVOS_*` (`:390-391`), `BOOSTER_RUT/RAZON_SOCIAL/GIRO/DIRECCION/COMUNA` (`:393-406`).
   - Eliminar tests de emisión; podar casos DTE de `admin-jobs-route.test.ts` y `liquidar-trip.test.ts`.
2. **Package**: eliminar `packages/dte-provider/` completo + su entrada en workspace.
3. **Deprecación (sin DROP)** en `schema.ts`: marcar `@deprecated` las columnas `dte_*` de `facturas_booster_clp` (`:1992-2003`) y `liquidaciones` (`:1945-1948`); dejar de poblarlas. Conservar el valor `'dte_emitido'` en `chk_liquidaciones_status` (`:1957-1960`) como legacy.
4. **API web**: `me-liquidaciones.ts:57-64,89-93` deja de proyectar `dte_*` + simplificar el `leftJoin`. Coordinar con `apps/web` (§4 / O-7).
5. **Infra**: eliminar `scheduling.tf:154-189` (cron) y `messaging.tf:13,83-91` (`document-events`, hallazgo #1). `terraform plan` → solo 1 destroy de cron + 1 de topic.
6. **ADR-069** (§8) + actualizar narrativa de retención del bucket (P0-A "no aplica").
7. Secretos `dte-provider-*` y bucket `documents`: marcar para revisión en F4 (no remover en F3).

Subagents: `sre-oncall` pre-merge (infra: cron/topic destroy, rollback). `security-scanner` (que la remoción no abra un hueco; que los secretos huérfanos se traten).

## 8. ADR-069

`docs/adr/069-booster-deja-de-emitir-dte-remocion-sovos.md`:
- **Supersede ADR-024** (Sovos primario + multi-vendor LATAM): Booster ya no selecciona ni integra proveedor SII para emisión.
- **Modifica ADR-007 §emisión**: Booster pasa de EMISOR (DTE 33/52 en nombre de carriers) a **RECEPTOR/ARCHIVADOR** de DTE de terceros → conecta con F4 (repositorio documental, retención O-3).
- **Declara P0-A "no aplica"**: sin emisión, el gate de `storage.tf` ("emisión real de DTE en prod") es insatisfacible; la retención de docs de terceros se rige por O-3 sin WORM obligatorio salvo exigencia legal.
- **Obsoleta** `.specs/sec-h3-dte-retention-lock/` (su SC-4 es insatisfacible por diseño).

## 9. Risks

| ID | Riesgo | L | I | Mitigación |
|---|---|---|---|---|
| R-1 | Imports colgantes tras remover services | M | M | typecheck 0 como gate; remoción guiada por el inventario de `report.md` |
| R-2 | Romper la PWA del carrier al quitar `dte_*` de `/me/liquidaciones` | M | H | **O-7**: revisar `apps/web` antes de mergear; no mergear sin confirmar |
| R-3 | DROP accidental de datos en deprecación | L | H | Política: solo `@deprecated` + dejar de escribir; sin migración destructiva; guard expand/contract |
| R-4 | `terraform plan` arrastra cambios colaterales (drift) | M | M | Revisar plan; aplicar targeteado (`-target`) cron+topic; coordinar `sre-oncall` |
| R-5 | `document-events` tenía un consumer/publisher no detectado | L | M | Confirmado huérfano (0 pub/sub, consumer skeleton); grep de publishers antes de remover |
| R-6 | Secretos `dte-provider-*` quedan huérfanos | L | L | Marcados para revisión en F4; si F4 no los usa, remover ahí |

## 10. Test list

- Tras remoción: `pnpm --filter @booster-ai/api typecheck` 0; suite api verde sin tests DTE; `admin-jobs`/`liquidar-trip` (casos no-DTE) verdes.
- `grep -riE 'sovos|DTE_PROVIDER' apps packages` → 0 en código vivo.
- `terraform validate` + `plan` → solo destroy de `reconciliar_dtes` + `document_events`.
- Test de `/me/liquidaciones`: el payload ya no incluye `dte_*` (actualizar la aserción existente).
- Test de que `liquidar-trip` cierra la liquidación sin intentar emitir DTE.

## 11. Open questions

- **O-7 (contrato público — BLOQUEANTE, confirmado)**: `apps/web` SÍ consume los `dte_*` activamente (`hooks/use-liquidaciones.ts:33-37` + `routes/liquidaciones.tsx:180-202` `DteCell`). Quitar los campos del backend sin tocar el front rompe la PWA. **Decisión PO**: **(a)** mantener los 5 campos en el JSON como `null` (backward-compat; deja contrato muerto pero no rompe), o **(b)** actualizar `apps/web` primero (quitar `DteCell` / campos opcionales) y luego el backend, todo en el PR de F3. **Recomendado (b)** (contrato limpio, cambio coordinado front+back).
- **O-8**: `document-events` — ¿F3 lo absorbe (recomendado, ya que está huérfano en `main`) o se deja al PR #493 sin mergear? Si #493 mergea primero, F3 no lo toca. Default: F3 lo remueve.
- **O-9 (a F4)**: secretos `dte-provider-api-key`/`-client-secret` y bucket `documents` — ¿se reusan para recepción de DTE de terceros (F4) o se remueven? No bloquea F3.

## 12. Devils-advocate pass

- **"¿Remover destruye trabajo válido?"** El adapter pattern de ADR-024 se conserva en git history; si Booster vuelve a emitir, se restaura. Reversible. La decisión de pivote es del PO, explícita.
- **"P0-A: ¿se resuelve o se barre?"** Se elimina la causa (emisión). Pero ADR-069 DEBE declarar explícitamente la retención de docs de terceros (O-3) para no dejar un hueco de compliance — ya cubierto por O-3.
- **"¿El grep=0 es real?"** Habrá menciones en ADR-024/007 e historia — eso es registro, no código vivo. El criterio es código ejecutable.
- **"Contrato /me/liquidaciones"**: es el riesgo real (R-2). Por eso O-7 es gate de merge, no opcional.

## 13. Approval

- [ ] **PO aprueba el reporte + spec F3** y autoriza la remoción.
- [ ] PO/yo confirmamos O-7 (consumidor `apps/web` de `/me/liquidaciones`) antes de mergear.
- [ ] PO decide O-8 (F3 absorbe `document-events` vs esperar #493).

**Pendiente de firma — fecha:** ____________
