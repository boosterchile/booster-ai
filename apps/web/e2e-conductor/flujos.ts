import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Credenciales del seed de flujos (`apps/api/scripts/seed-flujos-e2e.ts`).
 * RUTs propios, distintos del seed T2: el login por RUT tiene un límite de
 * 5 intentos cada 15 minutos que cuenta también los exitosos.
 */
export const CREDENCIAL_F = {
  gen: { rut: '77777777-7', clave: '482913', tipo: 'carga' },
  tra: { rut: '78787878-4', clave: '482913', tipo: 'transporte' },
  admin: { rut: '79797979-1', clave: '482913', tipo: 'booster' },
  stake: { rut: '75757575-2', clave: '864209', tipo: 'stakeholder' },
} as const;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Re-corre el seed de flujos (idempotente; limpia rate limits y el stakeholder). */
export function reseedFlujosE2e(): void {
  execFileSync('pnpm', ['--filter', '@booster-ai/api', 'seed:flujos-e2e'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099',
      FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID ?? 'booster-ai-dev',
    },
  });
}

/** `YYYY-MM-DDTHH:MM` en hora local, el formato de `<input type="datetime-local">`. */
export function datetimeLocal(fecha: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${p(fecha.getMonth() + 1)}-${p(fecha.getDate())}T${p(
    fecha.getHours(),
  )}:${p(fecha.getMinutes())}`;
}
