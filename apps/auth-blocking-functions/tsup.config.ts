import { writeFileSync } from 'node:fs';
import { defineConfig } from 'tsup';
import sourcePkg from './package.json' with { type: 'json' };

/**
 * Sprint 2c-B T3 — tsup build config for Cloud Function Gen 1 runtime.
 *
 * Gen 1 runtime (`gcloud functions deploy --no-gen2`) expects a
 * CommonJS entrypoint at `index.js` (or `main` in deployed package.json)
 * inside the `--source` directory. Workspace source is ESM (`"type":
 * "module"` in apps/auth-blocking-functions/package.json); this tsup
 * pipeline bridges:
 *   1. Compiles ESM → CJS bundle at `dist/index.js`.
 *   2. Writes a synthetic `dist/package.json` declaring `"type":
 *      "commonjs"` (so Node interprets `.js` as CJS at runtime
 *      regardless of the source workspace's ESM declaration) +
 *      `dependencies` listing only the EXTERNAL production deps
 *      (workspace deps are bundled via `noExternal` so they don't
 *      appear here).
 *
 * Per ADR-054: source format ESM (workspace convention) + deploy
 * artifact CommonJS (Gen 1 requirement) — bridged here.
 */

const EXTERNAL_RUNTIME_DEPS = [
  'gcip-cloud-functions',
  'firebase-admin',
  'firebase-functions',
  'pg',
  'punycode',
] as const;

function pickVersion(name: string): string {
  const v = (sourcePkg.dependencies as Record<string, string>)[name];
  if (!v) {
    throw new Error(
      `tsup post-build: missing version for runtime dep ${name} in source package.json`,
    );
  }
  return v;
}

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  outExtension: () => ({ js: '.js' }),
  noExternal: ['@booster-ai/logger', '@booster-ai/shared-schemas'],
  external: [...EXTERNAL_RUNTIME_DEPS],
  async onSuccess() {
    const distPkg = {
      name: '@booster-ai/auth-blocking-functions-deployed',
      version: sourcePkg.version,
      private: true,
      type: 'commonjs',
      main: 'index.js',
      engines: { node: '20' },
      dependencies: Object.fromEntries(
        EXTERNAL_RUNTIME_DEPS.map((name) => [name, pickVersion(name)]),
      ),
    };
    writeFileSync('dist/package.json', `${JSON.stringify(distPkg, null, 2)}\n`);
    // Build-time signal only (no runtime console at all in shipped code).
    process.stdout.write(
      '[tsup post-build] wrote dist/package.json (CJS + runtime deps for Gen 1)\n',
    );
  },
});
