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
  entry: ['src/main.ts'],
  format: ['esm'],
  clean: true,
  sourcemap: true,
  target: 'node22',
  noExternal: [/^@booster-ai\//],
  external: ['hono', '@hono/node-server', '@google-cloud/pubsub', 'pino', 'zod'],
});
