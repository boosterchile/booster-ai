#!/usr/bin/env tsx
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { initializeApp } from 'firebase-admin/app';
import { type Auth, getAuth } from 'firebase-admin/auth';

import { getDbPool } from '../src/db.js';

/**
 * Sprint 2c-A T8 — ghost user inventory script.
 *
 * Lists all Firebase Auth users whose `providerData` includes
 * `google.com`, cross-references each against `solicitudes_registro`
 * to determine whether an admin-approved row exists, and writes a CSV
 * report.
 *
 * **Read-only**: NO `auth.updateUser({disabled: true})`, NO
 * `auth.deleteUser()`. The CSV is input for PO cleanup decisions
 * pre-Sprint-2c-B launch (operational task; not in code).
 *
 * Execution context (3 modes per umbrella F-08 v1 fix):
 *   1. **Local laptop**: `gcloud auth application-default login` +
 *      IAP tunnel to `db-bastion` per memory `reference_prod_db_
 *      headless_query.md`; then `pnpm exec tsx
 *      scripts/inventory-google-ghost-users.ts`.
 *   2. **Cloud Run job** (preferred operational mode in 2c-B):
 *      `gcloud run jobs deploy inventory-google-ghost-users`
 *      (deferred to Sprint 2c-B per plan scope split).
 *   3. **Cloud Build trigger** one-shot manual.
 *
 * Output: `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/
 * ghost-users-inventory-<ISO-timestamp>.csv` con columnas
 * firebaseUid,email,displayName,createdAt,matchingApprovedRequest.
 */

export interface GhostUserRecord {
  firebaseUid: string;
  email: string;
  displayName: string;
  createdAt: string;
  matchingApprovedRequest: boolean;
}

export interface PoolLike {
  query(sql: string, params: unknown[]): Promise<{ rowCount: number | null }>;
}

export async function inventoryGoogleGhostUsers(
  auth: Pick<Auth, 'listUsers'>,
  pool: PoolLike,
): Promise<GhostUserRecord[]> {
  const ghosts: GhostUserRecord[] = [];
  let pageToken: string | undefined;
  do {
    const result = await auth.listUsers(1000, pageToken);
    for (const user of result.users) {
      const isGoogle = user.providerData.some((p) => p.providerId === 'google.com');
      if (!isGoogle || !user.email) {
        continue;
      }
      const match = await pool.query(
        "SELECT 1 FROM solicitudes_registro WHERE LOWER(email) = $1 AND estado = 'aprobado' LIMIT 1",
        [user.email.toLowerCase()],
      );
      ghosts.push({
        firebaseUid: user.uid,
        email: user.email,
        displayName: user.displayName ?? '',
        createdAt: user.metadata.creationTime,
        matchingApprovedRequest: (match.rowCount ?? 0) > 0,
      });
    }
    pageToken = result.pageToken;
  } while (pageToken);
  return ghosts;
}

export function toCsv(ghosts: readonly GhostUserRecord[]): string {
  const escapeCsv = (value: string): string => `"${value.replace(/"/g, '""')}"`;
  const header = 'firebaseUid,email,displayName,createdAt,matchingApprovedRequest';
  const rows = ghosts.map(
    (g) =>
      `${escapeCsv(g.firebaseUid)},${escapeCsv(g.email)},${escapeCsv(g.displayName)},${escapeCsv(g.createdAt)},${g.matchingApprovedRequest}`,
  );
  return [header, ...rows].join('\n');
}

async function main(): Promise<void> {
  initializeApp();
  const auth = getAuth();
  const pool = getDbPool();

  console.log('[inventory-google-ghost-users] listing Firebase users…');
  const ghosts = await inventoryGoogleGhostUsers(auth, pool);
  console.log(`[inventory-google-ghost-users] found ${ghosts.length} Google federated users`);

  const csv = toCsv(ghosts);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = new URL(
    `../../../.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/ghost-users-inventory-${timestamp}.csv`,
    import.meta.url,
  ).pathname;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, csv);
  console.log(`[inventory-google-ghost-users] CSV written to ${outputPath}`);
}

// Only invoke main when called directly via `tsx scripts/...`, not on
// import from tests. `process.argv[1]` is the entry file when the
// runtime resolves a CLI invocation.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error('[inventory-google-ghost-users] failed:', err);
    process.exit(1);
  });
}
