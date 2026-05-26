#!/usr/bin/env tsx
/**
 * T2b T6d (Sprint 2b SEC-001) — PR-modifies guard sobre
 * `apps/api/src/middleware/is-demo-allowlist.ts`.
 *
 * Spec sec-001-cierre §3 SC-1.3.6 part 3 + plan-sprint-2b §3 T2b:
 *   - Lee `git diff --name-only $BASE..HEAD` (BASE = env
 *     `GITHUB_BASE_REF` con prefijo `origin/`; fallback `HEAD~1`).
 *   - Si la allowlist NO está en el diff → exit 0 con mensaje "skipped".
 *   - Si SÍ está → ejecuta el mismo validator que T6c
 *     (`check-is-demo-allowlist-comments.ts`) y propaga su veredicto.
 *
 * Defense-in-depth: T6c siempre corre; T6d sólo en PRs que tocan el
 * archivo. La separación da visibilidad en PR check name (CI flag
 * concreto: "your PR modified the allowlist — here are the violations").
 *
 * Ejecución directa:
 *   pnpm exec tsx apps/api/scripts/check-allowlist-pr-guard.ts
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAllowlistEntries, validateEntries } from './check-is-demo-allowlist-comments.js';

const ALLOWLIST_RELATIVE_PATH = 'apps/api/src/middleware/is-demo-allowlist.ts';

export function isAllowlistFileInDiff(diffOutput: string, filePath: string): boolean {
  return diffOutput
    .split('\n')
    .map((l) => l.trim())
    .some((l) => l === filePath);
}

export interface PrGuardOptions {
  diffOutput: string;
  allowlistRelativePath: string;
  source: string;
  now?: Date;
}

export interface PrGuardResult {
  exitCode: 0 | 1;
  errors: string[];
  skipped: boolean;
}

export function runPrGuard(opts: PrGuardOptions): PrGuardResult {
  if (!isAllowlistFileInDiff(opts.diffOutput, opts.allowlistRelativePath)) {
    return { exitCode: 0, errors: [], skipped: true };
  }
  const entries = parseAllowlistEntries(opts.source);
  const errors = validateEntries(entries, opts.now);
  return {
    exitCode: errors.length > 0 ? 1 : 0,
    errors,
    skipped: false,
  };
}

/**
 * Resuelve el ref base contra el cual diffear. En PR CI Github expone
 * `GITHUB_BASE_REF` con el branch destino (e.g. `main`); GitHub Actions
 * suele dejar `origin/main` como reachable. Local fallback: `HEAD~1`.
 */
function resolveBaseRef(): string {
  const envBase = process.env.GITHUB_BASE_REF;
  if (envBase && envBase.trim().length > 0) {
    return `origin/${envBase.trim()}`;
  }
  return 'HEAD~1';
}

function gitDiffNameOnly(baseRef: string): string {
  return execSync(`git diff --name-only ${baseRef} HEAD`, {
    encoding: 'utf-8',
  });
}

function main(): void {
  const baseRef = resolveBaseRef();
  let diffOutput: string;
  try {
    diffOutput = gitDiffNameOnly(baseRef);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[check-allowlist-pr-guard] git diff failed (base=${baseRef}): ${errMsg}`);
    console.error(
      '[check-allowlist-pr-guard] aborting guard; CI should ensure git history available (fetch-depth: 0).',
    );
    process.exit(1);
  }

  const repoRoot = execSync('git rev-parse --show-toplevel', {
    encoding: 'utf-8',
  }).trim();
  const allowlistAbsPath = resolve(repoRoot, ALLOWLIST_RELATIVE_PATH);
  const source = readFileSync(allowlistAbsPath, 'utf-8');

  const result = runPrGuard({
    diffOutput,
    allowlistRelativePath: ALLOWLIST_RELATIVE_PATH,
    source,
  });

  if (result.skipped) {
    console.log(
      `[check-allowlist-pr-guard] OK — ${ALLOWLIST_RELATIVE_PATH} not in diff (base=${baseRef}); guard skipped.`,
    );
    process.exit(0);
  }

  if (result.exitCode === 1) {
    console.error(
      `[check-allowlist-pr-guard] FAIL — PR modifies ${ALLOWLIST_RELATIVE_PATH} but entries violate constraints:`,
    );
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    console.error(
      '\nFix: add `rationale` non-empty + `reviewBy` ISO YYYY-MM-DD strictly in future.',
    );
    process.exit(1);
  }

  console.log(
    `[check-allowlist-pr-guard] OK — PR modifies ${ALLOWLIST_RELATIVE_PATH}; entries validated.`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
