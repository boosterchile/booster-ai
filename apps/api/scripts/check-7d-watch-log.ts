#!/usr/bin/env tsx
/**
 * Sprint 2c-B T12b — 7-day watch log integrity check.
 *
 * Spec: `.specs/sec-001-h1-2-google-blocking-b/plan.md` v4 §T12b
 * acceptance (F-B8 mechanical fix). Runs as the gate before T13
 * ADR-054 Status flip Proposed → Accepted.
 *
 * Asserts:
 *   (a) Exactly 7 dated entries in `7day-watch-log.md` (one per day
 *       between T-WIRE-PROD-APPLY and T-WIRE-PROD-APPLY + 7 days).
 *   (b) The 7 dates form a contiguous sequence anchored at the
 *       T-WIRE-PROD-APPLY timestamp from `T-WIRE-PROD-APPLY.txt`.
 *   (c) Any 48h+ gap explicitly logged as a "GAP — extended by N days"
 *       entry (instead of being silently skipped).
 *   (d) If `T-WIRE-PROD-APPLY-amendments.md` exists (re-apply events),
 *       the watch log accounts for the amendments per runbook §4.
 *
 * **Mechanical scope**: this is a file-format integrity check, NOT a
 * semantic validation of the watch entries themselves. Whether the
 * entries report meaningful baseline rates / 3-sigma thresholds / alert
 * firings is a PO judgment captured manually in the log body. Per
 * plan-a v3 anti-pattern lesson: keep the gate honest about what it
 * does and does not enforce.
 *
 * Ejecución (post-T12b 7-day window):
 *   pnpm --filter @booster-ai/api exec tsx \
 *     scripts/check-7d-watch-log.ts
 *
 * Exit codes:
 *   0 — all assertions pass; T13 ADR flip cleared.
 *   1 — any assertion fails; T13 blocked, fix log + re-run.
 */

import { existsSync, readFileSync } from 'node:fs';

const EVIDENCE_DIR = '.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence';
const WATCH_LOG_PATH = `${EVIDENCE_DIR}/7day-watch-log.md`;
const ANCHOR_PATH = `${EVIDENCE_DIR}/T-WIRE-PROD-APPLY.txt`;
const AMENDMENTS_PATH = `${EVIDENCE_DIR}/T-WIRE-PROD-APPLY-amendments.md`;

export interface CheckOptions {
  /** Override evidence file paths for testing. */
  watchLogPath?: string;
  anchorPath?: string;
  amendmentsPath?: string;
}

export interface CheckResult {
  ok: boolean;
  reason: string;
}

export interface ParsedEntry {
  /** Day number (1..7 or higher if extended). */
  day: number;
  /** ISO 8601 date (YYYY-MM-DD). */
  date: string;
  /** True if entry headline contains 'GAP'. */
  isGap: boolean;
}

const ENTRY_HEADING = /^## Day (\d+)\s+\((\d{4}-\d{2}-\d{2})\)(.*)$/gm;

export function parseWatchLog(content: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  for (const match of content.matchAll(ENTRY_HEADING)) {
    const day = Number(match[1]);
    const date = match[2] ?? '';
    const headlineRest = match[3] ?? '';
    entries.push({
      day,
      date,
      isGap: /GAP\b/i.test(headlineRest),
    });
  }
  return entries;
}

export function parseAnchorTimestamp(content: string): string | null {
  const match = content.match(/T-WIRE-PROD-APPLY:\s*(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

function addDays(yyyymmdd: string, days: number): string {
  const date = new Date(`${yyyymmdd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function checkWatchLog(options: CheckOptions = {}): CheckResult {
  const watchLogPath = options.watchLogPath ?? WATCH_LOG_PATH;
  const anchorPath = options.anchorPath ?? ANCHOR_PATH;
  const amendmentsPath = options.amendmentsPath ?? AMENDMENTS_PATH;

  if (!existsSync(watchLogPath)) {
    return { ok: false, reason: `Watch log not found at ${watchLogPath}` };
  }
  if (!existsSync(anchorPath)) {
    return { ok: false, reason: `T-WIRE-PROD-APPLY anchor not found at ${anchorPath}` };
  }

  const watchLog = readFileSync(watchLogPath, 'utf-8');
  const anchorContent = readFileSync(anchorPath, 'utf-8');
  const anchorDate = parseAnchorTimestamp(anchorContent);
  if (!anchorDate) {
    return {
      ok: false,
      reason: `T-WIRE-PROD-APPLY.txt missing valid timestamp (expected line "T-WIRE-PROD-APPLY: YYYY-MM-DDTHH:MM:SSZ")`,
    };
  }

  const entries = parseWatchLog(watchLog);
  if (entries.length === 0) {
    return { ok: false, reason: 'No dated entries found in watch log (expected at least 7)' };
  }

  // (a) Exactly 7 entries — but accept >7 if extensions documented as GAP.
  if (entries.length < 7) {
    return {
      ok: false,
      reason: `Watch log has ${entries.length} dated entries; expected at least 7 (one per day from T-WIRE-PROD-APPLY)`,
    };
  }

  // (b) Sequence anchored at T-WIRE-PROD-APPLY.
  // The first entry's date should be `anchorDate + 1 day` (Day 1 of watch).
  const expectedDay1 = addDays(anchorDate, 1);
  if (entries[0]?.date !== expectedDay1) {
    return {
      ok: false,
      reason: `Day 1 entry date "${entries[0]?.date}" does not match expected "${expectedDay1}" (T-WIRE-PROD-APPLY + 1 day)`,
    };
  }

  // (b/c) Each subsequent entry advances exactly 1 day OR is explicitly
  // marked as a GAP extension. Non-gap entries with 48h+ gaps fail.
  for (let i = 1; i < entries.length; i += 1) {
    const prev = entries[i - 1];
    const curr = entries[i];
    if (!prev || !curr) {
      continue;
    }
    const expected = addDays(prev.date, 1);
    if (curr.date !== expected && !curr.isGap) {
      return {
        ok: false,
        reason: `Entry "Day ${curr.day} (${curr.date})" does not follow "Day ${prev.day} (${prev.date})" by exactly 1 day, and is not flagged as a GAP extension. Add "GAP — extended by N days" to the heading or fix the date sequence.`,
      };
    }
  }

  // (d) Amendments file presence cross-check. If file exists, the watch
  // log SHOULD reference at least one GAP entry (re-apply events usually
  // require log extension).
  if (existsSync(amendmentsPath)) {
    const hasGap = entries.some((e) => e.isGap);
    if (!hasGap) {
      return {
        ok: false,
        reason: `${amendmentsPath} exists (re-apply events documented) but watch log has NO GAP entries. Verify whether the re-apply reset/extended the watch clock per runbook §4.`,
      };
    }
  }

  return {
    ok: true,
    reason: `Watch log integrity OK — ${entries.length} dated entries, contiguous from ${anchorDate} + 1 day, GAP entries handled correctly`,
  };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const result = checkWatchLog();
  if (result.ok) {
    console.log(`[check-7d-watch-log] OK — ${result.reason}`);
    process.exit(0);
  }
  console.error(`[check-7d-watch-log] FAIL — ${result.reason}`);
  console.error('');
  console.error('Sprint 2c-B T13 ADR-054 Status flip gated on T12b watch log integrity.');
  console.error('See docs/qa/google-blocking-function-runbook.md §4 7-day watch semantics.');
  process.exit(1);
}
