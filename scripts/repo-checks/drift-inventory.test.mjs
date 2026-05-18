import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  extractDrizzleEnums,
  extractZodEnums,
  findDivergences,
  main,
  normalizeForMatch,
  parseArgs,
  renderMarkdown,
} from './drift-inventory.mjs';

describe('parseArgs', () => {
  it('uses defaults when no args', () => {
    const args = parseArgs([]);
    expect(args.domainDir).toContain('domain');
    expect(args.schemaFile).toContain('schema.ts');
    expect(args.output).toContain('inventory.md');
  });

  it('parses --domain-dir, --schema-file, --output', () => {
    const args = parseArgs(['--domain-dir', '/x', '--schema-file', '/y/z.ts', '--output', '/o']);
    expect(args.domainDir).toBe('/x');
    expect(args.schemaFile).toBe('/y/z.ts');
    expect(args.output).toBe('/o');
  });

  it('parses --quiet flag', () => {
    expect(parseArgs(['--quiet']).quiet).toBe(true);
    expect(parseArgs([]).quiet).toBe(false);
  });
});

describe('extractZodEnums', () => {
  it('extracts a simple z.enum', () => {
    const content = `export const fooSchema = z.enum(['a', 'b', 'c']);`;
    const result = extractZodEnums(content);
    expect(result.get('fooSchema')).toEqual(['a', 'b', 'c']);
  });

  it('extracts multiple enums in one file', () => {
    const content = `
      export const tripStateSchema = z.enum(['delivered', 'pending']);
      export const offerStateSchema = z.enum(['accepted', 'rejected']);
    `;
    const result = extractZodEnums(content);
    expect(result.size).toBe(2);
    expect(result.get('tripStateSchema')).toEqual(['delivered', 'pending']);
    expect(result.get('offerStateSchema')).toEqual(['accepted', 'rejected']);
  });

  it('handles multiline z.enum blocks', () => {
    const content = `
      export const tripStateSchema = z.enum([
        'requested',
        'in_transit',
        'delivered',
      ]);
    `;
    const result = extractZodEnums(content);
    expect(result.get('tripStateSchema')).toEqual(['requested', 'in_transit', 'delivered']);
  });

  it('returns empty Map when no enums', () => {
    expect(extractZodEnums('const x = 1;').size).toBe(0);
  });
});

describe('extractDrizzleEnums', () => {
  it('extracts a simple pgEnum', () => {
    const content = `export const fooEnum = pgEnum('foo_name', ['a', 'b']);`;
    const result = extractDrizzleEnums(content);
    expect(result.get('foo_name')).toEqual({ tsName: 'fooEnum', values: ['a', 'b'] });
  });

  it('extracts multiline pgEnum', () => {
    const content = `
      export const tripStatusEnum = pgEnum('estado_viaje', [
        'borrador',
        'asignado',
      ]);
    `;
    const result = extractDrizzleEnums(content);
    expect(result.get('estado_viaje').values).toEqual(['borrador', 'asignado']);
    expect(result.get('estado_viaje').tsName).toBe('tripStatusEnum');
  });

  it('returns empty Map when no pgEnums', () => {
    expect(extractDrizzleEnums('export const t = pgTable("x", {});').size).toBe(0);
  });
});

describe('normalizeForMatch', () => {
  it('strips Schema/Enum/Status/Estado suffixes', () => {
    expect(normalizeForMatch('tripStateSchema')).toBe('tripstate');
    expect(normalizeForMatch('tripStatusEnum')).toBe('tripstate');
    expect(normalizeForMatch('tripEstadoEnum')).toBe('tripstate');
  });

  it('lowercase output', () => {
    expect(normalizeForMatch('Foo')).toBe('foo');
  });
});

describe('findDivergences', () => {
  it('returns empty when domain and sql match perfectly', () => {
    const domain = new Map([['fooSchema', ['a', 'b']]]);
    const sql = new Map([['foo', { tsName: 'fooEnum', values: ['a', 'b'] }]]);
    expect(findDivergences(domain, sql)).toEqual([]);
  });

  it('detects value-mismatch (ts-only)', () => {
    const domain = new Map([['fooSchema', ['a', 'b', 'c']]]);
    const sql = new Map([['foo', { tsName: 'fooEnum', values: ['a', 'b'] }]]);
    const divs = findDivergences(domain, sql);
    expect(divs).toHaveLength(1);
    expect(divs[0].kind).toBe('value-mismatch');
    expect(divs[0].tsOnly).toEqual(['c']);
    expect(divs[0].sqlOnly).toEqual([]);
  });

  it('detects no-sql-match', () => {
    const domain = new Map([['fooSchema', ['a']]]);
    const sql = new Map();
    const divs = findDivergences(domain, sql);
    expect(divs).toHaveLength(1);
    expect(divs[0].kind).toBe('no-sql-match');
  });

  it('respects allowlist (correlationId)', () => {
    const domain = new Map([['correlationId', ['x']]]);
    const sql = new Map();
    expect(findDivergences(domain, sql)).toEqual([]);
  });

  it('matches by normalized name (tripState <-> tripStatus)', () => {
    const domain = new Map([['tripStateSchema', ['delivered']]]);
    const sql = new Map([['estado_viaje', { tsName: 'tripStatusEnum', values: ['entregado'] }]]);
    const divs = findDivergences(domain, sql);
    expect(divs).toHaveLength(1);
    expect(divs[0].kind).toBe('value-mismatch');
    expect(divs[0].sqlMatch.tsName).toBe('tripStatusEnum');
  });
});

describe('renderMarkdown', () => {
  it('produces frontmatter with gate=PENDING_PO', () => {
    const md = renderMarkdown([], { domainDir: 'd', schemaFile: 's' });
    expect(md).toMatch(/^---\ngate: PENDING_PO/);
  });

  it('includes divergence count in frontmatter', () => {
    const divs = [
      { domainName: 'fooSchema', domainValues: [], sqlMatch: null, kind: 'no-sql-match' },
    ];
    const md = renderMarkdown(divs, { domainDir: 'd', schemaFile: 's' });
    expect(md).toContain('divergences_total: 1');
  });

  it('returns "Sin divergencias" when empty', () => {
    const md = renderMarkdown([], { domainDir: 'd', schemaFile: 's' });
    expect(md).toContain('Sin divergencias detectadas');
  });
});

describe('main (integration)', () => {
  let tmp;
  let stdoutSpy;
  let stderrSpy;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'drift-inv-'));
    mkdirSync(join(tmp, 'domain'), { recursive: true });
    writeFileSync(
      join(tmp, 'domain', 'trip.ts'),
      `export const tripStateSchema = z.enum(['delivered', 'pending']);`,
    );
    writeFileSync(
      join(tmp, 'schema.ts'),
      `export const tripStatusEnum = pgEnum('estado_viaje', ['entregado']);`,
    );
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('exit 0 when N divergences <= threshold', () => {
    const code = main([
      '--domain-dir',
      join(tmp, 'domain'),
      '--schema-file',
      join(tmp, 'schema.ts'),
      '--output',
      join(tmp, 'out.md'),
    ]);
    expect(code).toBe(0);
  });

  it('exit 2 when domain dir missing', () => {
    const code = main(['--domain-dir', '/nonexistent', '--schema-file', join(tmp, 'schema.ts')]);
    expect(code).toBe(2);
  });

  it('exit 2 when schema file missing', () => {
    const code = main(['--domain-dir', join(tmp, 'domain'), '--schema-file', '/nonexistent']);
    expect(code).toBe(2);
  });

  it('exit 1 when divergences > threshold (gate fail)', () => {
    // Crear 11 enums divergentes en el mismo archivo de prueba
    const enums = Array.from(
      { length: 11 },
      (_, i) => `export const x${i}Schema = z.enum(['val${i}']);`,
    ).join('\n');
    writeFileSync(join(tmp, 'domain', 'many.ts'), enums);
    const code = main([
      '--domain-dir',
      join(tmp, 'domain'),
      '--schema-file',
      join(tmp, 'schema.ts'),
      '--output',
      join(tmp, 'out.md'),
    ]);
    expect(code).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('GATE FAIL'));
  });
});
