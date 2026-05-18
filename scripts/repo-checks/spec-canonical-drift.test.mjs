import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  compareSubset,
  extractSourceValues,
  findMarkdownFiles,
  main,
  parseAnnotations,
  parseArgs,
  renderHumanReport,
  renderJsonReport,
  validateAnnotation,
} from './spec-canonical-drift.mjs';

describe('parseArgs', () => {
  it('uses defaults when no args', () => {
    const args = parseArgs([]);
    expect(args.scanDirs).toEqual(['.specs', 'docs']);
    expect(args.repoRoot).toBe('.');
    expect(args.json).toBe(false);
    expect(args.quiet).toBe(false);
  });

  it('parses --scan-dirs (comma-separated)', () => {
    const args = parseArgs(['--scan-dirs', '.specs,docs,custom']);
    expect(args.scanDirs).toEqual(['.specs', 'docs', 'custom']);
  });

  it('filters empty entries from --scan-dirs', () => {
    const args = parseArgs(['--scan-dirs', '.specs,,docs']);
    expect(args.scanDirs).toEqual(['.specs', 'docs']);
  });

  it('parses --repo-root', () => {
    const args = parseArgs(['--repo-root', '/tmp/foo']);
    expect(args.repoRoot).toBe('/tmp/foo');
  });

  it('parses --json flag', () => {
    expect(parseArgs(['--json']).json).toBe(true);
  });

  it('parses --quiet flag', () => {
    expect(parseArgs(['--quiet']).quiet).toBe(true);
  });

  it('ignores unknown args', () => {
    const args = parseArgs(['--bogus', 'value', '--json']);
    expect(args.json).toBe(true);
  });
});

describe('parseAnnotations', () => {
  it('finds a single annotation with bullet list', () => {
    const md = [
      '# Test',
      '',
      '<!-- canonical-source: src/db/schema.ts:fooEnum -->',
      '- `a`',
      '- `b`',
      '- `c`',
      '',
      'paragraph after',
    ].join('\n');
    const annotations = parseAnnotations(md);
    expect(annotations).toHaveLength(1);
    expect(annotations[0].sourcePath).toBe('src/db/schema.ts');
    expect(annotations[0].identifier).toBe('fooEnum');
    expect(annotations[0].bullets).toEqual(['a', 'b', 'c']);
    expect(annotations[0].line).toBe(3);
  });

  it('handles blank lines between annotation and bullets', () => {
    const md = [
      '<!-- canonical-source: src/x.ts:barSchema -->',
      '',
      '',
      '- `value1`',
      '- `value2`',
    ].join('\n');
    const annotations = parseAnnotations(md);
    expect(annotations[0].bullets).toEqual(['value1', 'value2']);
  });

  it('handles indented bullets (nested under parent list item)', () => {
    const md = [
      '- [ ] **SC** — description:',
      '  <!-- canonical-source: src/x.ts:barEnum -->',
      '  - `a`',
      '  - `b`',
    ].join('\n');
    const annotations = parseAnnotations(md);
    expect(annotations).toHaveLength(1);
    expect(annotations[0].bullets).toEqual(['a', 'b']);
  });

  it('finds multiple annotations in one file', () => {
    const md = [
      '<!-- canonical-source: a.ts:e1 -->',
      '- `x`',
      '',
      '<!-- canonical-source: b.ts:e2 -->',
      '- `y`',
      '- `z`',
    ].join('\n');
    const annotations = parseAnnotations(md);
    expect(annotations).toHaveLength(2);
    expect(annotations[0].identifier).toBe('e1');
    expect(annotations[1].identifier).toBe('e2');
  });

  it('returns empty bullets when annotation has no following bullet list', () => {
    const md = [
      '<!-- canonical-source: src/x.ts:barEnum -->',
      '',
      'just a paragraph, no bullets',
    ].join('\n');
    const annotations = parseAnnotations(md);
    expect(annotations).toHaveLength(1);
    expect(annotations[0].bullets).toEqual([]);
  });

  it('returns empty array when no annotation found', () => {
    expect(parseAnnotations('# Just markdown, no annotation')).toEqual([]);
  });

  it('stops collecting bullets at first non-bullet line', () => {
    const md = [
      '<!-- canonical-source: src/x.ts:e -->',
      '- `a`',
      '- `b`',
      'paragraph breaks the list',
      '- `c`',
    ].join('\n');
    const annotations = parseAnnotations(md);
    expect(annotations[0].bullets).toEqual(['a', 'b']);
  });

  it('skips bullets without backtick format', () => {
    const md = ['<!-- canonical-source: src/x.ts:e -->', '- plain bullet, no backticks'].join('\n');
    const annotations = parseAnnotations(md);
    expect(annotations[0].bullets).toEqual([]);
  });

  it('ignores malformed annotation (missing colon)', () => {
    const md = '<!-- canonical-source: src/x.ts noColon -->\n- `a`';
    expect(parseAnnotations(md)).toEqual([]);
  });
});

describe('extractSourceValues', () => {
  it('extracts pgEnum values', () => {
    const content = `export const fooEnum = pgEnum('foo_sql', ['a', 'b', 'c']);`;
    expect(extractSourceValues(content, 'fooEnum')).toEqual(['a', 'b', 'c']);
  });

  it('extracts multiline pgEnum values', () => {
    const content = `
      export const tripStatusEnum = pgEnum('estado_viaje', [
        'borrador',
        'en_proceso',
        'entregado',
      ]);
    `;
    expect(extractSourceValues(content, 'tripStatusEnum')).toEqual([
      'borrador',
      'en_proceso',
      'entregado',
    ]);
  });

  it('extracts z.enum values', () => {
    const content = `export const fooSchema = z.enum(['x', 'y']);`;
    expect(extractSourceValues(content, 'fooSchema')).toEqual(['x', 'y']);
  });

  it('extracts multiline z.enum values', () => {
    const content = `
      export const tripStateSchema = z.enum([
        'requested',
        'in_transit',
      ]);
    `;
    expect(extractSourceValues(content, 'tripStateSchema')).toEqual(['requested', 'in_transit']);
  });

  it('returns null when identifier not found', () => {
    const content = `export const someOther = pgEnum('x', ['a']);`;
    expect(extractSourceValues(content, 'nonExistent')).toBeNull();
  });

  it('escapes regex special characters in identifier', () => {
    const content = `export const foo_bar = z.enum(['a']);`;
    expect(extractSourceValues(content, 'foo_bar')).toEqual(['a']);
  });

  it('prefers pgEnum if both pgEnum and z.enum exist with same name (impossible in real code, defensive)', () => {
    const content = `
      export const dup = pgEnum('dup_sql', ['from_pg']);
      export const dup = z.enum(['from_zod']);
    `;
    expect(extractSourceValues(content, 'dup')).toEqual(['from_pg']);
  });
});

describe('compareSubset', () => {
  it('returns empty when spec is full subset of source', () => {
    expect(compareSubset(['a', 'b'], ['a', 'b', 'c', 'd'])).toEqual([]);
  });

  it('returns drift values when spec has value not in source', () => {
    expect(compareSubset(['a', 'typo'], ['a', 'b'])).toEqual(['typo']);
  });

  it('returns all spec values as drift if source is empty', () => {
    expect(compareSubset(['a', 'b'], [])).toEqual(['a', 'b']);
  });

  it('returns empty when both are empty', () => {
    expect(compareSubset([], [])).toEqual([]);
  });

  it('does NOT flag source values not in spec (subset semantic)', () => {
    expect(compareSubset(['a'], ['a', 'b', 'c'])).toEqual([]);
  });
});

describe('validateAnnotation', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'spec-drift-'));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns ok when subset matches', () => {
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'src/schema.ts'),
      `export const fooEnum = pgEnum('foo', ['a', 'b', 'c']);`,
    );
    const result = validateAnnotation(
      { sourcePath: 'src/schema.ts', identifier: 'fooEnum', bullets: ['a', 'b'], line: 1 },
      tmpDir,
    );
    expect(result.ok).toBe(true);
  });

  it('returns source-not-found when path does not exist', () => {
    const result = validateAnnotation(
      { sourcePath: 'missing.ts', identifier: 'foo', bullets: ['a'], line: 1 },
      tmpDir,
    );
    expect(result.ok).toBe(false);
    expect(result.kind).toBe('source-not-found');
    expect(result.details).toContain('missing.ts');
  });

  it('returns no-bullets when bullet list is empty', () => {
    writeFileSync(
      join(tmpDir, 'schema.ts'),
      `export const fooEnum = pgEnum('foo', ['a', 'b']);`,
    );
    const result = validateAnnotation(
      { sourcePath: 'schema.ts', identifier: 'fooEnum', bullets: [], line: 1 },
      tmpDir,
    );
    expect(result.ok).toBe(false);
    expect(result.kind).toBe('no-bullets');
  });

  it('returns identifier-not-found when source lacks the identifier', () => {
    writeFileSync(
      join(tmpDir, 'schema.ts'),
      `export const otherEnum = pgEnum('other', ['x']);`,
    );
    const result = validateAnnotation(
      { sourcePath: 'schema.ts', identifier: 'missingEnum', bullets: ['a'], line: 1 },
      tmpDir,
    );
    expect(result.ok).toBe(false);
    expect(result.kind).toBe('identifier-not-found');
    expect(result.details).toContain('missingEnum');
  });

  it('returns value-not-in-source when spec has typo', () => {
    writeFileSync(
      join(tmpDir, 'schema.ts'),
      `export const fooEnum = pgEnum('foo', ['en_proceso', 'entregado']);`,
    );
    const result = validateAnnotation(
      { sourcePath: 'schema.ts', identifier: 'fooEnum', bullets: ['en_curso', 'entregado'], line: 1 },
      tmpDir,
    );
    expect(result.ok).toBe(false);
    expect(result.kind).toBe('value-not-in-source');
    expect(result.drift).toEqual(['en_curso']);
    expect(result.sourceValues).toEqual(['en_proceso', 'entregado']);
  });
});

describe('findMarkdownFiles', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'md-walk-'));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when dir does not exist', () => {
    expect(findMarkdownFiles(join(tmpDir, 'nonexistent'))).toEqual([]);
  });

  it('finds .md files recursively', () => {
    mkdirSync(join(tmpDir, 'a/b'), { recursive: true });
    writeFileSync(join(tmpDir, 'root.md'), '# root');
    writeFileSync(join(tmpDir, 'a/nested.md'), '# nested');
    writeFileSync(join(tmpDir, 'a/b/deep.md'), '# deep');
    writeFileSync(join(tmpDir, 'a/not-md.txt'), 'ignore me');
    const result = findMarkdownFiles(tmpDir);
    expect(result.length).toBe(3);
    expect(result.some((f) => f.endsWith('root.md'))).toBe(true);
    expect(result.some((f) => f.endsWith('nested.md'))).toBe(true);
    expect(result.some((f) => f.endsWith('deep.md'))).toBe(true);
  });

  it('skips node_modules and coverage dirs', () => {
    mkdirSync(join(tmpDir, 'node_modules/pkg'), { recursive: true });
    mkdirSync(join(tmpDir, 'coverage'), { recursive: true });
    writeFileSync(join(tmpDir, 'node_modules/pkg/README.md'), '# should skip');
    writeFileSync(join(tmpDir, 'coverage/index.md'), '# should skip');
    writeFileSync(join(tmpDir, 'real.md'), '# keep');
    const result = findMarkdownFiles(tmpDir);
    expect(result.length).toBe(1);
    expect(result[0]).toContain('real.md');
  });
});

describe('renderHumanReport', () => {
  it('reports OK when zero drift', () => {
    const out = renderHumanReport([], { total: 5, drift: 0 });
    expect(out).toContain('OK');
    expect(out).toContain('5 annotation(s) checked');
    expect(out).toContain('0 drift');
  });

  it('lists each drift with file:line + kind + details', () => {
    const results = [
      {
        file: 'specs/foo.md',
        annotations: [{ sourcePath: 'src/x.ts', identifier: 'fooEnum', bullets: ['typo'], line: 42 }],
        validations: {
          42: { ok: false, kind: 'value-not-in-source', details: "Values in spec not present in source: 'typo'" },
        },
      },
    ];
    const out = renderHumanReport(results, { total: 1, drift: 1 });
    expect(out).toContain('DRIFT');
    expect(out).toContain('specs/foo.md:42');
    expect(out).toContain('value-not-in-source');
    expect(out).toContain("'typo'");
    expect(out).toContain('Action: update spec bullets');
  });

  it('skips ok validations in drift report', () => {
    const results = [
      {
        file: 'a.md',
        annotations: [
          { sourcePath: 'x.ts', identifier: 'e1', bullets: ['a'], line: 1 },
          { sourcePath: 'x.ts', identifier: 'e2', bullets: ['typo'], line: 5 },
        ],
        validations: {
          1: { ok: true },
          5: { ok: false, kind: 'value-not-in-source', details: 'bad' },
        },
      },
    ];
    const out = renderHumanReport(results, { total: 2, drift: 1 });
    expect(out).toContain('a.md:5');
    expect(out).not.toContain('a.md:1');
  });
});

describe('renderJsonReport', () => {
  it('produces structured JSON with totals + items', () => {
    const results = [
      {
        file: 'a.md',
        annotations: [{ sourcePath: 'x.ts', identifier: 'e1', bullets: ['a'], line: 1 }],
        validations: { 1: { ok: true } },
      },
    ];
    const out = renderJsonReport(results, { total: 1, drift: 0 });
    const parsed = JSON.parse(out);
    expect(parsed.totals).toEqual({ total: 1, drift: 0 });
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].ok).toBe(true);
    expect(parsed.items[0].kind).toBeNull();
  });

  it('includes drift array when value-not-in-source', () => {
    const results = [
      {
        file: 'a.md',
        annotations: [{ sourcePath: 'x.ts', identifier: 'e1', bullets: ['typo'], line: 3 }],
        validations: {
          3: { ok: false, kind: 'value-not-in-source', details: 'd', drift: ['typo'] },
        },
      },
    ];
    const parsed = JSON.parse(renderJsonReport(results, { total: 1, drift: 1 }));
    expect(parsed.items[0].drift).toEqual(['typo']);
  });
});

describe('main (end-to-end)', () => {
  let tmpDir;
  let stdoutSpy;
  let stderrSpy;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'scd-main-'));
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('returns 0 when no annotations found in scan dirs', () => {
    mkdirSync(join(tmpDir, '.specs'), { recursive: true });
    writeFileSync(join(tmpDir, '.specs/empty.md'), '# nothing here');
    const exit = main(['--repo-root', tmpDir, '--scan-dirs', '.specs']);
    expect(exit).toBe(0);
  });

  it('returns 0 when annotations match subset', () => {
    mkdirSync(join(tmpDir, '.specs'), { recursive: true });
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'src/schema.ts'),
      `export const fooEnum = pgEnum('foo', ['a', 'b', 'c', 'd']);`,
    );
    writeFileSync(
      join(tmpDir, '.specs/spec.md'),
      ['<!-- canonical-source: src/schema.ts:fooEnum -->', '- `a`', '- `b`'].join('\n'),
    );
    const exit = main(['--repo-root', tmpDir, '--scan-dirs', '.specs']);
    expect(exit).toBe(0);
  });

  it('returns 1 when drift detected', () => {
    mkdirSync(join(tmpDir, '.specs'), { recursive: true });
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'src/schema.ts'),
      `export const fooEnum = pgEnum('foo', ['a', 'b']);`,
    );
    writeFileSync(
      join(tmpDir, '.specs/spec.md'),
      ['<!-- canonical-source: src/schema.ts:fooEnum -->', '- `a`', '- `typo`'].join('\n'),
    );
    const exit = main(['--repo-root', tmpDir, '--scan-dirs', '.specs']);
    expect(exit).toBe(1);
  });

  it('returns 2 when ALL scan dirs missing', () => {
    const exit = main(['--repo-root', tmpDir, '--scan-dirs', 'nonexistent']);
    expect(exit).toBe(2);
  });

  it('continues if SOME scan dirs exist (warns about missing ones)', () => {
    mkdirSync(join(tmpDir, '.specs'), { recursive: true });
    writeFileSync(join(tmpDir, '.specs/empty.md'), '# no annotations');
    const exit = main(['--repo-root', tmpDir, '--scan-dirs', '.specs,does-not-exist']);
    expect(exit).toBe(0);
  });

  it('emits JSON output with --json flag', () => {
    mkdirSync(join(tmpDir, '.specs'), { recursive: true });
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'src/x.ts'), `export const e = z.enum(['a', 'b']);`);
    writeFileSync(
      join(tmpDir, '.specs/s.md'),
      ['<!-- canonical-source: src/x.ts:e -->', '- `a`'].join('\n'),
    );
    const exit = main(['--repo-root', tmpDir, '--scan-dirs', '.specs', '--json']);
    expect(exit).toBe(0);
    const calls = stdoutSpy.mock.calls.flat();
    expect(calls.join('').includes('"totals"')).toBe(true);
  });

  it('suppresses stdout with --quiet but writes to stderr on drift', () => {
    mkdirSync(join(tmpDir, '.specs'), { recursive: true });
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'src/x.ts'), `export const e = z.enum(['a']);`);
    writeFileSync(
      join(tmpDir, '.specs/s.md'),
      ['<!-- canonical-source: src/x.ts:e -->', '- `typo`'].join('\n'),
    );
    const exit = main(['--repo-root', tmpDir, '--scan-dirs', '.specs', '--quiet']);
    expect(exit).toBe(1);
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalled();
  });

  it('handles all drift kinds end-to-end', () => {
    mkdirSync(join(tmpDir, '.specs'), { recursive: true });
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'src/schema.ts'), `export const e1 = z.enum(['a']);`);
    writeFileSync(
      join(tmpDir, '.specs/multi.md'),
      [
        '<!-- canonical-source: src/missing.ts:e -->',
        '- `a`',
        '',
        '<!-- canonical-source: src/schema.ts:nonexistentId -->',
        '- `a`',
        '',
        '<!-- canonical-source: src/schema.ts:e1 -->',
        'no bullets here',
        '',
        '<!-- canonical-source: src/schema.ts:e1 -->',
        '- `typo`',
      ].join('\n'),
    );
    const exit = main(['--repo-root', tmpDir, '--scan-dirs', '.specs']);
    expect(exit).toBe(1);
    const output = stdoutSpy.mock.calls.flat().join('');
    expect(output).toContain('source-not-found');
    expect(output).toContain('identifier-not-found');
    expect(output).toContain('no-bullets');
    expect(output).toContain('value-not-in-source');
  });
});
