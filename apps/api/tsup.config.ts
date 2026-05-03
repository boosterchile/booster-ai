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
  entry: ['src/main.ts', 'src/jobs/merge-duplicate-users.ts'],
  format: ['esm'],
  clean: true,
  sourcemap: true,
  target: 'node22',
  noExternal: [/^@booster-ai\//],
  // Dependencias runtime que SÍ deben quedar como externals (existen en
  // node_modules del container porque están en package.json de la app).
  external: [
    'pg',
    'hono',
    '@hono/node-server',
    '@hono/zod-validator',
    'drizzle-orm',
    'ioredis',
    'pino',
    'pino-http',
    'firebase-admin',
    'zod',
    '@opentelemetry/api',
    '@opentelemetry/auto-instrumentations-node',
    '@opentelemetry/exporter-trace-otlp-http',
    '@opentelemetry/resources',
    '@opentelemetry/sdk-node',
    '@opentelemetry/semantic-conventions',
    // P2 — deps transitivas de @booster-ai/certificate-generator.
    // Bundlear el paquete workspace está OK (es nuestro código, lo
    // necesitamos inline por la regex `noExternal: /^@booster-ai\//`),
    // pero sus deps externas usan `require()` síncrono de Node built-ins
    // (stream, crypto, etc.) que rompe en ESM bundle con
    // "Dynamic require of X is not supported".
    // Dejarlas external = Node las carga vía el flat node_modules que
    // `pnpm deploy --prod` produce en el runtime stage del Dockerfile.
    '@google-cloud/kms',
    '@google-cloud/storage',
    '@signpdf/signpdf',
    '@signpdf/placeholder-plain',
    '@signpdf/utils',
    'node-forge',
    'pdf-lib',
  ],
});
