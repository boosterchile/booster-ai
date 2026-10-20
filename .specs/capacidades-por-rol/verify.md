# Verificación

- `pnpm --filter @booster-ai/shared-schemas exec vitest run src/domain/capacidades.test.ts`
- `pnpm --filter @booster-ai/api exec vitest run test/unit/me-ficha-conductor.test.ts test/unit/capacidades.test.ts test/unit/capacidades-rutas.test.ts`
- `pnpm --filter @booster-ai/web exec vitest run src/lib/capacidades.test.ts src/components/nav-items.test.ts src/routes/ofertas-voz-dueno.test.tsx`
- `node scripts/repo-checks/check-migration-safety.mjs apps/api/drizzle/0067_membresias_puede_aceptar_ofertas.sql`

La salida de cada corrida va en la sección Evidencia del PR que la contiene. No se aplica la migración en producción.
