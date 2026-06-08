import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * apps/marketing — sitio público comercial (ADR-010, menos checkout; registro
 * vía signup-request gateado, ver `.specs/marketing-site-signup-request/`).
 *
 * - `transpilePackages`: los workspace packages se publican como TS fuente
 *   (sin build step), así que Next los transpila en el bundle.
 * - `outputFileTracingRoot`: ancla el tracing al root del monorepo (hay un
 *   pnpm-lock.yaml en el home que confunde la inferencia de Next).
 * - `webpack.extensionAlias`: el repo usa imports ESM con extensión `.js`
 *   (apps/api, apps/web, los packages). webpack no resuelve `.js`→`.ts/.tsx`
 *   por defecto; este alias lo habilita sin cambiar la convención de imports.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@booster-ai/ui-tokens', '@booster-ai/shared-schemas'],
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
    };
    return config;
  },
};

export default nextConfig;
