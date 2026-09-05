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
 * Aviso previo al vencimiento (follow-up de PR #668, 2026-09-05): si una
 * entry vence dentro de `--warn-days` (default 14) el gate AVISA sin
 * fallar: línea en stderr y, bajo GitHub Actions, anotación `::warning`
 * visible en la pestaña de checks. Una entry ya vencida sigue siendo
 * exit 1: el contrato del gate no se relaja.
 *
 * Defense-in-depth: si un PR author añade una entry sin justificación
 * o con reviewBy en pasado, el CI lo bloquea (workflow `security.yml`
 * job `is-demo-allowlist-comments`).
 *
 * Ejecución directa:
 *   pnpm exec tsx apps/api/scripts/check-is-demo-allowlist-comments.ts [--warn-days=N]
 *
 * Test-only export shape (no side-effects fuera del CLI gate):
 *   import { parseAllowlistEntries, validateEntries, findExpiringEntries } from './check-is-demo-allowlist-comments.js';
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ALLOWLIST_FILE = new URL('../src/middleware/is-demo-allowlist.ts', import.meta.url).pathname;
/** Ruta relativa al repo, para las anotaciones de GitHub Actions. */
const ALLOWLIST_REPO_PATH = 'apps/api/src/middleware/is-demo-allowlist.ts';

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;
const WARN_DAYS_FLAG = '--warn-days=';

/** Días de anticipación con los que el gate avisa un vencimiento. */
export const DEFAULT_WARN_DAYS = 14;

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

/** Entry vigente cuyo reviewBy cae dentro de la ventana de aviso. */
export interface ExpiringEntry {
  path: string;
  reviewBy: string;
  lineNumber: number;
  /** Días enteros hasta reviewBy (medianoche UTC), redondeando hacia arriba. */
  daysLeft: number;
}

/**
 * Entries que vencen dentro de `warnDays`: `now < reviewBy ≤ now + warnDays`.
 * Las vencidas, malformadas o sin reviewBy NO se incluyen: esas son
 * errores de `validateEntries`, no avisos. `warnDays = 0` nunca avisa.
 */
export function findExpiringEntries(
  entries: ParsedEntry[],
  now: Date = new Date(),
  warnDays: number = DEFAULT_WARN_DAYS,
): ExpiringEntry[] {
  const expiring: ExpiringEntry[] = [];
  if (warnDays <= 0) {
    return expiring;
  }
  const nowMs = now.getTime();
  const windowEndMs = nowMs + warnDays * MS_PER_DAY;
  for (const entry of entries) {
    const reviewBy = entry.reviewBy;
    if (!reviewBy || !ISO_DATE_RE.test(reviewBy)) {
      continue;
    }
    const reviewByMs = new Date(`${reviewBy}T00:00:00Z`).getTime();
    if (Number.isNaN(reviewByMs) || reviewByMs <= nowMs || reviewByMs > windowEndMs) {
      continue;
    }
    expiring.push({
      path: entry.path,
      reviewBy,
      lineNumber: entry.lineNumber,
      daysLeft: Math.ceil((reviewByMs - nowMs) / MS_PER_DAY),
    });
  }
  return expiring;
}

/**
 * Anotación `::warning` de GitHub Actions (una línea). Aparece en la
 * pestaña de checks del PR y en el resumen del job.
 */
export function formatGitHubWarning(entry: ExpiringEntry, file: string): string {
  const title = 'is-demo allowlist reviewBy por vencer';
  const message = `${entry.path} vence el ${entry.reviewBy} (${entry.daysLeft} día(s)); re-review obligatoria antes de esa fecha`;
  return `::warning file=${file},line=${entry.lineNumber},title=${title}::${message}`;
}

/**
 * Lee `--warn-days=N` de argv. Sin flag → DEFAULT_WARN_DAYS. Valor que
 * no sea entero ≥ 0 → null (uso inválido; el CLI sale con 2).
 */
export function parseWarnDays(argv: string[]): number | null {
  const flag = argv.find((arg) => arg.startsWith(WARN_DAYS_FLAG));
  if (flag === undefined) {
    return DEFAULT_WARN_DAYS;
  }
  const raw = flag.slice(WARN_DAYS_FLAG.length);
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  return Number.parseInt(raw, 10);
}

/**
 * CLI runner — sólo si el script se ejecuta directo via tsx, no si es
 * importado por tests. Lee el archivo allowlist, parsea, valida, exit
 * 0/1 según el resultado (2 si el flag es inválido). Los avisos de
 * vencimiento próximo no cambian el exit code.
 */
function main(): void {
  const warnDays = parseWarnDays(process.argv.slice(2));
  if (warnDays === null) {
    console.error(
      `[check-is-demo-allowlist-comments] uso: ${WARN_DAYS_FLAG}<entero ≥ 0> (default ${DEFAULT_WARN_DAYS})`,
    );
    process.exit(2);
  }

  const now = new Date();
  const source = readFileSync(ALLOWLIST_FILE, 'utf-8');
  const entries = parseAllowlistEntries(source);
  const errors = validateEntries(entries, now);

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

  const expiring = findExpiringEntries(entries, now, warnDays);
  if (expiring.length > 0) {
    console.error(
      `[check-is-demo-allowlist-comments] WARN — ${expiring.length} entr${expiring.length === 1 ? 'y vence' : 'ies vencen'} dentro de ${warnDays} días (no bloquea):`,
    );
    for (const entry of expiring) {
      console.error(
        `  - [${entry.path} @ line ${entry.lineNumber}] reviewBy ${entry.reviewBy} (${entry.daysLeft} día(s) restantes)`,
      );
      if (process.env.GITHUB_ACTIONS === 'true') {
        console.log(formatGitHubWarning(entry, ALLOWLIST_REPO_PATH));
      }
    }
  }

  const suffix = expiring.length > 0 ? `, ${expiring.length} por vencer` : '';
  console.log(
    `[check-is-demo-allowlist-comments] OK — ${entries.length} entries validated${suffix}.`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
