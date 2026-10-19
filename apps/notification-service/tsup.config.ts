import { defineConfig } from 'tsup';

/**
 * Tsup config para apps/notification-service (T10-21, Cloud Run).
 *
 * `noExternal` incluye los workspace packages @booster-ai/* en el bundle (sus
 * package.json apuntan a TS source). Cada `external` DEBE estar en
 * `dependencies` de este package.json: `pnpm deploy --prod` solo instala
 * deps directas, y un external ausente tumba la imagen al arrancar
 * (ERR_MODULE_NOT_FOUND; caso real en document-service, #763).
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
    // El exporter de Cloud Monitoring es CJS y, al evaluarse, hace
    // require("google-auth-library"); googleauth.js a su vez hace
    // require("child_process") en el tope del módulo. esbuild reescribe
    // ese require a un helper que en el dist ESM tira
    // `Dynamic require of "child_process" is not supported` al cargar
    // instrumentation.js — el proceso muere antes de escuchar /health
    // y el startup probe de Cloud Run falla. External + dependency
    // directa: Node los carga como CJS desde el node_modules de
    // `pnpm deploy --prod`. Mismo criterio que apps/api/tsup.config.ts.
    '@google-cloud/opentelemetry-cloud-monitoring-exporter',
    '@opentelemetry/sdk-metrics',
    '@google-cloud/pubsub',
    'pino',
    'pino-pretty',
    'zod',
  ],
});
