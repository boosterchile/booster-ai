/**
 * Endpoints de Web Push (P3.c).
 *
 *   - POST   /me/push-subscription            — registrar/actualizar (auth Firebase)
 *   - DELETE /me/push-subscription            — borrar (toggle off, auth Firebase)
 *   - GET    /webpush/vapid-public-key        — PÚBLICO (sin auth) para subscribe
 *
 * El layout de URLs separa las dos partes:
 *   - /me/push-subscription* requiere auth (Firebase ID token).
 *   - /webpush/vapid-public-key es público — el browser lo llama antes de
 *     poder authenticarse (idealmente al primer load para ofrecer activar
 *     push). Devolver la public key sin auth no es secreto: es lo que
 *     identifica al sender en el push service.
 */

import type { Logger } from '@booster-ai/logger';
import { zValidator } from '@hono/zod-validator';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { pushSubscriptions } from '../db/schema.js';
import type { FirebaseClaims } from '../middleware/firebase-auth.js';

const subscribeBodySchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

const unsubscribeBodySchema = z.object({
  endpoint: z.string().url(),
});

// ---------------------------------------------------------------------------
// Router auth requerido — /me/push-subscription
// ---------------------------------------------------------------------------
export function createMePushSubscriptionRoutes(opts: { db: Db; logger: Logger }) {
  const app = new Hono();

  // biome-ignore lint/suspicious/noExplicitAny: hono Context generics complejos
  function requireUser(c: Context<any, any, any>) {
    const userContext = c.get('userContext');
    if (!userContext?.user) {
      return { ok: false as const, response: c.json({ error: 'unauthorized' }, 401) };
    }
    return { ok: true as const, userId: userContext.user.id as string };
  }

  // -------------------------------------------------------------------------
  // POST /me/push-subscription — registrar o re-activar
  // -------------------------------------------------------------------------
  app.post('/', zValidator('json', subscribeBodySchema), async (c) => {
    const auth = requireUser(c);
    if (!auth.ok) {
      return auth.response;
    }

    const body = c.req.valid('json');
    const userAgent = c.req.header('user-agent') ?? null;

    // UPSERT por endpoint: si el browser revoca y vuelve a aceptar, el
    // endpoint puede ser el mismo (varía por provider). Insertar
    // duplicado falla por UNIQUE — usamos ON CONFLICT DO UPDATE para
    // re-activar y rotar keys/user_agent.
    await opts.db
      .insert(pushSubscriptions)
      .values({
        userId: auth.userId,
        endpoint: body.endpoint,
        p256dhKey: body.keys.p256dh,
        authKey: body.keys.auth,
        userAgent,
        status: 'activa',
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          userId: auth.userId,
          p256dhKey: body.keys.p256dh,
          authKey: body.keys.auth,
          userAgent,
          status: 'activa',
          lastFailedAt: null,
          updatedAt: new Date(),
        },
      });

    opts.logger.info(
      { userId: auth.userId, endpointHost: new URL(body.endpoint).host },
      'push subscription registrada',
    );

    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // DELETE /me/push-subscription — borrar (toggle off de este device)
  // -------------------------------------------------------------------------
  app.delete('/', zValidator('json', unsubscribeBodySchema), async (c) => {
    const auth = requireUser(c);
    if (!auth.ok) {
      return auth.response;
    }
    const body = c.req.valid('json');

    // Hard-delete solo de la fila de este usuario. El endpoint va en el
    // WHERE junto con userId: borrar primero y mirar el dueño después
    // eliminaba la suscripción de otra persona.
    const deleted = await opts.db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.endpoint, body.endpoint),
          eq(pushSubscriptions.userId, auth.userId),
        ),
      )
      .returning({ id: pushSubscriptions.id });

    return c.json({ ok: true, removed: deleted.length });
  });

  return app;
}

// ---------------------------------------------------------------------------
// Router público — /webpush/vapid-public-key
// ---------------------------------------------------------------------------
export function createWebpushPublicRoutes(opts: { vapidPublicKey?: string }) {
  const app = new Hono();

  app.get('/vapid-public-key', (c) => {
    if (!opts.vapidPublicKey) {
      return c.json({ error: 'webpush_disabled', code: 'webpush_disabled' }, 503);
    }
    // Devolver como JSON simple — el cliente lo consume con fetch y lo
    // pasa a `pushManager.subscribe({applicationServerKey: <key>})`.
    return c.json({
      public_key: opts.vapidPublicKey,
    });
  });

  return app;
}

// Type export para uso externo si hace falta.
export type { FirebaseClaims };
