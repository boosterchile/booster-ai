import { defineConfig } from 'drizzle-kit';

/**
 * Config de drizzle-kit para generar migraciones SQL desde el schema TypeScript.
 *
 * Uso:
 *   pnpm --filter @booster-ai/api exec drizzle-kit generate
 *
 * Las migraciones se aplican automáticamente al startup del servicio via
 * src/db/migrator.ts — no ejecutar `drizzle-kit migrate` manualmente en prod.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  verbose: true,
  strict: true,
});
