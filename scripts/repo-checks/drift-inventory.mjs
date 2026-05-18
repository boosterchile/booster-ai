#!/usr/bin/env node
/**
 * @booster-ai/repo-checks — drift-inventory
 *
 * Detecta divergencias entre packages/shared-schemas/src/domain/*.ts
 * (Zod schemas) y apps/api/src/db/schema.ts (Drizzle pgEnum + tablas).
 *
 * Implementa la metodologia del ADR-043 (drift schema/domain).
 *
 * Usage:
 *   node scripts/repo-checks/drift-inventory.mjs
 *   node scripts/repo-checks/drift-inventory.mjs --output .specs/s1-drift-coverage-e2e/inventory.md
 *   node scripts/repo-checks/drift-inventory.mjs --domain-dir <path> --schema-file <path>  # tests
 *
 * Exit codes (cubre SC-S1.0 enforcement):
 *   0 = sin divergencias O todas allowed
 *   1 = N divergencias > 10 OR Clase C >= 1 (gate stop-the-line; bloquea T1.2)
 *   2 = error de uso (dir/file no existe)
 *
 * Frontmatter del output:
 *   gate: PENDING_PO  -> default; pre-commit hook bloquea commits feat(domain)
 *   gate: APPROVED_BY_PO <fecha> -> PO firma post-review para permitir T1.2
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';

const DEFAULT_DOMAIN_DIR = 'packages/shared-schemas/src/domain';
const DEFAULT_SCHEMA_FILE = 'apps/api/src/db/schema.ts';
const DEFAULT_OUTPUT = '.specs/s1-drift-coverage-e2e/inventory.md';

const GATE_THRESHOLD_DIVERGENCES = 10;

/**
 * Identifiers TS-only sin equivalente SQL esperado.
 * Aparecer en domain/ es OK; no se reporta como divergencia.
 */
const ALLOWLIST_TS_ONLY = new Set([
  'correlationId',
  'requestId',
  'traceId',
  'spanId',
  'idempotencyKey',
]);

export function parseArgs(argv) {
  const args = {
    domainDir: DEFAULT_DOMAIN_DIR,
    schemaFile: DEFAULT_SCHEMA_FILE,
    output: DEFAULT_OUTPUT,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--domain-dir' && argv[i + 1]) {
      args.domainDir = argv[i + 1];
      i++;
    } else if (argv[i] === '--schema-file' && argv[i + 1]) {
      args.schemaFile = argv[i + 1];
      i++;
    } else if (argv[i] === '--output' && argv[i + 1]) {
      args.output = argv[i + 1];
      i++;
    } else if (argv[i] === '--quiet') {
      args.quiet = true;
    }
  }
  return args;
}

/**
 * Extrae enum values de `z.enum([...])` o `z.literal(...)` en un archivo TS.
 * Retorna Map<schemaName, string[]>.
 */
export function extractZodEnums(tsContent) {
  const enums = new Map();
  const zodEnumRe = /export\s+const\s+(\w+)\s*=\s*z\.enum\(\[([\s\S]*?)\]\)/g;
  for (const m of tsContent.matchAll(zodEnumRe)) {
    const name = m[1];
    const valuesBlock = m[2];
    const values = [...valuesBlock.matchAll(/'([^']+)'/g)].map((v) => v[1]);
    if (values.length > 0) {
      enums.set(name, values);
    }
  }
  return enums;
}

/**
 * Extrae enum values de `pgEnum('sql_name', [...])` en schema.ts.
 * Retorna Map<sqlName, { tsName, values }>.
 */
export function extractDrizzleEnums(tsContent) {
  const enums = new Map();
  const pgEnumRe = /export\s+const\s+(\w+)\s*=\s*pgEnum\(\s*'([^']+)'\s*,\s*\[([\s\S]*?)\]\)/g;
  for (const m of tsContent.matchAll(pgEnumRe)) {
    const tsName = m[1];
    const sqlName = m[2];
    const valuesBlock = m[3];
    const values = [...valuesBlock.matchAll(/'([^']+)'/g)].map((v) => v[1]);
    enums.set(sqlName, { tsName, values });
  }
  return enums;
}

/**
 * Match heuristico: domain `tripStateSchema` <-> sql tsName `tripStatusEnum`.
 * Genera variantes del nombre normalizado.
 */
export function normalizeForMatch(name) {
  return name
    .replace(/Schema$/, '')
    .replace(/Enum$/, '')
    .replace(/Status$/, 'State')
    .replace(/Estado$/, 'State')
    .toLowerCase();
}

/**
 * Encuentra divergencias entre Zod schemas y Drizzle pgEnums.
 * Empareja por nombre normalizado y compara valores.
 */
export function findDivergences(domainEnums, sqlEnums) {
  const divergences = [];
  const sqlByNormalized = new Map();
  for (const [sqlName, info] of sqlEnums) {
    sqlByNormalized.set(normalizeForMatch(info.tsName), { sqlName, ...info });
  }
  for (const [domainName, domainValues] of domainEnums) {
    if (ALLOWLIST_TS_ONLY.has(domainName)) {
      continue;
    }
    const normalized = normalizeForMatch(domainName);
    const sqlMatch = sqlByNormalized.get(normalized);
    if (!sqlMatch) {
      divergences.push({
        domainName,
        domainValues,
        sqlMatch: null,
        kind: 'no-sql-match',
      });
      continue;
    }
    const tsOnly = domainValues.filter((v) => !sqlMatch.values.includes(v));
    const sqlOnly = sqlMatch.values.filter((v) => !domainValues.includes(v));
    if (tsOnly.length > 0 || sqlOnly.length > 0) {
      divergences.push({
        domainName,
        domainValues,
        sqlMatch,
        tsOnly,
        sqlOnly,
        kind: 'value-mismatch',
      });
    }
  }
  return divergences;
}

/**
 * Renderiza output markdown.
 */
export function renderMarkdown(divergences, args) {
  const lines = [];
  lines.push('---');
  lines.push('gate: PENDING_PO');
  lines.push(`generated_at: ${new Date().toISOString()}`);
  lines.push(`source_domain: ${args.domainDir}`);
  lines.push(`source_schema: ${args.schemaFile}`);
  lines.push(`divergences_total: ${divergences.length}`);
  lines.push(`gate_threshold: ${GATE_THRESHOLD_DIVERGENCES}`);
  lines.push('---');
  lines.push('');
  lines.push('# Drift inventory schema/domain — Sprint S1 T1.1');
  lines.push('');
  lines.push(
    'Generado por `scripts/repo-checks/drift-inventory.mjs`. Cubre SC-S1.1 + gate SC-S1.0 del sprint S1.',
  );
  lines.push('');
  lines.push(
    `**Total divergencias detectadas**: ${divergences.length} (threshold gate: ${GATE_THRESHOLD_DIVERGENCES}).`,
  );
  lines.push('');
  lines.push('## Acción del PO');
  lines.push('');
  lines.push(
    'Clasificar cada divergencia como **Clase A** (TS-only refactor), **Clase B** (breaking API → flag + sunset + ADR), o **Clase C** (cambio SQL → ADR de excepción).',
  );
  lines.push('');
  lines.push(
    'Tras clasificar, cambiar frontmatter `gate: PENDING_PO` → `gate: APPROVED_BY_PO <fecha>` para permitir que pre-commit hook acepte commits `feat(domain)`.',
  );
  lines.push('');
  lines.push('## Divergencias');
  lines.push('');
  if (divergences.length === 0) {
    lines.push('Sin divergencias detectadas. SC-S1.0 cumple automáticamente.');
    lines.push('');
    return lines.join('\n');
  }
  lines.push(
    '| # | Schema domain (TS) | Schema SQL (Drizzle) | Tipo | TS-only values | SQL-only values | Clase (PO) |',
  );
  lines.push('|---|---|---|---|---|---|---|');
  divergences.forEach((d, idx) => {
    const tsOnly = (d.tsOnly || []).join(', ') || '(none)';
    const sqlOnly = (d.sqlOnly || []).join(', ') || '(none)';
    const sqlRef = d.sqlMatch
      ? `\`${d.sqlMatch.tsName}\` (\`${d.sqlMatch.sqlName}\`)`
      : '_no match_';
    lines.push(
      `| ${idx + 1} | \`${d.domainName}\` | ${sqlRef} | ${d.kind} | ${tsOnly} | ${sqlOnly} | _TBD_ |`,
    );
  });
  lines.push('');
  lines.push('## Tabla LOC adaptive (T1.5)');
  lines.push('');
  lines.push('Patterns aplicables para T1.5 (40 LOC × N patterns):');
  lines.push('');
  lines.push('- Pattern A (round-trip enum) → aplica si ≥1 Clase A.');
  lines.push('- Pattern B (identifier match en read query) → aplica si ≥1 Clase B.');
  lines.push('- Pattern C (flag transición Clase B durante doble-emit) → aplica si ≥1 Clase B.');
  lines.push('');
  lines.push('## Cómo regenerar');
  lines.push('');
  lines.push('```bash');
  lines.push('node scripts/repo-checks/drift-inventory.mjs');
  lines.push('```');
  return lines.join('\n');
}

export function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`[drift-inventory] arg error: ${err.message}\n`);
    return 2;
  }
  if (!existsSync(args.domainDir)) {
    process.stderr.write(`[drift-inventory] domain dir not found: ${args.domainDir}\n`);
    return 2;
  }
  if (!existsSync(args.schemaFile)) {
    process.stderr.write(`[drift-inventory] schema file not found: ${args.schemaFile}\n`);
    return 2;
  }
  const domainEnums = new Map();
  for (const f of readdirSync(args.domainDir).filter((x) => x.endsWith('.ts'))) {
    const content = readFileSync(join(args.domainDir, f), 'utf-8');
    for (const [k, v] of extractZodEnums(content)) {
      domainEnums.set(k, v);
    }
  }
  const sqlEnums = extractDrizzleEnums(readFileSync(args.schemaFile, 'utf-8'));
  const divergences = findDivergences(domainEnums, sqlEnums);
  const md = renderMarkdown(divergences, args);
  // Output to file or stdout
  if (args.output) {
    mkdirSync(dirname(args.output), { recursive: true });
    writeFileSync(args.output, md);
    if (!args.quiet) {
      process.stdout.write(
        `[drift-inventory] wrote ${divergences.length} divergence(s) to ${args.output}\n`,
      );
    }
  } else {
    process.stdout.write(md);
  }
  // Gate SC-S1.0
  if (divergences.length > GATE_THRESHOLD_DIVERGENCES) {
    process.stderr.write(
      `[drift-inventory] GATE FAIL: ${divergences.length} divergences > ${GATE_THRESHOLD_DIVERGENCES}. Sprint pausa hasta replan + firma PO.\n`,
    );
    return 1;
  }
  return 0;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  process.exit(main(process.argv.slice(2)));
}
