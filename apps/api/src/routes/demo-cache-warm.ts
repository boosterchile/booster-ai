import type { Logger } from '@booster-ai/logger';
import { personaDemoSchema } from '@booster-ai/shared-schemas';
import { eq } from 'drizzle-orm';
import type { Auth } from 'firebase-admin/auth';
import { Hono } from 'hono';
import type Redis from 'ioredis';
import type { Db } from '../db/client.js';
import { cuentasDemo } from '../db/schema.js';

/**
 * T5 SEC-001 Sprint 2a — demo-cache-warm public endpoint.
 *
 * `GET /api/v1/demo/cache-warm/:persona` — pre-warm el cache Redis del
 * middleware demo-expires (key `demo-claim:<uid>`). Llamado fire-and-
 * forget desde el landing demo (`apps/web/src/routes/demo.tsx`) en
 * useEffect on mount, así el primer click del usuario en una card demo
 * tiene latencia cached (~5ms p95) en vez de uncached (~200ms).
 *
 * Diseño per spec sec-001-cierre §3 H1.1 SC-1.1.2b:
 *   1. Lookup `firebase_uid` from `cuentas_demo` WHERE persona=X AND
 *      deshabilitado_en IS NULL.
 *   2. firebase Admin SDK `getUser(uid)` server-side.
 *   3. SET Redis key `demo-claim:<uid>` con snapshot serializado JSON
 *      TTL 60s (mismo TTL que el middleware lee).
 *   4. Response 204 No Content (success), 404 si persona o UID no
 *      existe, 503 si Firebase/Redis fail.
 *
 * Side-effect-free desde el caller's POV: el cache write es idempotent
 * (mismo snapshot escrito 2 veces = mismo estado). NO emite token, no
 * crea session, no muta cuentas_demo.
 *
 * Abuse mitigation per plan T5 P2-R2-3: aplica IP rate-limit inline
 * (10 req/min/IP) directo via Redis pipeline. Sin esto un attacker
 * podría enumerar Firebase Admin SDK quota.
 *
 * Endpoint público (no firebaseAuth required) por design — el caller
 * es el browser anonymous antes del demo login.
 */

const CACHE_KEY_PREFIX = 'demo-claim:';
const CACHE_TTL_SECONDS = 60;
const IP_RATE_LIMIT = 10;
const IP_RATE_WINDOW_SECONDS = 60;
const IP_RL_KEY_PREFIX = 'rl:demo-cache-warm:ip:';

export interface DemoCacheWarmOptions {
  db: Db;
  auth: Auth;
  redis: Redis;
  logger: Logger;
}

interface CachedUserSnapshot {
  uid: string;
  disabled: boolean;
  customClaims: Record<string, unknown>;
}

function extractClientIp(c: import('hono').Context): string {
  // X-Forwarded-For mismo patrón que rate-limit-pin (ADR-009 trust
  // boundary: Cloud Run LB setea el header en prod). En dev sin LB,
  // caemos al string 'unknown' que comparte bucket — aceptable.
  const xff = c.req.header('x-forwarded-for');
  if (xff) {
    return xff.split(',')[0]?.trim() ?? 'unknown';
  }
  return 'unknown';
}

export function createDemoCacheWarmRoutes(opts: DemoCacheWarmOptions): Hono {
  const app = new Hono();

  app.get('/cache-warm/:persona', async (c) => {
    // 1. IP rate-limit pre-check (10/min/IP).
    const ip = extractClientIp(c);
    const rlKey = `${IP_RL_KEY_PREFIX}${ip}`;
    try {
      const pipeline = opts.redis.multi();
      pipeline.incr(rlKey);
      pipeline.expire(rlKey, IP_RATE_WINDOW_SECONDS);
      const result = (await pipeline.exec()) as Array<[Error | null, number]> | null;
      const incrCount = result?.[0]?.[1];
      if (typeof incrCount === 'number' && incrCount > IP_RATE_LIMIT) {
        c.header('Retry-After', String(IP_RATE_WINDOW_SECONDS));
        return c.json({ error: 'rate_limited', scope: 'ip' }, 429);
      }
    } catch (err) {
      // Redis unreachable: fail-closed para rate-limit (defensa de
      // seguridad no degradable) — pero acá lo tratamos como degraded
      // path: seguimos al cache-warm sin contar el hit. Razón: cache-
      // warm es endpoint best-effort (fire-and-forget desde el client);
      // si Redis está down, ya el middleware demo-expires va a fail-
      // closed también. No queremos que rate-limit cuelgue todo.
      opts.logger.warn({ err, ip }, 'demo-cache-warm: rate-limit check failed, proceeding');
    }

    // 2. Validate persona param contra el enum Spanish.
    const personaParam = c.req.param('persona');
    const personaParsed = personaDemoSchema.safeParse(personaParam);
    if (!personaParsed.success) {
      return c.json({ error: 'invalid_persona', allowed: personaDemoSchema.options }, 400);
    }
    const persona = personaParsed.data;

    // 3. Lookup firebase_uid en cuentas_demo (active rows only).
    const rows = await opts.db
      .select({ firebaseUid: cuentasDemo.firebaseUid })
      .from(cuentasDemo)
      .where(eq(cuentasDemo.persona, persona))
      .limit(2); // 2 = detectar duplicados activos (estado inconsistente)
    const activeRows = rows.filter((r) => r.firebaseUid !== null);
    if (activeRows.length === 0) {
      // Sin row active = T4 recreate no se ejecutó todavía o cuenta
      // retired. Cache-warm es no-op.
      opts.logger.info({ persona }, 'demo-cache-warm: no active cuenta_demo row, skip cache warm');
      return c.body(null, 204);
    }
    const firebaseUid = activeRows[0]?.firebaseUid;
    if (!firebaseUid) {
      return c.body(null, 204);
    }

    // 4. Firebase Admin SDK getUser → cache snapshot.
    try {
      const user = await opts.auth.getUser(firebaseUid);
      const snapshot: CachedUserSnapshot = {
        uid: user.uid,
        disabled: Boolean(user.disabled),
        customClaims: (user.customClaims ?? {}) as Record<string, unknown>,
      };
      await opts.redis.set(
        `${CACHE_KEY_PREFIX}${firebaseUid}`,
        JSON.stringify(snapshot),
        'EX',
        CACHE_TTL_SECONDS,
      );
      return c.body(null, 204);
    } catch (err) {
      opts.logger.warn(
        { err, persona, firebaseUid },
        'demo-cache-warm: failed to fetch/cache Firebase user (degraded, middleware will fetch live on first hit)',
      );
      // 503 no porque el endpoint es best-effort + el middleware
      // demo-expires hará fallback live. Caller fire-and-forget no
      // necesita conocer el detalle.
      return c.body(null, 503);
    }
  });

  return app;
}
