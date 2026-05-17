import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const DRIZZLE_DIR = resolve(__dirname, '..', '..', 'drizzle');
const JOURNAL_PATH = resolve(DRIZZLE_DIR, 'meta', '_journal.json');

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface JournalFile {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

function loadJournal(): JournalFile {
  return JSON.parse(readFileSync(JOURNAL_PATH, 'utf-8'));
}

function listSqlTags(): string[] {
  return readdirSync(DRIZZLE_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => f.replace(/\.sql$/, ''))
    .sort();
}

function tagPrefix(tag: string): number | null {
  const match = tag.match(/^(\d{4})_/);
  return match ? Number(match[1]) : null;
}

describe('migration journal integrity', () => {
  // Test 1 — orphan on disk
  test('every .sql file on disk has a journal entry', () => {
    const journalTags = new Set(loadJournal().entries.map((e) => e.tag));
    const orphans = listSqlTags().filter((t) => !journalTags.has(t));
    expect(
      orphans,
      `Orphan migrations on disk (no journal entry):\n  ${orphans.join('\n  ')}`,
    ).toEqual([]);
  });

  // Test 2 — ghost in journal
  test('every journal entry has a .sql file on disk', () => {
    const diskTags = new Set(listSqlTags());
    const ghosts = loadJournal()
      .entries.map((e) => e.tag)
      .filter((t) => !diskTags.has(t));
    expect(
      ghosts,
      `Ghost migrations in journal (no .sql on disk):\n  ${ghosts.join('\n  ')}`,
    ).toEqual([]);
  });

  // Test 3 — counts iguales
  test('journal entries.length === sql files count', () => {
    expect(loadJournal().entries.length).toBe(listSqlTags().length);
  });

  // Test 4 — idx monotonic (sin gaps, sin duplicados)
  test('journal entries idx is monotonic [0..N-1] with no gaps', () => {
    const entries = loadJournal().entries;
    const expectedIdx = entries.map((_, i) => i);
    const actualIdx = entries.map((e) => e.idx);
    expect(actualIdx).toEqual(expectedIdx);
  });

  // Test 5 — filename prefix == idx (P0-3 devils-advocate)
  test('filename prefix matches journal idx for every entry', () => {
    const violations = loadJournal().entries.flatMap((e) => {
      const prefix = tagPrefix(e.tag);
      if (prefix === null) {
        return [{ tag: e.tag, reason: 'tag has no NNNN_ prefix' }];
      }
      if (prefix !== e.idx) {
        return [{ tag: e.tag, reason: `prefix=${prefix} ≠ idx=${e.idx}` }];
      }
      return [];
    });
    expect(
      violations,
      `Filename prefix ↔ idx drift:\n  ${violations.map((v) => `${v.tag}: ${v.reason}`).join('\n  ')}`,
    ).toEqual([]);
  });

  // Test 6 — no duplicate filename prefixes (P0-3 devils-advocate)
  test('no two .sql files share the same NNNN_ prefix', () => {
    const prefixCounts = new Map<string, string[]>();
    for (const tag of listSqlTags()) {
      const m = tag.match(/^(\d{4})_/);
      if (!m) {
        continue;
      }
      const prefix = m[1];
      if (!prefixCounts.has(prefix)) {
        prefixCounts.set(prefix, []);
      }
      // biome-ignore lint/style/noNonNullAssertion: just set above
      prefixCounts.get(prefix)!.push(tag);
    }
    const duplicates = Array.from(prefixCounts.entries()).filter(([, tags]) => tags.length > 1);
    expect(
      duplicates,
      `Duplicate filename prefixes:\n  ${duplicates.map(([p, tags]) => `${p}: ${tags.join(', ')}`).join('\n  ')}`,
    ).toEqual([]);
  });

  // Test 7 — `when` monotonic (P0-3 devils-advocate + ADR-040 lessons)
  // El bug original que motivó applyOutOfOrderPending fue migrations con
  // `when` NO monotónico vs orden de merge. Forzar monotonicidad en CI
  // previene re-introducción del bug.
  test('journal entries `when` field is strictly monotonic', () => {
    const entries = loadJournal().entries;
    const violations: string[] = [];
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].when <= entries[i - 1].when) {
        violations.push(
          `idx=${entries[i].idx} when=${entries[i].when} <= prev idx=${entries[i - 1].idx} when=${entries[i - 1].when}`,
        );
      }
    }
    expect(violations, `Non-monotonic when timestamps:\n  ${violations.join('\n  ')}`).toEqual([]);
  });
});
