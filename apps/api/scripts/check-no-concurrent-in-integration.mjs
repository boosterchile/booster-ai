#!/usr/bin/env node
/**
 * Lint rule del plan §D3 (test-integration-infra-apps-api v2):
 *   - Integration tests deben correr serialmente sobre un schema único.
 *   - `test.concurrent`, `it.concurrent`, `describe.concurrent` rompen
 *     ese contrato. Biome v1.9 no soporta `noRestrictedSyntax` para
 *     method chains arbitrarios, así que este check vive como script
 *     enganchado a `pretest:integration`.
 *
 * Falla con exit 1 si encuentra `\b(test|it|describe)\.concurrent\b` en
 * cualquier archivo bajo `apps/api/test/integration/`.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const TARGET_DIR = new URL('../test/integration', import.meta.url).pathname;
const FORBIDDEN = /\b(test|it|describe)\.concurrent\b/;

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return out;
    }
    throw err;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(test|spec)\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const offenders = [];
for (const file of walk(TARGET_DIR)) {
  const content = readFileSync(file, 'utf-8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    if (FORBIDDEN.test(line)) {
      offenders.push({ file, line: idx + 1, text: line.trim() });
    }
  });
}

if (offenders.length > 0) {
  console.error('Integration tests no pueden usar .concurrent (plan §D3):');
  for (const o of offenders) {
    console.error(`  ${o.file}:${o.line}  ${o.text}`);
  }
  process.exit(1);
}
process.exit(0);
