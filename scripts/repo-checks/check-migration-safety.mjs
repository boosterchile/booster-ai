#!/usr/bin/env node
/**
 * @booster-ai/scripts — check-migration-safety (audit P1-H, ADR-066)
 *
 * Enforcea la convención expand/contract: una migración Drizzle NUEVA no puede
 * traer DDL destructivo (que rompe backward-compat → el rollback de código deja
 * de ser seguro) sin declararlo explícitamente como la fase `contract`
 * planificada de un expand/contract con el marcador:
 *
 *   -- contract-phase: <ADR/issue/ref>
 *
 * Las migraciones se aplican al STARTUP del servicio (apps/api/src/db/migrator.ts)
 * y Drizzle es forward-only; el undo real de un DDL es PITR/clone, no un down
 * auto-aplicado (ver ADR-066 + docs/runbooks/db-migration-rollback.md).
 *
 * Opera SOLO sobre los archivos pasados como argumento (en CI = los .sql
 * AÑADIDOS en el diff vs la base), nunca sobre las migraciones ya aplicadas.
 *
 * Usage:
 *   node scripts/repo-checks/check-migration-safety.mjs <file.sql> [<file.sql> ...]
 *
 * Exit codes:
 *   0 = sin DDL destructivo, o todos con marcador contract-phase
 *   1 = al menos un archivo con DDL destructivo sin marcador
 *   2 = error de uso (archivo no legible)
 */
import { readFileSync } from 'node:fs';
import process from 'node:process';

/**
 * Patrones de DDL destructivo (rompen backward-compat dentro de un deploy).
 * Se evalúan sobre el SQL con los comentarios `--` ya removidos.
 */
const DESTRUCTIVE_PATTERNS = [
  { name: 'DROP TABLE', re: /\bdrop\s+table\b/i },
  { name: 'DROP COLUMN', re: /\bdrop\s+column\b/i },
  { name: 'DROP CONSTRAINT', re: /\bdrop\s+constraint\b/i },
  { name: 'RENAME', re: /\brename\s+(to|column)\b/i },
  { name: 'SET NOT NULL', re: /\bset\s+not\s+null\b/i },
  { name: 'ALTER COLUMN TYPE', re: /\balter\s+column\b[^;]*\b(set\s+data\s+type|type)\b/i },
  { name: 'TRUNCATE', re: /\btruncate\b/i },
];

const CONTRACT_MARKER = /^[ \t]*--[ \t]*contract-phase:[ \t]*\S+/im;

/** Quita los comentarios de línea `-- ...` para no matchear DDL en prosa. */
function stripLineComments(sql) {
  return sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

/** Devuelve los nombres de patrones destructivos presentes en el SQL. */
export function findDestructiveStatements(sql) {
  const code = stripLineComments(sql);
  const found = [];
  for (const { name, re } of DESTRUCTIVE_PATTERNS) {
    if (re.test(code)) {
      found.push(name);
    }
  }
  return found;
}

/** True si el archivo declara explícitamente que es una fase contract. */
export function hasContractMarker(sql) {
  return CONTRACT_MARKER.test(sql);
}

export function main(argv) {
  const files = argv.filter((a) => !a.startsWith('-'));
  const violations = [];
  for (const file of files) {
    let content;
    try {
      content = readFileSync(file, 'utf-8');
    } catch (err) {
      process.stderr.write(`[check-migration-safety] no se pudo leer ${file}: ${err.message}\n`);
      return 2;
    }
    const destructive = findDestructiveStatements(content);
    if (destructive.length > 0 && !hasContractMarker(content)) {
      violations.push({ file, destructive });
    }
  }

  if (violations.length === 0) {
    process.stdout.write(
      `[check-migration-safety] OK — ${files.length} migración(es) nueva(s) sin DDL destructivo no declarado\n`,
    );
    return 0;
  }

  process.stderr.write(
    `[check-migration-safety] FAIL — ${violations.length} migración(es) con DDL destructivo sin marcador:\n`,
  );
  for (const v of violations) {
    process.stderr.write(`  ${v.file}: ${v.destructive.join(', ')}\n`);
  }
  process.stderr.write(
    '\nLas migraciones deben ser backward-compatible (expand/contract, ADR-066): el rollback\n' +
      'de la revisión Cloud Run NO revierte el esquema. Opciones:\n' +
      '  1. Reescribir como cambio aditivo (ADD COLUMN nullable, CREATE TABLE/INDEX).\n' +
      '  2. Partir en fases: expand → backfill → contract (deploy aparte, cuando el código\n' +
      '     viejo ya no corre).\n' +
      '  3. Si ESTA es la fase contract planificada, declararla con una línea:\n' +
      '       -- contract-phase: <ADR-XXX | issue#>\n' +
      'Runbook: docs/runbooks/db-migration-rollback.md\n',
  );
  return 1;
}

// CLI entrypoint — solo corre cuando se ejecuta directo, no al importar.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  process.exit(main(process.argv.slice(2)));
}
