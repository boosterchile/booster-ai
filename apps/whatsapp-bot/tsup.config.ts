import { defineConfig } from 'tsup';

/**
 * Tsup config para apps/whatsapp-bot — mismo rationale que apps/api/tsup.config.ts:
 * bundlear los workspace packages (@booster-ai/*) dentro del dist final.
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
    'google-auth-library',
    'ioredis',
    'xstate',
    'pino',
    'zod',
  ],
});
