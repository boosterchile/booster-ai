// =============================================================================
// Cloud Run Job — reaper de cuentas IdP Google inertes (T8 / SC-G4)
// =============================================================================
// Spec: .specs/sec-001-h1-2-google-boundary-closure/spec.md SC-G4 + §10.
// Plan: .specs/sec-001-h1-2-google-boundary-closure/plan.md T8.
// ADR: docs/adr/057-google-signup-boundary-and-reaper-supersedes-054.md.
//
// Envuelve el predicado puro T7 (`isReapable`) con:
//   - `listUsers` paginado (chunks de 1000) — sin orphans (T12).
//   - **dry-run default** (`destructive=false`): NO escribe; solo loguea/cuenta
//     lo que HARÍA (T6). El modo destructivo requiere flag explícito.
//   - **disable-before-delete**: un reapable enabled se DESHABILITA (reversible)
//     y se marca con custom claim `reaperDisabledAt`; el delete ocurre solo si
//     ya está disabled-por-reaper y pasó el 2º grace.
//   - hard-guard vía el predicado (dual-guard uid+email + grace + pipeline).
//   - logs con email **hasheado** (PII, Ley 19.628 — T7) + `reaper.run.summary`
//     event para el log-based metric / counter de Cloud Monitoring (wired T9).
//
// Rollback (spec §11): las cuentas disabled son restaurables manualmente
// (`disabled:false`). El reaper NO re-habilita automáticamente.
//
// Variables (main):
//   DATABASE_URL                 inyectado vía Secret Manager (Cloud Run Job)
//   REAPER_DESTRUCTIVE           "true" para mutar; cualquier otro = dry-run (default)
//   REAPER_GRACE_DAYS            default 30 (OQ-G1)
//   REAPER_SECOND_GRACE_DAYS     default 30 (grace antes del delete)
//   REAPER_NEVER_REAPABLE_EMAILS CSV; default "dev@boosterchile.com"
// =============================================================================

import { createHash } from 'node:crypto';
import { type Logger, createLogger } from '@booster-ai/logger';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import pg from 'pg';
import { config as appConfig } from '../config.js';
import {
  DEFAULT_REAPER_GRACE_DAYS,
  type ReaperConfig,
  type ReaperFacts,
  type ReaperIdpAccount,
  isGoogleWithEmail,
  isReapable,
  normalizeReaperEmail,
} from '../services/reaper-predicate.js';

const MS_PER_DAY = 86_400_000;

export type ReaperAction = 'disable' | 'delete' | 'wait' | 'skip';

export interface ReaperRunConfig {
  destructive: boolean;
  graceDays: number;
  secondGraceDays: number;
  neverReapable: ReadonlySet<string>;
  now: Date;
  /**
   * Cap de borrados por corrida (REVIEW finding J). Acota el blast radius de un
   * false-positive masivo y el consumo de quota de Identity Platform si un
   * atacante infla la población (R-G6). Los excedentes se difieren al próximo
   * tick (acción `wait`). El cap se evalúa también en dry-run para que el
   * preview refleje lo que haría el modo destructivo.
   */
  maxDeletesPerRun: number;
}

interface UserRecordLike {
  uid: string;
  email?: string | null;
  disabled?: boolean;
  displayName?: string;
  customClaims?: Record<string, unknown> | null;
  providerData: readonly { providerId: string }[];
  metadata: { creationTime: string; lastSignInTime?: string };
}

interface AuthLike {
  listUsers(
    maxResults?: number,
    pageToken?: string,
  ): Promise<{ users: UserRecordLike[]; pageToken?: string }>;
  updateUser(uid: string, props: { disabled: boolean }): Promise<unknown>;
  deleteUser(uid: string): Promise<void>;
  setCustomUserClaims(uid: string, claims: Record<string, unknown>): Promise<void>;
}

export interface PoolLike {
  query(
    sql: string,
    params: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
}

export interface ReaperRunDeps {
  auth: AuthLike;
  fetchFacts: (account: ReaperIdpAccount) => Promise<ReaperFacts>;
  logger: Pick<Logger, 'info' | 'warn' | 'error'>;
}

export interface ReaperRunSummary {
  scanned: number;
  actions: Record<ReaperAction, number>;
}

/**
 * Hash parcial del email para logs (PII, Ley 19.628). SHA-256 sobre la forma
 * degradada, truncado a 16 hex chars. Mismo esquema que signup-request.ts →
 * correlación de logs sin revelar el email.
 */
export function hashEmailForLog(email: string): string {
  return createHash('sha256').update(normalizeReaperEmail(email)).digest('hex').slice(0, 16);
}

/**
 * Decide la acción dado el veredicto del predicado + el estado de disable.
 * Pura. `reaperDisabledAt` viene del custom claim seteado en una corrida previa.
 */
export function decideAction(
  reapable: boolean,
  account: { disabled: boolean; reaperDisabledAt?: string | undefined },
  now: Date,
  secondGraceDays: number,
): ReaperAction {
  if (!reapable) {
    return 'skip';
  }
  if (!account.disabled) {
    return 'disable';
  }
  // Ya disabled: solo borrar si LO deshabilitó el reaper y pasó el 2º grace.
  if (account.reaperDisabledAt) {
    const disabledMs = new Date(account.reaperDisabledAt).getTime();
    if (!Number.isNaN(disabledMs) && now.getTime() - disabledMs >= secondGraceDays * MS_PER_DAY) {
      return 'delete';
    }
  }
  return 'wait';
}

/** Cross-ref DB (dual-match `usuarios` + solicitud activa). El email se degrada (OQ-G6). */
export async function fetchReaperFacts(
  pool: PoolLike,
  account: ReaperIdpAccount,
): Promise<ReaperFacts> {
  const degraded = normalizeReaperEmail(account.email as string);
  const usersRes = await pool.query(
    'SELECT firebase_uid, email FROM usuarios WHERE firebase_uid = $1 OR LOWER(TRIM(email)) = $2 LIMIT 1',
    [account.uid, degraded],
  );
  const solRes = await pool.query(
    "SELECT 1 FROM solicitudes_registro WHERE LOWER(TRIM(email)) = $1 AND estado IN ('pendiente_aprobacion','aprobado') LIMIT 1",
    [degraded],
  );
  return {
    usersRows: usersRes.rows.map((r) => ({
      firebaseUid: r.firebase_uid as string,
      email: r.email as string,
    })),
    solicitudActive: (solRes.rowCount ?? 0) > 0,
  };
}

function readReaperDisabledAt(
  claims: Record<string, unknown> | null | undefined,
): string | undefined {
  const v = claims?.reaperDisabledAt;
  return typeof v === 'string' ? v : undefined;
}

/**
 * Corre el reaper sobre todas las cuentas IdP (paginado). Devuelve el resumen.
 * En dry-run no muta; en destructive aplica disable/delete según `decideAction`.
 */
export async function reapInertIdpAccounts(
  deps: ReaperRunDeps,
  config: ReaperRunConfig,
): Promise<ReaperRunSummary> {
  const summary: ReaperRunSummary = {
    scanned: 0,
    actions: { disable: 0, delete: 0, wait: 0, skip: 0 },
  };
  let deletesPlanned = 0;
  const predicateCfg: ReaperConfig = {
    now: config.now,
    graceDays: config.graceDays,
    neverReapable: config.neverReapable,
  };

  let pageToken: string | undefined;
  do {
    const page = await deps.auth.listUsers(1000, pageToken);
    for (const u of page.users) {
      summary.scanned += 1;
      const account: ReaperIdpAccount = {
        uid: u.uid,
        email: u.email ?? null,
        providerData: u.providerData,
        creationTime: u.metadata.creationTime,
        lastSignInTime: u.metadata.lastSignInTime ?? null,
      };

      // Fuera de scope (no Google / sin email): skip sin tocar la DB.
      if (!isGoogleWithEmail(account)) {
        summary.actions.skip += 1;
        continue;
      }

      const facts = await deps.fetchFacts(account);
      const verdict = isReapable(account, facts, predicateCfg);
      const reaperDisabledAt = readReaperDisabledAt(u.customClaims);
      let action = decideAction(
        verdict.reapable,
        { disabled: Boolean(u.disabled), reaperDisabledAt },
        config.now,
        config.secondGraceDays,
      );

      // J-cap (REVIEW): difiere borrados que excedan el cap al próximo tick.
      let capped = false;
      if (action === 'delete') {
        if (deletesPlanned >= config.maxDeletesPerRun) {
          action = 'wait';
          capped = true;
        } else {
          deletesPlanned += 1;
        }
      }
      summary.actions[action] += 1;

      const emailHashed = hashEmailForLog(u.email as string);
      const logFields = {
        event: `reaper.account.${action}`,
        uid: u.uid,
        emailHashed,
        reason: capped
          ? `delete diferido: cap ${config.maxDeletesPerRun}/run alcanzado`
          : verdict.reason,
        destructive: config.destructive,
      };

      if (config.destructive) {
        if (action === 'disable') {
          // B-limbo (REVIEW): marcar reaperDisabledAt ANTES de disable. Si el
          // proceso muere entre ambas, una cuenta disabled-sin-marker quedaría
          // en limbo (wait para siempre). Marcar primero hace que el peor caso
          // sea un marker sin disable (el próximo run la deshabilita).
          await deps.auth.setCustomUserClaims(u.uid, {
            ...(u.customClaims ?? {}),
            reaperDisabledAt: config.now.toISOString(),
          });
          await deps.auth.updateUser(u.uid, { disabled: true });
        } else if (action === 'delete') {
          await deps.auth.deleteUser(u.uid);
        }
      }

      if (action !== 'skip') {
        deps.logger.info(logFields, `reaper: ${action}${config.destructive ? '' : ' (dry-run)'}`);
      }
    }
    pageToken = page.pageToken;
  } while (pageToken);

  deps.logger.info(
    {
      event: 'reaper.run.summary',
      destructive: config.destructive,
      scanned: summary.scanned,
      ...summary.actions,
    },
    'reaper.run.summary',
  );
  return summary;
}

/** Default del cap de borrados por corrida (REVIEW finding J). */
export const DEFAULT_MAX_DELETES_PER_RUN = 50;

/**
 * never-reapable = platform-admins (config) + CSV env + `dev@boosterchile.com`.
 * DEBE coincidir con el set del endpoint (`admin-jobs.ts`) y del script de
 * clasificación (REVIEW finding G — evitar que un path destructivo proteja
 * menos cuentas que otro).
 */
function parseNeverReapable(csv: string | undefined): ReadonlySet<string> {
  const fromCsv = (csv ?? '').split(',').map((e) => normalizeReaperEmail(e));
  return new Set(
    [...appConfig.BOOSTER_PLATFORM_ADMIN_EMAILS, ...fromCsv, 'dev@boosterchile.com'].filter(
      (e) => e.length > 0,
    ),
  );
}

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    process.stderr.write('[reap-inert-idp-accounts] ERROR: DATABASE_URL no definida\n');
    process.exit(1);
  }

  const logger = createLogger({
    service: 'reap-inert-idp-accounts',
    version: appConfig.SERVICE_VERSION,
    level: appConfig.LOG_LEVEL,
  });

  initializeApp();
  const auth = getAuth();
  const pool = new pg.Pool({ connectionString: dbUrl, max: 2 });

  const runConfig: ReaperRunConfig = {
    destructive: process.env.REAPER_DESTRUCTIVE === 'true',
    graceDays: Number(process.env.REAPER_GRACE_DAYS ?? DEFAULT_REAPER_GRACE_DAYS),
    secondGraceDays: Number(process.env.REAPER_SECOND_GRACE_DAYS ?? DEFAULT_REAPER_GRACE_DAYS),
    neverReapable: parseNeverReapable(process.env.REAPER_NEVER_REAPABLE_EMAILS),
    now: new Date(),
    maxDeletesPerRun: Number(process.env.REAPER_MAX_DELETES_PER_RUN ?? DEFAULT_MAX_DELETES_PER_RUN),
  };

  try {
    const summary = await reapInertIdpAccounts(
      { auth, fetchFacts: (account) => fetchReaperFacts(pool, account), logger },
      runConfig,
    );
    logger.info({ event: 'reaper.run.done', ...summary.actions }, 'reaper done');
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`[reap-inert-idp-accounts] failed: ${String(err)}\n`);
    process.exit(1);
  });
}
