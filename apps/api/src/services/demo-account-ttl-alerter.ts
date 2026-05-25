import type { Logger } from '@booster-ai/logger';
import { isNull } from 'drizzle-orm';
import type { Auth } from 'firebase-admin/auth';
import type Redis from 'ioredis';
import type { Db } from '../db/client.js';
import { cuentasDemo } from '../db/schema.js';

/**
 * T6a SEC-001 Sprint 2a — TTL alerter de cuentas demo.
 *
 * Cron daily 06:00 Santiago (vía Cloud Scheduler) invoca este service
 * a través de `POST /admin/jobs/demo-account-ttl-alert`. El service:
 *
 *   1. Lee `firebase_uid` de cuentas_demo WHERE deshabilitado_en IS NULL.
 *   2. Por cada UID, llama Firebase Admin SDK `getUser(uid)`.
 *   3. Lee `customClaims.expires_at` del UserRecord.
 *   4. Calcula `days_remaining = (expires_at - now) / 86400000`.
 *   5. Si `days_remaining <= 7` Y no se alertó hoy → emite structured
 *      log `{ event: "demo.ttl_low", persona, days_remaining, uid }`.
 *
 * Redis dedup key `demo-ttl-alerted:<uid>:<YYYY-MM-DD>` con TTL 24h
 * evita re-alertar dentro del mismo día. Si el cron corre 2× por
 * cualquier razón, solo el primero alerta.
 *
 * Log-based metric `google_logging_metric` filter on
 * `jsonPayload.event = "demo.ttl_low"` cuenta los eventos. Alert
 * policy fires si `rate(metric) > 0` sustained 1min (= TTL low).
 *
 * Per plan v4 P0-R4-2 (conditional-counter pattern): emite log SOLO
 * cuando hay condición que alertar; no every-tick. Matches existing
 * `telemetry-monitoring.tf` counter patterns sin gauge complexity.
 *
 * Spec sec-001-cierre §3 H1.1 SC-1.1.6. ADR-053.
 */

const TTL_ALERT_THRESHOLD_DAYS = 7;
const DEDUP_KEY_PREFIX = 'demo-ttl-alerted:';
const DEDUP_TTL_SECONDS = 86_400; // 24h

export interface DemoTtlAlerterOptions {
  db: Db;
  firebaseAuth: Auth;
  redis: Redis;
  logger: Logger;
}

export interface DemoTtlAlerterResult {
  scanned: number;
  alerted: number;
  deduplicated: number;
  skippedSafe: number;
  errors: number;
}

function dedupKey(uid: string, dateUtcIso: string): string {
  const day = dateUtcIso.slice(0, 10); // YYYY-MM-DD
  return `${DEDUP_KEY_PREFIX}${uid}:${day}`;
}

function daysRemaining(expiresAtIso: string, nowMs: number): number | null {
  const parsed = Date.parse(expiresAtIso);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return Math.floor((parsed - nowMs) / 86_400_000);
}

/**
 * Scan cuentas_demo activas, computa days_remaining per UID, emite log
 * `demo.ttl_low` solo cuando ≤ TTL_ALERT_THRESHOLD_DAYS Y no se alertó
 * hoy (Redis dedup).
 *
 * Idempotent: corridas múltiples en el mismo día son no-op (dedup key).
 * Tolerante a fallos individuales: errores en un UID (Firebase 5xx,
 * Redis transient) loguean error y siguen con los demás.
 */
export async function runDemoTtlAlerter(
  opts: DemoTtlAlerterOptions,
): Promise<DemoTtlAlerterResult> {
  const { db, firebaseAuth, redis, logger } = opts;
  const result: DemoTtlAlerterResult = {
    scanned: 0,
    alerted: 0,
    deduplicated: 0,
    skippedSafe: 0,
    errors: 0,
  };
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // 1. Lookup cuentas activas con firebase_uid asignado.
  const rows = await db
    .select({ persona: cuentasDemo.persona, firebaseUid: cuentasDemo.firebaseUid })
    .from(cuentasDemo)
    .where(isNull(cuentasDemo.deshabilitadoEn));

  const activeUids = rows.filter(
    (r): r is { persona: typeof r.persona; firebaseUid: string } =>
      r.firebaseUid !== null && r.firebaseUid !== undefined,
  );

  for (const row of activeUids) {
    result.scanned += 1;
    try {
      const user = await firebaseAuth.getUser(row.firebaseUid);
      const expiresAt = user.customClaims?.expires_at;
      if (typeof expiresAt !== 'string' || expiresAt.length === 0) {
        // Claim ausente en cuenta active = estado inválido. Logueamos
        // warn (no es alert formal, pero queda en logs para audit).
        logger.warn(
          { persona: row.persona, uid: row.firebaseUid },
          'demo-ttl-alerter: cuenta active sin expires_at claim (estado inválido)',
        );
        result.errors += 1;
        continue;
      }

      const days = daysRemaining(expiresAt, nowMs);
      if (days === null) {
        logger.warn(
          { persona: row.persona, uid: row.firebaseUid, expires_at: expiresAt },
          'demo-ttl-alerter: expires_at no parseable',
        );
        result.errors += 1;
        continue;
      }

      if (days > TTL_ALERT_THRESHOLD_DAYS) {
        result.skippedSafe += 1;
        continue;
      }

      // 2. Dedup check — si ya alertamos hoy, skip.
      const key = dedupKey(row.firebaseUid, nowIso);
      const setNxResult = await redis.set(key, '1', 'EX', DEDUP_TTL_SECONDS, 'NX');
      if (setNxResult !== 'OK') {
        result.deduplicated += 1;
        continue;
      }

      // 3. Emit structured log con event field — el log-based metric
      //    filter matchea jsonPayload.event = "demo.ttl_low".
      logger.warn(
        {
          event: 'demo.ttl_low',
          persona: row.persona,
          uid: row.firebaseUid,
          days_remaining: days,
          expires_at: expiresAt,
        },
        'demo TTL low — renew via harden-demo-accounts.mjs --renew <uid> --extend-days 30',
      );
      result.alerted += 1;
    } catch (err) {
      logger.error(
        { persona: row.persona, uid: row.firebaseUid, err },
        'demo-ttl-alerter: failed to evaluate UID',
      );
      result.errors += 1;
    }
  }

  logger.info({ ...result }, 'demo-ttl-alerter: scan complete');
  return result;
}
