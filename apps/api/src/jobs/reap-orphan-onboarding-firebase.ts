// =============================================================================
// Job — reaper del usuario Firebase huérfano del onboarding admin-provisioned
// (onboarding-flow-redesign T1.7)
// =============================================================================
// Spec: .specs/onboarding-flow-redesign/spec.md §9 (riesgo huérfano).
// Plan: .specs/onboarding-flow-redesign/plan.md T1.7.
//
// El approve admin-provisioned (T1.3) crea un usuario Firebase y persiste su
// `firebase_uid` ANTES de que el dueño complete el onboarding. Si el token
// expira sin consumirse, ese usuario Firebase queda HUÉRFANO (credencial viva,
// email verificable). El reaper de cuentas inertes NO lo limpia: protege las
// solicitudes `aprobado` (reaper-predicate.ts `solicitudActive`). Este job es el
// limpiador dedicado: borra el usuario Firebase vía `firebase_uid` y marca la
// fila (nulea `firebase_uid`, marcador idempotente).
//
// Selección (clock de la BD, consistente con el consumo T1.5a):
//   estado='aprobado' AND token_hash NOT NULL AND consumido_en IS NULL
//   AND expira_en < now() AND firebase_uid NOT NULL
//
// SEGURIDAD / postura:
//   - **dry-run default** (`destructive=false`): NO borra; solo loguea/cuenta lo
//     que haría. El modo destructivo requiere `ONBOARDING_ORPHAN_REAPER_DESTRUCTIVE=true`
//     (flag PROPIO, no acoplado al reaper de inertes) + el gate de primer-run
//     destructivo (dry-run revisado + sign-off PO), igual que el otro reaper.
//   - Cap de borrados por corrida (acota blast radius de un false-positive).
//   - **Trigger**: hoy es un script `tsx` MANUAL (no Cloud Run Job todavía). Por
//     tanto NO es una mitigación de seguridad automática — es higiene operacional.
//     El riesgo "huérfano Firebase" del spec §9 queda ABIERTO hasta cablear un
//     Cloud Scheduler; ese cableado es gate del flip de ADMIN_PROVISIONED_ONBOARDING_ENABLED
//     (ver plan.md Cierre Fase 1).
//
// Variables (main):
//   DATABASE_URL                              inyectado vía Secret Manager
//   ONBOARDING_ORPHAN_REAPER_DESTRUCTIVE      "true" para borrar; otro = dry-run (default)
//   ONBOARDING_ORPHAN_REAPER_MAX_DELETES      default 50
// =============================================================================

import { type Logger, createLogger } from '@booster-ai/logger';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import pg from 'pg';
import { config as appConfig } from '../config.js';

/** Default del cap de borrados por corrida (acota blast radius de false-positive). */
export const DEFAULT_ORPHAN_MAX_DELETES_PER_RUN = 50;

export interface OnboardingOrphan {
  /** `solicitudes_registro.id`. */
  id: string;
  /** uid del usuario Firebase huérfano a borrar. */
  firebaseUid: string;
}

export interface OrphanReaperDeps {
  /** Solo `deleteUser` — el job no lista ni modifica otras cuentas. */
  auth: { deleteUser(uid: string): Promise<void> };
  /** Devuelve los huérfanos (expirados, no-consumidos, con firebase_uid). */
  listOrphans(): Promise<OnboardingOrphan[]>;
  /** Marca la fila como recolectada (nulea firebase_uid → idempotente). */
  markReaped(id: string): Promise<void>;
  logger: Pick<Logger, 'info' | 'warn' | 'error'>;
}

export interface OrphanReaperConfig {
  destructive: boolean;
  maxDeletesPerRun: number;
}

export interface OrphanReaperSummary {
  scanned: number;
  /** Borrados (o que se borrarían en dry-run). */
  deleted: number;
  /** El usuario Firebase ya no existía (auth/user-not-found); fila marcada igual. */
  alreadyGone: number;
  /** Diferidos por el cap; se procesan en el próximo tick. */
  deferred: number;
  /** deleteUser falló por causa no-recuperable; NO se marca, se reintenta. */
  errors: number;
}

/**
 * Recolecta los usuarios Firebase huérfanos del onboarding admin-provisioned.
 * Puro respecto de I/O (todo vía `deps`). En dry-run cuenta/loguea sin borrar.
 */
export async function reapOrphanOnboardingFirebaseUsers(
  deps: OrphanReaperDeps,
  config: OrphanReaperConfig,
): Promise<OrphanReaperSummary> {
  const orphans = await deps.listOrphans();
  const summary: OrphanReaperSummary = {
    scanned: orphans.length,
    deleted: 0,
    alreadyGone: 0,
    deferred: 0,
    errors: 0,
  };
  let deletesPlanned = 0;

  for (const orphan of orphans) {
    // Cap (evaluado también en dry-run para que el preview refleje el destructivo).
    if (deletesPlanned >= config.maxDeletesPerRun) {
      summary.deferred += 1;
      deps.logger.info(
        {
          event: 'onboarding-orphan-reaper.deferred',
          solicitudId: orphan.id,
          firebaseUid: orphan.firebaseUid,
          reason: `cap ${config.maxDeletesPerRun}/run alcanzado`,
        },
        'onboarding-orphan-reaper: deferred (cap)',
      );
      continue;
    }
    deletesPlanned += 1;

    if (!config.destructive) {
      summary.deleted += 1;
      deps.logger.info(
        {
          event: 'onboarding-orphan-reaper.would-delete',
          solicitudId: orphan.id,
          firebaseUid: orphan.firebaseUid,
        },
        'onboarding-orphan-reaper: would delete (dry-run)',
      );
      continue;
    }

    try {
      await deps.auth.deleteUser(orphan.firebaseUid);
      summary.deleted += 1;
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === 'auth/user-not-found') {
        // Ya no existe: la fila se marca igual (idempotente).
        summary.alreadyGone += 1;
      } else {
        // Error recuperable (red/quota): NO marcar → se reintenta el próximo run.
        summary.errors += 1;
        deps.logger.error(
          { err, solicitudId: orphan.id, firebaseUid: orphan.firebaseUid },
          'onboarding-orphan-reaper: deleteUser failed; will retry next run',
        );
        continue;
      }
    }

    await deps.markReaped(orphan.id);
    deps.logger.info(
      {
        event: 'onboarding-orphan-reaper.reaped',
        solicitudId: orphan.id,
        firebaseUid: orphan.firebaseUid,
      },
      'onboarding-orphan-reaper: reaped',
    );
  }

  deps.logger.info(
    {
      event: 'onboarding-orphan-reaper.run.summary',
      destructive: config.destructive,
      ...summary,
    },
    'onboarding-orphan-reaper.run.summary',
  );
  return summary;
}

interface PoolLike {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
}

/** SELECT de huérfanos: aprobados con token vivo-pero-vencido sin consumir. */
export async function listOnboardingOrphans(pool: PoolLike): Promise<OnboardingOrphan[]> {
  const res = await pool.query(
    `SELECT id, firebase_uid
       FROM solicitudes_registro
      WHERE estado = 'aprobado'
        AND token_hash IS NOT NULL
        AND consumido_en IS NULL
        AND expira_en < now()
        AND firebase_uid IS NOT NULL`,
  );
  return res.rows.map((r) => ({ id: r.id as string, firebaseUid: r.firebase_uid as string }));
}

/** Marca la fila como recolectada: nulea firebase_uid (idempotente). */
export async function markOnboardingOrphanReaped(pool: PoolLike, id: string): Promise<void> {
  await pool.query('UPDATE solicitudes_registro SET firebase_uid = NULL WHERE id = $1', [id]);
}

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    process.stderr.write('[reap-orphan-onboarding-firebase] ERROR: DATABASE_URL no definida\n');
    process.exit(1);
  }

  const logger = createLogger({
    service: 'reap-orphan-onboarding-firebase',
    version: appConfig.SERVICE_VERSION,
    level: appConfig.LOG_LEVEL,
  });

  initializeApp();
  const auth = getAuth();
  const pool = new pg.Pool({ connectionString: dbUrl, max: 2 });

  const runConfig: OrphanReaperConfig = {
    destructive: process.env.ONBOARDING_ORPHAN_REAPER_DESTRUCTIVE === 'true',
    maxDeletesPerRun: Number(
      process.env.ONBOARDING_ORPHAN_REAPER_MAX_DELETES ?? DEFAULT_ORPHAN_MAX_DELETES_PER_RUN,
    ),
  };

  try {
    const summary = await reapOrphanOnboardingFirebaseUsers(
      {
        auth: { deleteUser: (uid) => auth.deleteUser(uid) },
        listOrphans: () => listOnboardingOrphans(pool),
        markReaped: (id) => markOnboardingOrphanReaped(pool, id),
        logger,
      },
      runConfig,
    );
    logger.info({ event: 'onboarding-orphan-reaper.run.done', ...summary }, 'orphan reaper done');
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`[reap-orphan-onboarding-firebase] failed: ${String(err)}\n`);
    process.exit(1);
  });
}
