# Follow-up: `liquidaciones.tier_slug_aplicado` es NOT NULL en la BD y nullable en `schema.ts`

**Dimensión**: db / drift · **Estado**: pendiente · **Fuente**: bloque C del plan multi-tenant (`.specs/aislamiento-hallazgos-tenant/plan.md`), 2026-10-05.

## Problema

`apps/api/drizzle/0015_pricing_v2.sql` crea `tier_slug_aplicado text NOT NULL`. `apps/api/src/db/schema.ts` lo declara `text('tier_slug_aplicado')` sin `.notNull()`. Drizzle acepta un insert sin ese campo y Postgres lo rechaza con `23502`. Se detectó al escribir el fixture de `aislamiento-dos-empresas.integration.test.ts`.

## Impacto

Bajo en producción: el único escritor (`services/liquidar-trip.ts`) siempre lo setea. El riesgo es de tipos: un escritor nuevo compila y falla en runtime.

## Plan de pago

Un solo cambio: `.notNull()` en `schema.ts` (sin migración, la BD ya lo exige). Verificar que `pnpm drizzle-kit check` o el test `drift-alignment.integration.test.ts` no detecten otra columna en la misma situación.
