#!/usr/bin/env node
/**
 * @booster-ai/scripts — check-adr-numbering
 *
 * Verifica que cada numero de ADR (NNN) aparece exactamente una vez en
 * docs/adr/. Aplica disciplina "un numero por archivo" desde ADR-040 (ver
 * docs/handoff/CURRENT.md §Housekeeping ADRs).
 *
 * Las colisiones historicas (pre-040) se pasan via --allow-legacy NNN[,NNN...]
 * en el pre-commit hook (.husky/pre-commit) sin invalidar el guard general.
 *
 * Usage:
 *   node scripts/check-adr-numbering.mjs                              # falla si hay colisiones
 *   node scripts/check-adr-numbering.mjs --allow-legacy 028,034,035   # ignora las 3 historicas
 *   node scripts/check-adr-numbering.mjs --dir <path>                 # override dir (test)
 *
 * Exit codes:
 *   0 = sin colisiones (o todas allowed)
 *   1 = colisiones no allowed detectadas
 *   2 = error de uso (dir no existe, etc.)
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const ADR_PATTERN = /^(\d{3})-/;

export function parseArgs(argv) {
  const args = {
    allowLegacy: new Set(),
    dir: join(process.cwd(), 'docs', 'adr'),
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--allow-legacy' && argv[i + 1]) {
      argv[i + 1]
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean)
        .forEach((n) => args.allowLegacy.add(n.padStart(3, '0')));
      i++;
    } else if (argv[i] === '--dir' && argv[i + 1]) {
      args.dir = argv[i + 1];
      i++;
    }
  }
  return args;
}

export function findCollisions(dir, allowLegacy) {
  if (!existsSync(dir)) {
    throw new Error(`ADR dir not found: ${dir}`);
  }
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.md') && ADR_PATTERN.test(f))
    .sort();
  const byNumber = new Map();
  for (const f of files) {
    const num = f.match(ADR_PATTERN)[1];
    if (!byNumber.has(num)) {
      byNumber.set(num, []);
    }
    byNumber.get(num).push(f);
  }
  const collisions = [];
  for (const [num, fileList] of byNumber) {
    if (fileList.length > 1 && !allowLegacy.has(num)) {
      collisions.push({ number: num, files: fileList });
    }
  }
  return collisions;
}

export function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`[check-adr-numbering] arg error: ${err.message}\n`);
    return 2;
  }
  let collisions;
  try {
    collisions = findCollisions(args.dir, args.allowLegacy);
  } catch (err) {
    process.stderr.write(`[check-adr-numbering] ${err.message}\n`);
    return 2;
  }
  if (collisions.length === 0) {
    process.stdout.write(
      `[check-adr-numbering] OK — no collisions in ${args.dir}` +
        (args.allowLegacy.size > 0
          ? ` (legacy allowed: ${[...args.allowLegacy].sort().join(',')})\n`
          : '\n'),
    );
    return 0;
  }
  process.stderr.write(
    `[check-adr-numbering] FAIL — ${collisions.length} ADR number collision(s):\n`,
  );
  for (const c of collisions) {
    process.stderr.write(`  ADR-${c.number}: ${c.files.join(', ')}\n`);
  }
  process.stderr.write(
    'Hint: rename newer ADR to next free number, or pass --allow-legacy <NNN,...> for known historical collisions.\n',
  );
  return 1;
}

// CLI entrypoint — only runs when executed directly, not when imported.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  process.exit(main(process.argv.slice(2)));
}
