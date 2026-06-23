import { defineConfig } from 'tsup';

/**
 * Tsup config para apps/eco-routing-service.
 *
 * `noExternal` con @booster-ai/* incluye los workspace packages en el bundle.
 * Sin esto, Node intentaría resolver @booster-ai/* como TS source desde
 * node_modules y fallaría en producción.
 *
 * Mismo patrón que apps/telemetry-processor/tsup.config.ts.
 */
export default defineConfig({
  entry: ['src/main.ts', 'src/instrumentation.ts'],
  format: ['esm'],
  clean: true,
  sourcemap: true,
  target: 'node24',
  noExternal: [/^@booster-ai\//],
  // Dependencias runtime que SÍ deben quedar como externals.
  external: [
    'import-in-the-middle',
    '@opentelemetry/semantic-conventions',
    '@opentelemetry/sdk-trace-base',
    '@opentelemetry/sdk-node',
    '@opentelemetry/resources',
    '@opentelemetry/auto-instrumentations-node',
    '@opentelemetry/api',
    '@google-cloud/opentelemetry-cloud-trace-exporter',
    'zod',
    '@google-cloud/pubsub',
  ],
});
