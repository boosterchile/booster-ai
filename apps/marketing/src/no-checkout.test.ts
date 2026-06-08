import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MKT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(MKT, 'src');

/**
 * SC4 — apps/marketing implementa ADR-010 MENOS checkout. Sin SDK de pago,
 * sin rutas de checkout, sin imports a un PSP/DTE. El cobro está descartado en
 * el modelo gateado (ADR-052; ver `.specs/marketing-site-signup-request/`).
 * Este test es la guarda estructural (plan T2), frontloadeada para que la
 * regresión se atrape desde el primer commit con rutas.
 */
const FORBIDDEN_DEPS = [
  'stripe',
  '@stripe/stripe-js',
  '@stripe/react-stripe-js',
  'mercadopago',
  'transbank',
  'transbank-sdk',
  '@transbank/transbank-sdk',
  'webpay',
  'flowcl',
  '@flowcl/node',
  '@booster-ai/dte-provider',
];

const FORBIDDEN_IMPORT =
  /from\s+['"](@?stripe|mercadopago|@?transbank|webpay|@?flowcl|@booster-ai\/dte-provider)/;

function srcFiles() {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.(test|spec)\./.test(f))
    .map((f) => path.join(SRC, f));
}

describe('apps/marketing sin checkout (plan T2, SC4)', () => {
  it('package.json no declara ningún SDK de pago ni el package DTE', () => {
    const pkg = JSON.parse(readFileSync(path.join(MKT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const dep of FORBIDDEN_DEPS) {
      expect(dep in all).toBe(false);
    }
  });

  it('no existen rutas de checkout/pago', () => {
    for (const route of ['checkout', 'pagar', path.join('api', 'checkout')]) {
      expect(existsSync(path.join(SRC, 'app', route, 'page.tsx'))).toBe(false);
      expect(existsSync(path.join(SRC, 'app', route, 'route.ts'))).toBe(false);
    }
  });

  it('ningún archivo de src importa un PSP/DTE', () => {
    const offenders = srcFiles().filter((file) =>
      FORBIDDEN_IMPORT.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
