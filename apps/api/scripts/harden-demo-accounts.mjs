#!/usr/bin/env node
/**
 * apps/api/scripts/harden-demo-accounts.mjs
 *
 * CLI wrapper para el service module `harden-demo-accounts` (T4 SEC-001
 * Sprint 2a). Lo extracts dispatch + arg parsing; toda la lógica vive
 * en `apps/api/src/services/harden-demo-accounts.ts` (testeada via
 * vitest mocks).
 *
 * Operaciones:
 *   --recreate                          Crea las 4 UIDs nuevas (idempotent)
 *   --retire <uid>                      Retira 1 UID
 *   --retire-old-batch                  Retira las 4 UIDs viejas hardcoded
 *   --renew <uid> --extend-days <n>     Extiende expires_at del claim
 *   --dry-run                           No muta SDK ni DB (simulate)
 *
 * Requiere:
 *   - `gcloud auth application-default login` (ADC para Firebase Admin SDK)
 *   - Acceso a Postgres prod via TEST_DATABASE_URL o DATABASE_URL env
 *   - PO (`dev@boosterchile.com`) con role secretmanager.admin sobre los
 *     4 secrets demo-account-password-*-2026
 *
 * NO debe correr desde GitHub Actions — solo desde máquina del PO.
 *
 * One-shot ejecución timing (spec sec-001-cierre §3 H1.1 SC-1.1.4 +
 * plan-sprint-2a.md T4): post-PR #1 prod-deploy approved + curl-verified
 * 4 nuevas activas + T5 middleware deployed + T6a Cloud Monitoring alert
 * active. SLA 4h max post-deploy approval. **Forbidden Friday después
 * de 12:00 Santiago** (SLA fits before 16:00 cutoff per CLAUDE.md).
 *
 * Uso típico (sequence post-PR-merge prod):
 *   1. Verificar 4 nuevas activas:
 *      node apps/api/scripts/harden-demo-accounts.mjs --recreate --dry-run
 *   2. Aplicar recreate real (idempotent — si ya existen, skip):
 *      node apps/api/scripts/harden-demo-accounts.mjs --recreate
 *   3. Dry-run retire (verificar que retires van a las UIDs correctas):
 *      node apps/api/scripts/harden-demo-accounts.mjs --retire-old-batch --dry-run
 *   4. Aplicar retire real:
 *      node apps/api/scripts/harden-demo-accounts.mjs --retire-old-batch
 *   5. Renovación periódica (cuando TTL alerta -7 días):
 *      node apps/api/scripts/harden-demo-accounts.mjs --renew <uid> --extend-days 30
 */

import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { createLogger } from '@booster-ai/logger';
import { drizzle } from 'drizzle-orm/node-postgres';
import admin from 'firebase-admin';
import pg from 'pg';
import {
  getDemoOldUids,
  recreateAll,
  renew,
  retire,
  retireOldBatch,
} from '../dist/services/harden-demo-accounts.js';

// ----------------------------------------------------------------------------
// Arg parsing
// ----------------------------------------------------------------------------

const { values } = parseArgs({
  options: {
    recreate: { type: 'boolean', default: false },
    retire: { type: 'string' },
    'retire-old-batch': { type: 'boolean', default: false },
    renew: { type: 'string' },
    'extend-days': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
  allowPositionals: false,
});

if (values.help) {
  process.stdout.write(`
Usage: node apps/api/scripts/harden-demo-accounts.mjs <command> [--dry-run]

Commands:
  --recreate                         Idempotent create de las 4 UIDs nuevas
  --retire <uid>                     Retire 1 UID (disabled + audit)
  --retire-old-batch                 Retire las 4 UIDs viejas hardcoded
  --renew <uid> --extend-days <n>    Extiende expires_at claim

Options:
  --dry-run    Simulate sin SDK ni DB writes (staging rehearsal)
  --help       Show this help

Env vars requeridos:
  GOOGLE_APPLICATION_CREDENTIALS o ADC (gcloud auth application-default login)
  DATABASE_URL (postgres prod, format: postgresql://user:pw@host:port/db)
  DEMO_ACCOUNT_PASSWORD_{SHIPPER,CARRIER,STAKEHOLDER,CONDUCTOR_FIREBASE}_2026
    (lookup desde gcloud secrets pre-execution recomendado; solo --recreate)
  DEMO_OLD_UIDS (solo --retire-old-batch): CSV de los Firebase UIDs demo
    viejos a retirar (ADR-053). Formato /^[A-Za-z0-9]{20,128}$/ por UID.
    Ausente → --retire-old-batch es no-op (avisa y sale limpio, sin retirar).
`);
  process.exit(0);
}

const cmds = [
  values.recreate,
  Boolean(values.retire),
  values['retire-old-batch'],
  Boolean(values.renew),
].filter(Boolean);

if (cmds.length === 0) {
  process.stderr.write(
    'ERROR: especifica --recreate, --retire, --retire-old-batch o --renew. --help para detalle.\n',
  );
  process.exit(1);
}
if (cmds.length > 1) {
  process.stderr.write('ERROR: solo un comando a la vez. --help para detalle.\n');
  process.exit(1);
}

const dryRun = values['dry-run'];

// ----------------------------------------------------------------------------
// Init Firebase Admin + DB + Logger
// ----------------------------------------------------------------------------

if (admin.apps.length === 0) {
  admin.initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID ?? 'booster-ai-494222',
  });
}
const firebaseAuth = admin.auth();

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  process.stderr.write(
    'ERROR: DATABASE_URL env no definida. Format: postgresql://user:pw@host:port/db\n',
  );
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: dbUrl, max: 2 });
const db = drizzle(pool);

const logger = createLogger({
  service: 'harden-demo-accounts-cli',
  version: '0.0.0',
  level: 'info',
  pretty: true,
});

// ----------------------------------------------------------------------------
// Dispatch
// ----------------------------------------------------------------------------

const t0 = performance.now();
let exitCode = 0;

try {
  if (dryRun) {
    logger.warn('═══ DRY-RUN MODE: no SDK ni DB writes ═══');
  }

  if (values.recreate) {
    const r = await recreateAll({ db, firebaseAuth, logger, dryRun });
    logger.info({ result: r, durationMs: Math.round(performance.now() - t0) }, 'recreate done');
  } else if (values.retire) {
    const r = await retire({ db, firebaseAuth, logger, uid: values.retire, dryRun });
    logger.info({ result: r, durationMs: Math.round(performance.now() - t0) }, 'retire done');
  } else if (values['retire-old-batch']) {
    // F2 P0-C: la lista de UIDs viejas viene de la env DEMO_OLD_UIDS (CSV
    // validada por Zod), ya no hardcoded. Si está ausente, getDemoOldUids()
    // devuelve [] y retireOldBatch es no-op; avisamos explícito en vez de
    // fingir éxito silencioso.
    const oldUids = getDemoOldUids();
    if (oldUids.length === 0) {
      logger.warn(
        'DEMO_OLD_UIDS no seteada (o vacía) — --retire-old-batch será no-op. Exporta el CSV de UIDs viejos antes de correr el retiro real.',
      );
    }
    const r = await retireOldBatch({ db, firebaseAuth, logger, dryRun, oldUids });
    logger.info(
      { result: r, durationMs: Math.round(performance.now() - t0) },
      'retire-old-batch done',
    );
    if (r.failed.length > 0) {
      exitCode = 1; // signal partial failure al shell
    }
  } else if (values.renew) {
    const extendDays = Number(values['extend-days']);
    if (!Number.isInteger(extendDays) || extendDays <= 0) {
      process.stderr.write('ERROR: --renew requiere --extend-days <positive integer>\n');
      process.exit(1);
    }
    const r = await renew({
      db,
      firebaseAuth,
      logger,
      uid: values.renew,
      extendDays,
      dryRun,
    });
    logger.info({ result: r, durationMs: Math.round(performance.now() - t0) }, 'renew done');
  }
} catch (err) {
  logger.error({ err }, 'harden-demo-accounts: fatal');
  exitCode = 1;
} finally {
  await pool.end().catch(() => undefined);
}

process.exit(exitCode);
