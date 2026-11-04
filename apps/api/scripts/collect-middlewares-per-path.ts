/**
 * Parser de `app.use('/path', …)` en `server.ts`: devuelve, por path, los
 * identifiers de middleware que cada mount menciona. Lo usa el gate
 * `check-impersonation-wire-completeness.ts`.
 *
 * Vivía en el gate is-demo, retirado con la superficie demo (T10-03,
 * ADR-082).
 */

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
