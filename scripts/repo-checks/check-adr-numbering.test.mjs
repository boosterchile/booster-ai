import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findCollisions, main, parseArgs } from './check-adr-numbering.mjs';

describe('parseArgs', () => {
  it('parses --allow-legacy CSV padding short numbers to 3 digits', () => {
    const args = parseArgs(['--allow-legacy', '5,28,100']);
    expect(args.allowLegacy.has('005')).toBe(true);
    expect(args.allowLegacy.has('028')).toBe(true);
    expect(args.allowLegacy.has('100')).toBe(true);
  });

  it('handles whitespace in CSV', () => {
    const args = parseArgs(['--allow-legacy', ' 028 , 034 , 035 ']);
    expect(args.allowLegacy.size).toBe(3);
    expect(args.allowLegacy.has('028')).toBe(true);
  });

  it('handles --dir override', () => {
    const args = parseArgs(['--dir', '/tmp/adrs']);
    expect(args.dir).toBe('/tmp/adrs');
  });

  it('defaults allowLegacy to empty set when no flag', () => {
    const args = parseArgs([]);
    expect(args.allowLegacy.size).toBe(0);
  });

  it('ignores --allow-legacy without value (last flag)', () => {
    const args = parseArgs(['--allow-legacy']);
    expect(args.allowLegacy.size).toBe(0);
  });

  it('ignores empty entries in CSV', () => {
    const args = parseArgs(['--allow-legacy', '028,,034,']);
    expect(args.allowLegacy.size).toBe(2);
    expect(args.allowLegacy.has('028')).toBe(true);
    expect(args.allowLegacy.has('034')).toBe(true);
  });
});

describe('findCollisions', () => {
  let tmp;
  beforeEach(() => {
    tmp = join(tmpdir(), `adrs-${Date.now()}-${Math.random()}`);
    mkdirSync(tmp, { recursive: true });
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns no collisions for unique numbers', () => {
    writeFileSync(join(tmp, '001-foo.md'), '');
    writeFileSync(join(tmp, '002-bar.md'), '');
    expect(findCollisions(tmp, new Set())).toEqual([]);
  });

  it('detects duplicate ADR number', () => {
    writeFileSync(join(tmp, '028-foo.md'), '');
    writeFileSync(join(tmp, '028-bar.md'), '');
    const collisions = findCollisions(tmp, new Set());
    expect(collisions).toHaveLength(1);
    expect(collisions[0].number).toBe('028');
    expect(collisions[0].files.sort()).toEqual(['028-bar.md', '028-foo.md']);
  });

  it('detects multiple distinct collisions', () => {
    writeFileSync(join(tmp, '028-a.md'), '');
    writeFileSync(join(tmp, '028-b.md'), '');
    writeFileSync(join(tmp, '034-c.md'), '');
    writeFileSync(join(tmp, '034-d.md'), '');
    const collisions = findCollisions(tmp, new Set());
    expect(collisions).toHaveLength(2);
    expect(collisions.map((c) => c.number).sort()).toEqual(['028', '034']);
  });

  it('ignores allowed legacy collisions', () => {
    writeFileSync(join(tmp, '028-foo.md'), '');
    writeFileSync(join(tmp, '028-bar.md'), '');
    expect(findCollisions(tmp, new Set(['028']))).toEqual([]);
  });

  it('flags non-allowed even when other allowed exists', () => {
    writeFileSync(join(tmp, '028-a.md'), '');
    writeFileSync(join(tmp, '028-b.md'), '');
    writeFileSync(join(tmp, '100-x.md'), '');
    writeFileSync(join(tmp, '100-y.md'), '');
    const collisions = findCollisions(tmp, new Set(['028']));
    expect(collisions).toHaveLength(1);
    expect(collisions[0].number).toBe('100');
  });

  it('skips non-ADR files', () => {
    writeFileSync(join(tmp, 'README.md'), '');
    writeFileSync(join(tmp, 'notes.txt'), '');
    writeFileSync(join(tmp, 'no-prefix-here.md'), '');
    expect(findCollisions(tmp, new Set())).toEqual([]);
  });

  it('throws if dir does not exist', () => {
    expect(() => findCollisions('/nonexistent/xyz', new Set())).toThrow(/not found/);
  });
});

describe('main (integration)', () => {
  let tmp;
  let stdoutSpy;
  let stderrSpy;
  beforeEach(() => {
    tmp = join(tmpdir(), `adrs-main-${Date.now()}-${Math.random()}`);
    mkdirSync(tmp, { recursive: true });
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('exit 0 when no collisions', () => {
    writeFileSync(join(tmp, '001-foo.md'), '');
    expect(main(['--dir', tmp])).toBe(0);
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('OK'));
  });

  it('exit 0 logs legacy allowed list when present', () => {
    writeFileSync(join(tmp, '001-foo.md'), '');
    expect(main(['--dir', tmp, '--allow-legacy', '028,034'])).toBe(0);
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('legacy allowed: 028,034'));
  });

  it('exit 1 when collision detected', () => {
    writeFileSync(join(tmp, '028-foo.md'), '');
    writeFileSync(join(tmp, '028-bar.md'), '');
    expect(main(['--dir', tmp])).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('FAIL'));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('ADR-028'));
  });

  it('exit 0 when collision allowed via --allow-legacy', () => {
    writeFileSync(join(tmp, '028-foo.md'), '');
    writeFileSync(join(tmp, '028-bar.md'), '');
    expect(main(['--dir', tmp, '--allow-legacy', '028'])).toBe(0);
  });

  it('exit 2 when dir does not exist', () => {
    expect(main(['--dir', '/nonexistent/xyz'])).toBe(2);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });
});
