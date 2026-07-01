import { defineConfig } from 'tsup';

/**
 * Tsup config para apps/document-service (worker TED, Cloud Run).
 *
 * `noExternal` con @booster-ai/* fuerza a tsup a INCLUIR los workspace packages
 * en el bundle (sus package.json apuntan a TS source; Node no los resuelve
 * directo). Mismo patrón que apps/telemetry-processor/tsup.config.ts.
 *
 * Las deps WASM (pdfium, zxing-wasm) y sharp quedan como externals: viven en
 * node_modules del container (`--prod deploy`). pdfium/zxing cargan su .wasm
 * desde su propio paquete; sharp trae su binario prebuilt npm. Bundlearlos
 * rompería la resolución del .wasm/.node.
 */
export default defineConfig({
  entry: ['src/main.ts', 'src/instrumentation.ts'],
  format: ['esm'],
  clean: true,
  sourcemap: true,
  target: 'node22',
  noExternal: [/^@booster-ai\//],
  external: [
    'import-in-the-middle',
    '@opentelemetry/semantic-conventions',
    '@opentelemetry/sdk-trace-base',
    '@opentelemetry/sdk-node',
    '@opentelemetry/resources',
    '@opentelemetry/auto-instrumentations-node',
    '@opentelemetry/api',
    '@google-cloud/opentelemetry-cloud-trace-exporter',
    'pg',
    'drizzle-orm',
    'pino',
    'pino-pretty',
    'zod',
    '@google-cloud/pubsub',
    '@google-cloud/storage',
    '@hyzyla/pdfium',
    'zxing-wasm',
    'fast-xml-parser',
    'sharp',
  ],
});
