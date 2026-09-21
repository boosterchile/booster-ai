#!/usr/bin/env tsx
/**
 * Guard del hot path de auth (Slot 2, slice retiro-es-demo-auth-hot-path).
 *
 * Invertido respecto del gate SC-1.3.2 original: ese exigía
 * `isDemoEnforcementMiddleware` + `demoExpiresMiddleware` en cada mount
 * con `firebaseAuthMiddleware`. El login demo ya no existe y el branch
 * corría en cada request autenticado (passthrough si el claim no era
 * demo). Ahora el script falla si `server.ts` vuelve a importar o montar
 * ese enforcement.
 *
 * `collectMiddlewaresPerPath` se conserva: lo reutiliza el gate de
 * impersonación.
 *
 * Ejecución directa:
 *   pnpm exec tsx apps/api/scripts/check-is-demo-wire-completeness.ts
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SERVER_FILE = new URL('../src/server.ts', import.meta.url).pathname;

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

const HOT_PATH_DEMO_MARKERS = [
  'createDemoExpiresMiddleware',
  'createIsDemoEnforcementMiddleware',
  'demoExpiresMiddleware',
  'isDemoEnforcementMiddleware',
  "from './middleware/demo-expires",
  'from "./middleware/demo-expires',
  "from './middleware/is-demo-enforcement",
  'from "./middleware/is-demo-enforcement',
] as const;

/**
 * Quita comentarios para que una nota histórica no dispare el guard.
 * No interpreta strings: estos markers no aparecen en literales de server.ts.
 */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Markers de enforcement demo presentes en código (no en comentarios).
 * Array vacío = el request path de `server.ts` no monta ni importa el chain.
 * Cualquier hit es una reintroducción: el guard debe fallar.
 */
export function findHotPathDemoEnforcement(source: string): string[] {
  const code = stripComments(source);
  const hits: string[] = [];
  for (const marker of HOT_PATH_DEMO_MARKERS) {
    if (code.includes(marker)) {
      hits.push(marker);
    }
  }
  return hits;
}

function main(): void {
  const source = readFileSync(SERVER_FILE, 'utf-8');
  const hits = findHotPathDemoEnforcement(source);

  if (hits.length > 0) {
    console.error(
      '[check-is-demo-wire-completeness] FAIL — enforcement demo reintroducido en el hot path de server.ts:',
    );
    for (const hit of hits) {
      console.error(`  - ${hit}`);
    }
    console.error(
      `\n${hits.length} marker(s) en ${SERVER_FILE}. El chain productivo no monta demoExpires ni isDemoEnforcement.`,
    );
    process.exit(1);
  }

  console.log(
    '[check-is-demo-wire-completeness] OK — server.ts no monta ni importa enforcement demo en el hot path.',
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
