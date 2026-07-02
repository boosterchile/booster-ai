#!/usr/bin/env tsx
/**
 * T3 SC-1.3.2 audit-completeness CI gate (Sprint 2b SEC-001).
 *
 * Spec sec-001-cierre §3 SC-1.3.2 v3.4 amendment A1 + plan-sprint-2b §3
 * T3 acceptance:
 *
 *   Parsea `apps/api/src/server.ts` → identifica mount points que
 *   aplican `firebaseAuthMiddleware` (auth-required) → verifica que
 *   cada uno también aplica `isDemoEnforcementMiddleware` en el chain.
 *   Exit 1 si algún path auth-required NO tiene enforcement (defense-
 *   in-depth coverage gap).
 *
 * Esto previene incomplete coverage shipping en future PRs: si un dev
 * agrega un mount point nuevo con `firebaseAuth` pero olvida wired el
 * is-demo-enforcement, CI lo flaggea.
 *
 * Diseño: regex parser (mismo enfoque que T6c). server.ts usa shape
 * canónica `app.use('/path', m1, m2, ...)`. El script:
 *   1. Detecta todos los `app.use('/path', ...)` calls (single + multi
 *      line, via brace-tracking).
 *   2. Por cada path, acumula la lista de middlewares mencionados en
 *      todos sus app.use calls.
 *   3. Filtra paths que mencionan `firebaseAuthMiddleware`.
 *   4. Reporta los que NO mencionan `isDemoEnforcementMiddleware`.
 *
 * Ejecución directa:
 *   pnpm exec tsx apps/api/scripts/check-is-demo-wire-completeness.ts
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SERVER_FILE = new URL('../src/server.ts', import.meta.url).pathname;
const FIREBASE_AUTH_IDENTIFIER = 'firebaseAuthMiddleware';
const IS_DEMO_ENFORCEMENT_IDENTIFIER = 'isDemoEnforcementMiddleware';
// Review 2026-06-11 (gap /certificates, Sprint 2c track-1): demo-expires
// también es REQUERIDO en todo mount auth-required — el gap original
// existió porque ningún gate lo exigía.
const DEMO_EXPIRES_IDENTIFIER = 'demoExpiresMiddleware';

/**
 * Map path → list de middleware identifiers mencionados en sus app.use
 * calls. Identifiers se acumulan a través de múltiples app.use sobre el
 * mismo path.
 */
export function collectMiddlewaresPerPath(source: string): Map<string, string[]> {
  const map = new Map<string, string[]>();

  // Regex matches: app.use(\n? <whitespace> '/path' ... cierre cualquiera
  // (single line con `);` o multi-line con `);` o `,)` etc.).
  // Brace-tracking para handle args complejos.
  const callPattern = /app\.use\s*\(\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null = callPattern.exec(source);
  while (match !== null) {
    const path = match[1] as string;
    const argStartIdx = match.index + match[0].length;

    // Encontrar el cierre `)` del app.use(...) tracking parens.
    let depth = 1;
    let argEndIdx = argStartIdx;
    for (let i = argStartIdx; i < source.length; i++) {
      const ch = source[i];
      if (ch === '(') {
        depth += 1;
      } else if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          argEndIdx = i;
          break;
        }
      }
    }

    const argsBlock = source.slice(argStartIdx, argEndIdx);
    const middlewares = extractMiddlewareIdentifiers(argsBlock);

    const existing = map.get(path) ?? [];
    map.set(path, existing.concat(middlewares));
    match = callPattern.exec(source);
  }

  return map;
}

/**
 * Extrae identifiers de middleware del bloque de argumentos. Identifier =
 * cualquier palabra que matche `\b<camelCase>Middleware\b` (convención
 * Booster: middlewares terminan en `Middleware`).
 */
function extractMiddlewareIdentifiers(argsBlock: string): string[] {
  const identifierPattern = /\b([a-z][A-Za-z0-9]*Middleware)\b/g;
  const ids: string[] = [];
  let m: RegExpExecArray | null = identifierPattern.exec(argsBlock);
  while (m !== null) {
    if (m[1]) {
      ids.push(m[1]);
    }
    m = identifierPattern.exec(argsBlock);
  }
  return ids;
}

/**
 * Identifica paths con firebaseAuthMiddleware pero SIN
 * isDemoEnforcementMiddleware. Retorna array vacío si coverage completa.
 */
export function findMissingEnforcement(source: string): string[] {
  const map = collectMiddlewaresPerPath(source);
  const missing: string[] = [];
  for (const [path, middlewares] of map.entries()) {
    const hasFirebase = middlewares.includes(FIREBASE_AUTH_IDENTIFIER);
    if (!hasFirebase) {
      continue;
    }
    if (!middlewares.includes(IS_DEMO_ENFORCEMENT_IDENTIFIER)) {
      missing.push(`${path} (falta ${IS_DEMO_ENFORCEMENT_IDENTIFIER})`);
    }
    if (!middlewares.includes(DEMO_EXPIRES_IDENTIFIER)) {
      missing.push(`${path} (falta ${DEMO_EXPIRES_IDENTIFIER})`);
    }
  }
  return missing;
}

function main(): void {
  const source = readFileSync(SERVER_FILE, 'utf-8');
  const missing = findMissingEnforcement(source);

  if (missing.length > 0) {
    console.error(
      '[check-is-demo-wire-completeness] FAIL — auth-required mount points con middleware demo faltante:',
    );
    for (const path of missing) {
      console.error(`  - ${path}`);
    }
    console.error(
      `\n${missing.length} coverage gap(s) en ${SERVER_FILE}. Fix: agregar el middleware faltante al chain (per-group, post-firebase-auth).`,
    );
    process.exit(1);
  }

  console.log(
    '[check-is-demo-wire-completeness] OK — todos los mount points auth-required en server.ts tienen isDemoEnforcement + demoExpires wired.',
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
