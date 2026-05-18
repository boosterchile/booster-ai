#!/usr/bin/env node
/**
 * @booster-ai/repo-checks — spec-canonical-drift
 *
 * Detecta drift entre listas de valores canónicos declarados en markdown de specs
 * (anotados con HTML comments) y sus definiciones source-of-truth en código
 * (Drizzle pgEnum o Zod z.enum).
 *
 * Resuelve Hallazgo H-S1a-2 (en_curso vs en_proceso): el T1.1 drift-inventory
 * compara schema-to-schema; este script compara spec-to-código, captura drift
 * que T1.1 no puede ver.
 *
 * Annotation convention:
 *
 *   <!-- canonical-source: <path>:<identifier> -->
 *   - `value1`
 *   - `value2`
 *
 * Subset semantics: cada bullet del spec debe existir en source. Source puede
 * tener valores adicionales (specs frecuentemente subsettean enumeraciones).
 *
 * Usage:
 *   node scripts/repo-checks/spec-canonical-drift.mjs
 *   node scripts/repo-checks/spec-canonical-drift.mjs --json
 *   node scripts/repo-checks/spec-canonical-drift.mjs --scan-dirs .specs,docs
 *   node scripts/repo-checks/spec-canonical-drift.mjs --repo-root /tmp/test-fixture
 *
 * Exit codes:
 *   0 = no drift (incluso si 0 annotations encontradas)
 *   1 = drift detectado
 *   2 = error de uso (scan dir no existe, etc.)
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';

const DEFAULT_SCAN_DIRS = ['.specs', 'docs'];

const ANNOTATION_RE =
  /<!--\s*canonical-source:\s*([a-zA-Z0-9_./-]+):([a-zA-Z_$][a-zA-Z0-9_$]*)\s*-->/;
const BULLET_RE = /^\s*-\s+`([^`]+)`\s*$/;

export function parseArgs(argv) {
  const args = {
    scanDirs: DEFAULT_SCAN_DIRS,
    repoRoot: '.',
    json: false,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--scan-dirs' && argv[i + 1]) {
      args.scanDirs = argv[i + 1].split(',').filter(Boolean);
      i++;
    } else if (argv[i] === '--repo-root' && argv[i + 1]) {
      args.repoRoot = argv[i + 1];
      i++;
    } else if (argv[i] === '--json') {
      args.json = true;
    } else if (argv[i] === '--quiet') {
      args.quiet = true;
    }
  }
  return args;
}

/**
 * Walk recursivo de un directorio buscando .md files.
 * Skip node_modules, .git, coverage dirs.
 */
export function findMarkdownFiles(rootDir) {
  const results = [];
  function walk(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'coverage' || entry.startsWith('.git')) continue;
      const full = join(dir, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full);
      } else if (entry.endsWith('.md')) {
        results.push(full);
      }
    }
  }
  walk(rootDir);
  return results;
}

/**
 * Parsea annotations + bullets siguientes en un archivo markdown.
 * Returns array of { sourcePath, identifier, bullets, line }.
 */
export function parseAnnotations(mdContent) {
  const annotations = [];
  const lines = mdContent.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = ANNOTATION_RE.exec(lines[i]);
    if (!match) continue;
    const sourcePath = match[1];
    const identifier = match[2];
    const bullets = [];
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    while (j < lines.length) {
      const bm = BULLET_RE.exec(lines[j]);
      if (bm) {
        bullets.push(bm[1]);
        j++;
      } else {
        break;
      }
    }
    annotations.push({ sourcePath, identifier, bullets, line: i + 1 });
  }
  return annotations;
}

/**
 * Extrae valores de un pgEnum o z.enum exportado con el identifier dado.
 * Returns null si el identifier no se encuentra. Returns string[] si sí.
 */
export function extractSourceValues(sourceContent, identifier) {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pgEnumRe = new RegExp(
    `export\\s+const\\s+${escaped}\\s*=\\s*pgEnum\\(\\s*'[^']+'\\s*,\\s*\\[([\\s\\S]*?)\\]\\)`,
  );
  const zodEnumRe = new RegExp(
    `export\\s+const\\s+${escaped}\\s*=\\s*z\\.enum\\(\\[([\\s\\S]*?)\\]\\)`,
  );
  let m = pgEnumRe.exec(sourceContent);
  if (!m) m = zodEnumRe.exec(sourceContent);
  if (!m) return null;
  const valuesBlock = m[1];
  return [...valuesBlock.matchAll(/'([^']+)'/g)].map((v) => v[1]);
}

/**
 * Subset check: returns bullets en spec que NO existen en source.
 */
export function compareSubset(specBullets, sourceValues) {
  return specBullets.filter((b) => !sourceValues.includes(b));
}

/**
 * Valida una annotation contra su source. Returns:
 *   { ok: true } si subset matchea
 *   { ok: false, kind, details, ... } si hay drift o error
 */
export function validateAnnotation(annotation, repoRoot) {
  const sourceFile = resolve(repoRoot, annotation.sourcePath);
  if (!existsSync(sourceFile)) {
    return {
      ok: false,
      kind: 'source-not-found',
      details: `Source file '${annotation.sourcePath}' does not exist`,
    };
  }
  if (annotation.bullets.length === 0) {
    return {
      ok: false,
      kind: 'no-bullets',
      details: `Annotation has no bullet list immediately following (expected '- \`value\`' bullets)`,
    };
  }
  const sourceContent = readFileSync(sourceFile, 'utf-8');
  const sourceValues = extractSourceValues(sourceContent, annotation.identifier);
  if (sourceValues === null) {
    return {
      ok: false,
      kind: 'identifier-not-found',
      details: `Identifier '${annotation.identifier}' not found in ${annotation.sourcePath} (looked for pgEnum or z.enum)`,
    };
  }
  const drift = compareSubset(annotation.bullets, sourceValues);
  if (drift.length > 0) {
    return {
      ok: false,
      kind: 'value-not-in-source',
      details: `Values in spec not present in source: ${drift.map((v) => `'${v}'`).join(', ')}. Source has: ${sourceValues.map((v) => `'${v}'`).join(', ')}`,
      drift,
      sourceValues,
    };
  }
  return { ok: true };
}

export function renderHumanReport(results, totals) {
  const { total, drift } = totals;
  if (drift === 0) {
    return `[spec-canonical-drift] OK — ${total} annotation(s) checked, 0 drift.\n`;
  }
  const lines = [
    `[spec-canonical-drift] DRIFT — ${total} annotation(s) checked, ${drift} drift detected:`,
  ];
  for (const r of results) {
    for (const a of r.annotations) {
      const v = r.validations[a.line];
      if (v.ok) continue;
      lines.push('');
      lines.push(`  ${r.file}:${a.line}`);
      lines.push(`    annotation: ${a.sourcePath}:${a.identifier}`);
      lines.push(`    kind: ${v.kind}`);
      lines.push(`    ${v.details}`);
    }
  }
  lines.push('');
  lines.push('Action: update spec bullets to match source, or fix typo/rename in spec.');
  lines.push('');
  return lines.join('\n');
}

export function renderJsonReport(results, totals) {
  const items = [];
  for (const r of results) {
    for (const a of r.annotations) {
      const v = r.validations[a.line];
      items.push({
        file: r.file,
        line: a.line,
        sourcePath: a.sourcePath,
        identifier: a.identifier,
        ok: v.ok,
        kind: v.kind || null,
        details: v.details || null,
        drift: v.drift || null,
      });
    }
  }
  return `${JSON.stringify({ totals, items }, null, 2)}\n`;
}

export function main(argv) {
  const args = parseArgs(argv);
  const allFiles = [];
  let anyDirMissing = false;
  for (const dir of args.scanDirs) {
    const dirAbs = resolve(args.repoRoot, dir);
    if (!existsSync(dirAbs)) {
      process.stderr.write(`[spec-canonical-drift] WARN: scan dir not found: ${dir}\n`);
      anyDirMissing = true;
      continue;
    }
    for (const f of findMarkdownFiles(dirAbs)) {
      allFiles.push(relative(resolve(args.repoRoot), f));
    }
  }
  if (anyDirMissing && allFiles.length === 0) {
    return 2;
  }
  const results = [];
  let total = 0;
  let drift = 0;
  for (const f of allFiles) {
    const content = readFileSync(resolve(args.repoRoot, f), 'utf-8');
    const annotations = parseAnnotations(content);
    if (annotations.length === 0) continue;
    const validations = {};
    for (const a of annotations) {
      total++;
      const v = validateAnnotation(a, args.repoRoot);
      validations[a.line] = v;
      if (!v.ok) drift++;
    }
    results.push({ file: f, annotations, validations });
  }
  const totals = { total, drift };
  if (args.json) {
    process.stdout.write(renderJsonReport(results, totals));
  } else if (!args.quiet) {
    process.stdout.write(renderHumanReport(results, totals));
  } else if (drift > 0) {
    process.stderr.write(`[spec-canonical-drift] ${drift} drift in ${total} annotation(s)\n`);
  }
  return drift > 0 ? 1 : 0;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  process.exit(main(process.argv.slice(2)));
}
