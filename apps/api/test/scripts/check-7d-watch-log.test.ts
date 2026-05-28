import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkWatchLog,
  parseAnchorTimestamp,
  parseWatchLog,
} from '../../scripts/check-7d-watch-log.js';

/**
 * Sprint 2c-B T12b — tests for the 7-day watch log integrity check.
 *
 * Uses real temp files (mkdtemp) instead of mocks because the script
 * reads via fs.readFileSync directly; injecting fs would complicate
 * the production-path API. Temp files are auto-cleaned in afterEach.
 */

const ANCHOR_HAPPY = `T-WIRE-PROD-APPLY: 2026-06-01T10:00:00Z
Applied by: dev@boosterchile.com
Terraform apply run: abc-123
Notes: clean apply
`;

const WATCH_LOG_HAPPY = `# 7-day watch log — Sprint 2c-B
T-WIRE-PROD-APPLY: 2026-06-01T10:00:00Z

## Day 1 (2026-06-02)
- blocked count: 0
- baseline: n/a
- alerts: 0
- reviewer: dev

## Day 2 (2026-06-03)
- blocked count: 1
- alerts: 0
- reviewer: dev

## Day 3 (2026-06-04)
- blocked count: 0
- alerts: 0
- reviewer: dev

## Day 4 (2026-06-05)
- blocked count: 0
- alerts: 0
- reviewer: dev

## Day 5 (2026-06-06)
- blocked count: 0
- alerts: 0
- reviewer: dev

## Day 6 (2026-06-07)
- blocked count: 0
- alerts: 0
- reviewer: dev

## Day 7 (2026-06-08)
- blocked count: 0
- alerts: 0
- reviewer: dev
`;

describe('parseAnchorTimestamp', () => {
  it('parses ISO date from T-WIRE-PROD-APPLY line', () => {
    expect(parseAnchorTimestamp(ANCHOR_HAPPY)).toBe('2026-06-01');
  });

  it('returns null when anchor line missing', () => {
    expect(parseAnchorTimestamp('# Not the right file')).toBeNull();
  });
});

describe('parseWatchLog', () => {
  it('extracts 7 dated entries from happy log', () => {
    const entries = parseWatchLog(WATCH_LOG_HAPPY);
    expect(entries).toHaveLength(7);
    expect(entries[0]).toEqual({ day: 1, date: '2026-06-02', isGap: false });
    expect(entries[6]).toEqual({ day: 7, date: '2026-06-08', isGap: false });
  });

  it('detects GAP in heading', () => {
    const log = '## Day 1 (2026-06-02)\n## Day 2 (2026-06-04) — GAP — extended by 1 day\n';
    const entries = parseWatchLog(log);
    expect(entries[1]?.isGap).toBe(true);
  });

  it('returns empty array on empty input', () => {
    expect(parseWatchLog('')).toEqual([]);
  });
});

describe('checkWatchLog', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'watch-log-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeFiles(opts: { watchLog?: string; anchor?: string; amendments?: string | null }) {
    const watchLogPath = join(dir, '7day-watch-log.md');
    const anchorPath = join(dir, 'T-WIRE-PROD-APPLY.txt');
    const amendmentsPath = join(dir, 'T-WIRE-PROD-APPLY-amendments.md');
    if (opts.watchLog !== undefined) {
      writeFileSync(watchLogPath, opts.watchLog);
    }
    if (opts.anchor !== undefined) {
      writeFileSync(anchorPath, opts.anchor);
    }
    if (opts.amendments) {
      writeFileSync(amendmentsPath, opts.amendments);
    }
    return { watchLogPath, anchorPath, amendmentsPath };
  }

  it('happy path: 7 contiguous entries anchored at T-WIRE → ok', () => {
    const paths = writeFiles({ watchLog: WATCH_LOG_HAPPY, anchor: ANCHOR_HAPPY });
    const result = checkWatchLog(paths);
    expect(result.ok).toBe(true);
    expect(result.reason).toMatch(/integrity OK/);
  });

  it('missing watch log → fail', () => {
    const paths = writeFiles({ anchor: ANCHOR_HAPPY });
    const result = checkWatchLog(paths);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Watch log not found/);
  });

  it('missing anchor → fail', () => {
    const paths = writeFiles({ watchLog: WATCH_LOG_HAPPY });
    const result = checkWatchLog(paths);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/anchor not found/);
  });

  it('malformed anchor → fail', () => {
    const paths = writeFiles({ watchLog: WATCH_LOG_HAPPY, anchor: 'no T-WIRE line here' });
    const result = checkWatchLog(paths);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/missing valid timestamp/);
  });

  it('< 7 entries → fail', () => {
    const shortLog = '## Day 1 (2026-06-02)\n## Day 2 (2026-06-03)\n## Day 3 (2026-06-04)\n';
    const paths = writeFiles({ watchLog: shortLog, anchor: ANCHOR_HAPPY });
    const result = checkWatchLog(paths);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/expected at least 7/);
  });

  it('Day 1 date mismatch (not anchor + 1 day) → fail', () => {
    const wrongLog = WATCH_LOG_HAPPY.replace('Day 1 (2026-06-02)', 'Day 1 (2026-06-10)');
    const paths = writeFiles({ watchLog: wrongLog, anchor: ANCHOR_HAPPY });
    const result = checkWatchLog(paths);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Day 1 entry date/);
  });

  it('non-contiguous dates without GAP → fail', () => {
    const gappy =
      '## Day 1 (2026-06-02)\n## Day 2 (2026-06-03)\n## Day 3 (2026-06-04)\n' +
      '## Day 4 (2026-06-05)\n## Day 5 (2026-06-06)\n## Day 6 (2026-06-09)\n## Day 7 (2026-06-10)\n';
    const paths = writeFiles({ watchLog: gappy, anchor: ANCHOR_HAPPY });
    const result = checkWatchLog(paths);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/does not follow.*by exactly 1 day/);
  });

  it('non-contiguous dates WITH explicit GAP flag → ok', () => {
    const gappy =
      '## Day 1 (2026-06-02)\n## Day 2 (2026-06-03)\n## Day 3 (2026-06-04)\n' +
      '## Day 4 (2026-06-05)\n## Day 5 (2026-06-06)\n' +
      '## Day 6 (2026-06-09) — GAP — extended by 2 days (PO unavailable; no signups during gap)\n' +
      '## Day 7 (2026-06-10)\n';
    const paths = writeFiles({ watchLog: gappy, anchor: ANCHOR_HAPPY });
    const result = checkWatchLog(paths);
    expect(result.ok).toBe(true);
  });

  it('amendments file present + no GAP entries in log → fail', () => {
    const paths = writeFiles({
      watchLog: WATCH_LOG_HAPPY,
      anchor: ANCHOR_HAPPY,
      amendments:
        '## Re-apply event 2026-06-05T14:00:00Z\nReason: drift fix\nDecision: continue clock\n',
    });
    const result = checkWatchLog(paths);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/amendments.md exists.*NO GAP entries/);
  });

  it('amendments file present + GAP entry present → ok', () => {
    const logWithGap = WATCH_LOG_HAPPY.replace(
      'Day 5 (2026-06-06)',
      'Day 5 (2026-06-06) — GAP — extended by 0 days (re-apply continue clock per amendments.md)',
    );
    const paths = writeFiles({
      watchLog: logWithGap,
      anchor: ANCHOR_HAPPY,
      amendments:
        '## Re-apply event 2026-06-05T14:00:00Z\nReason: drift fix\nDecision: continue clock\n',
    });
    const result = checkWatchLog(paths);
    expect(result.ok).toBe(true);
  });
});
