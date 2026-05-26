#!/usr/bin/env tsx
/**
 * T2b T6c (Sprint 2b SEC-001) — Comment-lint CI gate sobre
 * `apps/api/src/middleware/is-demo-allowlist.ts`.
 *
 * Spec sec-001-cierre §3 SC-1.3.6 part 2 + plan-sprint-2b §3 T2b:
 *   - Parsea el archivo allowlist (regex sobre object literals dentro
 *     de `ALLOWLISTED_PATHS = [...]`).
 *   - Valida cada entry tiene:
 *       (a) `rationale` non-empty
 *       (b) `reviewBy` formato `YYYY-MM-DD` y fecha estrictamente en
 *           futuro (> today).
 *   - Exit 1 si falla con output structured (path + violation).
 *   - Exit 0 si pasa.
 *
 * Defense-in-depth: si un PR author añade una entry sin justificación
 * o con reviewBy en pasado, el CI lo bloquea (workflow `security.yml`
 * job `is-demo-allowlist-comments`).
 *
 * Ejecución directa:
 *   pnpm exec tsx apps/api/scripts/check-is-demo-allowlist-comments.ts
 *
 * Test-only export shape (no side-effects fuera del CLI gate):
 *   import { parseAllowlistEntries, validateEntries } from './check-is-demo-allowlist-comments.js';
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ALLOWLIST_FILE = new URL('../src/middleware/is-demo-allowlist.ts', import.meta.url).pathname;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Shape extraída por el parser. Sólo los campos que validamos. */
export interface ParsedEntry {
  /** Valor de `path:` o `'<unknown>'` si no se pudo extraer. */
  path: string;
  /** Valor de `rationale:` o `undefined` si campo ausente. */
  rationale: string | undefined;
  /** Valor de `reviewBy:` o `undefined` si campo ausente. */
  reviewBy: string | undefined;
  /** Línea aproximada (1-based) donde empieza la entry, para diagnostics. */
  lineNumber: number;
}

/**
 * Extrae entries del source del archivo allowlist. Asume shape canónica:
 *
 *   export const ALLOWLISTED_PATHS: IsDemoAllowlistEntry[] = [
 *     { path: '...', methods: [...], rationale: '...', reviewBy: '...' },
 *     ...
 *   ];
 *
 * El parser localiza el array con regex sobre `ALLOWLISTED_PATHS` y luego
 * itera matchs de top-level `{...}` blocks. Per-entry, extrae campos con
 * regex simple (path/rationale/reviewBy son strings entre quotes
 * simples).
 */
export function parseAllowlistEntries(source: string): ParsedEntry[] {
  const arrayStartMatch = source.match(/ALLOWLISTED_PATHS[^=]*=\s*\[/);
  if (!arrayStartMatch || arrayStartMatch.index === undefined) {
    return [];
  }
  const arrayStartIdx = arrayStartMatch.index + arrayStartMatch[0].length;

  // Recolecta los object-literal blocks `{...}` a top-level del array
  // (i.e., con depth=1 dentro del array, depth=2 contando el array).
  // Tracking de braces handles nested arrays/objects en `methods: [...]`.
  const entries: ParsedEntry[] = [];
  let depth = 0;
  let blockStart = -1;
  for (let i = arrayStartIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') {
      if (depth === 0) {
        blockStart = i;
      }
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0 && blockStart !== -1) {
        const block = source.slice(blockStart, i + 1);
        entries.push(extractFields(block, lineFromIndex(source, blockStart)));
        blockStart = -1;
      }
    } else if (ch === ']' && depth === 0) {
      // Cierre del array de entries.
      break;
    }
  }
  return entries;
}

function lineFromIndex(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (source[i] === '\n') {
      line += 1;
    }
  }
  return line;
}

function extractFields(block: string, lineNumber: number): ParsedEntry {
  const pathMatch = block.match(/\bpath\s*:\s*['"]([^'"]*)['"]/);
  const rationaleMatch = block.match(/\brationale\s*:\s*['"]([^'"]*)['"]/);
  const reviewByMatch = block.match(/\breviewBy\s*:\s*['"]([^'"]*)['"]/);
  return {
    path: pathMatch?.[1] ?? '<unknown>',
    rationale: rationaleMatch?.[1],
    reviewBy: reviewByMatch?.[1],
    lineNumber,
  };
}

/**
 * Valida cada entry contra las reglas T6c. Retorna array de error
 * messages (vacío si todas pasan).
 *
 * @param entries — output de parseAllowlistEntries
 * @param now — fecha de referencia para chequear reviewBy > now.
 *              Inyectable en tests para reproducibilidad.
 */
export function validateEntries(entries: ParsedEntry[], now: Date = new Date()): string[] {
  const errors: string[] = [];
  for (const entry of entries) {
    if (!entry.rationale || entry.rationale.trim().length === 0) {
      errors.push(`[${entry.path} @ line ${entry.lineNumber}] rationale must be non-empty`);
    }
    const reviewByError = validateReviewBy(entry.reviewBy, now);
    if (reviewByError) {
      errors.push(`[${entry.path} @ line ${entry.lineNumber}] ${reviewByError}`);
    }
  }
  return errors;
}

function validateReviewBy(reviewBy: string | undefined, now: Date): string | null {
  if (!reviewBy) {
    return 'reviewBy field missing';
  }
  if (!ISO_DATE_RE.test(reviewBy)) {
    return `reviewBy must be ISO YYYY-MM-DD format; got '${reviewBy}'`;
  }
  const parsed = new Date(`${reviewBy}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return `reviewBy parse failed: '${reviewBy}'`;
  }
  if (parsed <= now) {
    return `reviewBy must be strictly in future (>today); got '${reviewBy}'`;
  }
  return null;
}

/**
 * CLI runner — sólo si el script se ejecuta directo via tsx, no si es
 * importado por tests. Lee el archivo allowlist, parsea, valida, exit
 * 0/1 según el resultado.
 */
function main(): void {
  const source = readFileSync(ALLOWLIST_FILE, 'utf-8');
  const entries = parseAllowlistEntries(source);
  const errors = validateEntries(entries);

  if (errors.length > 0) {
    console.error('[check-is-demo-allowlist-comments] FAIL — invalid entries:');
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    console.error(
      `\n${errors.length} violation(s) in ${entries.length} entries of ${ALLOWLIST_FILE}`,
    );
    process.exit(1);
  }

  console.log(`[check-is-demo-allowlist-comments] OK — ${entries.length} entries validated.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
