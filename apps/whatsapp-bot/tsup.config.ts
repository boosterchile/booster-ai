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
  // pino se bundlea inline para evitar el ERR_MODULE_NOT_FOUND en runtime Docker
  // (pnpm workspaces no exponen pino en /app/node_modules, solo en
  // /app/node_modules/.pnpm/pino@.../node_modules/pino). Bundlearlo elimina
  // la dependencia de la resolución de módulos del runtime.
  external: ['hono', '@hono/node-server', 'google-auth-library', 'xstate', 'zod'],
});
