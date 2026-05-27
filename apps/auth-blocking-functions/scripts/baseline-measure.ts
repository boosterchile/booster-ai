#!/usr/bin/env tsx
import { execSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

import { beforeCreateCallback } from '../src/handler.js';

/**
 * Sprint 2c-A T9b — baseline measurement script.
 *
 * Invokes `beforeCreateCallback` 10 times against an in-process mock
 * (pool returns rowCount=0 to exercise the full lookup + log + throw
 * chain) + records p50/p95/p99 plus raw timings into a versioned
 * evidence JSON file plus a `.latest.json` copy.
 *
 * **NO pass/fail threshold against this measurement** (per plan v4
 * F-A7 fix). The numbers reflect handler-callback JS execution time
 * in isolation — useful as a floor sanity check but NOT representative
 * of production p95 which will be dominated by:
 *   - IdP JWT validation (~10-50 ms).
 *   - gcip-cloud-functions HTTP wrapping + cold-start (~1-3 s on
 *     first Gen 1 invocation in a container).
 *   - Cloud SQL Auth Proxy unix-socket round-trip (~5-20 ms).
 *
 * Production p95 bar lands in Sprint 2c-B post-deploy + 7-day watch
 * (SC-2C.B.5 + SC-2C.B.7 per umbrella spec).
 *
 * **Plan deviation declared**: measures handler-callback in-process
 * instead of via Firebase emulator HTTP (per plan v4 §T9b "via T9a's
 * emulator"). Rationale: OQ-PLAN-1 soft-waiver keeps firebase-tools
 * out of deps (~50 MB CLI); emulator setup requires firebase-tools +
 * tsup build + running emulator. Handler-callback JS time is the
 * dominant non-network component; emulator IPC adds fixed overhead
 * that is more honestly measured in 2c-B with real prod traffic.
 *
 * **Manual run**:
 *   pnpm --filter @booster-ai/auth-blocking-functions \
 *     exec tsx scripts/baseline-measure.ts
 */

interface BaselineRecord {
  commitSha: string;
  generatedAt: string;
  runs: number;
  timingsMs: number[];
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  meanMs: number;
  context: string;
  note: string;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

function buildMockUser(): Parameters<typeof beforeCreateCallback>[0] {
  return {
    uid: 'baseline-uid',
    email: 'baseline@booster.test',
    emailVerified: false,
    displayName: '',
    phoneNumber: '',
    photoURL: '',
    disabled: false,
    metadata: { lastSignInTime: '', creationTime: '', toJSON: () => ({}) },
    providerData: [
      {
        providerId: 'google.com',
        uid: 'g-uid',
        displayName: '',
        email: 'baseline@booster.test',
        phoneNumber: '',
        photoURL: '',
        toJSON: () => ({}),
      },
    ],
    toJSON: () => ({}),
  } as unknown as Parameters<typeof beforeCreateCallback>[0];
}

const STUB_CONTEXT = {
  eventId: 'baseline-event',
  timestamp: new Date().toISOString(),
  eventType: 'providers/cloud.auth/eventTypes/user.beforeCreate',
  resource: 'projects/baseline-project',
  params: {},
  ipAddress: '127.0.0.1',
  userAgent: 'baseline-script',
} as unknown as Parameters<typeof beforeCreateCallback>[1];

async function measureOnce(): Promise<number> {
  const user = buildMockUser();
  const start = performance.now();
  try {
    await beforeCreateCallback(user, STUB_CONTEXT);
  } catch {
    // Expected: rowCount=0 → permission-denied. We are timing the chain,
    // not asserting outcome.
  }
  return performance.now() - start;
}

async function main(): Promise<void> {
  const sha = (() => {
    try {
      return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
    } catch {
      return 'unknown';
    }
  })();

  console.log(`[baseline-measure] invoking beforeCreateCallback × 10 (commit ${sha.slice(0, 8)})…`);
  // Warm-up: discard first invocation (V8 JIT warmup; pg.Pool lazy-init).
  await measureOnce();
  const timings: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    timings.push(await measureOnce());
  }
  const sorted = [...timings].sort((a, b) => a - b);

  const record: BaselineRecord = {
    commitSha: sha,
    generatedAt: new Date().toISOString(),
    runs: 10,
    timingsMs: timings.map((t) => Number(t.toFixed(3))),
    p50Ms: Number(percentile(sorted, 50).toFixed(3)),
    p95Ms: Number(percentile(sorted, 95).toFixed(3)),
    p99Ms: Number(percentile(sorted, 99).toFixed(3)),
    meanMs: Number((timings.reduce((a, b) => a + b, 0) / timings.length).toFixed(3)),
    context:
      'handler-callback in-process; real pg.Pool attempts local connect with no DATABASE_URL → DB error path (HttpsError internal). Measures: JS exec + crypto + pool init + connection-refused + structured log + throw.',
    note: 'NOT a pass/fail bar. Production p95 will be dominated by IdP JWT validation + Gen 1 cold start + Cloud SQL Auth Proxy round-trip — orders of magnitude higher than this floor. Real prod measurement defers to 2c-B post-deploy + 7-day watch (SC-2C.B.5 + SC-2C.B.7 per umbrella spec).',
  };

  const evidenceDir = new URL(
    '../../../.specs/sec-001-h1-2-google-blocking-a/sprint-2c-a-evidence/',
    import.meta.url,
  ).pathname;
  await mkdir(evidenceDir, { recursive: true });
  const versioned = `${evidenceDir}baseline-perf-2c-a-${sha.slice(0, 8)}.json`;
  const latest = `${evidenceDir}baseline-perf-2c-a.latest.json`;
  const json = `${JSON.stringify(record, null, 2)}\n`;
  await writeFile(versioned, json);
  await writeFile(latest, json);

  console.log(`[baseline-measure] wrote ${versioned}`);
  console.log(`[baseline-measure] wrote ${latest}`);
  console.log(
    `  p50=${record.p50Ms} ms · p95=${record.p95Ms} ms · p99=${record.p99Ms} ms · mean=${record.meanMs} ms`,
  );
}

main().catch((err: unknown) => {
  console.error('[baseline-measure] failed:', err);
  process.exit(1);
});
