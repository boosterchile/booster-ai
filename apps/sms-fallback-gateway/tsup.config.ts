import { defineConfig } from 'tsup';

/**
 * Tsup config para apps/sms-fallback-gateway — mismo rationale que
 * apps/whatsapp-bot/tsup.config.ts: bundlear los workspace packages
 * (@booster-ai/*) dentro del dist final.
 *
 * Sin esto, Node 22 explota al startup con
 * ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING porque
 * `@booster-ai/logger` etc. tienen `main: ./src/index.ts` (TS source) y
 * Node no puede strippear types desde archivos en node_modules.
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
    'hono',
    '@hono/node-server',
    '@google-cloud/pubsub',
    'pino',
    'zod',
  ],
});
