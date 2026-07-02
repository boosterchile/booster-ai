# Spec — Cron de cobro mensual de membership fees (pricing v2, gap B5)

**Feature slug**: `pricing-v2-membership-cron`
**Fecha**: 2026-06-22
**ADRs**: [ADR-030 §7](../../docs/adr/030-pricing-v2-activation-commission-and-billing.md) (billing-engine recurrente), [ADR-031](../../docs/adr/031-pricing-v2-activacion-escala-minima.md) (§"Acciones diferidas": "Cron mensual de membership fees: se implementa cuando exista el primer carrier tier Standard/Pro/Premium"), [ADR-066](../../docs/adr/066-db-migration-rollback-strategy.md) (migración expand-only + `.down.sql`).
**Dominio**: financiero → **TDD obligatorio** (`booster-skills:tdd-dominio-critico`).

## Problema (gap B5)

El engine de pricing v2 está construido (`packages/pricing-engine`: `calcularCobroMembership`, `periodoMesDesde`) y las tablas existen (`carrier_memberships`, `membership_tiers`, `facturas_booster_clp` con su unique parcial `uq_facturas_membership_empresa_mes`), pero **el cron que dispara el cobro mensual estaba diferido**. Faltaba: el orquestador, el dunning, el port de pago, la ruta interna y el Cloud Scheduler.

## Decisiones de diseño

1. **Rail de pago STUBEADO** (no mueve dinero). Se introduce el port `MembershipPaymentGateway`; el default es `noopMembershipPaymentGateway`, que NO cobra y devuelve `pending_provider`. Replica cómo factoring (`cobra-hoy`) stubea el partner externo (el adelanto queda `solicitado`). El cobro real llega cuando exista `payment-provider` y se inyecte un gateway real — sin tocar la lógica.

2. **Dunning como sub-estado separado**, no como ampliación del `status` contable. Se añaden columnas aditivas a `facturas_booster_clp` (`cobro_estado`, `cobro_intentos`, `cobro_ultimo_intento_en`, `cobro_proximo_intento_en`, `cobro_gateway_ref`) en vez de ampliar el CHECK de `status` (eso sería DROP+ADD CONSTRAINT = DDL destructivo bajo ADR-066). La migración 0045 es **expand-only** (pasa el guard `check-migration-safety`).
   - `cobro_estado`: `pendiente_cobro → pending_payment_provider → reintentando → morosa | cobrada`.
   - Hasta 3 intentos (`DUNNING_MAX_INTENTOS`) con backoff de 7 días (`DUNNING_BACKOFF_DIAS`); al agotarlos → `morosa` (status contable → `vencida`).
   - La máquina de estados es **pura** (`decidirSiguienteDunning` en pricing-engine), testeada determinísticamente.

3. **Gating** por `PRICING_V2_ACTIVATED` (default `false` salvo prod): el service y la ruta hacen early-return no-op con el flag off.

4. **Idempotencia por ciclo**: el unique parcial `uq_facturas_membership_empresa_mes` (empresa+mes, ya existente en migración 0015) impide doble factura; el INSERT captura la violación y la cuenta como `ya_facturada`. El dunning solo reintenta facturas `pending_payment_provider`/`reintentando` con `cobro_proximo_intento_en` vencido.

5. **Trigger**: ruta interna `POST /admin/jobs/cobrar-memberships-mensual` (mismo patrón auth OIDC que los demás crons: middleware `cronAuthMiddleware` sobre `/admin/jobs/*` validando `INTERNAL_CRON_CALLER_SA`). Cloud Scheduler mensual (día 1, 08:00 Santiago), **`paused = true`** inicialmente (cron financiero: primer tick manual + observado por el PO).

## Entregables

| Archivo | Qué |
|---|---|
| `packages/pricing-engine/src/dunning-membership.ts` | `decidirSiguienteDunning` (pura) + tipos + constantes |
| `packages/pricing-engine/src/index.ts` | export del módulo dunning |
| `apps/api/src/services/membership-payment-gateway.ts` | port `MembershipPaymentGateway` + stub no-op |
| `apps/api/src/services/cobrar-memberships-mensual.ts` | orquestador delgado |
| `apps/api/src/routes/admin-jobs.ts` | ruta `POST /admin/jobs/cobrar-memberships-mensual` |
| `apps/api/src/server.ts` | comentario del wire (usa el stub por default) |
| `apps/api/src/db/schema.ts` | columnas dunning + CHECK + índice parcial |
| `apps/api/drizzle/0045_facturas_membership_dunning.sql` | migración expand-only |
| `apps/api/drizzle/down/0045_*.down.sql` | reverse manual (ADR-066) |
| `apps/api/drizzle/meta/_journal.json` | entry idx 45 |
| `infrastructure/scheduling.tf` | `google_cloud_scheduler_job.cobrar_memberships_mensual` (paused) |
| tests | dunning (pura), gateway stub, service (selección/cómputo/dunning/idempotencia/flag-off/stub), ruta |

## Cobertura de tests (TDD)

- **Pura** (`decidirSiguienteDunning`): éxito, pending 1º/2º/3º intento, rechazo, validaciones. 16 casos.
- **Gateway stub**: siempre `pending_provider` + ref null + log explícito. 2 casos.
- **Service**: flag-off no-op, sin memberships, factura nueva + stub → `pending_payment_provider`, idempotencia (ya cobrada + race unique), dunning (reintento incrementa contador, 3º → morosa, backoff no vencido → skip), pago exitoso (provider futuro), múltiples memberships. 10 casos.
- **Ruta**: flag-off skipped, happy path snake_case + `payment_rail_stubbed:true`, defensa skipped. 3 casos.

## Pendiente / diferido explícito

- **`payment-provider` real** (Transbank/Khipu/Stripe/etc.): mientras no exista, el gateway es el stub no-op y las facturas paran en `pending_payment_provider` (NO cobradas). Activar = implementar el port real + inyectarlo en `server.ts`.
- **Migración 0045 NO aplicada en una BD real en este entorno** (no hay Postgres server ni docker disponible; solo `psql` client). Validada estáticamente (guard expand-only + estilo idéntico a las 44 migraciones previas + schema Drizzle typecheck). Aplicar/ensayar en staging/prod antes de despausar el cron.
- **Cloud Scheduler arranca `paused`**: el PO corre el primer tick manual y observado antes de despausar.
