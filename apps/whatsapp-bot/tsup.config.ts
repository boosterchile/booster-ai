import { defineConfig } from 'tsup';

/**
 * Tsup config para apps/whatsapp-bot — mismo rationale que apps/api/tsup.config.ts:
 * bundlear los workspace packages (@booster-ai/*) dentro del dist final.
 */
export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  clean: true,
  sourcemap: true,
  target: 'node22',
  noExternal: [/^@booster-ai\//],
  external: ['hono', '@hono/node-server', 'google-auth-library', 'xstate', 'pino', 'zod'],
});
