import { defineConfig } from 'tsup';

/**
 * Tsup config para apps/api.
 *
 * `noExternal` con pattern de @booster-ai/* fuerza a tsup a INCLUIR los
 * workspace packages (shared-schemas, logger, config, etc.) dentro del bundle
 * final de main.js. Sin esto, tsup los trata como externals y el runtime
 * Docker no puede resolverlos (los workspace deps viven como symlinks de pnpm
 * y no se copian al container).
 *
 * Alternativa considerada: `pnpm deploy --prod` para extraer un árbol
 * autocontenido. Elegimos bundling por simplicidad del Dockerfile.
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
  //
  // pino y pino-http se bundlean inline para evitar ERR_MODULE_NOT_FOUND
  // (pnpm workspaces no exponen esos paquetes en /app/node_modules como
  // carpetas directas, solo como symlinks en /app/node_modules/.pnpm/...).
  // Son JS puro y bundlean limpiamente.
  external: [
    'pg',
    'hono',
    '@hono/node-server',
    '@hono/zod-validator',
    'drizzle-orm',
    'ioredis',
    'firebase-admin',
    'zod',
    '@opentelemetry/api',
    '@opentelemetry/auto-instrumentations-node',
    '@opentelemetry/exporter-trace-otlp-http',
    '@opentelemetry/resources',
    '@opentelemetry/sdk-node',
    '@opentelemetry/semantic-conventions',
  ],
});
