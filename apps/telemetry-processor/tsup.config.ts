import { defineConfig } from 'tsup';

/**
 * Tsup config para apps/telemetry-processor.
 *
 * `noExternal` con @booster-ai/* fuerza a tsup a INCLUIR los workspace packages
 * dentro del bundle final. Sin esto, dist/main.js hace `import '@booster-ai/logger'`
 * y Node intenta resolver a node_modules/@booster-ai/logger/src/index.ts
 * (el package.json apunta a TS source). Node 22 falla con
 * ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING.
 *
 * Mismo patrón que apps/api/tsup.config.ts.
 */
export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  clean: true,
  sourcemap: true,
  target: 'node22',
  noExternal: [/^@booster-ai\//],
  // Dependencias runtime que SÍ deben quedar como externals (existen en
  // node_modules del container porque están en package.json de la app).
  external: ['pg', 'drizzle-orm', 'pino', 'pino-pretty', 'zod', '@google-cloud/pubsub'],
});
