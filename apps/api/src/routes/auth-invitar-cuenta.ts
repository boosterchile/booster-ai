import type { Logger } from '@booster-ai/logger';
import {
  consultarInvitacionCorreoResponseSchema,
  crearCuentaInvitacionResponseSchema,
  crearCuentaInvitacionSchema,
  tokenInvitacionCorreoSchema,
} from '@booster-ai/shared-schemas';
import type { Auth } from 'firebase-admin/auth';
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import type { Db } from '../db/client.js';
import { zValidator } from '../lib/validation.js';
import { getBusinessCounter } from '../observability/business-metrics.js';
import { setResultAttributes, withBusinessSpan } from '../observability/business-span.js';
import {
  consultarInvitacionPorToken,
  crearCuentaDesdeInvitacion,
} from '../services/invitar-correo-cuenta.js';

/**
 * ADR-093 — `GET/POST /auth/invitar-cuenta`.
 *
 * Público por diseño: la persona todavía no tiene sesión. Defensas: token
 * opaco one-shot con hash en DB + vencimiento; Zod en boundaries; rate-limit
 * IP en el mount. Uniforme 410 `invitacion_invalida` si el token no sirve.
 *
 * El secreto viaja en header `x-invite-token` (mismo patrón que
 * `x-onboarding-token` en `/empresas/onboarding-admin`). Nunca como query del
 * API: Cloud Run registra `httpRequest.requestUrl` y filtraría el nonce.
 * La PWA sí puede recibir `?token=` en el mail; el cliente lo reenvía en header.
 */

/** Header bearer del token de invitación (GET consultar; no query). */
export const INVITE_TOKEN_HEADER = 'x-invite-token';

export function createAuthInvitarCuentaRoutes(opts: {
  db: Db;
  logger: Logger;
  firebaseAuth: Auth;
  rateLimit: MiddlewareHandler;
}): Hono {
  const app = new Hono();

  app.get('/invitar-cuenta', opts.rateLimit, async (c) => {
    return await withBusinessSpan({ name: 'invitar_correo_cuenta.consultar' }, async (span) => {
      const raw = c.req.header(INVITE_TOKEN_HEADER) ?? '';
      const parsed = tokenInvitacionCorreoSchema.safeParse(raw);
      if (!parsed.success) {
        getBusinessCounter('invitar_correo_cuenta_consultar_total').add(1, {
          resultado: 'invitacion_invalida',
        });
        setResultAttributes(span, { 'invitar_correo_cuenta.resultado': 'invitacion_invalida' });
        return c.json({ error: 'gone', code: 'invitacion_invalida' }, 410);
      }

      const r = await consultarInvitacionPorToken(opts.db, parsed.data);
      if (!r.ok) {
        getBusinessCounter('invitar_correo_cuenta_consultar_total').add(1, {
          resultado: r.code,
        });
        setResultAttributes(span, { 'invitar_correo_cuenta.resultado': r.code });
        return c.json({ error: 'gone', code: 'invitacion_invalida' }, 410);
      }

      getBusinessCounter('invitar_correo_cuenta_consultar_total').add(1, { resultado: 'ok' });
      setResultAttributes(span, {
        'invitar_correo_cuenta.resultado': 'ok',
        'invitar_correo_cuenta.tipo': r.tipo,
      });
      return c.json(
        consultarInvitacionCorreoResponseSchema.parse({
          email: r.email,
          tipo: r.tipo,
          expira_en: r.expiraEn.toISOString(),
        }),
        200,
      );
    });
  });

  app.post(
    '/invitar-cuenta',
    opts.rateLimit,
    zValidator('json', crearCuentaInvitacionSchema),
    async (c) => {
      const body = c.req.valid('json');

      return await withBusinessSpan({ name: 'invitar_correo_cuenta.crear' }, async (span) => {
        const r = await crearCuentaDesdeInvitacion({
          db: opts.db,
          logger: opts.logger,
          firebaseAuth: opts.firebaseAuth,
          token: body.token,
          fullName: body.full_name,
          password: body.password,
          rut: body.rut,
        });

        if (!r.ok) {
          getBusinessCounter('invitar_correo_cuenta_crear_total').add(1, { resultado: r.code });
          setResultAttributes(span, { 'invitar_correo_cuenta.resultado': r.code });
          if (r.code === 'invitacion_invalida') {
            return c.json({ error: 'gone', code: 'invitacion_invalida' }, 410);
          }
          return c.json({ error: 'conflict', code: r.code }, 409);
        }

        let customToken: string | null = null;
        try {
          customToken = await opts.firebaseAuth.createCustomToken(r.firebaseUid, {
            booster_user_id: r.userId,
          });
        } catch (err) {
          opts.logger.warn(
            {
              user_id: r.userId,
              error: err instanceof Error ? err.name : 'desconocido',
            },
            'invitar-correo-cuenta: createCustomToken falló; cuenta lista, entra por login',
          );
        }

        getBusinessCounter('invitar_correo_cuenta_crear_total').add(1, {
          resultado: 'ok',
          tipo: r.tipo,
        });
        setResultAttributes(span, {
          'invitar_correo_cuenta.resultado': 'ok',
          'invitar_correo_cuenta.tipo': r.tipo,
        });

        return c.json(
          crearCuentaInvitacionResponseSchema.parse({
            ok: true,
            user_id: r.userId,
            email: r.email,
            tipo: r.tipo,
            custom_token: customToken,
          }),
          201,
        );
      });
    },
  );

  return app;
}
