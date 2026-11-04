import { defineConfig } from 'tsup';

/**
 * Tsup config para apps/matching-engine (T10-21, Cloud Run).
 *
 * `noExternal` incluye los workspace packages @booster-ai/* en el bundle (sus
 * package.json apuntan a TS source). Cada `external` DEBE estar en
 * `dependencies` de este package.json: `pnpm deploy --prod` solo instala
 * deps directas, y un external ausente tumba la imagen al arrancar
 * (ERR_MODULE_NOT_FOUND; caso real en document-service).
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
    // @booster-ai/otel-bootstrap (noExternal) importa estos dos en runtime.
    // Sin external, esbuild mete el exporter CJS de Cloud Monitoring en el
    // dist ESM. Ese paquete hace require() de google-auth-library al
    // cargarse, y googleauth.js hace require("child_process") en el tope
    // del módulo. En ESM el helper de esbuild tira
    // `Dynamic require of "…" is not supported` (child_process si la
    // librería queda inline; google-auth-library si ya era external) y
    // el proceso muere antes de /health. External + dependency directa,
    // igual que apps/api/tsup.config.ts.
    '@google-cloud/opentelemetry-cloud-monitoring-exporter',
    '@opentelemetry/sdk-metrics',
    '@hono/node-server',
    'google-auth-library',
    'hono',
    'pino',
    'pino-pretty',
    'zod',
  ],
});
